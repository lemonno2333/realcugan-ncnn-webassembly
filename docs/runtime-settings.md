# Adaptive Runtime Settings

The WebAssembly runtime now receives explicit inference settings for every
task:

- `threadCount`: accepted range `1..4`.
- `tileSize`: accepted values `128`, `160`, or `200`.

The threaded build prewarms at most four pthread workers. The UI then selects
the actual ncnn inference thread count per task from browser signals instead
of always using every logical CPU core.

## Default Selection

The frontend uses `navigator.hardwareConcurrency`, `navigator.deviceMemory`,
viewport size, and the selected backend:

- `basic` and `simd` fallback worker backends use one inference thread.
- Mobile or low-memory devices use a cap of two or four threads.
- Desktop devices use a cap of four threads.
- Low-memory, mobile, fallback-worker, and 4x large-image workloads prefer
  smaller tiles for lower peak memory and shorter cancel checkpoints.

Tile selection is conservative:

- `128`: memory-constrained devices, mobile low-memory devices, and larger 4x
  jobs.
- `160`: fallback worker or latency-sensitive jobs that are not already forced
  to `128`.
- `200`: desktop/high-memory default.

The C++ entry point validates the values again before processing, then clamps
thread count to the ncnn CPU count reported by the runtime.

## Benchmarks

After rebuilding the backends, run the runtime matrix with:

```shell
node tests/benchmark-runtime-settings.cjs --backend simd-threads
```

Desktop-focused thread limits:

```shell
node tests/benchmark-runtime-settings.cjs --backend simd-threads --threads 4
```

Mobile-focused thread limits:

```shell
node tests/benchmark-runtime-settings.cjs --backend simd-threads --threads 2,4
```

Tile-size sweep:

```shell
node tests/benchmark-runtime-settings.cjs --backend simd-threads --threads 4 --tiles 128,160,200
```

Cancellation latency for threaded backends:

```shell
node tests/benchmark-runtime-settings.cjs --backend simd-threads --threads 2,4 --tiles 128,160,200 --cancel
```

The benchmark records elapsed time, sampled peak RSS, sampled peak WASM heap,
an output SHA-256 prefix for consistency checks, and cancellation latency when
requested. Use larger `--width` and `--height` values for release-candidate
measurements; the defaults are intentionally small enough for quick regression
checks.
