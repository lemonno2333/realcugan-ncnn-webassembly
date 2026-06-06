const assert = require('node:assert/strict');
const path = require('node:path');

const backend = process.argv[2] || 'basic';
const isThreaded = backend.includes('threads');
const webRoot = path.resolve(__dirname, '..', 'web');
const modulePath = path.join(webRoot, `realcugan-ncnn-webassembly-${backend}.js`);
const callbacks = [];
const originalLog = console.log;

global.navigator = {hardwareConcurrency: 4};
process.chdir(webRoot);
console.log = (...args) => {
    const text = args.join(' ');
    if (text.startsWith('$CALLBACK$ ')) {
        callbacks.push(JSON.parse(text.slice(11)));
    }
    originalLog(...args);
};

const Module = require(modulePath);

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

async function run() {
    await waitFor(() => Module.calledRun, 10000, 'WASM initialization');

    const probe = allocateImage(2, 2, 2);
    assert.equal(Module._get_task_state(), 0);
    assert.equal(Module._process_image(1, 0, probe.inputSize, probe.output,
        probe.outputSize, 2, 2, 2, 0, 0), -2);
    assert.equal(Module._process_image(1, probe.input, probe.inputSize, probe.output,
        probe.outputSize, 0, 2, 2, 0, 0), -3);
    assert.equal(Module._process_image(1, probe.input, probe.inputSize, probe.output,
        probe.outputSize, 2, 2, 4, 3, 1), -4);
    assert.equal(Module._process_image(1, probe.input, probe.inputSize - 1, probe.output,
        probe.outputSize, 2, 2, 2, 0, 0), -6);
    assert.equal(Module._process_image(1, probe.input, probe.inputSize, probe.output,
        probe.outputSize, 2147483647, 2, 4, 0, 0), -5);
    assert.equal(Module._get_task_state(), 0);
    freeImage(probe);

    const first = allocateImage(16, 16, 2);
    const firstCallbackIndex = callbacks.length;
    assert.equal(Module._process_image(2, first.input, first.inputSize, first.output,
        first.outputSize, 16, 16, 2, 0, 0), 0);
    const firstResult = await waitFor(
        () => isThreaded
            ? Module._get_task_state() === 0
            : callbacks.slice(firstCallbackIndex).find((event) =>
                event.eventType === 'PROC_END' || event.eventType === 'PROC_ERROR'),
        30000,
        'first processing result'
    );
    if (!isThreaded) {
        assert.equal(firstResult.eventType, 'PROC_END');
    }
    assert.ok(Module.HEAPU8.subarray(first.output, first.output + first.outputSize)
        .some((value) => value !== 0));
    assert.equal(Module._get_task_state(), 0);
    freeImage(first);

    const transparent = allocateImage(10, 10, 2, true);
    const transparentCallbackIndex = callbacks.length;
    assert.equal(Module._process_image(6, transparent.input, transparent.inputSize,
        transparent.output, transparent.outputSize, 10, 10, 2, 0, 0), 0);
    const transparentResult = await waitFor(
        () => isThreaded
            ? Module._get_task_state() === 0
            : callbacks.slice(transparentCallbackIndex).find((event) =>
                event.eventType === 'PROC_END' || event.eventType === 'PROC_ERROR'),
        30000,
        'transparent processing result'
    );
    if (!isThreaded) {
        assert.equal(transparentResult.eventType, 'PROC_END');
    }
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
        Module.FS_unlink('/up3x-no-denoise.param');
        const missingModel = allocateImage(8, 8, 3);
        const missingModelCallbackIndex = callbacks.length;
        assert.equal(Module._process_image(5, missingModel.input, missingModel.inputSize,
            missingModel.output, missingModel.outputSize, 8, 8, 3, 0, 0), 0);
        const modelError = callbacks.slice(missingModelCallbackIndex).find((event) =>
            event.eventType === 'PROC_ERROR');
        assert.ok(modelError);
        assert.equal(modelError.code, -8);
        assert.equal(modelError.message, 'model_param_load_failed');
        assert.equal(Module._get_task_state(), 0);
        freeImage(missingModel);
    }

    if (isThreaded) {
        const cancelled = allocateImage(512, 512, 2);
        assert.equal(Module._process_image(4, cancelled.input, cancelled.inputSize,
            cancelled.output, cancelled.outputSize, 512, 512, 2, 0, 0), 0);
        await waitFor(() => Module._get_task_state() === 1, 5000, 'running task state');
        assert.equal(Module._cancel_process(), 1);
        await waitFor(() => Module._get_task_state() === 0, 30000, 'cancelled task cleanup');
        freeImage(cancelled);
    }

    const second = allocateImage(12, 12, 2);
    const secondCallbackIndex = callbacks.length;
    assert.equal(Module._process_image(3, second.input, second.inputSize, second.output,
        second.outputSize, 12, 12, 2, 0, 0), 0);
    const secondResult = await waitFor(
        () => isThreaded
            ? Module._get_task_state() === 0
            : callbacks.slice(secondCallbackIndex).find((event) =>
                event.eventType === 'PROC_END' || event.eventType === 'PROC_ERROR'),
        30000,
        'second processing result'
    );
    if (!isThreaded) {
        assert.equal(secondResult.eventType, 'PROC_END');
    }
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
