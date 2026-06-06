#include "realcugan.h"
#include <cfloat>
#include <cpu.h>
#include <iostream>
#include <thread>
#include <string>
#include "fmt/format.h"

RealCUGAN::RealCUGAN() : noise(-999), scale(0), model_type(-1), prepadding(0) {
    std::cout << "cpu count: " << ncnn::get_big_cpu_count() << std::endl;
    ncnn::set_cpu_powersave(2);
    ncnn::set_omp_num_threads(ncnn::get_big_cpu_count());

    ncnnNet.opt = ncnn::Option();
    ncnnNet.opt.num_threads = ncnn::get_big_cpu_count();
}

void progress_callback(long total_cost, long tile_cost, float progress_rate)
{
    // callback by stdout =_=
    long remaining_time = 0;
    if (progress_rate != 0) {
        remaining_time = float(total_cost) / progress_rate - (float)total_cost;
    }
    std::string script = fmt::format(R"($CALLBACK$ {{"eventType":"PROC_PROGRESS","total_cost":{},"tile_cost":{},"progress_rate":{},"remaining_time":{}}})",
                                     total_cost, tile_cost, progress_rate, remaining_time);
    std::cout << script << std::endl;
}

static unsigned char float_to_u8(float value) {
    if (value <= 0.f) {
        return 0;
    }
    if (value >= 255.f) {
        return 255;
    }
    return static_cast<unsigned char>(value);
}

static unsigned char sample_alpha_bilinear(const unsigned char *alpha_data, int in_w, int in_h,
                                           int scale, int output_x, int output_y) {
    if (!alpha_data) {
        return 255;
    }

    const float src_x = static_cast<float>(output_x) / scale;
    const float src_y = static_cast<float>(output_y) / scale;
    const int x0 = static_cast<int>(src_x);
    const int y0 = static_cast<int>(src_y);
    const int x1 = x0 + 1 < in_w ? x0 + 1 : x0;
    const int y1 = y0 + 1 < in_h ? y0 + 1 : y0;
    const float fx = src_x - x0;
    const float fy = src_y - y0;

    const float v00 = alpha_data[y0 * in_w + x0];
    const float v10 = alpha_data[y0 * in_w + x1];
    const float v01 = alpha_data[y1 * in_w + x0];
    const float v11 = alpha_data[y1 * in_w + x1];
    const float value = v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) +
                        v01 * (1 - fx) * fy + v11 * fx * fy;
    return static_cast<unsigned char>(value + 0.5f);
}

int RealCUGAN::load(int scaleOption, int noiseOption, int modelType) {
    ncnnNet.clear();
    scale = 0;
    noise = -999;
    model_type = -1;
    prepadding = 0;

    std::string paramFilePath;
    std::string binFilePath;
    const std::string modelDir = modelType == 1 ? "models-pro/" : "";
    if (noiseOption == 0) {
        paramFilePath = fmt::format("{}up{}x-no-denoise.param", modelDir, scaleOption);
        binFilePath = fmt::format("{}up{}x-no-denoise.bin", modelDir, scaleOption);
    } else if (noiseOption == -1) {
        paramFilePath = fmt::format("{}up{}x-conservative.param", modelDir, scaleOption);
        binFilePath = fmt::format("{}up{}x-conservative.bin", modelDir, scaleOption);
    } else {
        paramFilePath = fmt::format("{}up{}x-denoise{}x.param", modelDir, scaleOption, noiseOption);
        binFilePath = fmt::format("{}up{}x-denoise{}x.bin", modelDir, scaleOption, noiseOption);
    }
    if (ncnnNet.load_param(paramFilePath.c_str()) != 0) {
        ncnnNet.clear();
        return REALCUGAN_LOAD_PARAM_FAILED;
    }
    if (ncnnNet.load_model(binFilePath.c_str()) != 0) {
        ncnnNet.clear();
        return REALCUGAN_LOAD_MODEL_FAILED;
    }

    if (scaleOption == 2)
    {
        prepadding = 18;
    } else if (scaleOption == 3)
    {
        prepadding = 14;
    } else if (scaleOption == 4)
    {
        prepadding = 19;
    }
    scale = scaleOption;
    noise = noiseOption;
    model_type = modelType;
    return REALCUGAN_LOAD_OK;
}

bool RealCUGAN::is_loaded(int scaleOption, int noiseOption, int modelType) const {
    return scale == scaleOption && noise == noiseOption && model_type == modelType;
}

// CPU only
int RealCUGAN::process(const ncnn::Mat &inimage, unsigned char *outimage_rgba,
                       const unsigned char *alpha_data,
                       const std::atomic<bool> *cancel_requested) {
    std::chrono::steady_clock::time_point begin = std::chrono::steady_clock::now();
    const unsigned char *pixeldata = (const unsigned char *) inimage.data;
    const int w = inimage.w;
    const int h = inimage.h;
    const int channels = inimage.elempack;

    const int TILE_SIZE_X = tilesize;
    const int TILE_SIZE_Y = tilesize;

    ncnn::Option opt = ncnnNet.opt;

    // each tile 200x200
    const int xtiles = (w + TILE_SIZE_X - 1) / TILE_SIZE_X;
    const int ytiles = (h + TILE_SIZE_Y - 1) / TILE_SIZE_Y;

    for (int yi = 0; yi < ytiles; yi++) {
        if (cancel_requested && cancel_requested->load()) {
            return 1;
        }
        const int tile_h_nopad = std::min((yi + 1) * TILE_SIZE_Y, h) - yi * TILE_SIZE_Y;

        int prepadding_bottom = prepadding;
        if (scale == 1 || scale == 3) {
            prepadding_bottom += (tile_h_nopad + 3) / 4 * 4 - tile_h_nopad;
        }
        if (scale == 2 || scale == 4) {
            prepadding_bottom += (tile_h_nopad + 1) / 2 * 2 - tile_h_nopad;
        }

        int in_tile_y0 = std::max(yi * TILE_SIZE_Y - prepadding, 0);
        int in_tile_y1 = std::min((yi + 1) * TILE_SIZE_Y + prepadding_bottom, h);
        for (int xi = 0; xi < xtiles; xi++) {
            if (cancel_requested && cancel_requested->load()) {
                return 1;
            }
            std::chrono::steady_clock::time_point tileBegin = std::chrono::steady_clock::now();

            const int tile_w_nopad = std::min((xi + 1) * TILE_SIZE_X, w) - xi * TILE_SIZE_X;

            int prepadding_right = prepadding;
            if (scale == 1 || scale == 3) {
                prepadding_right += (tile_w_nopad + 3) / 4 * 4 - tile_w_nopad;
            }
            if (scale == 2 || scale == 4) {
                prepadding_right += (tile_w_nopad + 1) / 2 * 2 - tile_w_nopad;
            }

            int in_tile_x0 = std::max(xi * TILE_SIZE_X - prepadding, 0);
            int in_tile_x1 = std::min((xi + 1) * TILE_SIZE_X + prepadding_right, w);

            // crop tile
            ncnn::Mat in;
            {
                if (channels == 3) {
                    in = ncnn::Mat::from_pixels_roi(pixeldata, ncnn::Mat::PIXEL_RGB, w, h, in_tile_x0, in_tile_y0,
                                                    in_tile_x1 - in_tile_x0, in_tile_y1 - in_tile_y0);
                } else {
                    return REALCUGAN_PROCESS_FAILED;
                }
            }

            {
                // split alpha and preproc
                ncnn::Mat in_tile;
                {
                    in_tile.create(in.w, in.h, 3);
                    for (int q = 0; q < 3; q++) {
                        const float *ptr = in.channel(q);
                        float *outptr = in_tile.channel(q);

                        for (int i = 0; i < in.w * in.h; i++) {
                            *outptr++ = *ptr++ * (1 / 255.f);
                        }
                    }
                }

                // border padding
                {
                    int pad_top = std::max(prepadding - yi * TILE_SIZE_Y, 0);
                    int pad_bottom = std::max(
                            std::min((yi + 1) * TILE_SIZE_Y + prepadding_bottom - h, prepadding_bottom), 0);
                    int pad_left = std::max(prepadding - xi * TILE_SIZE_X, 0);
                    int pad_right = std::max(std::min((xi + 1) * TILE_SIZE_X + prepadding_right - w, prepadding_right),
                                             0);

                    ncnn::Mat in_tile_padded;
                    ncnn::copy_make_border(in_tile, in_tile_padded, pad_top, pad_bottom, pad_left, pad_right, 2, 0.f,
                                           ncnnNet.opt);
                    in_tile = in_tile_padded;
                }
                // realcugan
                ncnn::Mat out_tile;
                {
                    ncnn::Extractor ex = ncnnNet.create_extractor();

                    if (ex.input("in0", in_tile) != 0) {
                        return REALCUGAN_PROCESS_FAILED;
                    }

                    if (ex.extract("out0", out_tile) != 0 || out_tile.empty()) {
                        return REALCUGAN_PROCESS_FAILED;
                    }
                }

                if (cancel_requested && cancel_requested->load()) {
                    return 1;
                }

                // postproc and merge alpha
                {
                    const int out_w = w * scale;
                    const int tile_out_w = tile_w_nopad * scale;
                    const int tile_out_h = tile_h_nopad * scale;
                    const int tile_out_x0 = xi * TILE_SIZE_X * scale;
                    const int tile_out_y0 = yi * TILE_SIZE_Y * scale;
                    if (scale == 4) {
                        for (int i = 0; i < tile_out_h; i++) {
                            const int output_y = tile_out_y0 + i;
                            unsigned char *dst = outimage_rgba + (output_y * out_w + tile_out_x0) * 4;
                            const float *input_r = in_tile.channel(0).row(prepadding + i / 4) + prepadding;
                            const float *input_g = in_tile.channel(1).row(prepadding + i / 4) + prepadding;
                            const float *input_b = in_tile.channel(2).row(prepadding + i / 4) + prepadding;
                            const float *tile_r = out_tile.channel(0).row(i);
                            const float *tile_g = out_tile.channel(1).row(i);
                            const float *tile_b = out_tile.channel(2).row(i);

                            for (int j = 0; j < tile_out_w; j++) {
                                const int output_x = tile_out_x0 + j;
                                dst[0] = float_to_u8(tile_r[j] * 255.f + 0.5f + input_r[j / 4] * 255.f);
                                dst[1] = float_to_u8(tile_g[j] * 255.f + 0.5f + input_g[j / 4] * 255.f);
                                dst[2] = float_to_u8(tile_b[j] * 255.f + 0.5f + input_b[j / 4] * 255.f);
                                dst[3] = sample_alpha_bilinear(alpha_data, w, h, scale, output_x, output_y);
                                dst += 4;
                            }
                        }
                    } else {
                        for (int i = 0; i < tile_out_h; i++) {
                            const int output_y = tile_out_y0 + i;
                            unsigned char *dst = outimage_rgba + (output_y * out_w + tile_out_x0) * 4;
                            const float *tile_r = out_tile.channel(0).row(i);
                            const float *tile_g = out_tile.channel(1).row(i);
                            const float *tile_b = out_tile.channel(2).row(i);

                            for (int j = 0; j < tile_out_w; j++) {
                                const int output_x = tile_out_x0 + j;
                                dst[0] = float_to_u8(tile_r[j] * 255.f + 0.5f);
                                dst[1] = float_to_u8(tile_g[j] * 255.f + 0.5f);
                                dst[2] = float_to_u8(tile_b[j] * 255.f + 0.5f);
                                dst[3] = sample_alpha_bilinear(alpha_data, w, h, scale, output_x, output_y);
                                dst += 4;
                            }
                        }
                    }
                }
            }

            auto end = std::chrono::steady_clock::now();
            auto tile_cost = std::chrono::duration_cast<std::chrono::milliseconds>(end - tileBegin).count();
            auto total_cost = std::chrono::duration_cast<std::chrono::milliseconds>(end - begin).count();
            float progress_rate = (float) (xtiles * yi + xi + 1) / (float) (xtiles * ytiles);
            progress_callback(total_cost, tile_cost, progress_rate);
        }
    }

    return REALCUGAN_PROCESS_OK;
}
