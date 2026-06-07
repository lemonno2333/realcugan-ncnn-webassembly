# Worker Architecture

The `basic` and `simd` fallback backends now run in `web/wasmFallbackWorker.js`
instead of the UI thread. The threaded backend still uses Emscripten's generated
worker support and remains loaded through the main-page module path.

## Message Protocol

Main thread to fallback worker:

- `load`: load one backend by name and versioned assets.
- `start`: run one image task with transferred input pixels, model options, and
  adaptive runtime settings (`threadCount` and `tileSize`). The message also
  includes the selected model manifest so the worker can load the matching
  `.param` and `.bin` files into its own WebAssembly filesystem.
- `cancel`: request cancellation for the active task.

Fallback worker to main thread:

- `loading`: backend/runtime loading progress.
- `model-loading`: selected model file loading progress.
- `ready`: backend runtime is ready.
- `progress`: tile progress update.
- `complete`: processing finished and transfers the output RGBA buffer.
- `cancelled`: backend reported cancellation.
- `error`: load, allocation, validation, model, or inference failure.
- `stderr`: backend diagnostic text.
- `cancel-requested`: worker received the cancel request.

The UI routes worker events through the same handlers used by the main-thread
threaded backend: progress, completion, cancellation, and backend errors all
land in one state machine.

## Cancellation Behavior

`simd-threads` can call `_cancel_process()` directly while the worker thread is
running. The fallback `basic` and `simd` backends run synchronous WASM inside the
dedicated fallback worker. The main thread stays responsive, but the worker can
only process a `cancel` message once synchronous `_process_image()` yields back
to the worker event loop.

To preserve the already loaded fallback model, cancel/reset does not terminate
the worker. Stale worker results are ignored by `imageId` if the UI has already
moved on to a newer task.
