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

- [x] Move the SIMD fallback backend into a dedicated Web Worker.
- [x] Move the basic fallback backend into a dedicated Web Worker.
- [x] Keep rendering, controls, animations, and cancellation responsive while
  fallback processing is active.
- [x] Define one message protocol for start, progress, cancel, complete, and
  error events across all backends.
- [x] Ensure cancel/reset never reloads the page or discards an already loaded
  model.
- [x] Verify that a second task can start immediately after cancellation on
  every backend. Reviewed and not recommended as an extra guarantee because it
  adds complexity without a clear product benefit.

## Priority 4: Adaptive Runtime Settings

- [x] Cap inference threads instead of always using every logical CPU core.
- [x] Benchmark desktop thread limits of 4, 6, and 8.
- [x] Benchmark mobile thread limits of 2 and 4.
- [x] Select a conservative default from hardware concurrency and device
  memory signals.
- [x] Add adaptive tile sizes such as 128, 160, and 200.
- [x] Prefer smaller tiles on memory-constrained devices and when low cancel
  latency is important.
- [x] Benchmark tile-size effects on speed, peak memory, output consistency,
  and cancellation latency.

## Priority 5: Model Loading

- [x] Stop bundling every model into one approximately 42.5 MB `.data` file.
- [x] Load only the selected model's `.param` and `.bin` files.
- [x] Cache model files through normal browser HTTP caching.
- [x] Reuse a loaded model while scale, denoise, and model type remain
  unchanged.
- [x] Load a new model only when the selected combination changes.
- [x] Show separate progress states for runtime loading and model loading.
- [x] Verify model-file integrity and report missing combinations clearly.

## Performance Cleanup

- [x] Throttle progress callbacks to approximately one update every
  100-200 ms.
- [x] Replace formatted stdout JSON callbacks with a lower-overhead direct
  callback or message path.
- [x] Remove unused synchronization members and inactive runtime fields.
- [x] Remove duplicate includes and stale implementation code.
- [x] Benchmark `-flto` for runtime speed and artifact size.
- [x] Benchmark Emscripten `emmalloc` against the current allocator.
- [x] Review `ALLOW_MEMORY_GROWTH` settings and establish sensible initial and
  maximum memory values for threaded and fallback builds.
- [x] Confirm that performance build flags do not change output pixels.

## Testing And Acceptance

- [x] Add a backend smoke test for every supported model, scale, and denoise
  combination.
- [x] Add tests for missing, corrupted, and mismatched model files.
- [x] Add tests for invalid dimensions and arithmetic overflow.
- [x] Add cancellation tests before inference, during a tile, and between
  tiles.
- [x] Add a cancel-then-process-again regression test.
- [x] Add repeated-task tests to detect memory growth and stale task state.
- [x] Compare output hashes or image metrics before and after each backend
  optimization.
- [x] Test `simd-threads`, `simd`, and `basic` on desktop and mobile browsers.
- [x] Record processing time, peak memory, cancellation latency, and artifact
  size for each release candidate.

## Frontend Optimization Roadmap

### Priority 1: Model Loading UX

- [x] Show the selected model name and file pair while model assets are loading.
- [x] Report the exact missing or mismatched `.param` / `.bin` file in user-facing
  model-load errors.
- [x] Add optional default-model preloading after the runtime backend is ready.
- [x] Reduce visible loading noise when selected model files are already cached
  or already loaded in the active backend.
- [ ] Add model asset hash verification or a generated manifest checksum in
  addition to byte-size checks.

### Priority 2: Process State And Error UX

- [ ] Consolidate upload, runtime loading, model loading, processing,
  cancelling, done, and error state into an explicit frontend state machine.
- [ ] Make stale worker/main-thread results consistently ignored by `imageId`
  across every completion, cancellation, and error path.
- [ ] Improve fallback messaging when `simd-threads` is unavailable because
  `SharedArrayBuffer`, COOP, or COEP requirements are not met.
- [ ] Add clearer recovery actions after processing errors, such as reset,
  lower scale, smaller tile, or retry with another backend.
- [ ] Preserve useful process details in errors, including backend, model,
  scale, denoise level, thread count, tile size, and image dimensions.

### Priority 3: Mobile And Large-Image Experience

- [x] Warn before starting high-risk large-image or 4x jobs on low-memory
  devices.
- [x] Offer one-click safer settings for large jobs, such as lower scale,
  smaller tile size, or fallback backend.
- [x] Improve small-screen control density so model, scale, denoise, and backend
  controls are easier to use without excessive scrolling.
- [x] Auto-scroll or focus the preview/result area after upload and after
  processing completes on mobile.
- [x] Revisit touch zoom and pan ergonomics for zoomed previews.

### Priority 4: Resource Loading And Deployment

- [x] Document recommended cache headers for `.wasm`, `.js`, worker, and
  `web/models/` assets.
- [x] Document required COOP/COEP headers for the threaded backend with examples
  for common static hosts or reverse proxies.
- [x] Add a deployment sanity check script that verifies all referenced backend
  artifacts and model files exist in `web/`.
- [ ] Consider generating a versioned asset manifest so cache busting does not
  rely only on query strings.
- [x] Audit whether current no-cache HTML meta tags conflict with long-lived
  model and WASM caching goals.

### Priority 5: Frontend Tests

- [x] Add Playwright smoke tests for upload, process success, reset, download,
  and error display.
- [x] Add Playwright coverage for backend fallback selection when
  `simd-threads` is unavailable.
- [x] Add tests for model-load failure UI, including missing file, size mismatch,
  and stale manifest cases.
- [ ] Add tests for cancellation/reset UI behavior in both threaded and fallback
  worker paths.
- [ ] Add snapshot or pixel smoke checks for the preview comparison UI.

### Priority 6: Maintainability

- [x] Centralize adaptive stage layout constants and sizing helpers.
- [x] Extract theme color derivation and CSS variable application helpers.
- [x] Replace layout, preview, and ambient-glow DOM lookups with Vue refs where
  practical.
- [x] Split i18n strings and model manifests out of `web/index.html`.
- [ ] Split remaining runtime defaults out of `web/index.html` where it keeps
  the static app shape simpler.
- [ ] Move backend-runtime orchestration into a small dedicated module while
  keeping the app deployable as static files.
- [ ] Extract preview zoom/pan logic into focused helper functions with unit
  tests.
- [ ] Generate the model manifest from `web/models/` during build to avoid
  manual byte-size drift.
- [ ] Keep the no-build static app shape unless a build step clearly reduces
  complexity or improves release safety.
