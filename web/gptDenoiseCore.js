/* Pure CPU algorithms used by the denoise Worker and the Node regression check.
 * L0 gradient minimization ported from CXP-2024/gpt-anime-denoise (MIT).
 * See THIRD_PARTY_NOTICES.md for the original copyright and license.
 */
(function (root) {
    'use strict';

    class Radix2 {
        constructor(n) {
            this.n = n;
            this.rev = new Uint32Array(n);
            this.cos = new Float64Array(n / 2);
            this.sin = new Float64Array(n / 2);
            for (let i = 1; i < n; i++) this.rev[i] = (this.rev[i >> 1] >> 1) | ((i & 1) ? n >> 1 : 0);
            for (let i = 0; i < n / 2; i++) {
                this.cos[i] = Math.cos(2 * Math.PI * i / n);
                this.sin[i] = Math.sin(2 * Math.PI * i / n);
            }
        }
        transform(re, im, inverse = false) {
            const n = this.n;
            for (let i = 0; i < n; i++) {
                const j = this.rev[i];
                if (i < j) {
                    [re[i], re[j]] = [re[j], re[i]];
                    [im[i], im[j]] = [im[j], im[i]];
                }
            }
            for (let size = 2; size <= n; size *= 2) {
                const half = size / 2, step = n / size;
                for (let start = 0; start < n; start += size) {
                    for (let j = 0; j < half; j++) {
                        const c = this.cos[j * step], s = this.sin[j * step] * (inverse ? 1 : -1);
                        const a = start + j, b = a + half;
                        const r = re[b] * c - im[b] * s, v = re[b] * s + im[b] * c;
                        re[b] = re[a] - r; im[b] = im[a] - v;
                        re[a] += r; im[a] += v;
                    }
                }
            }
            if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
        }
    }

    // Bluestein handles arbitrary lengths: padding the image itself would change
    // the periodic boundary conditions of the original NumPy L0 implementation.
    class FFTPlan {
        constructor(n) {
            if (!Number.isInteger(n) || n < 1) throw new Error('Invalid FFT length');
            this.n = n;
            if ((n & (n - 1)) === 0) { this.direct = new Radix2(n); return; }
            let m = 1;
            while (m < 2 * n - 1) m *= 2;
            this.fft = new Radix2(m);
            this.cos = new Float64Array(n); this.sin = new Float64Array(n);
            this.kr = new Float64Array(m); this.ki = new Float64Array(m);
            this.ar = new Float64Array(m); this.ai = new Float64Array(m);
            for (let i = 0; i < n; i++) {
                const angle = Math.PI * ((i * i) % (2 * n)) / n;
                const c = this.cos[i] = Math.cos(angle), s = this.sin[i] = Math.sin(angle);
                this.kr[i] = c; this.ki[i] = s;
                if (i) { this.kr[m - i] = c; this.ki[m - i] = s; }
            }
            this.fft.transform(this.kr, this.ki);
        }
        transform(re, im, inverse = false) {
            if (this.direct) { this.direct.transform(re, im, inverse); return; }
            const {n, ar, ai, cos, sin, kr, ki} = this;
            ar.fill(0); ai.fill(0);
            for (let i = 0; i < n; i++) {
                const v = inverse ? -im[i] : im[i];
                ar[i] = re[i] * cos[i] + v * sin[i];
                ai[i] = v * cos[i] - re[i] * sin[i];
            }
            this.fft.transform(ar, ai);
            for (let i = 0; i < ar.length; i++) {
                const r = ar[i] * kr[i] - ai[i] * ki[i];
                ai[i] = ar[i] * ki[i] + ai[i] * kr[i]; ar[i] = r;
            }
            this.fft.transform(ar, ai, true);
            for (let i = 0; i < n; i++) {
                re[i] = (ar[i] * cos[i] + ai[i] * sin[i]) / (inverse ? n : 1);
                im[i] = (ai[i] * cos[i] - ar[i] * sin[i]) * (inverse ? -1 / n : 1);
            }
        }
    }

    function makeFFT2(w, h) {
        const rows = new FFTPlan(w), cols = new FFTPlan(h);
        const re = new Float64Array(Math.max(w, h)), im = new Float64Array(re.length);
        return (real, imag, inverse = false) => {
            for (let y = 0; y < h; y++) {
                re.set(real.subarray(y * w, (y + 1) * w));
                im.set(imag.subarray(y * w, (y + 1) * w));
                rows.transform(re, im, inverse);
                real.set(re.subarray(0, w), y * w); imag.set(im.subarray(0, w), y * w);
            }
            for (let x = 0; x < w; x++) {
                for (let y = 0; y < h; y++) { re[y] = real[y * w + x]; im[y] = imag[y * w + x]; }
                cols.transform(re, im, inverse);
                for (let y = 0; y < h; y++) { real[y * w + x] = re[y]; imag[y * w + x] = im[y]; }
            }
        };
    }

    function roundEven(v) {
        const lo = Math.floor(v), fraction = v - lo;
        return fraction === 0.5 ? lo + (lo & 1) : Math.round(v);
    }
    function byte(v) { return Math.min(255, Math.max(0, roundEven(v))); }

    function checkImage(rgba, w, h) {
        if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 ||
            w > 4096 || h > 4096 || w * h > 4000000 || rgba.length !== w * h * 4) {
            throw new Error('图片尺寸或像素缓冲无效（最多 400 万像素，单边不超过 4096）。');
        }
    }

    function validateOptions({method = 'esrgan', down = 0.6, lambda = 0.001} = {}) {
        if (!['esrgan', 'cugan', 'l0'].includes(method) || !Number.isFinite(down) || down < 0.1 || down > 1 ||
            !Number.isFinite(lambda) || lambda < 0 || lambda > 0.01) {
            throw new Error('去噪参数无效。');
        }
        return {method, down, lambda};
    }

    // Separable Pillow-style BOX / Lanczos-3 resampling on RGB, NOT Canvas's
    // implementation-dependent imageSmoothingQuality. Alpha is restored later.
    function resizeRGB(source, sw, sh, dw, dh, filter) {
        if (![sw, sh, dw, dh].every(n => Number.isInteger(n) && n > 0) ||
            source.length !== sw * sh * 4 || !['box', 'lanczos'].includes(filter)) throw new Error('Invalid resize');
        const kernel = x => {
            if (filter === 'box') return x > -0.5 && x <= 0.5 ? 1 : 0;
            if (Math.abs(x) >= 3) return 0;
            if (Math.abs(x) < 1e-12) return 1;
            const p = Math.PI * x;
            return Math.sin(p) * Math.sin(p / 3) / (p * p / 3);
        };
        function coefficients(from, to) {
            const scale = from / to, stretch = Math.max(1, scale), support = (filter === 'box' ? 0.5 : 3) * stretch;
            return Array.from({length: to}, (_, i) => {
                const center = (i + 0.5) * scale;
                const first = Math.max(0, Math.floor(center - support + 0.5));
                const last = Math.min(from, Math.floor(center + support + 0.5));
                const weights = new Float64Array(last - first);
                let sum = 0;
                for (let j = first; j < last; j++) sum += weights[j - first] = kernel((j + 0.5 - center) / stretch);
                for (let j = 0; j < weights.length; j++) weights[j] /= sum;
                return {first, weights};
            });
        }
        const cx = coefficients(sw, dw), cy = coefficients(sh, dh);
        const horizontal = new Uint8Array(dw * sh * 4), out = new Uint8Array(dw * dh * 4);
        for (let y = 0; y < sh; y++) for (let x = 0; x < dw; x++) {
            const {first, weights} = cx[x];
            for (let c = 0; c < 3; c++) {
                let sum = 0;
                for (let k = 0; k < weights.length; k++) sum += source[(y * sw + first + k) * 4 + c] * weights[k];
                horizontal[(y * dw + x) * 4 + c] = Math.min(255, Math.max(0, Math.floor(sum + 0.5)));
            }
        }
        for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
            const {first, weights} = cy[y];
            for (let c = 0; c < 3; c++) {
                let sum = 0;
                for (let k = 0; k < weights.length; k++) sum += horizontal[((first + k) * dw + x) * 4 + c] * weights[k];
                out[(y * dw + x) * 4 + c] = Math.min(255, Math.max(0, Math.floor(sum + 0.5)));
            }
            out[(y * dw + x) * 4 + 3] = 255;
        }
        return out;
    }

    function l0Smooth(rgba, w, h, lambda, progress = () => {}) {
        checkImage(rgba, w, h);
        validateOptions({lambda});
        if (!lambda) return new Uint8Array(rgba);
        const n = w * h, fft = makeFFT2(w, h);
        const s = Array.from({length: 3}, () => new Float64Array(n));
        const n1r = s.map(() => new Float64Array(n)), n1i = s.map(() => new Float64Array(n));
        const horizontal = s.map(() => new Float64Array(n)), vertical = s.map(() => new Float64Array(n));
        const otf = new Float64Array(n), wr = new Float64Array(n), wi = new Float64Array(n);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            const i = y * w + x;
            otf[i] = 4 - 2 * Math.cos(2 * Math.PI * x / w) - 2 * Math.cos(2 * Math.PI * y / h);
            for (let c = 0; c < 3; c++) n1r[c][i] = s[c][i] = rgba[i * 4 + c] / 255;
        }
        for (let c = 0; c < 3; c++) fft(n1r[c], n1i[c]);
        const total = Math.ceil(Math.log2(1e5 / (2 * lambda)));
        let iteration = 0;
        for (let beta = 2 * lambda; beta < 1e5; beta *= 2) {
            const threshold = lambda / beta;
            for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
                const i = y * w + x, right = y * w + (x + 1) % w, below = ((y + 1) % h) * w + x;
                let norm = 0;
                for (let c = 0; c < 3; c++) {
                    const a = horizontal[c][i] = s[c][right] - s[c][i];
                    const b = vertical[c][i] = s[c][below] - s[c][i];
                    norm += a * a + b * b;
                }
                if (norm < threshold) for (let c = 0; c < 3; c++) horizontal[c][i] = vertical[c][i] = 0;
            }
            for (let c = 0; c < 3; c++) {
                for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
                    const i = y * w + x;
                    wr[i] = horizontal[c][y * w + (x + w - 1) % w] - horizontal[c][i]
                        + vertical[c][((y + h - 1) % h) * w + x] - vertical[c][i];
                }
                wi.fill(0); fft(wr, wi);
                for (let i = 0; i < n; i++) {
                    const denom = 1 + beta * otf[i];
                    wr[i] = (n1r[c][i] + beta * wr[i]) / denom;
                    wi[i] = (n1i[c][i] + beta * wi[i]) / denom;
                }
                fft(wr, wi, true); s[c].set(wr);
            }
            progress(++iteration / total);
        }
        const out = new Uint8Array(rgba.length);
        for (let i = 0; i < n; i++) {
            for (let c = 0; c < 3; c++) out[i * 4 + c] = byte(s[c][i] * 255);
            out[i * 4 + 3] = rgba[i * 4 + 3];
        }
        return out;
    }

    const api = {FFTPlan, makeFFT2, resizeRGB, l0Smooth, checkImage, validateOptions, roundEven};
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.GPTDenoiseCore = api;
})(typeof self !== 'undefined' ? self : globalThis);
