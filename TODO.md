# TODO

This fork is now maintained as a browser-based Real-CUGAN WebAssembly project.
The roadmap below tracks repository maintenance, user-facing features, model
coverage, build reliability, and release quality.

## Completed

- [x] Keep the existing ncnn Real-CUGAN models instead of converting or
  regenerating model files from scratch.
- [x] Build three WebAssembly backends from the same C++ code:
  `simd-threads`, `simd`, and `basic`.
- [x] Support CPU fallback when pthreads or SharedArrayBuffer are unavailable.
- [x] Select the fastest supported backend automatically in the browser.
- [x] Pin `ncnn` to `20220729` to avoid corrupted output seen with newer
  versions.
- [x] Preserve PNG alpha by processing RGB and upscaling alpha separately.
- [x] Show app version and selected backend in the footer.
- [x] Version `.js`, `.wasm`, `.worker.js`, and `.data` asset URLs to avoid
  stale WebAssembly package caches.
- [x] Remove Emscripten preload IndexedDB cache to prevent model package
  mismatches after updates.
- [x] Add SE and Pro model selection.
- [x] Add the full upstream SE model set currently used by this fork:
  2X conservative/no-denoise/denoise1x/denoise2x/denoise3x,
  3X conservative/no-denoise/denoise3x, and
  4X conservative/no-denoise/denoise3x.
- [x] Add available Pro 2X and 3X conservative/no-denoise/denoise3x models.
- [x] Redesign the web UI for a larger workspace and modern controls.
- [x] Keep original helper text for user guidance.
- [x] Move repository links into the About section and point the primary GitHub
  link to `lemonno2333/realcugan-ncnn-webassembly`.
- [x] Add Chinese, English, and Japanese UI languages.
- [x] Add Material Design Monet-inspired theme color extraction from uploaded
  images.
- [x] Add animated mesh-gradient processing state based on image dominant
  colors.
- [x] Replace side-by-side preview modes with one overlay comparison mode.
- [x] Add viewport-relative comparison slider, bounded zoom, wheel zoom, and
  drag-to-pan preview behavior.
- [x] Add Ambilight-style ambient glow for processing and result previews.
- [x] Improve mobile layout so pages can scroll vertically while staying within
  viewport width.
- [x] Add reset behavior for processing another image after upload.
- [x] Update README and README_CN for the current fork.
- [x] Commit and push the current maintained state to `origin/main`.

## Next: Release And Deployment Quality

- [ ] Add a release checklist for bumping `APP_VERSION`, rebuilding all
  backends, checking `.data` size changes, and uploading the full `web`
  artifact.
- [ ] Add Nginx/Baota deployment notes for COOP/COEP headers, MIME types, cache
  control, and large `.data` files.
- [ ] Add troubleshooting docs for SharedArrayBuffer fallback, model 404s,
  stale `.data` caches, `parse magic failed`, memory errors, and oversized
  images.
- [ ] Document which model combinations are available for SE and Pro.
- [ ] Add a short browser support table for desktop and mobile.

## Runtime Stability

- [x] Add preflight output size and memory risk estimation before processing.
- [ ] Add input size warnings before processing very large images.
- [ ] Add conservative mobile defaults for large images or low-memory devices.
- [x] Improve memory cleanup after failed, canceled, or out-of-memory runs.
- [x] Restore the UI to a reusable state after processing failures.
- [x] Map common backend errors to actionable user guidance.
- [ ] Consider exposing tile-size presets if memory pressure remains an issue.

## Testing

- [ ] Add a small regression image set for output sanity checks.
- [ ] Add a browser smoke test that loads each backend and verifies the package
  can read representative model files.
- [ ] Add UI smoke tests for language switching, model option constraints,
  upload/reset, zoom/pan, and overlay slider sync.
- [ ] Add a build check that fails if source model files change but generated
  `web/*.data` artifacts are stale in release artifacts.

## Frontend Maintenance

- [x] Add light/dark/auto theme mode.
- [ ] Review mobile touch interactions on iOS Safari and Android Chrome.
- [ ] Add accessible labels/tooltips for icon-only or compact controls.
- [ ] Improve keyboard support for zoom controls and the overlay slider.
- [ ] Audit text wrapping for long filenames across all supported languages.
- [ ] Keep the visual theme responsive without letting extracted colors reduce
  contrast.

## Model And Backend Maintenance

- [ ] Track upstream `realcugan-ncnn-vulkan` model changes and record when this
  fork syncs them.
- [ ] Decide whether `models-nose` should be supported in the web UI.
- [ ] Investigate whether 1X processing should be exposed as a practical model
  mode or kept out of the UI.
- [ ] Keep Pro support limited to model combinations that actually exist in the
  bundled files.
- [ ] Re-evaluate newer `ncnn` versions only with regression images before
  changing the pinned revision.

## Repository Hygiene

- [ ] Add `.gitattributes` for stable line endings and binary model handling.
- [ ] Document how generated `web/realcugan-ncnn-webassembly-*` files should be
  handled in releases versus source commits.
- [ ] Add issue templates for bug reports, model/output problems, and deployment
  problems.
- [ ] Add a changelog or release notes file for user-visible updates.
