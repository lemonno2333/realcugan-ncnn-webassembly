#include <atomic>
#include <chrono>
#include <cstdint>
#include <iostream>
#include <limits>
#include <memory>
#include <new>
#include <string>
#include <emscripten.h>

#ifdef REALCUGAN_USE_PTHREADS
#include <thread>
#endif

#include <cpu.h>
#include "realcugan.h"

enum ProcessError {
    PROCESS_OK = 0,
    PROCESS_BUSY = -1,
    PROCESS_INVALID_POINTER = -2,
    PROCESS_INVALID_DIMENSIONS = -3,
    PROCESS_INVALID_OPTIONS = -4,
    PROCESS_SIZE_OVERFLOW = -5,
    PROCESS_BUFFER_TOO_SMALL = -6,
    PROCESS_ALLOCATION_FAILED = -7,
    PROCESS_MODEL_PARAM_FAILED = -8,
    PROCESS_MODEL_BIN_FAILED = -9,
    PROCESS_INFERENCE_FAILED = -10,
    PROCESS_INTERNAL_ERROR = -11
};

enum TaskState {
    TASK_IDLE = 0,
    TASK_RUNNING = 1,
    TASK_CANCELLING = 2
};

struct Task {
    int image_id;
    unsigned char *input_image_data;
    unsigned char *output_image_data;
    std::unique_ptr<unsigned char[]> alpha_data;
    int input_w;
    int input_h;
    int scale;
    int noise;
    int model_type;
    int thread_count;
    int tile_size;
};

struct TaskResult {
    int code;
    long cost;
    const char *message;
};

static std::unique_ptr<RealCUGAN> realcugan;
static std::unique_ptr<Task> proc_img_task;
static std::atomic<bool> cancel_requested(false);
static std::atomic<int> task_state(TASK_IDLE);

#ifdef REALCUGAN_USE_PTHREADS
static ncnn::Mutex lock;
static ncnn::ConditionVariable condition;
#endif

static bool checked_multiply_size(size_t left, size_t right, size_t *result) {
    if (left != 0 && right > std::numeric_limits<size_t>::max() / left) {
        return false;
    }
    *result = left * right;
    return true;
}

static bool is_supported_options(int scale, int noise, int model_type) {
    if (model_type == 0) {
        if (scale == 2) {
            return noise == -1 || noise == 0 || noise == 1 || noise == 2 || noise == 3;
        }
        if (scale == 3 || scale == 4) {
            return noise == -1 || noise == 0 || noise == 3;
        }
        return false;
    }
    if (model_type == 1 && (scale == 2 || scale == 3)) {
        return noise == -1 || noise == 0 || noise == 3;
    }
    return false;
}

static bool is_supported_runtime_options(int thread_count, int tile_size) {
    if (thread_count < 1 || thread_count > 4) {
        return false;
    }
    return tile_size == 128 || tile_size == 160 || tile_size == 200;
}

static void remove_alpha_channel(unsigned char *image_data, size_t pixel_count) {
    for (size_t i = 0; i < pixel_count; i++) {
        image_data[i * 3] = image_data[i * 4];
        image_data[i * 3 + 1] = image_data[i * 4 + 1];
        image_data[i * 3 + 2] = image_data[i * 4 + 2];
    }
}

static void extract_alpha_channel(const unsigned char *rgba_data, unsigned char *alpha_out,
                                  size_t pixel_count) {
    for (size_t i = 0; i < pixel_count; i++) {
        alpha_out[i] = rgba_data[i * 4 + 3];
    }
}

static bool has_transparent_alpha(const unsigned char *rgba_data, size_t pixel_count) {
    for (size_t i = 0; i < pixel_count; i++) {
        if (rgba_data[i * 4 + 3] != 255) {
            return true;
        }
    }
    return false;
}

static void process_image_success_callback(int image_id, long cost) {
    MAIN_THREAD_EM_ASM({
        if (Module.onBackendComplete) {
            Module.onBackendComplete($0, $1);
        }
    }, image_id, cost);
}

static void process_image_cancelled_callback(int image_id) {
    MAIN_THREAD_EM_ASM({
        if (Module.onBackendCancelled) {
            Module.onBackendCancelled($0);
        }
    }, image_id);
}

static void process_image_error_callback(int image_id, int code, const char *message) {
    MAIN_THREAD_EM_ASM({
        if (Module.onBackendError) {
            Module.onBackendError($0, $1, UTF8ToString($2));
        }
    }, image_id, code, message);
}

static TaskResult run_task(Task *task) {
    const std::chrono::steady_clock::time_point begin = std::chrono::steady_clock::now();
    std::cout << "process start" << std::endl;

    try {
        if (!realcugan) {
            realcugan.reset(new (std::nothrow) RealCUGAN());
            if (!realcugan) {
                return {PROCESS_ALLOCATION_FAILED, 0, "runtime_allocation_failed"};
            }
        }
        realcugan->configure_runtime(task->thread_count, task->tile_size);

        if (!realcugan->is_loaded(task->scale, task->noise, task->model_type)) {
            const int load_result = realcugan->load(task->scale, task->noise, task->model_type);
            if (load_result == REALCUGAN_LOAD_PARAM_FAILED) {
                return {PROCESS_MODEL_PARAM_FAILED, 0, "model_param_load_failed"};
            }
            if (load_result == REALCUGAN_LOAD_MODEL_FAILED) {
                return {PROCESS_MODEL_BIN_FAILED, 0, "model_bin_load_failed"};
            }
            if (load_result != REALCUGAN_LOAD_OK) {
                return {PROCESS_INTERNAL_ERROR, 0, "model_load_failed"};
            }
            realcugan->configure_runtime(task->thread_count, task->tile_size);
        }

        ncnn::Mat input(task->input_w, task->input_h, task->input_image_data, static_cast<size_t>(3), 3);

        const int process_result = realcugan->process(input, task->output_image_data,
                                                      task->alpha_data.get(), &cancel_requested);
        if (process_result == REALCUGAN_PROCESS_CANCELLED) {
            return {PROCESS_OK, 0, "cancelled"};
        }
        if (process_result != REALCUGAN_PROCESS_OK) {
            return {PROCESS_INFERENCE_FAILED, 0, "inference_failed"};
        }

        const std::chrono::steady_clock::time_point end = std::chrono::steady_clock::now();
        const long cost = static_cast<long>(
                std::chrono::duration_cast<std::chrono::milliseconds>(end - begin).count());
        std::cout << "process done, cost: " << cost / 1000 << "secs" << std::endl;
        return {PROCESS_OK, cost, "completed"};
    } catch (const std::bad_alloc &) {
        return {PROCESS_ALLOCATION_FAILED, 0, "allocation_failed"};
    } catch (const std::exception &error) {
        std::cerr << "process exception: " << error.what() << std::endl;
        return {PROCESS_INTERNAL_ERROR, 0, "backend_exception"};
    } catch (...) {
        std::cerr << "process unknown exception" << std::endl;
        return {PROCESS_INTERNAL_ERROR, 0, "backend_unknown_exception"};
    }
}

static void complete_task(std::unique_ptr<Task> task, const TaskResult &result) {
    const int image_id = task->image_id;
    task.reset();
    cancel_requested.store(false);
    task_state.store(TASK_IDLE);

    if (result.code != PROCESS_OK) {
        process_image_error_callback(image_id, result.code, result.message);
    } else if (std::string(result.message) == "cancelled") {
        process_image_cancelled_callback(image_id);
    } else {
        process_image_success_callback(image_id, result.cost);
    }
}

#ifdef REALCUGAN_USE_PTHREADS
static void worker() {
    while (true) {
        lock.lock();
        while (!proc_img_task) {
            condition.wait(lock);
        }
        std::unique_ptr<Task> task = std::move(proc_img_task);
        lock.unlock();

        const TaskResult result = run_task(task.get());
        complete_task(std::move(task), result);
    }
}

static std::thread worker_thread(worker);
#endif

extern "C" {

int process_image(int image_id, unsigned char *input_image_data, uint32_t input_buffer_size,
                  unsigned char *output_image_data, uint32_t output_buffer_size,
                  int input_w, int input_h, int scale, int noise, int model_type,
                  int thread_count, int tile_size) {
    if (!input_image_data || !output_image_data) {
        return PROCESS_INVALID_POINTER;
    }
    if (input_w <= 0 || input_h <= 0) {
        return PROCESS_INVALID_DIMENSIONS;
    }
    if (!is_supported_options(scale, noise, model_type) ||
        !is_supported_runtime_options(thread_count, tile_size)) {
        return PROCESS_INVALID_OPTIONS;
    }
    if (input_w > std::numeric_limits<int>::max() / scale ||
        input_h > std::numeric_limits<int>::max() / scale) {
        return PROCESS_SIZE_OVERFLOW;
    }

    size_t input_pixels = 0;
    size_t input_bytes = 0;
    size_t output_pixels = 0;
    size_t output_bytes = 0;
    if (!checked_multiply_size(static_cast<size_t>(input_w), static_cast<size_t>(input_h), &input_pixels) ||
        !checked_multiply_size(input_pixels, static_cast<size_t>(4), &input_bytes) ||
        !checked_multiply_size(input_pixels, static_cast<size_t>(scale * scale), &output_pixels) ||
        !checked_multiply_size(output_pixels, static_cast<size_t>(4), &output_bytes)) {
        return PROCESS_SIZE_OVERFLOW;
    }
    if (input_bytes > input_buffer_size || output_bytes > output_buffer_size) {
        return PROCESS_BUFFER_TOO_SMALL;
    }

#ifdef REALCUGAN_USE_PTHREADS
    lock.lock();
#endif
    int expected_state = TASK_IDLE;
    if (!task_state.compare_exchange_strong(expected_state, TASK_RUNNING)) {
#ifdef REALCUGAN_USE_PTHREADS
        lock.unlock();
#endif
        return PROCESS_BUSY;
    }

    std::unique_ptr<Task> task(new (std::nothrow) Task());
    if (!task) {
        task_state.store(TASK_IDLE);
#ifdef REALCUGAN_USE_PTHREADS
        lock.unlock();
#endif
        return PROCESS_ALLOCATION_FAILED;
    }
    if (has_transparent_alpha(input_image_data, input_pixels)) {
        task->alpha_data.reset(new (std::nothrow) unsigned char[input_pixels]);
        if (!task->alpha_data) {
            task_state.store(TASK_IDLE);
#ifdef REALCUGAN_USE_PTHREADS
            lock.unlock();
#endif
            return PROCESS_ALLOCATION_FAILED;
        }
        extract_alpha_channel(input_image_data, task->alpha_data.get(), input_pixels);
    }

    remove_alpha_channel(input_image_data, input_pixels);

    task->image_id = image_id;
    task->input_image_data = input_image_data;
    task->output_image_data = output_image_data;
    task->input_w = input_w;
    task->input_h = input_h;
    task->scale = scale;
    task->noise = noise;
    task->model_type = model_type;
    task->thread_count = thread_count;
    task->tile_size = tile_size;
    cancel_requested.store(false);
    proc_img_task = std::move(task);

#ifdef REALCUGAN_USE_PTHREADS
    lock.unlock();
    condition.signal();
#else
    std::unique_ptr<Task> active_task = std::move(proc_img_task);
    const TaskResult result = run_task(active_task.get());
    complete_task(std::move(active_task), result);
#endif
    return PROCESS_OK;
}

int cancel_process() {
    int expected_state = TASK_RUNNING;
    if (task_state.compare_exchange_strong(expected_state, TASK_CANCELLING) ||
        task_state.load() == TASK_CANCELLING) {
        cancel_requested.store(true);
        return 1;
    }
    return 0;
}

int get_task_state() {
    return task_state.load();
}

}
