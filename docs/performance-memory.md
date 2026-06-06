# Peak Memory Baseline

This baseline documents the representative workloads from `TODO.md`. It is kept
as the pre-optimization reference for the peak-memory reduction work.

Run the measurement script from the repository root after building the desired
backend:

```shell
node tests/measure-peak-memory.cjs --backend basic
node tests/measure-peak-memory.cjs --backend simd
node tests/measure-peak-memory.cjs --backend simd-threads
```

Use `--json` to capture machine-readable results:

```shell
node tests/measure-peak-memory.cjs --backend basic --json
```

Each workload runs in a fresh Node process. The script records sampled peak RSS,
sampled peak WebAssembly heap size, elapsed time, and the buffer floor from the
current backend design. It also reports the backend working set, calculated as
the peak WebAssembly heap minus the known full-image buffer floor.

## Pre-Optimization Buffer Floor

Before tile-direct RGBA output, the backend kept these full-image buffers alive
around inference:

- input RGBA in WebAssembly memory: `width * height * 4`
- output RGBA in WebAssembly memory: `width * height * scale * scale * 4`
- full intermediate RGB output `ncnn::Mat`: `width * height * scale * scale * 3`
- extracted input alpha: `width * height`
- full upscaled alpha, when input alpha is preserved:
  `width * height * scale * scale`

The table below is the minimum full-image buffer footprint for representative
opaque-image runs before removing the full intermediate RGB output. Real peak
RSS is higher because it also includes the loaded model, ncnn tile tensors,
allocator overhead, JavaScript runtime memory, and Emscripten filesystem/model
preload storage.

| Input | Scale | Buffer floor | Removed by tile-direct RGBA |
| ---: | ---: | ---: | ---: |
| 1920x1080 | 2x | 73.2 MiB | 23.7 MiB |
| 1920x1080 | 3x | 152.3 MiB | 53.4 MiB |
| 1920x1080 | 4x | 263.0 MiB | 94.9 MiB |
| 2560x1440 | 2x | 130.1 MiB | 42.2 MiB |
| 2560x1440 | 3x | 270.7 MiB | 94.9 MiB |
| 2560x1440 | 4x | 467.6 MiB | 168.8 MiB |
| 3840x2160 | 2x | 292.7 MiB | 94.9 MiB |
| 3840x2160 | 3x | 609.1 MiB | 213.6 MiB |
| 3840x2160 | 4x | 1052.1 MiB | 379.7 MiB |

## Current Buffer Floor

After tile-direct RGBA output, on-demand alpha sampling, and the opaque-image
fast path, the full intermediate RGB output `ncnn::Mat`, the full upscaled alpha
buffer, and the extracted input alpha buffer for fully opaque images are gone.
The measurement script reports the current floor below and includes the removed
full-image buffers as `Avoided RGB`, `Avoided input alpha`, and
`Avoided upscaled alpha`.

| Input | Scale | Opaque buffer floor | Transparent buffer floor | Avoided RGB | Avoided input alpha | Avoided upscaled alpha |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1920x1080 | 2x | 39.6 MiB | 41.5 MiB | 23.7 MiB | 2.0 MiB | 7.9 MiB |
| 1920x1080 | 3x | 79.1 MiB | 81.1 MiB | 53.4 MiB | 2.0 MiB | 17.8 MiB |
| 1920x1080 | 4x | 134.5 MiB | 136.5 MiB | 94.9 MiB | 2.0 MiB | 31.6 MiB |
| 2560x1440 | 2x | 70.3 MiB | 73.8 MiB | 42.2 MiB | 3.5 MiB | 14.1 MiB |
| 2560x1440 | 3x | 140.6 MiB | 144.1 MiB | 94.9 MiB | 3.5 MiB | 31.6 MiB |
| 2560x1440 | 4x | 239.1 MiB | 242.6 MiB | 168.8 MiB | 3.5 MiB | 56.3 MiB |
| 3840x2160 | 2x | 158.2 MiB | 166.1 MiB | 94.9 MiB | 7.9 MiB | 31.6 MiB |
| 3840x2160 | 3x | 316.4 MiB | 324.3 MiB | 213.6 MiB | 7.9 MiB | 71.2 MiB |
| 3840x2160 | 4x | 537.9 MiB | 545.8 MiB | 379.7 MiB | 7.9 MiB | 126.6 MiB |

## Measurement Notes

- Default workload: SE model set, no denoise, scales 2x/3x/4x.
- The Pro model set does not include 4x, so the script skips that combination
  when `--model-type 1` is used.
- Peak RSS is sampled every 25 ms and after backend progress callbacks. Treat it
  as a comparable baseline for optimization work rather than an exact allocator
  high-water mark.
- The default measurement workload is opaque. Use `--transparent` to exercise
  the transparent path and include the extracted input alpha buffer in the
  reported buffer floor.
- Transparent-image alpha handling is now tile-local: the backend keeps only the
  original-size extracted alpha buffer and samples it while writing each tile
  into the final RGBA output.

## Frontend Copy Reduction

The web UI now avoids several full-image copies that previously overlapped:

- Risk confirmation runs before creating the full input `ImageData`.
- Theme extraction reads a maximum 96-pixel sample instead of the full image.
- The upload canvas is released immediately after its pixels enter WebAssembly.
- The output canvas is allocated only after inference completes.
- `ImageData` normally views the WebAssembly output directly. Browsers that
  reject a `SharedArrayBuffer`-backed view use one compatibility copy.
- The generated PNG object URL is reused for preview and download instead of
  generating another Base64 data URL.

At inference time, the normal browser path therefore keeps approximately two
input RGBA equivalents (decoded preview plus WebAssembly input) and one
WebAssembly output. During result presentation, the output briefly has two RGBA
equivalents (WebAssembly output plus canvas backing).

## Frontend Risk Calibration

A SIMD 1920x1080 to 3840x2160 opaque run measured on June 6, 2026 produced:

| Peak RSS | Peak WASM heap | Buffer floor | Backend working set | Time |
| ---: | ---: | ---: | ---: | ---: |
| 1013.5 MiB | 987.3 MiB | 39.6 MiB | 947.7 MiB | 113.2 s |

The previous frontend estimator used a fixed 180 MiB backend allowance and
three output RGBA copies, substantially underestimating the backend while
overstating frontend duplication. The current estimator uses the measured 2x
working set rounded to 950 MiB, with conservative 1050 MiB and 1150 MiB
allowances for 3x and 4x. It then adds:

- two input RGBA equivalents
- two output RGBA equivalents
- one input-sized alpha allowance for transparent images

Warning thresholds use `navigator.deviceMemory` when available, with
conservative mobile and desktop defaults otherwise. These warnings remain
advisory and never prevent the user from continuing.
