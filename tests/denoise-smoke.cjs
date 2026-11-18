// Browser check against real local models and WASM, served without COOP/COEP.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '../web');
const mime = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png'};
const server = http.createServer((req, res) => {
    const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.resolve(root, '.' + name);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404); res.end('Not found'); return;
    }
    res.writeHead(200, {'Content-Type': mime[path.extname(file)] || 'application/octet-stream'});
    fs.createReadStream(file).pipe(res);
});

async function main() {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    let browser;
    try {
        browser = await chromium.launch({headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? {channel: process.env.PLAYWRIGHT_CHANNEL} : {})});
        const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
        await page.addInitScript(() => {localStorage.setItem('rc:language', 'zh');if (!localStorage.getItem('rc:themeMode')) localStorage.setItem('rc:themeMode', 'light');});
        const upload = async (name = 'test.png') => {
            await page.locator('input[type=file]').setInputFiles({name, mimeType: 'image/png', buffer: Buffer.from(png, 'base64')});
            await page.locator('.btn-run').waitFor();
        };
        const done = async () => {
            await page.waitForFunction(() => {
                const app = document.querySelector('.design-root').__vue__;
                return app.isProcessDone || app.processFailureDialogOpen;
            }, undefined, {timeout: 120000});
            assert.equal(await page.locator('.el-message-box').isVisible(), false, await page.locator('body').innerText());
        };
        const setLambda = async value => {
            await page.locator('.gpt-strength input').fill(String(value));
            await page.locator('.gpt-strength input').press('Tab');
        };
        const errors = [], requests = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('request', req => { if (/^https?:/.test(req.url())) requests.push({url: req.url(), method: req.method()}); });
        await page.goto(base + '/gpt-denoise.html');
        assert.equal(await page.evaluate(() => crossOriginIsolated), false);
        // Generate a local translucent PNG with actual colour gradients.
        const png = await page.evaluate(() => {
            const c = document.createElement('canvas'); c.width = 13; c.height = 11;
            const ctx = c.getContext('2d'), data = ctx.createImageData(c.width, c.height);
            for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
                const i = (y * c.width + x) * 4;
                data.data.set([30 + x * 12, 50 + y * 13, 110 + (x + y) % 7 * 4, (x + y) % 3 ? 255 : 128], i);
            }
            ctx.putImageData(data, 0, 0); return c.toDataURL('image/png').split(',')[1];
        });
        await upload();
        const input = await page.evaluate(() => Array.from(document.getElementById('canvas-upload').getContext('2d').getImageData(0, 0, 13, 11).data));
        await page.locator('.btn-run').click();
        await page.locator('.processing-hud').waitFor();
        assert.equal(await page.locator('.mesh.is-on').count(), 1);
        assert.ok(await page.locator('.dot-grid .dot-pop').count() > 0);
        await done();
        const output = await page.evaluate(() => {
            const c = document.getElementById('canvas-output');
            return {width: c.width, height: c.height, data: Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data)};
        });
        assert.equal(output.width, 13); assert.equal(output.height, 11);
        input.forEach((v, i) => { if (i % 4 === 3) assert.equal(output.data[i], v, 'alpha retained'); });
        assert.ok(output.data.some((v, i) => i % 4 !== 3 && Math.abs(v - input[i]) > 2), 'real inference must change RGB');
        assert.ok(output.data.some((v, i) => i % 4 !== 3 && v > 50), 'result is not black');
        assert.equal(await page.locator('.stage-body.is-revealing').count(), 1, 'shared result reveal');
        assert.equal(await page.locator('.mesh.is-reveal').count(), 1);
        await page.waitForFunction(() => !document.querySelector('.design-root').__vue__.isResultRevealing);
        assert.equal(await page.locator('.preview-split-handle').count(), 1);
        await page.locator('.preview-split-handle').focus();
        await page.keyboard.press('ArrowRight');
        assert.ok(Number(await page.locator('.preview-split-handle').getAttribute('aria-valuenow')) > 50);
        assert.match(await page.locator('.preview-overlap-origin').getAttribute('style'), /clip-path: inset/);
        const download = page.waitForEvent('download');
        await page.getByRole('button', {name: '保存图片', exact: true}).click();
        assert.equal((await download).suggestedFilename(), 'test-denoise.png');
        assert.ok(requests.some(r => r.url.includes('gpt-denoise-simd.wasm')), 'SIMD backend used');
        assert.ok(requests.every(r => r.method === 'GET' && (r.url.startsWith(base) || /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(r.url))), 'no image uploads or external requests: ' + JSON.stringify(requests.filter(r => r.method !== 'GET' || !r.url.startsWith(base))));
        // Compare one whole-image graph pass with multi-tile inference. Width
        // exceeds twice the halo, so this catches incorrect crop/edge padding.
        const tileParity = await page.evaluate(async base => {
            const script = `
                onmessage = async () => {
                    try {
                        importScripts(${JSON.stringify(base)} + '/gpt-denoise-simd.js');
                        const m = await createDenoiseModule({locateFile: n => ${JSON.stringify(base)} + '/' + n});
                        m.FS.mkdir('/esrgan');
                        const paths = [];
                        for (const name of ['realesrgan-x4plus-anime.param','realesrgan-x4plus-anime.bin']) {
                            m.FS.writeFile('/esrgan/' + name, new Uint8Array(await (await fetch(${JSON.stringify(base)} + '/models/esrgan/' + name)).arrayBuffer()));
                            const bytes = new TextEncoder().encode('/esrgan/' + name + '\0'), p = m._malloc(bytes.length);
                            m.HEAPU8.set(bytes, p); paths.push(p);
                        }
                        if(m._denoise_load_model(...paths)) throw Error('model');
                        paths.forEach(p => m._free(p));
                        const w=211, h=9, src=new Uint8Array(w*h*4);
                        for(let i=0;i<w*h;i++) src.set([30+(i%w)%50*3,60+Math.floor(i/w)*15,160+(i%3)*3,255],i*4);
                        function run(left,width,coreX,coreWidth) {
                            const a=m._malloc(width*h*4), b=m._malloc(coreWidth*h*64);
                            for(let y=0;y<h;y++) m.HEAPU8.set(src.subarray((y*w+left)*4,(y*w+left+width)*4),a+y*width*4);
                            const code=m._denoise_tile(a,width,h,coreX,0,coreWidth,h,b);
                            if(code) throw Error('inference '+code);
                            const out=m.HEAPU8.slice(b,b+coreWidth*h*64);m._free(a);m._free(b);return out;
                        }
                        const whole=run(0,w,0,w), tiled=new Uint8Array(whole.length);
                        for(let x=0;x<w;x+=64) {
                            const cw=Math.min(64,w-x),left=Math.max(0,x-96),right=Math.min(w,x+cw+96);
                            const tile=run(left,right-left,x-left,cw);
                            for(let y=0;y<h*4;y++) tiled.set(tile.subarray(y*cw*16,(y+1)*cw*16),(y*w*4+x*4)*4);
                        }
                        let max=0;for(let i=0;i<whole.length;i++)max=Math.max(max,Math.abs(whole[i]-tiled[i]));
                        // Reproduce the changing halo shapes in the 1672 x 941
                        // job: ncnn's old pools retain buffers until >2 GiB.
                        let heap = m.HEAPU8.length;
                        const shapes = [[192,192,0,0,96,96], [288,192,96,0,96,96],
                            [235,192,96,0,43,96], [192,288,0,96,96,96],
                            [288,288,96,96,96,96], [288,277,96,96,96,96],
                            [235,277,96,96,43,96], [235,181,96,96,43,85],
                            [288,288,96,96,96,96], [192,192,0,0,96,96]];
                        let first, repeatDifference = 0;
                        for(const [tw,th,x,y,cw,ch] of shapes) {
                            const a=m._malloc(tw*th*4), b=m._malloc(cw*ch*64);
                            try {
                                m.HEAPU8.fill(128,a,a+tw*th*4);
                                const code=m._denoise_tile(a,tw,th,x,y,cw,ch,b);
                                if(code) throw Error('halo inference '+code+' at '+tw+'x'+th);
                                const output=m.HEAPU8.slice(b,b+cw*ch*64);
                                if(!output.some((v,i)=>i%4!==3 && v>20)) throw Error('black halo output');
                                for(let i=3;i<output.length;i+=4) if(output[i]!==255) throw Error('halo alpha');
                                if(tw===192 && th===192) {
                                    if(!first) first=output;
                                    else for(let i=0;i<first.length;i++) repeatDifference=Math.max(repeatDifference,Math.abs(first[i]-output[i]));
                                }
                                heap=Math.max(heap,m.HEAPU8.length);
                            }finally{m._free(a);m._free(b)}
                        }
                        postMessage({max,heap,repeatDifference});
                    }catch(e){postMessage({error:e.message})}
                };`;
            const url = URL.createObjectURL(new Blob([script], {type: 'text/javascript'}));
            const worker = new Worker(url);
            try {
                return await new Promise((resolve, reject) => {
                    const timer=setTimeout(()=>reject(Error('tile parity timeout')),240000);
                    worker.onmessage=({data})=>{clearTimeout(timer);resolve(data)};
                    worker.onerror=e=>{clearTimeout(timer);reject(Error(e.message))};worker.postMessage({});
                });
            } finally {worker.terminate();URL.revokeObjectURL(url)}
        }, base);
        assert.equal(tileParity.error, undefined, tileParity.error);
        assert.ok(tileParity.max <= 2, 'tile boundary parity: ' + tileParity.max);
        assert.ok(tileParity.heap < 768 * 1024 * 1024, 'halo heap must stay bounded: ' + tileParity.heap);
        assert.equal(tileParity.repeatDifference, 0, 'repeat after interior/odd-edge tiles');
        console.log('GPT halo memory regression passed; peak WASM heap:', tileParity.heap);

        if (process.env.DENOISE_LARGE === '1') {
            const large = await page.evaluate(async () => {
                const width=1672, height=941, pixels=new Uint8Array(width*height*4);
                for(let y=0;y<height;y++)for(let x=0;x<width;x++)
                    pixels.set([x%256,y%256,(x+y)%256,(x+y)%251],(y*width+x)*4);
                const expected=pixels.slice(), worker=new Worker('gptDenoiseWorker.js?v='+GPTDenoiseModels.version);
                try {
                    const data=await new Promise((resolve,reject)=> {
                        const timer=setTimeout(()=>reject(Error('large pipeline timeout')),1800000);
                        worker.onmessage=({data})=>{
                            if(data.type==='complete'){clearTimeout(timer);resolve(data)}
                            if(data.type==='error'){clearTimeout(timer);reject(Error(data.message))}
                        };
                        worker.onerror=e=>{clearTimeout(timer);reject(Error(e.message))};
                        worker.postMessage({type:'start',id:1,width,height,buffer:pixels.buffer,
                            options:{method:'esrgan',down:0.6,lambda:0.001}},[pixels.buffer]);
                    });
                    const output=new Uint8ClampedArray(data.buffer);
                    let changed=0, alphaErrors=0;
                    for(let i=0;i<output.length;i++) {
                        if(i%4===3) alphaErrors+=output[i]!==expected[i];
                        else changed+=Math.abs(output[i]-expected[i])>2;
                    }
                    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
                    canvas.getContext('2d').putImageData(new ImageData(output,width,height),0,0);
                    const png=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
                    const header=Array.from(new Uint8Array(await png.arrayBuffer()).slice(0,24));
                    return {width:data.width,height:data.height,seconds:data.seconds,changed,alphaErrors,header};
                }finally{worker.terminate()}
            });
            assert.equal(large.width,1672);assert.equal(large.height,941);
            assert.equal(large.alphaErrors,0);assert.ok(large.changed>0);
            assert.deepEqual(large.header.slice(0,8),[137,80,78,71,13,10,26,10]);
            assert.deepEqual(large.header.slice(16,24),[0,0,6,136,0,0,3,173]);
            console.log('GPT 1672 x 941 full ESRGAN + L0 + PNG passed:', large.seconds, 'seconds');
        }

        // Force SIMD loading failure to prove basic fallback through the shared UI.
        await page.reload();
        await page.route('**/gpt-denoise-simd.js*', route => route.abort());
        await upload('fallback.png'); await setLambda(0);
        await page.locator('.btn-run').click(); await done();
        assert.ok(requests.some(r => r.url.includes('gpt-denoise-basic.wasm')), 'basic fallback used');
        await page.unroute('**/gpt-denoise-simd.js*');

        // Termination interrupts WASM; retain source for retry in the shared ready state.
        await page.reload(); await upload('retry.png');
        await page.locator('.btn-run').click();
        await page.locator('.processing-cancel').click();
        await page.locator('.btn-run').waitFor();
        assert.equal(await page.evaluate(() => document.querySelector('.design-root').__vue__.gptWorker), null);
        await page.locator('.gpt-method .el-radio-button').filter({hasText:'仅 L0'}).click();
        const requestsBeforeL0 = requests.length;
        await page.locator('.btn-run').click(); await done();
        assert.ok(!requests.slice(requestsBeforeL0).some(r => /\.(wasm|bin|param)\b/.test(r.url)), 'L0 only does not load a model');

        // Corrupt model is rejected by the shared error dialog and keeps the original.
        await page.reload();
        await page.route('**/models/esrgan/*.param*', async route => {
            const response = await route.fetch(); const body = await response.body();
            body[0] ^= 1; await route.fulfill({response, body});
        });
        await upload('corrupt.png'); await page.locator('.btn-run').click();
        await page.locator('.el-message-box').waitFor({timeout: 120000});
        assert.match(await page.locator('.el-message-box').innerText(), /校验失败/);
        assert.equal(await page.locator('.preview-overlap-result').count(), 0);
        await page.unroute('**/models/esrgan/*.param*');

        // The shared queue also executes GPT jobs, preserving dimensions/alpha and download names.
        await page.reload();
        await page.locator('input[type=file]').setInputFiles(['one.png','two.png'].map(name => ({name, mimeType:'image/png', buffer:Buffer.from(png,'base64')})));
        await page.waitForFunction(() => {
            const app = document.querySelector('.design-root').__vue__;
            return app.batchItems.length === 2 && !app.isBatchProcessing;
        }, null, {timeout:120000});
        assert.deepEqual(await page.evaluate(() => document.querySelector('.design-root').__vue__.batchItems.map(i => ({status:i.status,width:i.outputWidth,height:i.outputHeight,filename:i.filename}))),
            ['one','two'].map(name => ({status:'done',width:13,height:11,filename:name+'-denoise.png'})));
        const zip = page.waitForEvent('download');
        await page.locator('#settings-panel .ctl-foot button').filter({hasText:'下载全部'}).click();
        assert.match((await zip).suggestedFilename(), /\.zip$/);
        // Invalid local files and oversized images fail before a Worker or model is started.
        await page.reload();
        const requestStart = requests.length;
        await page.locator('input[type=file]').setInputFiles({name:'not-image.txt',mimeType:'text/plain',buffer:Buffer.from('not an image')});
        await page.locator('.el-message-box').waitFor();
        assert.match(await page.locator('.el-message-box').innerText(), /40 MB/);
        await page.reload();
        const wide = await page.evaluate(() => {const c=document.createElement('canvas');c.width=4097;c.height=1;return c.toDataURL('image/png').split(',')[1];});
        await page.locator('input[type=file]').setInputFiles({name:'wide.png',mimeType:'image/png',buffer:Buffer.from(wide,'base64')});
        await page.locator('.el-message-box').waitFor();
        assert.match(await page.locator('.el-message-box').innerText(), /4096/);
        assert.equal(await page.evaluate(() => document.querySelector('.design-root').__vue__.gptWorker), null);
        assert.ok(!requests.slice(requestStart).some(r => /\.(wasm|bin|param)\b/.test(r.url)), 'invalid inputs do not load models');

        // Both routes use the very same Vue template and motion method bodies.
        const shared = await page.evaluate(() => {
            const app = document.querySelector('.design-root').__vue__;
            return {template: app.$options.template, methods: ['initWebReMotion','setThemeMode','beginResultReveal','startRevealWipeSweep','startSplitDrag','openMobileSettings','closeMobileSettings'].map(k => app.$options.methods[k].toString())};
        });
        const mainPage = await browser.newPage();
        await mainPage.goto(base + '/index.html');
        await mainPage.locator('.design-root').waitFor();
        const mainShared = await mainPage.evaluate(() => {
            const app = document.querySelector('.design-root').__vue__;
            return {template: app.$options.template, methods: ['initWebReMotion','setThemeMode','beginResultReveal','startRevealWipeSweep','startSplitDrag','openMobileSettings','closeMobileSettings'].map(k => app.$options.methods[k].toString())};
        });
        assert.deepEqual(shared, mainShared, 'not merely matching CSS: identical template and motion implementations');
        await mainPage.close();
        for (const lang of ['en','ja']) {
            const langPage = await browser.newPage(); await langPage.goto(base + '/' + lang + '/index.html');
            await langPage.locator('.design-root').waitFor();
            assert.equal(await langPage.evaluate(() => document.querySelector('.design-root').__vue__.$options.template), shared.template);
            await langPage.close();
        }
        // Phone drawer uses the shared entering/exiting animation, focus trap and background inert.
        await page.setViewportSize({width: 390, height: 844}); await page.reload();
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        assert.equal(await page.locator('#settings-panel').evaluate(n=>n.inert), true);
        await page.locator('.mobile-settings-fab').click();
        assert.equal(await page.locator('#settings-panel').getAttribute('role'), 'dialog');
        assert.equal(await page.locator('#settings-panel').getAttribute('aria-modal'), 'true');
        assert.equal(await page.locator('.stage-body').evaluate(n => n.closest('section').inert), true);
        await page.waitForFunction(() => document.activeElement.classList.contains('mobile-drawer-close'));
        // Element UI controls inherit the drawer visibility transition; wait for it to finish.
        await page.waitForFunction(() => getComputedStyle(document.querySelector('#settings-panel .card-body button')).visibility === 'visible');
        // First focusable element is the help button, last is Sample.
        await page.locator('#settings-panel .info-button').focus(); await page.keyboard.press('Shift+Tab');
        assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), '示例图片');
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement.classList.contains('info-button')), true);
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => document.activeElement.classList.contains('mobile-settings-fab'));
        assert.equal(await page.evaluate(() => document.body.style.overflow), '');
        await page.locator('.mobile-settings-fab').click();
        await page.locator('.mobile-drawer-backdrop').click({position:{x:10,y:10}});
        assert.equal(await page.locator('.mobile-settings-fab').count(), 1);

        // Real theme radial reveal, persistence, auto and reduced-motion behavior.
        await page.evaluate(() => {
            window.themeAnimations = [];
            const animate = document.documentElement.animate.bind(document.documentElement);
            document.documentElement.animate = (frames, options) => {window.themeAnimations.push({frames, options});return animate(frames, options);};
        });
        await page.getByRole('button', {name: /^主题:/}).click();
        await page.locator('.el-dropdown-menu:visible').getByText('深色', {exact:true}).click();
        await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
        await page.waitForFunction(() => window.themeAnimations.length > 0);
        assert.equal(await page.evaluate(() => window.themeAnimations[0].options.duration), 480);
        assert.equal(await page.evaluate(() => localStorage.getItem('rc:themeMode')), 'dark');
        // A real reload retains the selected theme.
        await page.reload();
        await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
        await page.evaluate(() => {window.themeAnimations=[];const animate=document.documentElement.animate.bind(document.documentElement);document.documentElement.animate=(frames,options)=>{window.themeAnimations.push({frames,options});return animate(frames,options);};});
        await page.emulateMedia({reducedMotion:'reduce', colorScheme:'dark'});
        await page.getByRole('button', {name: /^主题:/}).click();
        await page.locator('.el-dropdown-menu:visible').getByText('浅色', {exact:true}).click();
        await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
        assert.equal(await page.evaluate(() => window.themeAnimations.length), 0, 'reduced motion disables radial reveal');
        await page.getByRole('button', {name: /^主题:/}).click();
        await page.locator('.el-dropdown-menu:visible').getByText('跟随系统', {exact:true}).click();
        await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
        await page.emulateMedia({colorScheme:'light',reducedMotion:'reduce'});
        await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
        await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-reveal]')).opacity === '1');
        assert.ok(await page.locator('[data-reveal]').first().evaluate(n => parseFloat(getComputedStyle(n).transitionDuration) <= 0.00001), 'reduced motion has no reveal delay');

        // Mobile upload and L0 pipeline with the same ready/reveal/viewer state machine.
        await upload('phone.png');
        await page.locator('.mobile-settings-fab').click();
        await page.locator('.gpt-method .el-radio-button').filter({hasText:'仅 L0'}).click();
        await page.locator('.mobile-drawer-close').click();
        await page.locator('.btn-run').click(); await done();
        await page.locator('.mobile-settings-fab').click();
        const mobileDownload = page.waitForEvent('download');
        await page.getByRole('button', {name:'保存图片',exact:true}).click();
        assert.equal((await mobileDownload).suggestedFilename(),'phone-denoise.png');
        await page.locator('.mobile-settings-fab').click();
        await page.setViewportSize({width:1440,height:1000});
        await page.waitForFunction(() => document.getElementById('settings-panel').getAttribute('role') === null);
        assert.equal(await page.locator('.stage-body').evaluate(n => n.closest('section').inert), false);
        assert.equal(await page.evaluate(() => document.body.style.overflow), '');
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        // Full-cover upload target invokes the local picker, never a form POST.
        await page.reload();
        const picker = page.waitForEvent('filechooser');
        await page.locator('.el-upload-dragger').click();
        await (await picker).setFiles({name:'picker.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
        await page.locator('.btn-run').waitFor();
        assert.ok(requests.every(r => r.method === 'GET' && (new URL(r.url).origin === base || /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(r.url))), 'no external requests or uploads');
        assert.equal(errors.length, 0, errors.join('\n'));
        console.log('GPT browser passed: real ESRGAN/L0, alpha/PNG, SIMD/basic, cancel/retry, checksum, identical shared Vue UI/motion, mobile/focus/theme/reduced-motion.');
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
