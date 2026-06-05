#include <stdio.h>
#include <iostream>
#include "realcugan.h"

#define STB_IMAGE_IMPLEMENTATION

#include "stb_image.h"
#include <chrono>
#ifdef REALCUGAN_USE_PTHREADS
#include <thread>
#endif
#include "realcugan.h"
#include <cpu.h>
#include "fmt/format.h"

class Task {
public:
    int image_id;
    unsigned char *input_image_data;
    unsigned char *output_image_data;
    unsigned char *alpha_data;
    int input_w;
    int input_h;
    int input_channel;
    int scale;
    int noise;
};

static RealCUGAN *realcugan;
static Task *proc_img_task;

#ifdef REALCUGAN_USE_PTHREADS
static ncnn::Mutex lock;
static ncnn::ConditionVariable condition;
static ncnn::Mutex finish_lock;
static ncnn::ConditionVariable finish_condition;
#endif

void remove_alpha_channel(unsigned char *image_data, int w, int h) {
    for (int i = 0; i < w * h; i++) {
        image_data[i * 3] = image_data[i * 4];
        image_data[i * 3 + 1] = image_data[i * 4 + 1];
        image_data[i * 3 + 2] = image_data[i * 4 + 2];
    }
}

void extract_alpha_channel(const unsigned char *rgba_data, unsigned char *alpha_out, int w, int h) {
    for (int i = 0; i < w * h; i++) {
        alpha_out[i] = rgba_data[i * 4 + 3];
    }
}

void upscale_alpha_bilinear(const unsigned char *alpha_in, unsigned char *alpha_out,
                            int in_w, int in_h, int scale) {
    int out_w = in_w * scale;
    int out_h = in_h * scale;
    for (int y = 0; y < out_h; y++) {
        float src_y = (float)y / scale;
        int y0 = (int)src_y;
        int y1 = (y0 + 1 < in_h) ? y0 + 1 : y0;
        float fy = src_y - y0;
        for (int x = 0; x < out_w; x++) {
            float src_x = (float)x / scale;
            int x0 = (int)src_x;
            int x1 = (x0 + 1 < in_w) ? x0 + 1 : x0;
            float fx = src_x - x0;

            float v00 = alpha_in[y0 * in_w + x0];
            float v10 = alpha_in[y0 * in_w + x1];
            float v01 = alpha_in[y1 * in_w + x0];
            float v11 = alpha_in[y1 * in_w + x1];

            float v = v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) +
                      v01 * (1 - fx) * fy + v11 * fx * fy;
            alpha_out[y * out_w + x] = (unsigned char)(v + 0.5f);
        }
    }
}

void copy_with_alpha_channel(unsigned char *dst, const unsigned char *src,
                             const unsigned char *alpha, int w, int h) {
    for (int i = 0; i < w * h; i++) {
        dst[0] = src[0];
        dst[1] = src[1];
        dst[2] = src[2];
        dst[3] = alpha ? alpha[i] : 255;
        dst += 4;
        src += 3;
    }
}

void process_image_success_callback(int image_id, long cost)
{
    std::string script = fmt::format(R"($CALLBACK$ {{"eventType": "PROC_END", "image_id": {}, "cost": {}}})", image_id, cost);
    std::cout << script << std::endl;
}

static void run_task(Task *task) {
    std::chrono::steady_clock::time_point begin = std::chrono::steady_clock::now();
    std::cout << "process start" << std::endl;

    if (!realcugan) {
        realcugan = new RealCUGAN();
        realcugan->load(task->scale, task->noise);
    }
    if (realcugan->scale != task->scale || realcugan->noise != task->noise)
    {
        realcugan->load(task->scale, task->noise);
    }

    ncnn::Mat inImage = ncnn::Mat(task->input_w, task->input_h,
                                  (void *) task->input_image_data, (size_t) task->input_channel,
                                  task->input_channel);
    ncnn::Mat outImage = ncnn::Mat(inImage.w * realcugan->scale, inImage.h * realcugan->scale,
                                   (size_t) inImage.elemsize, (int) inImage.elemsize);
    realcugan->process(inImage, outImage);

    unsigned char *upscaled_alpha = nullptr;
    if (task->alpha_data) {
        upscaled_alpha = new unsigned char[outImage.w * outImage.h];
        upscale_alpha_bilinear(task->alpha_data, upscaled_alpha,
                               task->input_w, task->input_h, task->scale);
    }
    copy_with_alpha_channel(task->output_image_data, (const unsigned char *) outImage.data,
                            upscaled_alpha, outImage.w, outImage.h);
    delete[] upscaled_alpha;
    delete[] task->alpha_data;
    task->alpha_data = nullptr;

    std::chrono::steady_clock::time_point end = std::chrono::steady_clock::now();
    auto cost = std::chrono::duration_cast<std::chrono::milliseconds>(end - begin).count();
    std::cout << "process done, cost: " << cost / 1000 << "secs" << std::endl;
    process_image_success_callback(task->image_id, cost);
}

#ifdef REALCUGAN_USE_PTHREADS
static void worker() {
    while (1) {
        lock.lock();
        while (proc_img_task == nullptr) {
            condition.wait(lock);
        }

        Task *task = proc_img_task;
        run_task(task);

        delete task;
        proc_img_task = nullptr;
        lock.unlock();
        finish_lock.lock();
        finish_condition.signal();
        finish_lock.unlock();

    }
}

static std::thread t(worker);
#endif

extern "C"
{

int process_image(int image_id, unsigned char *input_image_data, unsigned char *output_image_data, int input_w,
                  int input_h, int scale, int noise) {
#ifdef REALCUGAN_USE_PTHREADS
    lock.lock();
#endif

    if (proc_img_task != nullptr) {
#ifdef REALCUGAN_USE_PTHREADS
        lock.unlock();
#endif
        return -1;
    }

    int alpha_size = input_w * input_h;
    unsigned char *alpha_buf = new unsigned char[alpha_size];
    extract_alpha_channel(input_image_data, alpha_buf, input_w, input_h);
    remove_alpha_channel(input_image_data, input_w, input_h);

    Task *tsk = new Task();
    tsk->image_id = image_id;
    tsk->input_image_data = input_image_data;
    tsk->output_image_data = output_image_data;
    tsk->alpha_data = alpha_buf;
    tsk->input_w = input_w;
    tsk->input_h = input_h;
    tsk->input_channel = 3;
    tsk->scale = scale;
    tsk->noise = noise;
    proc_img_task = tsk;

#ifdef REALCUGAN_USE_PTHREADS
    lock.unlock();
    condition.signal();
#else
    run_task(tsk);
    delete tsk;
    proc_img_task = nullptr;
#endif
    return 0;
}

}
