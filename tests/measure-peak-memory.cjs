const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const path = require('node:path');

const SIZE_PRESETS = {
    '1080p': {width: 1920, height: 1080},
    '1440p': {width: 2560, height: 1440},
    '4k': {width: 3840, height: 2160}
};

const DEFAULT_SIZES = ['1080p', '1440p', '4k'];
const DEFAULT_SCALES = [2, 3, 4];

function parseArgs(argv) {
    const options = {
        backend: 'basic',
        denoise: 0,
        modelType: 0,
        sizes: DEFAULT_SIZES,
        scales: DEFAULT_SCALES,
        child: false,
        width: 0,
        height: 0,
        scale: 0,
        json: false,
        transparent: false
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const next = () => {
            i++;
            if (i >= argv.length) {
                throw new Error(`Missing value for ${arg}`);
            }
            return argv[i];
        };

        if (arg === '--child') {
            options.child = true;
        } else if (arg === '--backend') {
            options.backend = next();
        } else if (arg === '--denoise') {
            options.denoise = Number(next());
        } else if (arg === '--model-type') {
            options.modelType = Number(next());
        } else if (arg === '--sizes') {
            options.sizes = next().split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
        } else if (arg === '--scales') {
            options.scales = next().split(',').map((value) => Number(value.trim())).filter(Boolean);
        } else if (arg === '--width') {
            options.width = Number(next());
        } else if (arg === '--height') {
            options.height = Number(next());
        } else if (arg === '--scale') {
            options.scale = Number(next());
        } else if (arg === '--json') {
            options.json = true;
        } else if (arg === '--transparent') {
            options.transparent = true;
        } else if (arg === '--help' || arg === '-h') {
            printHelp();
            process.exit(0);
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }

    return options;
}

function printHelp() {
    console.log(`Usage:
  node tests/measure-peak-memory.cjs [options]

Options:
  --backend <name>       WASM backend to load: basic, simd, or simd-threads.
  --sizes <list>         Comma-separated presets: 1080p,1440p,4k.
  --scales <list>        Comma-separated upscale factors: 2,3,4.
  --denoise <value>      Denoise model option. Default: 0.
  --model-type <value>   Model set, 0 for SE and 1 for Pro. Default: 0.
  --transparent          Use a non-opaque alpha pattern and include input alpha
                         storage in the buffer floor.
  --json                 Print raw JSON instead of a Markdown table.

Each workload runs in a separate Node process so model caches and grown WASM
heaps from one workload do not contaminate the next peak-memory sample.`);
}

function formatMiB(bytes) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

function getBufferFloor(width, height, scale) {
    const inputPixels = width * height;
    const outputPixels = inputPixels * scale * scale;
    return {
        inputRgbaBytes: inputPixels * 4,
        outputRgbaBytes: outputPixels * 4,
        avoidedBackendRgbBytes: outputPixels * 3,
        alphaBytes: inputPixels,
        avoidedInputAlphaBytes: inputPixels,
        avoidedUpscaledAlphaBytes: outputPixels
    };
}

function getTotalFloorBytes(floor, transparent) {
    return floor.inputRgbaBytes + floor.outputRgbaBytes +
        (transparent ? floor.alphaBytes : 0);
}

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

function allocateImage(Module, width, height, scale, transparent) {
    const inputSize = width * height * 4;
    const outputSize = width * height * scale * scale * 4;
    const input = Module._malloc(inputSize);
    const output = Module._malloc(outputSize);
    assert.notEqual(input, 0, 'malloc failed for input image');
    assert.notEqual(output, 0, 'malloc failed for output image');

    Module.HEAPU8.fill(127, input, input + inputSize);
    Module.HEAPU8.fill(0, output, output + outputSize);
    let pixelIndex = 0;
    for (let offset = input + 3; offset < input + inputSize; offset += 4) {
        Module.HEAPU8[offset] = transparent && pixelIndex % 17 === 0 ? 96 : 255;
        pixelIndex++;
    }

    return {input, inputSize, output, outputSize};
}

async function runChild(options) {
    const callbacks = [];
    const webRoot = path.resolve(__dirname, '..', 'web');
    const modulePath = path.join(webRoot, `realcugan-ncnn-webassembly-${options.backend}.js`);
    let peakRssBytes = 0;
    let peakWasmHeapBytes = 0;
    let Module;

    function sample() {
        peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
        if (Module && Module.HEAPU8) {
            peakWasmHeapBytes = Math.max(peakWasmHeapBytes, Module.HEAPU8.buffer.byteLength);
        }
    }

    global.navigator = {hardwareConcurrency: 4};
    process.chdir(webRoot);
    console.log = (...args) => {
        const text = args.join(' ');
        if (text.startsWith('$CALLBACK$ ')) {
            callbacks.push(JSON.parse(text.slice(11)));
            sample();
        }
    };

    Module = require(modulePath);
    const sampler = setInterval(sample, 25);
    sampler.unref();

    try {
        await waitFor(() => Module.calledRun, 10000, 'WASM initialization');
        sample();

        const image = allocateImage(Module, options.width, options.height, options.scale,
            options.transparent);
        sample();

        const startedAt = Date.now();
        const retCode = Module._process_image(1, image.input, image.inputSize, image.output,
            image.outputSize, options.width, options.height, options.scale,
            options.denoise, options.modelType);
        assert.equal(retCode, 0, `process_image returned ${retCode}`);

        const result = options.backend.includes('threads')
            ? await waitFor(() => Module._get_task_state() === 0, 60 * 60 * 1000, 'processing completion')
            : callbacks.find((event) => event.eventType === 'PROC_END' || event.eventType === 'PROC_ERROR');
        sample();

        const error = callbacks.find((event) => event.eventType === 'PROC_ERROR');
        if (error) {
            throw new Error(`backend error ${error.code}: ${error.message}`);
        }
        assert.ok(result || callbacks.find((event) => event.eventType === 'PROC_END'),
            'missing completion signal');

        Module._free(image.input);
        Module._free(image.output);
        sample();

        const floor = getBufferFloor(options.width, options.height, options.scale);
        const bufferFloorBytes = getTotalFloorBytes(floor, options.transparent);
        process.stdout.write(`${JSON.stringify({
            backend: options.backend,
            width: options.width,
            height: options.height,
            scale: options.scale,
            transparent: options.transparent,
            denoise: options.denoise,
            modelType: options.modelType,
            inputRgbaBytes: floor.inputRgbaBytes,
            outputRgbaBytes: floor.outputRgbaBytes,
            avoidedBackendRgbBytes: floor.avoidedBackendRgbBytes,
            alphaBytes: floor.alphaBytes,
            avoidedInputAlphaBytes: floor.avoidedInputAlphaBytes,
            avoidedUpscaledAlphaBytes: floor.avoidedUpscaledAlphaBytes,
            bufferFloorBytes,
            peakRssBytes,
            peakWasmHeapBytes,
            backendWorkingSetBytes: Math.max(0, peakWasmHeapBytes - bufferFloorBytes),
            elapsedMs: Date.now() - startedAt
        })}\n`);
        if (options.backend.includes('threads')) {
            process.exit(0);
        }
    } finally {
        clearInterval(sampler);
    }
}

function runParent(options) {
    const rows = [];
    for (const sizeName of options.sizes) {
        const size = SIZE_PRESETS[sizeName];
        if (!size) {
            throw new Error(`Unknown size preset: ${sizeName}`);
        }
        for (const scale of options.scales) {
            if (options.modelType === 1 && scale === 4) {
                continue;
            }

            const args = [
                __filename,
                '--child',
                '--backend', options.backend,
                '--width', String(size.width),
                '--height', String(size.height),
                '--scale', String(scale),
                '--denoise', String(options.denoise),
                '--model-type', String(options.modelType)
            ];
            if (options.transparent) {
                args.push('--transparent');
            }
            const result = spawnSync(process.execPath, args, {
                cwd: path.resolve(__dirname, '..'),
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe']
            });
            if (result.status !== 0) {
                process.stderr.write(result.stderr);
                process.stderr.write(result.stdout);
                throw new Error(`Workload failed: ${sizeName} ${scale}x`);
            }
            const row = JSON.parse(result.stdout.trim());
            row.size = sizeName;
            rows.push(row);
        }
    }

    if (options.json) {
        console.log(JSON.stringify(rows, null, 2));
        return;
    }

    console.log(`| Backend | Input | Scale | Alpha | Buffer floor | Backend working set | Avoided RGB | Avoided input alpha | Avoided upscaled alpha | Peak RSS | Peak WASM heap | Time |`);
    console.log(`| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |`);
    for (const row of rows) {
        console.log(`| ${row.backend} | ${row.width}x${row.height} (${row.size}) | ${row.scale}x | ${row.transparent ? 'transparent' : 'opaque'} | ${formatMiB(row.bufferFloorBytes)} | ${formatMiB(row.backendWorkingSetBytes)} | ${formatMiB(row.avoidedBackendRgbBytes)} | ${row.transparent ? '0.0 MiB' : formatMiB(row.avoidedInputAlphaBytes)} | ${formatMiB(row.avoidedUpscaledAlphaBytes)} | ${formatMiB(row.peakRssBytes)} | ${formatMiB(row.peakWasmHeapBytes)} | ${(row.elapsedMs / 1000).toFixed(1)}s |`);
    }
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.child) {
        await runChild(options);
    } else {
        runParent(options);
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
