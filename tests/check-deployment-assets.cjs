const fs = require('node:fs');
const path = require('node:path');

function parseArgs(argv) {
    const options = {
        webRoot: path.resolve(__dirname, '..', 'web'),
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

        if (arg === '--web-root') {
            options.webRoot = path.resolve(next());
        } else if (arg === '--json') {
            options.json = true;
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
  node tests/check-deployment-assets.cjs [options]

Options:
  --web-root <dir>   Directory containing the deployable static files. Default: web.
  --json             Print a JSON report.
  --help, -h         Show this help.`);
}

function readText(filePath) {
    return fs.readFileSync(filePath, 'utf8');
}

function stripHtmlComments(html) {
    return html.replace(/<!--[\s\S]*?-->/g, '');
}

function extractModelManifest(webRoot) {
    const manifestPath = path.join(webRoot, 'modelManifest.js');
    if (!fs.existsSync(manifestPath)) {
        throw new Error('Could not find web/modelManifest.js');
    }
    const source = readText(manifestPath);
    const match = source.match(/window\.MODEL_FILES\s*=\s*([\s\S]*?);\s*$/);
    if (!match) {
        throw new Error('Could not find MODEL_FILES in web/modelManifest.js');
    }
    return Function(`"use strict"; return (${match[1]});`)();
}

function collectStaticReferences(html) {
    const references = new Set();
    const cleaned = stripHtmlComments(html);
    const attrPattern = /(?:^|[\s<])(?:src|href)=["']([^"']+)["']/g;
    let match;
    while ((match = attrPattern.exec(cleaned)) !== null) {
        const value = match[1];
        if (/^(?:https?:|data:|#|mailto:)/i.test(value)) {
            continue;
        }
        const asset = value.split('?')[0];
        references.add(asset.endsWith('/') ? asset + 'index.html' : asset);
    }
    return references;
}

function addAsset(report, webRoot, relativePath, options = {}) {
    const assetPath = path.join(webRoot, relativePath);
    const item = {
        path: relativePath,
        required: options.required !== false,
        expectedBytes: options.expectedBytes || null,
        exists: false,
        bytes: null,
        ok: false,
        error: ''
    };

    try {
        const stat = fs.statSync(assetPath);
        item.exists = stat.isFile();
        item.bytes = stat.size;
        if (!item.exists) {
            item.error = 'not a file';
        } else if (item.expectedBytes !== null && item.bytes !== item.expectedBytes) {
            item.error = `size mismatch: expected=${item.expectedBytes} actual=${item.bytes}`;
        } else {
            item.ok = true;
        }
    } catch (error) {
        item.error = 'missing';
    }

    report.assets.push(item);
    if (!item.ok && item.required) {
        report.ok = false;
        report.errors.push(`${item.path}: ${item.error}`);
    }
    return item;
}

function collectModelAssets(modelFiles) {
    const assets = new Map();
    Object.values(modelFiles).forEach((modelSet) => {
        Object.values(modelSet).forEach((denoiseSet) => {
            Object.values(denoiseSet).forEach((files) => {
                assets.set(files.param, files.paramBytes);
                assets.set(files.bin, files.binBytes);
            });
        });
    });
    return assets;
}

function buildReport(webRoot) {
    const report = {
        ok: true,
        webRoot,
        assets: [],
        errors: [],
        summary: {
            checked: 0,
            missing: 0,
            mismatched: 0
        }
    };

    const indexPath = path.join(webRoot, 'index.html');
    if (!fs.existsSync(indexPath)) {
        report.ok = false;
        report.errors.push('index.html: missing');
        return report;
    }

    const html = readText(indexPath);
    const manifest = extractModelManifest(webRoot);
    const uiVersion = readText(path.join(webRoot, 'app.js')).match(/const APP_VERSION = '([^']+)'/)[1];
    for (const entry of ['index.html', 'gpt-denoise.html', 'en/index.html', 'ja/index.html']) {
        const file = path.join(webRoot, entry);
        if (!fs.existsSync(file)) continue;
        const source = readText(file);
        for (const asset of ['app.js', 'appTemplate.js', 'app.css', 'gptDenoise.js']) {
            if (!source.includes(asset + '?v=' + uiVersion + '"')) {
                report.ok = false;
                report.errors.push(entry + ': stale or missing shared UI asset ' + asset);
            }
        }
    }

    addAsset(report, webRoot, 'index.html');
    collectStaticReferences(html).forEach((relativePath) => {
        addAsset(report, webRoot, relativePath);
    });

    [
        'wasmFallbackWorker.js',
        'realcugan-ncnn-webassembly-basic.js',
        'realcugan-ncnn-webassembly-basic.wasm',
        'realcugan-ncnn-webassembly-simd.js',
        'realcugan-ncnn-webassembly-simd.wasm',
        'realcugan-ncnn-webassembly-simd-threads.js',
        'realcugan-ncnn-webassembly-simd-threads.wasm'
    ].forEach((relativePath) => addAsset(report, webRoot, relativePath));

    // Older Emscripten emits a separate worker; newer versions use the main JS
    // as their pthread Worker. Require the extra file only if it is referenced.
    const threadedPath = path.join(webRoot, 'realcugan-ncnn-webassembly-simd-threads.js');
    if (fs.existsSync(threadedPath) && readText(threadedPath).includes('.worker.js')) {
        addAsset(report, webRoot, 'realcugan-ncnn-webassembly-simd-threads.worker.js');
    }

    ['gpt-denoise.html', 'en/index.html', 'ja/index.html', 'appTemplate.js', 'app.js', 'THIRD_PARTY_NOTICES.md'].forEach(relativePath => addAsset(report, webRoot, relativePath));
    const denoiseHtml = path.join(webRoot, 'gpt-denoise.html');
    if (fs.existsSync(denoiseHtml)) {
        collectStaticReferences(readText(denoiseHtml)).forEach(relativePath => addAsset(report, webRoot, relativePath));
    }
    ['gptDenoiseWorker.js', 'gpt-denoise-basic.js', 'gpt-denoise-basic.wasm',
        'gpt-denoise-simd.js', 'gpt-denoise-simd.wasm',
        'gpt-denoise-simd-threads.js', 'gpt-denoise-simd-threads.wasm'].forEach(relativePath => addAsset(report, webRoot, relativePath));
    const gptThreaded = path.join(webRoot, 'gpt-denoise-simd-threads.js');
    if (fs.existsSync(gptThreaded) && readText(gptThreaded).includes('.worker.js')) {
        addAsset(report, webRoot, 'gpt-denoise-simd-threads.worker.js');
    }
    const denoiseModels = require('../web/gptDenoiseModels.js');
    [...denoiseModels.files.map(file => ({...file, folder: 'esrgan'})),
        ...denoiseModels.cuganFiles.map(file => ({...file, folder: ''}))].forEach(file => {
        const relativePath = path.join('models', file.folder, file.name);
        addAsset(report, webRoot, relativePath, {expectedBytes: file.bytes});
        const filePath = path.join(webRoot, relativePath);
        if (fs.existsSync(filePath) && require('node:crypto').createHash('sha256')
            .update(fs.readFileSync(filePath)).digest('hex') !== file.sha256) {
            report.ok = false;
            report.errors.push(relativePath + ': SHA-256 mismatch');
        }
    });
    addAsset(report, webRoot, 'models/esrgan/LICENSE');

    collectModelAssets(manifest).forEach((expectedBytes, modelPath) => {
        addAsset(report, webRoot, path.join('models', modelPath), {expectedBytes});
    });

    report.summary.checked = report.assets.length;
    report.summary.missing = report.assets.filter((asset) => !asset.exists).length;
    report.summary.mismatched = report.assets.filter((asset) => asset.exists && asset.expectedBytes !== null && asset.bytes !== asset.expectedBytes).length;
    return report;
}

function printReport(report) {
    if (report.ok) {
        console.log(`Deployment asset check passed: ${report.summary.checked} files checked.`);
        return;
    }

    console.error(`Deployment asset check failed: ${report.errors.length} issue(s).`);
    report.errors.forEach((error) => {
        console.error(`- ${error}`);
    });
}

function main() {
    try {
        const options = parseArgs(process.argv.slice(2));
        const report = buildReport(options.webRoot);
        if (options.json) {
            console.log(JSON.stringify(report, null, 2));
        } else {
            printReport(report);
        }
        process.exit(report.ok ? 0 : 1);
    } catch (error) {
        console.error(error && error.stack ? error.stack : error);
        process.exit(1);
    }
}

main();
