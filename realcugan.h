#ifndef REALCUGAN_H
#define REALCUGAN_H

#include <atomic>
#include "net.h"

enum RealCUGANLoadResult {
    REALCUGAN_LOAD_OK = 0,
    REALCUGAN_LOAD_PARAM_FAILED = -1,
    REALCUGAN_LOAD_MODEL_FAILED = -2
};

enum RealCUGANProcessResult {
    REALCUGAN_PROCESS_OK = 0,
    REALCUGAN_PROCESS_CANCELLED = 1,
    REALCUGAN_PROCESS_FAILED = -1
};

class RealCUGAN {
public:
    RealCUGAN();

    int load(int scale, int noise, int model_type);
    bool is_loaded(int scale, int noise, int model_type) const;

    int process(const ncnn::Mat &inimage, unsigned char *outimage_rgba,
                const unsigned char *alpha_data,
                const std::atomic<bool> *cancel_requested = nullptr);

    int noise;
    int scale;
    int model_type;
    int prepadding;
    int tilesize = 200;
    int syncgap = 0;
    bool tta_mode = false;

private:
    ncnn::Net ncnnNet;
};

#endif // REALCUGAN_H

typedef std::string path_t;
