# RealCUGAN-ncnn-webassembly
[中文](https://github.com/lemonno2333/realcugan-ncnn-webassembly/blob/main/README_CN.md)

This project uses WebAssembly technology to run the Real-CUGAN model based on ncnn.
Images are processed locally in the browser with CPU inference and are not
uploaded to a server.

This fork keeps the existing ncnn model files in the repository. It does not
require converting or regenerating models. The build now produces
`simd-threads`, `simd`, and `basic` WebAssembly backends. The browser selects
the fastest supported backend and falls back to single-threaded CPU inference
when pthreads or SharedArrayBuffer are unavailable.

The web UI has also been updated for local image inspection:

- fixed header/footer tool layout with a larger image workspace;
- automatic theme color extraction from the uploaded image, inspired by
  Material Design Monet;
- animated mesh-gradient processing state generated from the uploaded image's
  dominant colors;
- single overlay comparison mode with a viewport-relative split slider;
- bounded zoom, mouse-wheel zoom, and drag-to-pan preview behavior on desktop;
- mobile-friendly scrolling layout with touch panning for zoomed previews;
- reset button for clearing the current image and processing another one.

[Real-CUGAN](https://github.com/bilibili/ailab/tree/main/Real-CUGAN) is an AI super resolution model for anime images, trained in a million scale anime dataset, using the same architecture as Waifu2x-CUNet. It supports 2x\3x\4x super resolving. For different enhancement strength, now 2x Real-CUGAN supports 5 model weights, 3x/4x Real-CUGAN supports 3 model weights.

The code implementation deeply refers to [realcugan-ncnn-vulkan](https://github.com/nihui/realcugan-ncnn-vulkan) and [ncnn-webassembly-nanodet](https://github.com/nihui/ncnn-webassembly-nanodet).

# Usage
Website： https://realcugan.lemonno.xyz/

Android/iOS: please open in a browser app.

PC/Mac/Linux: recommend using the latest version of Chrome or Firefox.

# How to build
 1. Install [emscripten](https://github.com/emscripten-core/emscripten):
 ```shell
 git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
./emsdk install 3.1.13
./emsdk activate 3.1.13

source emsdk/emsdk_env.sh # or add it to .zshrc etc.
 ```
2. build:
```shell
git clone https://github.com/lemonno2333/realcugan-ncnn-webassembly.git
cd realcugan-ncnn-webassembly

git submodule update --init
# If this fork does not contain submodule gitlinks, prepare dependencies manually:
# git clone --depth 1 https://github.com/fmtlib/fmt.git fmt
# git clone --depth 1 --branch 20220729 https://github.com/Tencent/ncnn.git ncnn
sh build.sh

go run local_server.go
```
open in brower: http://localhost:8000

The default build creates all backends. To build only selected backends:

```shell
WASM_FEATURES=basic sh build.sh
WASM_FEATURES="simd simd-threads" sh build.sh
```

For public deployment, copy the whole `web/` directory after running the build.
The generated `.wasm`, `.js`, `.data`, and worker files are required by the
frontend. COOP/COEP headers are still recommended so browsers that support
threads can use the faster `simd-threads` backend. Without those headers, the
page attempts to use a slower single-threaded backend.

Use ncnn `20220729` for this model set. Newer ncnn versions may compile but can
produce corrupted output such as colored stripes or noisy blocks with these old
Real-CUGAN params.

# Credits

This fork is based on the original
[hanFengSan/realcugan-ncnn-webassembly](https://github.com/hanFengSan/realcugan-ncnn-webassembly).
