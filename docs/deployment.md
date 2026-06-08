# Deployment Headers And Caching

This project is a static web app, but the WebAssembly backends need a few
deployment details to work reliably. Before publishing a release, run:

```shell
npm run check:deploy
```

The check verifies that `web/` contains the frontend assets, every generated
WASM backend, the worker files, and every model file referenced by
`MODEL_FILES` in `web/modelManifest.js`. It also checks model byte sizes so
stale or partial uploads fail before deployment.

## Repository Layout

The `web/` directory is the deployable static root. It intentionally mixes
hand-maintained frontend files with build output so it can be served directly
for local testing and copied as-is for deployment.

Tracked files in `web/` are the static app shell, vendor runtime files, and
small frontend helpers such as `app.css`, `i18n.js`, `modelManifest.js`,
`debugLogger.js`, `wasmFeatureDetect.js`, and `wasmFallbackWorker.js`.

Do not commit generated deployment payloads under `web/`: `build.sh` copies the
WASM runtime files and copies the source model set from `models/` into
`web/models/`. The `web/.gitignore` file keeps those generated files out of
Git, while `npm run check:deploy` still verifies they exist before publishing.

## Required Files

Deploy the whole `web/` directory after building. At minimum it must include:

- `index.html`
- `vue.min.js`, `element.js`, `element.css`, `normalize.css`
- `wasmFeatureDetect.js`
- `wasmFallbackWorker.js`
- `app.css`, `i18n.js`, `modelManifest.js`, `debugLogger.js`
- `realcugan-ncnn-webassembly-basic.js`
- `realcugan-ncnn-webassembly-basic.wasm`
- `realcugan-ncnn-webassembly-simd.js`
- `realcugan-ncnn-webassembly-simd.wasm`
- `realcugan-ncnn-webassembly-simd-threads.js`
- `realcugan-ncnn-webassembly-simd-threads.wasm`
- `realcugan-ncnn-webassembly-simd-threads.worker.js`
- the full `web/models/` directory

## COOP And COEP

The threaded backend requires `SharedArrayBuffer`, which modern browsers expose
only in a cross-origin isolated page. Configure these response headers on
`index.html` and same-origin static assets:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin
```

If these headers are missing, the app still works by falling back to `simd` or
`basic`, but `simd-threads` will not be available.

Also make sure `.wasm` files are served as:

```text
Content-Type: application/wasm
```

## Cache Policy

The frontend appends `?v=APP_VERSION` to runtime, worker, and model asset URLs.
That means release assets can be cached aggressively, as long as `APP_VERSION`
is bumped whenever any deployed asset changes.

Recommended headers:

```text
index.html:
  Cache-Control: no-cache

*.js, *.css, *.wasm, *.worker.js:
  Cache-Control: public, max-age=31536000, immutable

web/models/**/*.param, web/models/**/*.bin:
  Cache-Control: public, max-age=31536000, immutable
```

Keep `index.html` short-cached or revalidated so users can discover the latest
`APP_VERSION`. Long-cache WASM, worker, JavaScript, CSS, and model files because
their URLs include the version query string.

Do not rely on `<meta http-equiv>` cache tags in `index.html` for deployment
caching. They only apply to the HTML document after it has already been loaded,
are inconsistently honored across browsers and proxies, and cannot control
external WASM, worker, JavaScript, CSS, or model asset caching. Use HTTP
`Cache-Control` response headers instead.

If your static host or CDN ignores query strings when caching, either configure
it to include the full query string in the cache key, or avoid long-lived
caching until a file-name-based asset manifest is introduced.

## Nginx Example

```nginx
types {
    application/wasm wasm;
}

server {
    root /var/www/realcugan/web;

    add_header Cross-Origin-Opener-Policy "same-origin" always;
    add_header Cross-Origin-Embedder-Policy "require-corp" always;
    add_header Cross-Origin-Resource-Policy "same-origin" always;

    location = /index.html {
        add_header Cache-Control "no-cache" always;
        try_files $uri =404;
    }

    location ~* \.(?:js|css|wasm)$ {
        add_header Cache-Control "public, max-age=31536000, immutable" always;
        try_files $uri =404;
    }

    location ^~ /models/ {
        add_header Cache-Control "public, max-age=31536000, immutable" always;
        try_files $uri =404;
    }

    location / {
        try_files $uri /index.html;
    }
}
```

## Apache Example

```apache
<IfModule mod_mime.c>
  AddType application/wasm .wasm
</IfModule>

<IfModule mod_headers.c>
  Header always set Cross-Origin-Opener-Policy "same-origin"
  Header always set Cross-Origin-Embedder-Policy "require-corp"
  Header always set Cross-Origin-Resource-Policy "same-origin"

  <Files "index.html">
    Header set Cache-Control "no-cache"
  </Files>

  <FilesMatch "\.(js|css|wasm)$">
    Header set Cache-Control "public, max-age=31536000, immutable"
  </FilesMatch>

  <LocationMatch "^/models/.*\.(param|bin)$">
    Header set Cache-Control "public, max-age=31536000, immutable"
  </LocationMatch>
</IfModule>
```

## GitHub Pages And Static Hosts

GitHub Pages does not allow custom COOP/COEP headers, so it cannot enable
`simd-threads`. The app will fall back to `simd` or `basic`.

For hosts that support custom headers, configure the three isolation headers
above and verify in the browser console:

```js
crossOriginIsolated
```

It should return `true` for the threaded backend to be available.
