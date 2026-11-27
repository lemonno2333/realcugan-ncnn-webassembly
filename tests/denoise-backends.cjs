// Real-model checks for both GPT recipes, all backend modes and isolation fallback.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '../web');
const mime = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png'};

function serve(isolated) {
    return http.createServer((req, res) => {
        const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
        const file = path.resolve(root, '.' + pathname);
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
            res.writeHead(404); res.end(); return;
        }
        res.writeHead(200, {'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
            ...(isolated ? {'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp'} : {})});
        fs.createReadStream(file).pipe(res);
    });
}

async function pipeline(page, method, mode, width = 41, height = 29, lambda = 0.001) {
    return page.evaluate(async ({method, mode, width, height, lambda}) => {
        const app = document.querySelector('.design-root').__vue__;
        const [simd, threads] = await Promise.all([wasmFeatureDetect.simd(), wasmFeatureDetect.threads()]);
        app.backendMode = mode;
        const backends = app.getBackendCandidates(simd, app.canUseThreadedBackend(simd, threads));
        const source = new Uint8Array(width * height * 4);
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++)
            source.set([x * 9 % 256, y * 11 % 256, (x + y) * 5 % 256, (x + y) % 251], (y * width + x) * 4);
        const expected = source.slice();
        const worker = new Worker(app.versionedUrl('gptDenoiseWorker.js'));
        let backend, progress = [];
        try {
            const result = await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(Error('pipeline timeout')), width * height > 400000 ? 1800000 : 120000);
                worker.onmessage = ({data}) => {
                    if (data.type === 'backend') backend = data;
                    if (data.type === 'progress') progress.push(data);
                    if (data.type === 'complete') {clearTimeout(timer); resolve(data);}
                    if (data.type === 'error') {clearTimeout(timer); reject(Error(data.message));}
                };
                worker.onerror = e => {clearTimeout(timer); reject(Error(e.message));};
                worker.postMessage({type: 'start', id: 1, width, height, options: {method, down: 0.6, lambda},
                    runtime: {backends, threads: 4}, buffer: source.buffer}, [source.buffer]);
            });
            const output = new Uint8Array(result.buffer);
            let alphaErrors = 0, changed = 0;
            for (let i = 0; i < output.length; i++) {
                if (i % 4 === 3) alphaErrors += output[i] !== expected[i];
                else changed += output[i] !== expected[i];
            }
            return {backend, seconds: result.seconds, width: result.width, height: result.height,
                alphaErrors, changed, pixels: Array.from(output), stages: [...new Set(progress.map(p => p.stage))]};
        } finally {worker.terminate();}
    }, {method, mode, width, height, lambda});
}

async function main() {
    fs.mkdirSync(path.resolve(__dirname, '../output/playwright'), {recursive: true});
    const servers = [serve(false), serve(true)], contexts = [], report = [];
    let browser;
    try {
        for (const server of servers) await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        browser = await chromium.launch({headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? {channel: process.env.PLAYWRIGHT_CHANNEL} : {})});
        const cdp = await browser.newBrowserCDPSession();
        const targets = new Map(), seenThreadWorkers = new Set();
        const trackTarget = ({targetInfo}) => {
            targets.set(targetInfo.targetId, targetInfo);
            if (targetInfo.type === 'worker' && targetInfo.url.includes('gpt-denoise-simd-threads')) seenThreadWorkers.add(targetInfo.targetId);
        };
        cdp.on('Target.targetCreated', trackTarget);
        cdp.on('Target.targetInfoChanged', trackTarget);
        cdp.on('Target.targetDestroyed', ({targetId}) => targets.delete(targetId));
        await cdp.send('Target.setDiscoverTargets', {discover: true});
        const errors = [];
        for (const [index, server] of servers.entries()) {
            const isolated = index === 1, base = `http://127.0.0.1:${server.address().port}`;
            const context = await browser.newContext({viewport: {width: 1440, height: 1000}, serviceWorkers: 'block'});
            contexts.push(context);
            await context.addInitScript(() => {localStorage.setItem('rc:language', 'zh'); localStorage.setItem('rc:themeMode', 'light');});
            const page = await context.newPage();
            page.on('pageerror', error => errors.push(error.message));
            await page.goto(base + '/gpt-denoise.html');
            await page.waitForFunction(() => document.querySelector('.design-root')?.__vue__);
            assert.equal(await page.evaluate(() => crossOriginIsolated), isolated);
            assert.equal(await page.locator('.gpt-method .el-radio-button').count(), 3);
            assert.equal(await page.locator('.backend-mode .el-radio-button').count(), 4);
            for (const method of ['cugan', 'esrgan']) {
                let reference, rawReference;
                for (const mode of ['basic', 'simd', 'simd-threads', 'auto']) {
                    const raw = await pipeline(page, method, mode, 41, 29, 0);
                    const result = await pipeline(page, method, mode);
                    const expectedBackend = mode === 'basic' ? 'basic' : isolated && ['auto', 'simd-threads'].includes(mode) ? 'simd-threads' : 'simd';
                    assert.equal(result.backend.backend, expectedBackend);
                    assert.equal(result.backend.sharedMemory, expectedBackend === 'simd-threads');
                    assert.ok(expectedBackend === 'simd-threads' ? result.backend.threads >= 2 : result.backend.threads === 1);
                    assert.equal(result.width, 41); assert.equal(result.height, 29);
                    assert.equal(result.alphaErrors, 0); assert.ok(result.changed > 0);
                    assert.ok(result.stages.includes(method) && result.stages.includes('l0'));
                    if (!reference) reference = result.pixels;
                    if (!rawReference) rawReference = raw.pixels;
                    let maxDifference = 0, rawDifference = 0;
                    result.pixels.forEach((v, i) => {
                        const difference = Math.abs(v - reference[i]);
                        maxDifference = Math.max(maxDifference, difference);
                        rawDifference = Math.max(rawDifference, Math.abs(raw.pixels[i] - rawReference[i]));
                    });
                    assert.ok(maxDifference <= 2, method + ' / ' + mode + ' full backend parity: ' + maxDifference);
                    assert.ok(rawDifference <= 2, method + ' / ' + mode + ' raw backend parity: ' + rawDifference);
                    report.push({isolated, method, mode, backend: expectedBackend, threads: result.backend.threads, seconds: result.seconds, maxDifference, rawDifference});
                }
            }
            if (!isolated) {
                // A fresh CUGAN UI run downloads only the selected model and obeys manual mode changes.
                const requests = [];
                page.on('request', r => requests.push(r.url()));
                const png = await page.evaluate(() => {
                    const c = document.createElement('canvas'); c.width = 8; c.height = 8;
                    const ctx = c.getContext('2d'), data = ctx.createImageData(8, 8);
                    for (let i = 0; i < data.data.length; i += 4) data.data.set([i % 256, 97, 160, i % 3 ? 255 : 128], i);
                    ctx.putImageData(data, 0, 0); return c.toDataURL('image/png').split(',')[1];
                });
                await page.locator('.gpt-method .el-radio-button').filter({hasText: 'CUGAN + L0'}).click();
                await page.locator('.backend-mode .el-radio-button').filter({hasText: '兼容'}).click();
                await page.locator('input[type=file]').setInputFiles({name: 'tiny.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64')});
                await page.locator('.btn-run').click();
                await page.waitForFunction(() => document.querySelector('.design-root').__vue__.isProcessDone, null, {timeout: 60000});
                assert.ok((await page.locator('.app-footer').innerText()).includes('GPT / basic'));
                assert.ok(requests.some(url => url.includes('models/up2x-denoise3x.bin')));
                assert.ok(!requests.some(url => url.includes('models/esrgan/')));
                await page.locator('.backend-mode .el-radio-button').filter({hasText: 'SIMD', exact: true}).click();
                assert.equal(await page.evaluate(() => document.querySelector('.design-root').__vue__.gptWorker), null);
                await page.getByRole('button', {name: '复位', exact: true}).click();
                await page.locator('input[type=file]').setInputFiles({name: 'simd.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64')});
                await page.locator('.btn-run').click();
                await page.waitForFunction(() => document.querySelector('.design-root').__vue__.isProcessDone, null, {timeout: 60000});
                assert.ok((await page.locator('.app-footer').innerText()).includes('GPT / simd'));
                await page.waitForFunction(() => !document.querySelector('.design-root').__vue__.isResultRevealing);
                await page.screenshot({path: path.resolve(__dirname, '../output/playwright/gpt-cugan-backends.png')});
                // Switching recipes reuses the runtime but lazily loads the other model.
                await page.locator('.gpt-method .el-radio-button').filter({hasText: 'ESRGAN + L0'}).click();
                await page.getByRole('button', {name: '复位', exact: true}).click();
                await page.locator('input[type=file]').setInputFiles({name: 'esrgan.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64')});
                await page.locator('.btn-run').click();
                await page.waitForFunction(() => document.querySelector('.design-root').__vue__.isProcessDone, null, {timeout: 60000});
                assert.ok(requests.some(url => url.includes('models/esrgan/realesrgan-x4plus-anime.bin')));
            } else {
                assert.ok(seenThreadWorkers.size >= 4, 'real pthread child Workers must be created');
                await page.route('**/gpt-denoise-simd-threads.wasm*', route => route.fulfill({status: 404, body: 'not found'}));
                const fallback = await pipeline(page, 'cugan', 'simd-threads');
                assert.equal(fallback.backend.backend, 'simd');
                await page.unroute('**/gpt-denoise-simd-threads.wasm*');
                report.push({isolated, test: 'threaded WASM load failure', fallback: fallback.backend.backend});
                // Reflection padding must work even when the resized tile is 1 pixel wide/high.
                for (const [width, height] of [[1, 1], [3, 37], [37, 3]]) {
                    const basic = await pipeline(page, 'cugan', 'basic', width, height, 0);
                    const threaded = await pipeline(page, 'cugan', 'simd-threads', width, height, 0);
                    assert.equal(threaded.width, width); assert.equal(threaded.height, height);
                    assert.equal(threaded.alphaErrors, 0);
                    let maxDifference = 0;
                    basic.pixels.forEach((v, i) => {maxDifference = Math.max(maxDifference, Math.abs(v - threaded.pixels[i]));});
                    assert.ok(maxDifference <= 2, 'tiny CUGAN parity ' + width + 'x' + height + ': ' + maxDifference);
                    report.push({isolated, test: 'CUGAN tiny reflection', width, height, maxDifference});
                }
                // Exercise multi-tile CUGAN padding and odd edge tiles with shared memory.
                const tiled = await pipeline(page, 'cugan', 'simd-threads', 437, 299);
                assert.equal(tiled.alphaErrors, 0); assert.equal(tiled.width, 437); assert.equal(tiled.height, 299);
                report.push({isolated, test: 'CUGAN multi-tile', seconds: tiled.seconds});
                if (process.env.DENOISE_LARGE === '1') {
                    const large = await pipeline(page, 'cugan', 'simd-threads', 1672, 941);
                    assert.equal(large.width, 1672); assert.equal(large.height, 941);
                    assert.equal(large.alphaErrors, 0); assert.ok(large.changed > 0);
                    report.push({isolated, test: 'CUGAN 1672x941', seconds: large.seconds});
                }
            }
        }
        assert.deepEqual(errors, []);
        fs.mkdirSync(path.resolve(__dirname, '../output/playwright'), {recursive: true});
        fs.writeFileSync(path.resolve(__dirname, '../output/playwright/gpt-backend-validation.json'), JSON.stringify({report, pthreadWorkers: seenThreadWorkers.size}, null, 2));
        console.log('GPT backend checks passed:', JSON.stringify({runs: report.length, pthreadWorkers: seenThreadWorkers.size, report}));
    } finally {
        for (const context of contexts) await context.close();
        if (browser) await browser.close();
        for (const server of servers) await new Promise(resolve => server.close(resolve));
    }
}
main().catch(error => {console.error(error); process.exitCode = 1;});
