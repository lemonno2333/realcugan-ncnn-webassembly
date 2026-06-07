# Performance Cleanup Notes

This document records small build and runtime experiments from the Performance
Cleanup section of `TODO.md`.

## `-flto` Benchmark

Date: 2026-06-07

Environment:

- Emscripten 3.1.13 from `.tools/emsdk`
- Workload: `64x64`, `scale=2`, `tileSize=160`
- Runtime matrix:
  - `basic`: `threads=1`
  - `simd`: `threads=1`
  - `simd-threads`: `threads=4`

Command shape:

```powershell
node tests\benchmark-runtime-settings.cjs --child --backend <backend> --width 64 --height 64 --scale 2 --threads <n> --tiles 160 --json
```

Build shape:

```powershell
cmake -S . -B build-lto\<backend> ... -DCMAKE_C_FLAGS=-flto -DCMAKE_CXX_FLAGS=-flto -DCMAKE_EXE_LINKER_FLAGS=-flto
cmake --build build-lto\<backend> --parallel 4
```

Runtime results:

| Backend | Release elapsed | `-flto` elapsed | Release hash | `-flto` hash |
| --- | ---: | ---: | --- | --- |
| `basic` | 3135 ms | 3441 ms | `46b91b78a24a` | `5cbc1cece469` |
| `simd` | 690 ms | 760 ms | `90787d250e71` | `90787d250e71` |
| `simd-threads` | 463 ms | 496 ms | `116f6a390f83` | `116f6a390f83` |

Artifact size results:

| Artifact | Release | `-flto` | Delta |
| --- | ---: | ---: | ---: |
| `realcugan-ncnn-webassembly-basic.js` | 89,897 B | 88,173 B | -1,724 B |
| `realcugan-ncnn-webassembly-basic.wasm` | 1,315,478 B | 1,341,918 B | +26,440 B |
| `realcugan-ncnn-webassembly-simd.js` | 90,137 B | 88,172 B | -1,965 B |
| `realcugan-ncnn-webassembly-simd.wasm` | 2,364,223 B | 2,433,955 B | +69,732 B |
| `realcugan-ncnn-webassembly-simd-threads.js` | 108,600 B | 106,528 B | -2,072 B |
| `realcugan-ncnn-webassembly-simd-threads.wasm` | 2,612,002 B | 2,745,003 B | +133,001 B |
| `realcugan-ncnn-webassembly-simd-threads.worker.js` | 2,928 B | 2,928 B | 0 B |

Conclusion:

Do not enable `-flto` by default right now. It made every measured backend
slower, reduced JS glue size only slightly, increased WASM size, and changed
the `basic` output hash for this workload. Revisit only if a future Emscripten
or ncnn update changes the trade-off.

## `emmalloc` Benchmark

Date: 2026-06-07

Environment:

- Emscripten 3.1.13 from `.tools/emsdk`
- Workload: `64x64`, `scale=2`, `tileSize=160`
- Runtime matrix:
  - `basic`: `threads=1`
  - `simd`: `threads=1`
  - `simd-threads`: `threads=4`

Command shape:

```powershell
node tests\benchmark-runtime-settings.cjs --child --backend <backend> --width 64 --height 64 --scale 2 --threads <n> --tiles 160 --json
```

Build shape:

```powershell
cmake -S . -B build-emmalloc\<backend> ... -DCMAKE_EXE_LINKER_FLAGS=-sMALLOC=emmalloc
cmake --build build-emmalloc\<backend> --parallel 4
```

Runtime results:

| Backend | Release elapsed | `emmalloc` elapsed | Release peak RSS | `emmalloc` peak RSS | Release hash | `emmalloc` hash |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| `basic` | 3199 ms | 3227 ms | 187,703,296 B | 188,821,504 B | `46b91b78a24a` | `46b91b78a24a` |
| `simd` | 742 ms | 755 ms | 181,063,680 B | 179,281,920 B | `90787d250e71` | `90787d250e71` |
| `simd-threads` | 477 ms | 507 ms | 328,146,944 B | 332,804,096 B | `116f6a390f83` | `116f6a390f83` |

Artifact size results:

| Artifact | Release | `emmalloc` | Delta |
| --- | ---: | ---: | ---: |
| `realcugan-ncnn-webassembly-basic.js` | 89,897 B | 89,897 B | 0 B |
| `realcugan-ncnn-webassembly-basic.wasm` | 1,315,478 B | 1,306,427 B | -9,051 B |
| `realcugan-ncnn-webassembly-simd.js` | 90,137 B | 90,137 B | 0 B |
| `realcugan-ncnn-webassembly-simd.wasm` | 2,364,223 B | 2,355,869 B | -8,354 B |
| `realcugan-ncnn-webassembly-simd-threads.js` | 108,600 B | 108,600 B | 0 B |
| `realcugan-ncnn-webassembly-simd-threads.wasm` | 2,612,002 B | 2,603,616 B | -8,386 B |
| `realcugan-ncnn-webassembly-simd-threads.worker.js` | 2,928 B | 2,928 B | 0 B |

Conclusion:

Do not switch to `emmalloc` by default right now. It preserved output hashes
and saved only about 8-9 KiB per WASM artifact, but it did not improve runtime
speed in this workload and did not show a stable memory reduction.
