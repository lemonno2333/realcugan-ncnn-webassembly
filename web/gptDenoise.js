// GPT backend adapter. All UI, preview, state transitions and motion live in app.js/appTemplate.js.
window.GPTDenoise = {
    copy: {
        zh: {
            'app.heading': 'GPT 图片去噪', 'app.title': 'GPT 图片去噪 · Real-CUGAN', 'app.brandSuffix': 'GPT 去噪',
            'app.description': 'Real-ESRGAN + L0 在浏览器本地处理 GPT 动漫图片，保留原尺寸与透明度，不上传图片。',
            'gpt.method': '处理方法', 'gpt.l0Only': '仅 L0', 'gpt.down': '预缩图比例',
            'gpt.strength': 'L0 强度 λ', 'gpt.recipe': '处理流程', 'gpt.originalSize': '原尺寸',
            'gpt.l0Recipe': '原尺寸 → L0 · 不加载模型', 'gpt.licenses': '许可与致谢',
            'gpt.fileError': '请选择不超过 40 MB 的图片。', 'gpt.sizeError': '图片最大 400 万像素，单边不超过 4096。',
            'help.scaleTitle': '预缩图：', 'help.scaleText': 'ESRGAN 前先缩小图片，4× 重建后恢复原尺寸，不改变输出尺寸。',
            'help.denoiseTitle': 'L0 强度：', 'help.denoiseText': '用于平滑鱼鳞状纹理与碎片阴影；数值越大平滑越强，可能减少细节。',
            'stage.start': '开始去噪', 'preview.after': '去噪', 'progress.cancelling': '正在取消处理…',
            'gpt.resize': '预缩图', 'gpt.runtime': '加载 WASM 后端', 'gpt.model': '下载并校验模型',
            'gpt.esrgan': 'Real-ESRGAN 重建', 'gpt.resizeBack': '恢复原尺寸', 'gpt.l0': 'L0 平滑',
        },
        en: {
            'app.heading': 'GPT Image Denoise', 'app.title': 'GPT Image Denoise · Real-CUGAN', 'app.brandSuffix': 'GPT DENOISE',
            'app.description': 'Denoise GPT anime images locally with Real-ESRGAN and L0. Original size and alpha retained; no uploads.',
            'gpt.method': 'Method', 'gpt.l0Only': 'L0 only', 'gpt.down': 'Pre-resize',
            'gpt.strength': 'L0 strength λ', 'gpt.recipe': 'Pipeline', 'gpt.originalSize': 'Original size',
            'gpt.l0Recipe': 'Original size → L0 · No model download', 'gpt.licenses': 'Licenses',
            'gpt.fileError': 'Select an image up to 40 MB.', 'gpt.sizeError': 'Maximum 4 million pixels and 4096 pixels per side.',
            'help.scaleTitle': 'Pre-resize: ', 'help.scaleText': 'Resize before ESRGAN, rebuild at 4×, then restore the original dimensions.',
            'help.denoiseTitle': 'L0 strength: ', 'help.denoiseText': 'Smooths fish-scale textures and fragmented shadows. Higher values may reduce detail.',
            'stage.start': 'Start denoising', 'preview.after': 'Denoised', 'progress.cancelling': 'Cancelling…',
            'gpt.resize': 'Pre-resizing', 'gpt.runtime': 'Loading WASM', 'gpt.model': 'Downloading and verifying model',
            'gpt.esrgan': 'Real-ESRGAN reconstruction', 'gpt.resizeBack': 'Restoring original size', 'gpt.l0': 'L0 smoothing',
        },
        ja: {
            'app.heading': 'GPT 画像ノイズ除去', 'app.title': 'GPT 画像ノイズ除去 · Real-CUGAN', 'app.brandSuffix': 'GPT ノイズ除去',
            'app.description': 'Real-ESRGAN と L0 で GPT アニメ画像をブラウザー内で処理。元のサイズと透明度を保持し、アップロードしません。',
            'gpt.method': '処理方法', 'gpt.l0Only': 'L0 のみ', 'gpt.down': '事前縮小率',
            'gpt.strength': 'L0 強度 λ', 'gpt.recipe': '処理フロー', 'gpt.originalSize': '元のサイズ',
            'gpt.l0Recipe': '元のサイズ → L0 · モデル不要', 'gpt.licenses': 'ライセンス',
            'gpt.fileError': '40 MB 以下の画像を選択してください。', 'gpt.sizeError': '最大 400 万画素、各辺 4096 ピクセルまでです。',
            'help.scaleTitle': '事前縮小：', 'help.scaleText': 'ESRGAN 前に縮小し、4× 再構成後に元のサイズへ戻します。',
            'help.denoiseTitle': 'L0 強度：', 'help.denoiseText': '鱗状のテクスチャや断片的な陰影を平滑化。高い値は細部を減らす場合があります。',
            'stage.start': 'ノイズ除去開始', 'preview.after': '処理後', 'progress.cancelling': 'キャンセル中…',
            'gpt.resize': '事前縮小', 'gpt.runtime': 'WASM 読み込み', 'gpt.model': 'モデル取得・検証',
            'gpt.esrgan': 'Real-ESRGAN 再構成', 'gpt.resizeBack': '元のサイズに復元', 'gpt.l0': 'L0 平滑化',
        },
    },
    validate(app, width, height) {
        if (width > 4096 || height > 4096 || width * height > 4000000) throw new Error(app.t('gpt.sizeError'));
        return GPTDenoiseCore.validateOptions({method: app.gptMethod, down: app.gptDown / 100, lambda: app.gptLambda});
    },
    run(app, canvas, width, height, id) {
        const options = this.validate(app, width, height);
        const input = canvas.getContext('2d', {willReadFrequently: true}).getImageData(0, 0, width, height);
        if (!app.gptWorker) app.gptWorker = new Worker(app.versionedUrl('gptDenoiseWorker.js'));
        const worker = app.gptWorker;
        const current = () => app.gptWorker === worker && app.activeImageId === id && app.isProcessing;
        const fail = error => {
            if (!current()) return;
            worker.terminate(); app.gptWorker = null;
            app.handleProcessFailure(error);
        };
        worker.onerror = event => { event.preventDefault(); fail(new Error(event.message || 'GPT Worker failed')); };
        worker.onmessage = ({data}) => {
            if (!current() || data.id !== id) return;
            if (data.type === 'backend') {
                app.wasmBackend = 'GPT / ' + data.backend;
            } else if (data.type === 'progress') {
                // Use the shared progress/watchdog path so every stage animates identically.
                app.onProcessProgressChange(0, 0, data.progress / 100, 0);
                app.progressTip = app.t('gpt.' + data.stage) + ' · ' + data.progress + '%';
                if (options.method === 'l0') app.wasmBackend = 'GPT / L0 (JS)';
            } else if (data.type === 'complete') {
                app.onProcessEnd(data.seconds * 1000, data.buffer, data.width, data.height);
            } else if (data.type === 'error') {
                const tile = data.tile ? '\nTile: ' + JSON.stringify(data.tile) : '';
                fail(new Error(data.message + '\nStage: ' + (data.stage || 'unknown') + tile + (data.stack ? '\n' + data.stack : '')));
            }
        };
        worker.postMessage({type: 'start', id, width, height, buffer: input.data.buffer, options}, [input.data.buffer]);
    },
    cancel(app) {
        if (app.gptWorker) app.gptWorker.terminate();
        app.gptWorker = null;
        app.activeImageId += 1;
        if (app.isProcessing) app.onProcessCancelled();
    },
};
