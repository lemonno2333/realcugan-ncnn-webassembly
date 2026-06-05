# TODO

This fork keeps the existing ncnn Real-CUGAN models. The short-term goal is to
make the web app deployable and usable even when pthreads are unavailable.

## Phase 1: Keep the current models and add CPU fallback

- [x] Document the plan in this TODO.
- [x] Build multiple WebAssembly backends from the same C++ code and model files:
  `simd-threads`, `simd`, and `basic`.
- [x] Support single-threaded CPU inference when pthreads are not enabled.
- [x] Load the fastest supported backend in the browser, falling back to slower
  CPU-only builds instead of refusing to run.
- [x] Update GitHub Actions to build the current fork and upload the complete
  `web` artifact.
- [x] Show the deployed version and selected backend in the page footer.

## Phase 2: Make deployment predictable

- [x] Pin `ncnn` to `20220729` to avoid corrupted output from newer ncnn
  releases.
- [ ] Add a deployment guide for Nginx/Baota with COOP/COEP headers.
- [ ] Add a troubleshooting guide for SharedArrayBuffer, model 404s, and memory
  errors.

## Phase 3: Improve runtime stability

- [ ] Add mobile defaults with smaller tile size and conservative image limits.
- [ ] Add a small regression image set for output sanity checks.
- [ ] Improve memory cleanup after failures and canceled runs.
