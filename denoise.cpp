// Browser-only RealESRGAN_x4plus_anime_6B inference, using ncnn's CPU backend.
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <net.h>

static ncnn::Net net;
static bool loaded = false;

extern "C" {
int denoise_load_model(const char* param, const char* weights) {
    loaded = false;
    net.clear();
    net.opt.num_threads = 1;
    // ncnn pools retain buffers across differently sized halo tiles and can
    // exhaust the 2 GiB WASM heap. Return temporary buffers to malloc instead.
    net.opt.use_local_pool_allocator = false;
    net.opt.use_vulkan_compute = false;
    net.opt.use_fp16_storage = false;
    net.opt.use_fp16_arithmetic = false;
    if (!param || !weights || net.load_param(param) || net.load_model(weights)) return -1;
    loaded = true;
    return 0;
}

// The caller supplies a real-neighbour halo of 96 input pixels, clipped at image
// edges. Blob 501 is the trunk output in the pinned upstream anime-6B graph.
// Splitting BEFORE the 4x tail avoids allocating its 64-channel activations for
// the entire halo. A 3-pixel feature halo covers all four tail convolutions.
int denoise_tile(const uint8_t* rgba, int w, int h, int x, int y,
                 int core_w, int core_h, uint8_t* output) {
    if (!loaded || !rgba || !output || w < 1 || h < 1 || w > 512 || h > 512 ||
        x < 0 || y < 0 || core_w < 1 || core_h < 1 ||
        x + core_w > w || y + core_h > h) return -2;
    try {
        const int left = std::max(0, x - 3), top = std::max(0, y - 3);
        const int right = std::min(w, x + core_w + 3), bottom = std::min(h, y + core_h + 3);
        ncnn::Mat features;
        {
            ncnn::Mat input = ncnn::Mat::from_pixels(rgba, ncnn::Mat::PIXEL_RGBA2RGB, w, h);
            if (input.empty()) return -7;
            const float norm[3] = {1.f / 255.f, 1.f / 255.f, 1.f / 255.f};
            input.substract_mean_normalize(nullptr, norm);
            ncnn::Extractor head = net.create_extractor();
            ncnn::Mat whole;
            if (head.input("data", input) || head.extract("501", whole) || whole.empty()) return -3;
            ncnn::copy_cut_border(whole, features, top, h - bottom, left, w - right, net.opt);
            if (features.empty()) return -7;
        }
        ncnn::Extractor tail = net.create_extractor();
        ncnn::Mat result;
        if (tail.input("501", features) || tail.extract("output", result) || result.empty()) return -3;
        if (result.w != (right - left) * 4 || result.h != (bottom - top) * 4 ||
            result.c != 3 || result.elempack != 1) return -4;
        for (int c = 0; c < 3; ++c) {
            const float* pixels = result.channel(c);
            for (int j = 0; j < core_h * 4; ++j) {
                const float* row = pixels + ((y - top) * 4 + j) * result.w + (x - left) * 4;
                for (int i = 0; i < core_w * 4; ++i) {
                    float value = row[i];
                    if (!std::isfinite(value)) return -5;
                    output[(j * core_w * 4 + i) * 4 + c] =
                        static_cast<uint8_t>(std::max(0.f, std::min(255.f, std::nearbyint(value * 255.f))));
                }
            }
        }
        for (int i = 0; i < core_w * core_h * 16; ++i) output[i * 4 + 3] = 255;
        return 0;
    } catch (...) { return -6; }
}
}
