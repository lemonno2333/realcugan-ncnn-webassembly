const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const {expect, test} = require('@playwright/test');

const repoRoot = path.resolve(__dirname, '..', '..');
const webRoot = path.join(repoRoot, 'web');
const tinyImage = createPngBuffer(8, 8);

function requireWebAsset(relativePath) {
  const fullPath = path.join(webRoot, relativePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Missing E2E web asset: ${relativePath}. Build the wasm backend before running Playwright.`);
  }
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  const crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function createPngBuffer(width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 4);
    row[0] = 0;
    for (let x = 0; x < width; x++) {
      const offset = 1 + x * 4;
      row[offset] = 96 + x * 8;
      row[offset + 1] = 112 + y * 8;
      row[offset + 2] = 160;
      row[offset + 3] = 255;
    }
    rows.push(row);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

async function uploadTinyImage(page) {
  await page.locator('input[type="file"]').setInputFiles({
    name: 'tiny.png',
    mimeType: 'image/png',
    buffer: tinyImage,
  });
}

async function seedPreferences(page, overrides = {}) {
  await page.addInitScript((prefs) => {
    localStorage.clear();
    Object.entries(prefs).forEach(([key, value]) => localStorage.setItem(key, value));
  }, {
    language: 'en',
    backendMode: 'basic',
    modelType: 'se',
    scale: '2',
    denoise: '3',
    ...overrides,
  });
}

async function openApp(page) {
  await page.goto('/');
  await expect(page.getByRole('heading', {name: 'Anime Image Upscaler'})).toBeVisible();
}

async function waitForSuccess(page) {
  await expect(page.locator('.stage-status')).toContainText(/Done\. Time:/, {timeout: 90000});
  await expect(page.getByRole('button', {name: 'Save image'})).toBeVisible();
}

test.beforeAll(() => {
  [
    'index.html',
    'wasmFallbackWorker.js',
    'realcugan-ncnn-webassembly-basic.js',
    'realcugan-ncnn-webassembly-basic.wasm',
    'realcugan-ncnn-webassembly-simd.js',
    'realcugan-ncnn-webassembly-simd.wasm',
  ].forEach(requireWebAsset);
});

test('uploads an image, processes it, downloads the result, and resets', async ({page}) => {
  await seedPreferences(page);
  await openApp(page);

  await uploadTinyImage(page);
  await waitForSuccess(page);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', {name: 'Save image'}).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/tiny-se-up2x-denoise3x\.png$/);

  await page.getByRole('complementary').getByRole('button', {name: 'Reset'}).click();
  await expect(page.getByText('Waiting for image')).toBeVisible();
  await expect(page.getByRole('button', {name: 'Sample'})).toBeVisible();
});

test('falls back when the threaded backend is unavailable', async ({page}) => {
  await seedPreferences(page, {backendMode: 'simd-threads'});
  await page.addInitScript(() => {
    Object.defineProperty(window, 'SharedArrayBuffer', {
      configurable: true,
      value: undefined,
    });
  });
  await openApp(page);

  await uploadTinyImage(page);
  await waitForSuccess(page);
  await expect(page.locator('.app-footer')).toContainText(/Backend: (simd|basic)/);
  await expect(page.locator('.app-footer')).not.toContainText('Backend: simd-threads');
});

test('shows the exact missing model file in the error dialog', async ({page}) => {
  await seedPreferences(page);
  await page.route('**/models/up2x-denoise3x.bin*', (route) => {
    route.fulfill({
      status: 404,
      contentType: 'text/plain',
      body: 'missing test model',
    });
  });
  await openApp(page);

  await uploadTinyImage(page);
  await expect(page.getByRole('dialog')).toContainText('Processing error', {timeout: 90000});
  await expect(page.getByRole('dialog')).toContainText('Model loading failed');
  await expect(page.getByRole('dialog')).toContainText('up2x-denoise3x.bin');
});

test('shows the mismatched model file size in the error dialog', async ({page}) => {
  await seedPreferences(page);
  await page.route('**/models/up2x-denoise3x.param*', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'text/plain',
      body: 'stale manifest test',
    });
  });
  await openApp(page);

  await uploadTinyImage(page);
  await expect(page.getByRole('dialog')).toContainText('Processing error', {timeout: 90000});
  await expect(page.getByRole('dialog')).toContainText('Model loading failed');
  await expect(page.getByRole('dialog')).toContainText('up2x-denoise3x.param');
  await expect(page.getByRole('dialog')).toContainText(/expected=\d+ actual=\d+/);
});

test('offers safer settings for risky mobile jobs', async ({page}) => {
  await seedPreferences(page, {scale: '4'});
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'deviceMemory', {
      configurable: true,
      value: 2,
    });
  });
  await page.setViewportSize({width: 390, height: 844});
  await openApp(page);

  await uploadTinyImage(page);
  await expect(page.getByRole('dialog')).toContainText('Image size risk');
  await expect(page.getByRole('dialog')).toContainText('Mobile browsers');
  await page.getByRole('button', {name: 'Use safe settings'}).click();

  await waitForSuccess(page);
  await expect(page.locator('.stage-meta')).toContainText('8 × 8 -> 16 × 16');
});
