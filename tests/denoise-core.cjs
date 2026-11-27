const assert = require('node:assert/strict');
const {FFTPlan, makeFFT2, l0Smooth, resizeRGB, validateOptions, checkImage} = require('../web/gptDenoiseCore.js');
const fixture = require('./fixtures/denoise-reference.json');
for (const n of [1, 2, 3, 5, 7, 8, 11, 16, 31, 96]) {
    const re = Float64Array.from({length: n}, (_, i) => Math.sin(i * 0.7) + i / 10);
    const im = Float64Array.from({length: n}, (_, i) => Math.cos(i * 0.3));
    const a = re.slice(), b = im.slice(), plan = new FFTPlan(n);
    plan.transform(re, im);
    for (let k = 0; k < n; k++) {
        let r = 0, v = 0;
        for (let j = 0; j < n; j++) {
            const c = Math.cos(2 * Math.PI * j * k / n), s = -Math.sin(2 * Math.PI * j * k / n);
            r += a[j] * c - b[j] * s; v += a[j] * s + b[j] * c;
        }
        assert.ok(Math.abs(r - re[k]) < 1e-8 && Math.abs(v - im[k]) < 1e-8, `DFT ${n}:${k}`);
    }
    plan.transform(re, im, true);
    for (let i = 0; i < n; i++) assert.ok(Math.abs(a[i] - re[i]) < 1e-10 && Math.abs(b[i] - im[i]) < 1e-10);
}
for (const [w, h] of [[1, 1], [1, 7], [7, 1], [5, 8], [7, 11]]) {
    const re = Float64Array.from({length: w * h}, (_, i) => Math.sin(i)), orig = re.slice();
    const im = new Float64Array(re.length), fft = makeFFT2(w, h);
    fft(re, im); fft(re, im, true);
    orig.forEach((v, i) => assert.ok(Math.abs(v - re[i]) < 1e-10));
    const constant = Uint8Array.from({length: w * h * 4}, (_, i) => i % 4 === 3 ? i % 256 : 123);
    assert.deepEqual(l0Smooth(constant, w, h, 0.001), constant);
}
const src = new Uint8Array(fixture.input);
const before = src.slice();
let progress = [];
assert.deepEqual(Array.from(l0Smooth(src, fixture.width, fixture.height, 0.001, p => progress.push(p))), fixture.l0);
assert.deepEqual(src, before, 'source remains intact');
assert.equal(progress.length, 26); assert.equal(progress.at(-1), 1);
assert.deepEqual(l0Smooth(src, fixture.width, fixture.height, 0), src);
for (const filter of ['box', 'lanczos']) {
    const result = resizeRGB(src, fixture.width, fixture.height, 4, 3, filter);
    const rgb = Array.from(result).filter((_, i) => i % 4 !== 3);
    // Pillow uses fixed-point coefficient rounding, so allow one 8-bit level.
    rgb.forEach((v, i) => assert.ok(Math.abs(v - fixture[filter][i]) <= 1, `${filter}:${i}`));
}
for (const lambda of [-1, NaN, Infinity, 0.011]) assert.throws(() => validateOptions({lambda}));
for (const down of [0, -1, Infinity, 1.01]) assert.throws(() => validateOptions({down}));
assert.throws(() => validateOptions({method: 'unknown'}));
assert.throws(() => checkImage(new Uint8Array(4), 0, 1));
assert.throws(() => checkImage(src.subarray(0, 4), 7, 5));
console.log('GPT-denoise core passed: FFT/DFT, NumPy L0 parity, Pillow resampling, alpha, parameters.');

assert.equal(validateOptions({method: 'cugan'}).method, 'cugan');
assert.throws(() => validateOptions({method: 'unknown'}));
