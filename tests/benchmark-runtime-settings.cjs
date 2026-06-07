const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function parseArgs(argv) {
    const options = {
        backend: 'simd-threads',
        width: 64,
        height: 64,
        scale: 2,
        denoise: 0,
        modelType: 0,
        threads: [],
        tiles: [128, 160, 200],
        child: false,
        cancel: false,
        json: false
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
        } else if (arg === '--width') {
            options.width = Number(next());
        } else if (arg === '--height') {
            options.height = Number(next());
        } else if (arg === '--scale') {
            options.scale = Number(next());
        } else if (arg === '--denoise') {
            options.denoise = Number(next());
        } else if (arg === '--model-type') {
            options.modelType = Number(next());
        } else if (arg === '--threads') {
            options.threads = next().split(',').map((value) => Number(value.trim())).filter(Boolean);
        } else if (arg === '--tiles') {
            options.tiles = next().split(',').map((value) => Number(value.trim())).filter(Boolean);
        } else if (arg === '--cancel') {
            options.cancel = true;
        } else if (arg === '--json') {
            options.json = true;
        } else if (arg === '--help' || arg === '-h') {
            printHelp();
            process.exit(0);
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }

    if (options.threads.length === 0) {
        options.threads = options.backend.includes('threads') ? [4, 6, 8, 2] : [1];
    }
    return options;
}

function printHelp() {
    console.log(`Usage:
  node tests/benchmark-runtime-settings.cjs [options]

Options:
  --backend <name>       WASM backend: basic, simd, or simd-threads.
  --width <px>           Input width. Default: 64.
  --height <px>          Input height. Default: 64.
  --scale <value>        Upscale factor. Default: 2.
  --threads <list>       Comma-separated runtime thread counts.
  --tiles <list>         Comma-separated tile sizes. Default: 128,160,200.
  --cancel               Measure cancellation latency for threaded backends.
  --json                 Print raw JSON.

The default matrix covers desktop thread limits 4, 6, and 8, the mobile
thread limit 2, and all adaptive tile sizes. Use --threads 2,4 for the mobile
subset or --threads 4,6,8 for the desktop subset.`);
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

function allocateImage(Module, width, height, scale) {
    const inputSize = width * height * 4;
    const outputSize = width * height * scale * scale * 4;
    const input = Module._malloc(inputSize);
    const output = Module._malloc(outputSize);
    assert.notEqual(input, 0, 'malloc failed for input image');
    assert.notEqual(output, 0, 'malloc failed for output image');

    for (let i = 0; i < inputSize; i += 4) {
        const pixel = i / 4;
        Module.HEAPU8[input + i] = pixel % 251;
        Module.HEAPU8[input + i + 1] = (pixel * 7) % 251;
        Module.HEAPU8[input + i + 2] = (pixel * 13) % 251;
        Module.HEAPU8[input + i + 3] = 255;
    }
    Module.HEAPU8.fill(0, output, output + outputSize);
    return {input, inputSize, output, outputSize};
}

function hashOutput(Module, image) {
    return crypto.createHash('sha256')
        .update(Module.HEAPU8.subarray(image.output, image.output + image.outputSize))
        .digest('hex');
}

function ensureModelDirectory(Module, modelPath) {
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

function writeModelFile(Module, webRoot, modelPath) {
    const source = path.join(webRoot, 'models', modelPath);
    const bytes = fs.readFileSync(source);
    const dir = ensureModelDirectory(Module, modelPath);
    const name = modelPath.slice(modelPath.lastIndexOf('/') + 1);
    const fsPath = '/' + modelPath;
    try {
        Module.FS_unlink(fsPath);
    } catch (error) {
        // File is not present yet.
    }
    Module.FS_createDataFile(dir, name, bytes, true, true, true);
}

function loadModel(Module, webRoot, scale, denoise, modelType) {
    const prefix = modelType === 1 ? 'models-pro/' : '';
    let suffix;
    if (denoise === -1) {
        suffix = `up${scale}x-conservative`;
    } else if (denoise === 0) {
        suffix = `up${scale}x-no-denoise`;
    } else {
        suffix = `up${scale}x-denoise${denoise}x`;
    }
    writeModelFile(Module, webRoot, `${prefix}${suffix}.param`);
    writeModelFile(Module, webRoot, `${prefix}${suffix}.bin`);
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

    global.navigator = {hardwareConcurrency: 8};
    process.chdir(webRoot);

    Module = require(modulePath);
    Module.onBackendProgress = (totalCost, tileCost, progressRate, remainingTime) => {
        callbacks.push({
            eventType: 'PROC_PROGRESS',
            total_cost: totalCost,
            tile_cost: tileCost,
            progress_rate: progressRate,
            remaining_time: remainingTime
        });
        sample();
    };
    Module.onBackendComplete = (imageId, cost) => {
        callbacks.push({
            eventType: 'PROC_END',
            image_id: imageId,
            cost
        });
        sample();
    };
    Module.onBackendCancelled = (imageId) => {
        callbacks.push({
            eventType: 'PROC_CANCELLED',
            image_id: imageId
        });
        sample();
    };
    Module.onBackendError = (imageId, code, message) => {
        callbacks.push({
            eventType: 'PROC_ERROR',
            image_id: imageId,
            code,
            message
        });
        sample();
    };
    const sampler = setInterval(sample, 25);
    sampler.unref();

    try {
        await waitFor(() => Module.calledRun, 10000, 'WASM initialization');
        loadModel(Module, webRoot, options.scale, options.denoise, options.modelType);
        const image = allocateImage(Module, options.width, options.height, options.scale);
        sample();

        const startedAt = Date.now();
        const retCode = Module._process_image(1, image.input, image.inputSize, image.output,
            image.outputSize, options.width, options.height, options.scale, options.denoise,
            options.modelType, options.threads[0], options.tiles[0]);
        assert.equal(retCode, 0, `process_image returned ${retCode}`);

        let cancelLatencyMs = null;
        if (options.cancel && options.backend.includes('threads')) {
            await waitFor(() => Module._get_task_state() === 1, 5000, 'running task state');
            const cancelStartedAt = Date.now();
            assert.equal(Module._cancel_process(), 1);
            await waitFor(() => Module._get_task_state() === 0, 60000, 'cancel cleanup');
            cancelLatencyMs = Date.now() - cancelStartedAt;
        } else {
            const result = options.backend.includes('threads')
                ? await waitFor(() => Module._get_task_state() === 0, 60 * 60 * 1000, 'processing completion')
                : callbacks.find((event) => event.eventType === 'PROC_END' || event.eventType === 'PROC_ERROR');
            assert.ok(result || callbacks.find((event) => event.eventType === 'PROC_END'),
                'missing completion signal');
        }

        const error = callbacks.find((event) => event.eventType === 'PROC_ERROR');
        if (error) {
            throw new Error(`backend error ${error.code}: ${error.message}`);
        }

        const outputHash = cancelLatencyMs === null ? hashOutput(Module, image) : null;
        Module._free(image.input);
        Module._free(image.output);
        sample();

        process.stdout.write(`${JSON.stringify({
            backend: options.backend,
            width: options.width,
            height: options.height,
            scale: options.scale,
            threads: options.threads[0],
            tileSize: options.tiles[0],
            elapsedMs: Date.now() - startedAt,
            peakRssBytes,
            peakWasmHeapBytes,
            outputHash,
            cancelLatencyMs
        })}\n`);
        if (options.backend.includes('threads')) {
            process.exit(0);
        }
    } finally {
        clearInterval(sampler);
    }
}

function formatMiB(bytes) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

function runCase(parentOptions, threadCount, tileSize, cancel) {
    const width = cancel ? Math.max(parentOptions.width, 512) : parentOptions.width;
    const height = cancel ? Math.max(parentOptions.height, 512) : parentOptions.height;
    const args = [
        __filename,
        '--child',
        '--backend', parentOptions.backend,
        '--width', String(width),
        '--height', String(height),
        '--scale', String(parentOptions.scale),
        '--denoise', String(parentOptions.denoise),
        '--model-type', String(parentOptions.modelType),
        '--threads', String(threadCount),
        '--tiles', String(tileSize)
    ];
    if (cancel) {
        args.push('--cancel');
    }
    const result = spawnSync(process.execPath, args, {
        cwd: path.resolve(__dirname, '..'),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    });
    if (result.status !== 0) {
        process.stderr.write(result.stderr);
        process.stderr.write(result.stdout);
        throw new Error(`Runtime benchmark failed: threads=${threadCount}, tile=${tileSize}`);
    }
    const jsonLine = result.stdout.trim().split(/\r?\n/).reverse()
        .find((line) => line.trim().startsWith('{'));
    if (!jsonLine) {
        process.stderr.write(result.stdout);
        throw new Error(`Runtime benchmark did not produce JSON: threads=${threadCount}, tile=${tileSize}`);
    }
    return JSON.parse(jsonLine);
}

function runParent(options) {
    const rows = [];
    for (const threadCount of options.threads) {
        for (const tileSize of options.tiles) {
            rows.push(runCase(options, threadCount, tileSize, false));
        }
    }

    if (options.cancel) {
        for (const threadCount of options.threads) {
            for (const tileSize of options.tiles) {
                rows.push(runCase(options, threadCount, tileSize, true));
            }
        }
    }

    if (options.json) {
        console.log(JSON.stringify(rows, null, 2));
        return;
    }

    console.log(`| Backend | Input | Scale | Threads | Tile | Time | Peak RSS | Peak WASM heap | Output hash | Cancel latency |`);
    console.log(`| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |`);
    for (const row of rows) {
        console.log(`| ${row.backend} | ${row.width}x${row.height} | ${row.scale}x | ${row.threads} | ${row.tileSize} | ${(row.elapsedMs / 1000).toFixed(2)}s | ${formatMiB(row.peakRssBytes)} | ${formatMiB(row.peakWasmHeapBytes)} | ${row.outputHash ? row.outputHash.slice(0, 12) : '-'} | ${row.cancelLatencyMs === null ? '-' : `${row.cancelLatencyMs} ms`} |`);
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
