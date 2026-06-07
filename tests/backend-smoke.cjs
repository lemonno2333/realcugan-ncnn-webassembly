const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const backend = process.argv[2] || 'basic';
const isThreaded = backend.includes('threads');
const DEFAULT_THREAD_COUNT = isThreaded ? 4 : 1;
const DEFAULT_TILE_SIZE = 160;
const webRoot = path.resolve(__dirname, '..', 'web');
const modulePath = path.join(webRoot, `realcugan-ncnn-webassembly-${backend}.js`);
const callbacks = [];
const originalLog = console.log;

global.navigator = {hardwareConcurrency: 4};
process.chdir(webRoot);

const Module = require(modulePath);
Module.onBackendProgress = (totalCost, tileCost, progressRate, remainingTime) => {
    callbacks.push({
        eventType: 'PROC_PROGRESS',
        total_cost: totalCost,
        tile_cost: tileCost,
        progress_rate: progressRate,
        remaining_time: remainingTime
    });
};
Module.onBackendComplete = (imageId, cost) => {
    callbacks.push({
        eventType: 'PROC_END',
        image_id: imageId,
        cost
    });
};
Module.onBackendCancelled = (imageId) => {
    callbacks.push({
        eventType: 'PROC_CANCELLED',
        image_id: imageId
    });
};
Module.onBackendError = (imageId, code, message) => {
    callbacks.push({
        eventType: 'PROC_ERROR',
        image_id: imageId,
        code,
        message
    });
};

function waitFor(predicate, timeoutMs, description) {
    const started = Date.now();
    return new Promise((resolve, reject) => {
        const check = () => {
            const value = predicate();
            if (value) {
                resolve(value);
                return;
            }
            if (Date.now() - started >= timeoutMs) {
                reject(new Error(`Timed out waiting for ${description}`));
                return;
            }
            setTimeout(check, 10);
        };
        check();
    });
}

function allocateImage(width, height, scale, transparent = false) {
    const inputSize = width * height * 4;
    const outputSize = width * height * scale * scale * 4;
    const input = Module._malloc(inputSize);
    const output = Module._malloc(outputSize);
    assert.notEqual(input, 0);
    assert.notEqual(output, 0);
    Module.HEAPU8.fill(127, input, input + inputSize);
    Module.HEAPU8.fill(0, output, output + outputSize);
    let pixelIndex = 0;
    for (let offset = input + 3; offset < input + inputSize; offset += 4) {
        Module.HEAPU8[offset] = transparent && pixelIndex % 5 === 0 ? 64 : 255;
        pixelIndex++;
    }
    return {input, inputSize, output, outputSize};
}

function freeImage(image) {
    Module._free(image.input);
    Module._free(image.output);
}

function ensureModelDirectory(modelPath) {
    const slashIndex = modelPath.lastIndexOf('/');
    if (slashIndex <= 0) {
        return '/';
    }
    const dir = modelPath.slice(0, slashIndex);
    try {
        Module.FS_createPath('/', dir, true, true);
    } catch (error) {
        // Directory already exists.
    }
    return '/' + dir;
}

function writeModelFile(modelPath) {
    const source = path.join(webRoot, 'models', modelPath);
    const bytes = fs.readFileSync(source);
    const dir = ensureModelDirectory(modelPath);
    const name = modelPath.slice(modelPath.lastIndexOf('/') + 1);
    const fsPath = '/' + modelPath;
    try {
        Module.FS_unlink(fsPath);
    } catch (error) {
        // File is not present yet.
    }
    Module.FS_createDataFile(dir, name, bytes, true, true, true);
}

function loadModel(scale, denoise, modelType = 0) {
    const prefix = modelType === 1 ? 'models-pro/' : '';
    let suffix;
    if (denoise === -1) {
        suffix = `up${scale}x-conservative`;
    } else if (denoise === 0) {
        suffix = `up${scale}x-no-denoise`;
    } else {
        suffix = `up${scale}x-denoise${denoise}x`;
    }
    writeModelFile(`${prefix}${suffix}.param`);
    writeModelFile(`${prefix}${suffix}.bin`);
}

function processImage(imageId, input, inputSize, output, outputSize, width, height,
    scale, denoise, modelType, threadCount = DEFAULT_THREAD_COUNT, tileSize = DEFAULT_TILE_SIZE) {
    return Module._process_image(imageId, input, inputSize, output, outputSize, width, height,
        scale, denoise, modelType, threadCount, tileSize);
}

function findFinalEvent(startIndex) {
    return callbacks.slice(startIndex).find((event) =>
        event.eventType === 'PROC_END' ||
        event.eventType === 'PROC_CANCELLED' ||
        event.eventType === 'PROC_ERROR');
}

async function run() {
    await waitFor(() => Module.calledRun, 10000, 'WASM initialization');
    loadModel(2, 0, 0);

    const probe = allocateImage(2, 2, 2);
    assert.equal(Module._get_task_state(), 0);
    assert.equal(processImage(1, 0, probe.inputSize, probe.output,
        probe.outputSize, 2, 2, 2, 0, 0), -2);
    assert.equal(processImage(1, probe.input, probe.inputSize, probe.output,
        probe.outputSize, 0, 2, 2, 0, 0), -3);
    assert.equal(processImage(1, probe.input, probe.inputSize, probe.output,
        probe.outputSize, 2, 2, 4, 3, 1), -4);
    assert.equal(processImage(1, probe.input, probe.inputSize, probe.output,
        probe.outputSize, 2, 2, 2, 0, 0, 0, DEFAULT_TILE_SIZE), -4);
    assert.equal(processImage(1, probe.input, probe.inputSize, probe.output,
        probe.outputSize, 2, 2, 2, 0, 0, DEFAULT_THREAD_COUNT, 96), -4);
    assert.equal(processImage(1, probe.input, probe.inputSize - 1, probe.output,
        probe.outputSize, 2, 2, 2, 0, 0), -6);
    assert.equal(processImage(1, probe.input, probe.inputSize, probe.output,
        probe.outputSize, 2147483647, 2, 4, 0, 0), -5);
    assert.equal(Module._get_task_state(), 0);
    freeImage(probe);

    const first = allocateImage(16, 16, 2);
    const firstCallbackIndex = callbacks.length;
    assert.equal(processImage(2, first.input, first.inputSize, first.output,
        first.outputSize, 16, 16, 2, 0, 0), 0);
    const firstResult = await waitFor(() => findFinalEvent(firstCallbackIndex),
        30000, 'first processing result');
    assert.equal(firstResult.eventType, 'PROC_END');
    assert.ok(Module.HEAPU8.subarray(first.output, first.output + first.outputSize)
        .some((value) => value !== 0));
    assert.equal(Module._get_task_state(), 0);
    freeImage(first);

    const transparent = allocateImage(10, 10, 2, true);
    const transparentCallbackIndex = callbacks.length;
    assert.equal(processImage(6, transparent.input, transparent.inputSize,
        transparent.output, transparent.outputSize, 10, 10, 2, 0, 0), 0);
    const transparentResult = await waitFor(() => findFinalEvent(transparentCallbackIndex),
        30000, 'transparent processing result');
    assert.equal(transparentResult.eventType, 'PROC_END');
    const transparentOutput = Module.HEAPU8.subarray(transparent.output,
        transparent.output + transparent.outputSize);
    let hasTransparentAlpha = false;
    for (let offset = 3; offset < transparentOutput.length; offset += 4) {
        if (transparentOutput[offset] < 255) {
            hasTransparentAlpha = true;
            break;
        }
    }
    assert.ok(hasTransparentAlpha);
    assert.equal(Module._get_task_state(), 0);
    freeImage(transparent);

    if (backend === 'basic') {
        loadModel(3, 0, 0);
        Module.FS_unlink('/up3x-no-denoise.param');
        const missingModel = allocateImage(8, 8, 3);
        const missingModelCallbackIndex = callbacks.length;
        assert.equal(processImage(5, missingModel.input, missingModel.inputSize,
            missingModel.output, missingModel.outputSize, 8, 8, 3, 0, 0), 0);
        const modelError = callbacks.slice(missingModelCallbackIndex).find((event) =>
            event.eventType === 'PROC_ERROR');
        assert.ok(modelError);
        assert.equal(modelError.code, -8);
        assert.equal(modelError.message, 'model_param_load_failed');
        assert.equal(Module._get_task_state(), 0);
        freeImage(missingModel);
        loadModel(2, 0, 0);
    }

    if (isThreaded) {
        const cancelled = allocateImage(512, 512, 2);
        const cancelCallbackIndex = callbacks.length;
        assert.equal(processImage(4, cancelled.input, cancelled.inputSize,
            cancelled.output, cancelled.outputSize, 512, 512, 2, 0, 0), 0);
        await waitFor(() => Module._get_task_state() === 1, 5000, 'running task state');
        assert.equal(Module._cancel_process(), 1);
        const cancelResult = await waitFor(() => findFinalEvent(cancelCallbackIndex),
            30000, 'cancelled task callback');
        assert.equal(cancelResult.eventType, 'PROC_CANCELLED');
        assert.equal(Module._get_task_state(), 0);
        freeImage(cancelled);
    }

    const second = allocateImage(12, 12, 2);
    const secondCallbackIndex = callbacks.length;
    assert.equal(processImage(3, second.input, second.inputSize, second.output,
        second.outputSize, 12, 12, 2, 0, 0), 0);
    const secondResult = await waitFor(() => findFinalEvent(secondCallbackIndex),
        30000, 'second processing result');
    assert.equal(secondResult.eventType, 'PROC_END');
    assert.ok(Module.HEAPU8.subarray(second.output, second.output + second.outputSize)
        .some((value) => value !== 0));
    assert.equal(Module._get_task_state(), 0);
    freeImage(second);

    originalLog(`backend smoke test passed: ${backend}`);
    if (isThreaded) {
        process.exit(0);
    }
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
