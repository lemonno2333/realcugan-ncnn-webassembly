'use strict';
const version = new URL(self.location.href).searchParams.get('v') || 'dev';
const localUrl = path => new URL(path + '?v=' + encodeURIComponent(version), self.location.href).href;
importScripts(localUrl('gptDenoiseCore.js'), localUrl('gptDenoiseModels.js'));
const {resizeRGB, l0Smooth, checkImage, validateOptions, roundEven} = GPTDenoiseCore;
let runtimeBackend;
let runtimePromise, busy = false, currentJob, currentStage, currentTile;
const report = (stage, value) => {
    currentStage = stage;
    self.postMessage({type: 'progress', id: currentJob, stage, progress: Math.round(value)});
};

async function readModel(file, completed, total) {
    const response = await fetch(localUrl('models/esrgan/' + file.name), {credentials: 'same-origin'});
    if (!response.ok) throw new Error('模型下载失败：' + file.name + '（HTTP ' + response.status + '）。请检查静态部署文件。');
    const bytes = new Uint8Array(file.bytes);
    let offset = 0;
    if (response.body) {
        const reader = response.body.getReader();
        for (;;) {
            const {done, value} = await reader.read();
            if (done) break;
            if (offset + value.length > bytes.length) { await reader.cancel(); throw new Error('模型文件大小不符。'); }
            bytes.set(value, offset); offset += value.length;
            report('model', 3 + 12 * (completed + offset) / total);
        }
    } else {
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength !== file.bytes) throw new Error('模型文件大小不符。');
        bytes.set(new Uint8Array(buffer)); offset = bytes.length;
    }
    if (offset !== file.bytes) throw new Error('模型文件不完整：' + file.name);
    if (!self.crypto || !self.crypto.subtle) throw new Error('模型校验需要 HTTPS 或 localhost 环境。');
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hash = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
    if (hash !== file.sha256) throw new Error('模型校验失败：' + file.name + '。请清除缓存或重新部署。');
    return bytes;
}

function loadRuntime() {
    if (!runtimePromise) runtimePromise = (async () => {
        report('runtime', 1);
        const supportsSIMD = WebAssembly.validate(new Uint8Array([
            0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,10,1,8,0,65,0,253,15,253,98,11
        ]));
        let module;
        // No pthread module: fallback works without SharedArrayBuffer / COOP / COEP.
        const candidates = supportsSIMD ? ['simd', 'basic'] : ['basic'];
        for (const backend of candidates) {
            try {
                importScripts(localUrl('gpt-denoise-' + backend + '.js'));
                module = await createDenoiseModule({
                    locateFile: name => localUrl(name),
                    printErr: message => console.warn('[GPT denoise]', message)
                });
                runtimeBackend = backend;
                break;
            } catch (error) {
                if (backend === 'basic') throw new Error('WASM 加载失败，请确认 gpt-denoise-basic.js / .wasm 已部署。' + error.message);
            }
        }
        const total = GPTDenoiseModels.files.reduce((sum, file) => sum + file.bytes, 0);
        let completed = 0;
        module.FS.mkdir('/esrgan');
        for (const file of GPTDenoiseModels.files) {
            const bytes = await readModel(file, completed, total);
            module.FS.writeFile('/esrgan/' + file.name, bytes); completed += bytes.length;
        }
        const pointers = [];
        try {
            for (const file of GPTDenoiseModels.files) {
                const bytes = new TextEncoder().encode('/esrgan/' + file.name + '\0');
                const ptr = module._malloc(bytes.length);
                if (!ptr) throw new Error('WASM 内存不足。');
                pointers.push(ptr); module.HEAPU8.set(bytes, ptr);
            }
            if (module._denoise_load_model(...pointers)) throw new Error('Real-ESRGAN 模型加载失败。');
        } finally {
            pointers.forEach(ptr => module._free(ptr));
            for (const file of GPTDenoiseModels.files) module.FS.unlink('/esrgan/' + file.name);
        }
        return module;
    })().catch(error => { runtimePromise = null; throw error; });
    return runtimePromise;
}

async function upscale(source, w, h) {
    const module = await loadRuntime(), tileSize = 96, halo = 96;
    const output = new Uint8Array(w * h * 16 * 4), outWidth = w * 4;
    const total = Math.ceil(w / tileSize) * Math.ceil(h / tileSize);
    let done = 0;
    currentStage = 'esrgan';
    for (let y = 0; y < h; y += tileSize) for (let x = 0; x < w; x += tileSize) {
        const cw = Math.min(tileSize, w - x), ch = Math.min(tileSize, h - y);
        const left = Math.max(0, x - halo), top = Math.max(0, y - halo);
        const right = Math.min(w, x + cw + halo), bottom = Math.min(h, y + ch + halo);
        const tw = right - left, th = bottom - top;
        currentTile = {x, y, width: tw, height: th, coreWidth: cw, coreHeight: ch};
        const inputPtr = module._malloc(tw * th * 4), outputPtr = module._malloc(cw * ch * 16 * 4);
        try {
            if (!inputPtr || !outputPtr) throw new Error('WASM 内存不足，请缩小输入图片。');
            for (let row = 0; row < th; row++) {
                module.HEAPU8.set(source.subarray(((top + row) * w + left) * 4,
                    ((top + row) * w + right) * 4), inputPtr + row * tw * 4);
            }
            const code = module._denoise_tile(inputPtr, tw, th, x - left, y - top, cw, ch, outputPtr);
            if (code) throw new Error(code === -7 ? 'Real-ESRGAN 分配临时内存失败。' : 'Real-ESRGAN 推理失败（' + code + '）。');
            // memory growth may replace HEAPU8: obtain the view AFTER inference.
            for (let row = 0; row < ch * 4; row++) {
                output.set(module.HEAPU8.subarray(outputPtr + row * cw * 16,
                    outputPtr + (row + 1) * cw * 16), ((y * 4 + row) * outWidth + x * 4) * 4);
            }
        } finally {
            if (inputPtr) module._free(inputPtr);
            if (outputPtr) module._free(outputPtr);
        }
        report('esrgan', 15 + 50 * ++done / total);
    }
    currentTile = null;
    return output;
}

self.onmessage = async ({data}) => {
    if (!data || data.type !== 'start' || busy) return;
    busy = true; currentJob = data.id; currentStage = 'validate'; currentTile = null;
    const begin = performance.now();
    try {
        const source = new Uint8Array(data.buffer), {width: w, height: h} = data;
        checkImage(source, w, h);
        const {method, down, lambda} = validateOptions(data.options);
        let result;
        if (method === 'esrgan') {
            report('resize', 0);
            const sw = Math.max(1, roundEven(w * down)), sh = Math.max(1, roundEven(h * down));
            // Scope the large SR buffers so they can be collected before L0.
            const small = resizeRGB(source, w, h, sw, sh, 'box');
            const enlarged = await upscale(small, sw, sh);
            self.postMessage({type: 'backend', id: currentJob, backend: runtimeBackend});
            report('resizeBack', 67);
            result = resizeRGB(enlarged, sw * 4, sh * 4, w, h, 'lanczos');
        } else result = source;
        if (lambda) result = l0Smooth(result, w, h, lambda, ratio => report('l0', 70 + 29 * ratio));
        for (let i = 3; i < result.length; i += 4) result[i] = source[i];
        self.postMessage({type: 'complete', id: currentJob, buffer: result.buffer,
            width: w, height: h, seconds: (performance.now() - begin) / 1000}, [result.buffer]);
    } catch (error) {
        const detail = {stage: currentStage, tile: currentTile, stack: error.stack};
        console.error('[GPT denoise]', detail, error);
        const message = error instanceof WebAssembly.RuntimeError && /out of bounds/.test(error.message)
            ? 'Real-ESRGAN 的 WASM 内存访问异常。请刷新以加载最新版本；若仍失败，请提供图片尺寸和下方分块位置。'
            : error.message || String(error);
        const position = currentTile ? '（分块 ' + currentTile.x + ', ' + currentTile.y + '；邻域 ' + currentTile.width + ' × ' + currentTile.height + '）' : '';
        self.postMessage({type: 'error', id: currentJob, message: message + position, ...detail});
    } finally { busy = false; }
};
