var Module = null;
let loadedBackend = '';
let appVersion = '';
let loading = false;
let processing = false;
let activeTask = null;
let finalEvent = null;
let loadedModelKey = '';
let loadedModelFiles = {};

function versionedUrl(path) {
    return path + '?v=' + encodeURIComponent(appVersion);
}

function post(type, payload, transfer) {
    self.postMessage(Object.assign({type}, payload || {}), transfer || []);
}

function releaseActiveTask() {
    if (!activeTask || !Module) {
        activeTask = null;
        return;
    }
    if (activeTask.inputPtr) {
        Module._free(activeTask.inputPtr);
    }
    if (activeTask.outputPtr) {
        Module._free(activeTask.outputPtr);
    }
    activeTask = null;
}

function postModelLoading(modelFiles, backend, progress, file) {
    post('model-loading', {
        backend,
        progress,
        model: modelFiles && modelFiles.label ? modelFiles.label : '',
        file: file || ''
    });
}

async function fetchModelAsset(path, expectedBytes, progress, backend, modelFiles) {
    postModelLoading(modelFiles, backend, Math.max(0, progress - 10), path);
    const response = await fetch(versionedUrl('models/' + path));
    if (!response.ok) {
        throw new Error('model_file_not_found: ' + path);
    }
    const contentLength = Number(response.headers.get('content-length')) || 0;
    if (contentLength && expectedBytes && contentLength !== expectedBytes) {
        throw new Error('model_file_size_mismatch: ' + path + ' expected=' + expectedBytes + ' actual=' + contentLength);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (expectedBytes && bytes.length !== expectedBytes) {
        throw new Error('model_file_size_mismatch: ' + path + ' expected=' + expectedBytes + ' actual=' + bytes.length);
    }
    postModelLoading(modelFiles, backend, progress, path);
    return bytes;
}

function ensureModelDirectory(path) {
    const slashIndex = path.lastIndexOf('/');
    if (slashIndex <= 0) {
        return '/';
    }
    const dir = path.substring(0, slashIndex);
    try {
        Module.FS_createPath('/', dir, true, true);
    } catch (error) {
        // Directory already exists.
    }
    return '/' + dir;
}

function writeModelFile(path, bytes) {
    const dir = ensureModelDirectory(path);
    const name = path.substring(path.lastIndexOf('/') + 1);
    const fsPath = '/' + path;
    try {
        Module.FS_unlink(fsPath);
    } catch (error) {
        // File is not present yet.
    }
    Module.FS_createDataFile(dir, name, bytes, true, true, true);
}

function unloadPreviousModelFiles(nextFiles) {
    Object.keys(loadedModelFiles).forEach((path) => {
        if (path === nextFiles.param || path === nextFiles.bin) {
            return;
        }
        try {
            Module.FS_unlink('/' + path);
        } catch (error) {
            // The file may already have been removed by a previous failed load.
        }
        delete loadedModelFiles[path];
    });
}

function getProvidedModelBytes(modelFiles, modelAssets) {
    if (!modelAssets || !modelAssets.paramBuffer || !modelAssets.binBuffer) {
        return null;
    }
    const paramBytes = new Uint8Array(modelAssets.paramBuffer);
    const binBytes = new Uint8Array(modelAssets.binBuffer);
    if (modelFiles.paramBytes && paramBytes.length !== modelFiles.paramBytes) {
        throw new Error('model_file_size_mismatch: ' + modelFiles.param + ' expected=' + modelFiles.paramBytes + ' actual=' + paramBytes.length);
    }
    if (modelFiles.binBytes && binBytes.length !== modelFiles.binBytes) {
        throw new Error('model_file_size_mismatch: ' + modelFiles.bin + ' expected=' + modelFiles.binBytes + ' actual=' + binBytes.length);
    }
    return {paramBytes, binBytes};
}

async function ensureModelLoaded(modelFiles, backend, modelAssets) {
    if (!modelFiles || !modelFiles.key || !modelFiles.param || !modelFiles.bin) {
        throw new Error('model_manifest_missing');
    }
    if (loadedModelKey === modelFiles.key &&
        loadedModelFiles[modelFiles.param] &&
        loadedModelFiles[modelFiles.bin]) {
        return;
    }

    postModelLoading(modelFiles, backend, 0, modelFiles.param);
    const providedBytes = getProvidedModelBytes(modelFiles, modelAssets);
    const paramBytes = providedBytes
        ? providedBytes.paramBytes
        : await fetchModelAsset(modelFiles.param, modelFiles.paramBytes, 35, backend, modelFiles);
    if (providedBytes) {
        postModelLoading(modelFiles, backend, 35, modelFiles.param);
    }
    const binBytes = providedBytes
        ? providedBytes.binBytes
        : await fetchModelAsset(modelFiles.bin, modelFiles.binBytes, 90, backend, modelFiles);
    if (providedBytes) {
        postModelLoading(modelFiles, backend, 90, modelFiles.bin);
    }
    writeModelFile(modelFiles.param, paramBytes);
    writeModelFile(modelFiles.bin, binBytes);
    unloadPreviousModelFiles(modelFiles);
    loadedModelFiles[modelFiles.param] = true;
    loadedModelFiles[modelFiles.bin] = true;
    loadedModelKey = modelFiles.key;
    postModelLoading(modelFiles, backend, 100, modelFiles.bin);
}

function finishActiveTask(retCode) {
    const task = activeTask;
    if (!task) {
        processing = false;
        return;
    }

    if (retCode !== 0) {
        releaseActiveTask();
        processing = false;
        post('error', {
            imageId: task.imageId,
            code: retCode,
            message: 'process_image_rejected'
        });
        return;
    }

    if (!finalEvent) {
        releaseActiveTask();
        processing = false;
        post('error', {
            imageId: task.imageId,
            code: -11,
            message: 'missing_completion_event'
        });
        return;
    }

    if (finalEvent.eventType === 'PROC_ERROR') {
        const event = finalEvent;
        releaseActiveTask();
        processing = false;
        post('error', {
            imageId: event.image_id,
            code: event.code,
            message: event.message || 'backend_error'
        });
        return;
    }

    if (finalEvent.eventType === 'PROC_CANCELLED') {
        releaseActiveTask();
        processing = false;
        post('cancelled', {imageId: finalEvent.image_id});
        return;
    }

    const outputBytes = Module.HEAPU8.slice(task.outputPtr, task.outputPtr + task.outputByteLength);
    const outputBuffer = outputBytes.buffer;
    const cost = finalEvent.cost || 0;
    const imageId = finalEvent.image_id;
    const width = task.outputWidth;
    const height = task.outputHeight;
    releaseActiveTask();
    processing = false;
    post('complete', {
        imageId,
        cost,
        width,
        height,
        outputBuffer
    }, [outputBuffer]);
}

async function loadBackend(backend, version) {
    if (loadedBackend === backend && Module) {
        post('ready', {backend});
        return;
    }
    if (loading) {
        post('error', {
            code: -11,
            message: 'backend_load_already_in_progress'
        });
        return;
    }

    loading = true;
    appVersion = version || '';
    post('loading', {progress: 3, backend});

    try {
        const wasmResponse = await fetch(versionedUrl('realcugan-ncnn-webassembly-' + backend + '.wasm'));
        if (!wasmResponse.ok) {
            throw new Error('WASM resource not found: ' + backend);
        }
        const wasmBinary = await wasmResponse.arrayBuffer();
        post('loading', {progress: 40, backend});

        Module = {
            wasmBinary,
            print: (text) => {
                if (text) {
                    post('stdout', {text: String(text)});
                }
            },
            printErr: (text) => {
                post('stderr', {text: String(text || '')});
            },
            onBackendProgress: (totalCost, tileCost, progressRate, remainingTime) => {
                post('progress', {
                    totalCost,
                    tileCost,
                    progressRate,
                    remainingTime
                });
            },
            onBackendComplete: (imageId, cost) => {
                finalEvent = {
                    eventType: 'PROC_END',
                    image_id: imageId,
                    cost
                };
            },
            onBackendCancelled: (imageId) => {
                finalEvent = {
                    eventType: 'PROC_CANCELLED',
                    image_id: imageId
                };
            },
            onBackendError: (imageId, code, message) => {
                finalEvent = {
                    eventType: 'PROC_ERROR',
                    image_id: imageId,
                    code,
                    message
                };
            },
            setStatus: (text) => {
                const match = (text || '').match(/Downloading data\.\.\. \((\d+)\/(\d+)\)/);
                if (match && Number(match[2]) > 0) {
                    const dataProgress = Number(match[1]) / Number(match[2]);
                    post('loading', {
                        backend,
                        progress: Math.min(99, Math.max(45, Math.round(45 + dataProgress * 54)))
                    });
                }
            },
            locateFile: (path, prefix) => {
                if (path.indexOf('.worker.js') !== -1) {
                    return versionedUrl(path);
                }
                return prefix + path;
            },
            onRuntimeInitialized: () => {
                loadedBackend = backend;
                loadedModelKey = '';
                loadedModelFiles = {};
                loading = false;
                post('ready', {backend});
            }
        };

        importScripts(versionedUrl('realcugan-ncnn-webassembly-' + backend + '.js'));
    } catch (error) {
        loading = false;
        post('error', {
            code: -11,
            message: 'backend_load_failed',
            detail: error && error.message ? error.message : String(error)
        });
    }
}

async function startTask(message) {
    if (!Module || loadedBackend !== message.backend) {
        post('error', {
            imageId: message.imageId,
            code: -11,
            message: 'backend_not_ready'
        });
        return;
    }
    if (processing) {
        post('error', {
            imageId: message.imageId,
            code: -1,
            message: 'backend_busy'
        });
        return;
    }

    processing = true;
    finalEvent = null;

    try {
        await ensureModelLoaded(message.modelFiles, message.backend, message.modelAssets);
        const inputBytes = new Uint8Array(message.inputBuffer);
        const inputPtr = Module._malloc(inputBytes.length);
        const outputPtr = Module._malloc(message.outputByteLength);
        if (!inputPtr || !outputPtr) {
            if (inputPtr) {
                Module._free(inputPtr);
            }
            if (outputPtr) {
                Module._free(outputPtr);
            }
            processing = false;
            post('error', {
                imageId: message.imageId,
                code: -7,
                message: 'malloc_failed'
            });
            return;
        }

        Module.HEAPU8.set(inputBytes, inputPtr);
        activeTask = {
            imageId: message.imageId,
            inputPtr,
            outputPtr,
            outputByteLength: message.outputByteLength,
            outputWidth: message.outputWidth,
            outputHeight: message.outputHeight
        };

        const retCode = Module._process_image(
            message.imageId,
            inputPtr,
            inputBytes.length,
            outputPtr,
            message.outputByteLength,
            message.width,
            message.height,
            message.scale,
            message.denoise,
            message.modelType,
            message.threadCount || 1,
            message.tileSize || 160
        );
        finishActiveTask(retCode);
    } catch (error) {
        releaseActiveTask();
        processing = false;
        post('error', {
            imageId: message.imageId,
            code: -11,
            message: error && error.message && error.message.indexOf('model_') === 0
                ? error.message
                : 'backend_exception',
            detail: error && error.message ? error.message : String(error)
        });
    }
}

self.onmessage = (event) => {
    const message = event.data || {};
    if (message.type === 'load') {
        loadBackend(message.backend, message.appVersion);
    } else if (message.type === 'start') {
        startTask(message);
    } else if (message.type === 'cancel') {
        if (Module && typeof Module._cancel_process === 'function') {
            Module._cancel_process();
        }
        post('cancel-requested', {imageId: message.imageId});
    }
};
