# TODO

This roadmap focuses on WebAssembly backend performance, memory usage,
stability, cancellation, and build quality.

## Priority 1: Safety And Correctness

- [x] Check and propagate the return values from `ncnn::Net::load_param()` and
  `ncnn::Net::load_model()`.
- [x] Return structured model-loading errors to the web UI instead of
  continuing with an invalid or missing model.
- [x] Validate input width, height, scale, model type, denoise level, and
  buffer pointers before processing.
- [x] Use `size_t` or checked 64-bit arithmetic for pixel counts and buffer
  sizes to prevent integer overflow on very large images.
- [x] Add exception handling around model loading, allocation, and inference
  so the worker always returns to a reusable state.
- [x] Replace the global raw task pointer with an explicit
  `Idle / Running / Cancelling` task state.
- [x] Use RAII containers and smart pointers for task and alpha buffers to
  guarantee cleanup on every return path.

## Priority 2: Peak Memory Reduction

- [x] Measure and document peak memory for representative 2X, 3X, and 4X
  workloads, including 1080p, 1440p, and 4K inputs.
- [x] Remove the full-size intermediate RGB output image where possible.
- [x] Write completed tiles directly into the final RGBA output buffer.
- [x] Avoid allocating a full upscaled alpha buffer.
- [x] Add a fast path for fully opaque images that skips alpha extraction and
  upscaling.
- [x] For transparent images, upscale and merge alpha per tile.
- [x] Reduce duplicate full-image copies between Canvas `ImageData`, the
  JavaScript heap, and WebAssembly memory.
- [x] Revisit the frontend memory-risk estimator after measuring the optimized
  backend.

## Priority 3: Worker Architecture

- [ ] Move the SIMD fallback backend into a dedicated Web Worker.
- [ ] Move the basic fallback backend into a dedicated Web Worker.
- [ ] Keep rendering, controls, animations, and cancellation responsive while
  fallback processing is active.
- [ ] Define one message protocol for start, progress, cancel, complete, and
  error events across all backends.
- [ ] Ensure cancel/reset never reloads the page or discards an already loaded
  model.
- [ ] Verify that a second task can start immediately after cancellation on
  every backend.

## Priority 4: Adaptive Runtime Settings

- [ ] Cap inference threads instead of always using every logical CPU core.
- [ ] Benchmark desktop thread limits of 4, 6, and 8.
- [ ] Benchmark mobile thread limits of 2 and 4.
- [ ] Select a conservative default from hardware concurrency and device
  memory signals.
- [ ] Add adaptive tile sizes such as 128, 160, and 200.
- [ ] Prefer smaller tiles on memory-constrained devices and when low cancel
  latency is important.
- [ ] Benchmark tile-size effects on speed, peak memory, output consistency,
  and cancellation latency.

## Priority 5: Model Loading

- [ ] Stop bundling every model into one approximately 42.5 MB `.data` file.
- [ ] Load only the selected model's `.param` and `.bin` files.
- [ ] Cache model files through normal browser HTTP caching.
- [ ] Reuse a loaded model while scale, denoise, and model type remain
  unchanged.
- [ ] Load a new model only when the selected combination changes.
- [ ] Show separate progress states for runtime loading and model loading.
- [ ] Verify model-file integrity and report missing combinations clearly.

## Performance Cleanup

- [ ] Throttle progress callbacks to approximately one update every
  100-200 ms.
- [ ] Replace formatted stdout JSON callbacks with a lower-overhead direct
  callback or message path.
- [x] Remove unused synchronization members and inactive runtime fields.
- [x] Remove duplicate includes and stale implementation code.
- [ ] Benchmark `-flto` for runtime speed and artifact size.
- [ ] Benchmark Emscripten `emmalloc` against the current allocator.
- [ ] Review `ALLOW_MEMORY_GROWTH` settings and establish sensible initial and
  maximum memory values for threaded and fallback builds.
- [ ] Confirm that performance build flags do not change output pixels.

## Testing And Acceptance

- [ ] Add a backend smoke test for every supported model, scale, and denoise
  combination.
- [ ] Add tests for missing, corrupted, and mismatched model files.
- [x] Add tests for invalid dimensions and arithmetic overflow.
- [ ] Add cancellation tests before inference, during a tile, and between
  tiles.
- [x] Add a cancel-then-process-again regression test.
- [ ] Add repeated-task tests to detect memory growth and stale task state.
- [ ] Compare output hashes or image metrics before and after each backend
  optimization.
- [ ] Test `simd-threads`, `simd`, and `basic` on desktop and mobile browsers.
- [ ] Record processing time, peak memory, cancellation latency, and artifact
  size for each release candidate.
