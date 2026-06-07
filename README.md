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

- selectable SE and Pro Real-CUGAN model sets, including the full upstream SE model set;
- fixed header/footer tool layout with a larger image workspace;
- automatic theme color extraction from the uploaded image, inspired by
  Material Design Monet;
- animated mesh-gradient processing state generated from the uploaded image's
  dominant colors;
- single overlay comparison mode with a viewport-relative split slider;
- bounded zoom, mouse-wheel zoom, and drag-to-pan preview behavior on desktop;
- mobile-friendly scrolling layout with touch panning for zoomed previews;
- reset button for clearing the current image and processing another one.

Backend optimization work in this fork includes:

- dedicated fallback Web Workers for the `basic` and `simd` backends, so the UI
  remains responsive when threaded WASM is unavailable;
- on-demand model loading from `web/models/` with normal HTTP caching instead of
  one large Emscripten `.data` bundle;
- adaptive runtime settings for inference threads and tile size, selected from
  backend capability, hardware concurrency, device memory, and viewport size;
- lower peak-memory processing by writing completed tiles directly into the
  final RGBA output and avoiding full-size intermediate buffers where possible;
- lower-overhead direct backend callbacks for progress, completion,
  cancellation, and errors instead of formatted stdout JSON events;
- benchmarked `-flto` and `emmalloc` builds; neither is enabled by default
  because the measured trade-offs were not favorable.

[Real-CUGAN](https://github.com/bilibili/ailab/tree/main/Real-CUGAN) is an AI super resolution model for anime images, trained in a million scale anime dataset, using the same architecture as Waifu2x-CUNet. It supports 2x\3x\4x super resolving. The bundled SE models match the upstream `models-se` set: 2x supports conservative, no denoise, and denoise1x/2x/3x; 3x and 4x support conservative, no denoise, and denoise3x.

The code implementation deeply refers to [realcugan-ncnn-vulkan](https://github.com/nihui/realcugan-ncnn-vulkan) and [ncnn-webassembly-nanodet](https://github.com/nihui/ncnn-webassembly-nanodet).

# Usage
Website： https://realcugan.lemonno.xyz/

Android/iOS: please open in a browser app.

PC/Mac/Linux: recommend using the latest version of Chrome or Firefox.

# How to build

You can download the pre-built version from GitHub Actions, or build it manually following the tutorial below.

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
The generated `.wasm`, `.js`, worker files, and `web/models/` model files are
required by the frontend. Model files are fetched on demand through normal HTTP
caching instead of being bundled into one `.data` package. COOP/COEP headers are
still recommended so browsers that support threads can use the faster
`simd-threads` backend. Without those headers, the page attempts to use a slower
single-threaded backend.

Before publishing, run:

```shell
npm run check:deploy
```

See `docs/deployment.md` for recommended COOP/COEP headers, `.wasm` MIME type,
cache headers, and Nginx/Apache examples.

When publishing rebuilt runtime, worker, or model assets, bump `APP_VERSION` in
`web/index.html` so browsers fetch the new `?v=` asset URLs instead of reusing
stale cached files.

Use ncnn `20220729` for this model set. Newer ncnn versions may compile but can
produce corrupted output such as colored stripes or noisy blocks with these old
Real-CUGAN params.

# Performance measurements

After building, measure representative peak-memory workloads with:

```shell
node tests/measure-peak-memory.cjs --backend basic
```

The script also supports `--backend simd`, `--backend simd-threads`, and
`--json`. See `docs/performance-memory.md` for the current 1080p, 1440p, and 4K
buffer baseline and measurement notes.

Runtime thread and tile-size sweeps can be measured with:

```shell
node tests/benchmark-runtime-settings.cjs --backend simd-threads
```

See `docs/runtime-settings.md` for the adaptive defaults and benchmark matrix.

Additional implementation and benchmark notes:

- `docs/worker-architecture.md`: worker message protocol and cancellation behavior.
- `docs/performance-memory.md`: peak-memory measurement notes.
- `docs/performance-cleanup.md`: `-flto` and `emmalloc` benchmark results.

Quick smoke checks:

```shell
node tests/backend-smoke.cjs basic
node tests/backend-smoke.cjs simd
node tests/backend-smoke.cjs simd-threads
```

# Credits

This fork is based on the original
[hanFengSan/realcugan-ncnn-webassembly](https://github.com/hanFengSan/realcugan-ncnn-webassembly).
