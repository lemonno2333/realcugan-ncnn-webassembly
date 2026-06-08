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
        references.add(value.split('?')[0]);
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
        'realcugan-ncnn-webassembly-simd-threads.wasm',
        'realcugan-ncnn-webassembly-simd-threads.worker.js'
    ].forEach((relativePath) => addAsset(report, webRoot, relativePath));

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
