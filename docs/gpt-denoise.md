# 纯浏览器 GPT 图片去噪

## 入口与范围

从超分页面右上角 **GPT 去噪** 进入 `gpt-denoise.html`。也可直接打开该静态页面。

默认流程移植自 [gpt-anime-denoise](https://github.com/CXP-2024/gpt-anime-denoise)：

```text
RGB → BOX 预缩 60% → RealESRGAN_x4plus_anime_6B 4×
    → Lanczos-3 恢复原尺寸 → L0 平滑 λ=0.001 → 恢复原图 alpha → PNG
```

可调预缩比例 10%–100%、L0 强度 0–0.01。设为 0 跳过 L0。
“仅 L0 平滑”不下载模型，也不做缩图或超分。

**整个流程在浏览器本地运行**：只有静态 JS/WASM/模型与主页面字体的 GET 请求，无上传接口、
Python 服务、远程推理 API 或 CDN 推理依赖。现有 Real-CUGAN 超分功能保持独立。
本次移植范围是 ESRGAN / CUGAN + L0 去噪流程，不包括 APISR、人物分割、笔刷、套索或原项目的桌面 GUI。主页面现有批量队列与下载在去噪模式下同样可用。

## 界面复用

主页面与去噪页直接加载**同一个** `web/appTemplate.js` 和 `web/app.js`：
Vue / Element UI 控件、品牌与布局、上传/粘贴/批量队列、图像取色、处理网格与光效、
文字擦入、结果揭示与对比滑杆/缩放/拖动、主题圆形揭示、移动抽屉及焦点交互全部共用。
`prefers-reduced-motion` 也遵循同一实现，并非复制样式或另写一套相似动效。

GPT 模式只切换专属参数（ESRGAN / CUGAN / L0、预缩比例、λ）与推理后端。
`gptDenoise.js` 现在仅是 Worker 适配器和专属文案，不再控制 DOM；
独立的原生控件样式 `gptDenoise.css` 已移除。不会加载主页面 WASM；
GPT runtime 根据所选方法加载 ESRGAN 或 CUGAN 模型。

修改 UI 与动效请编辑共享文件；修改入口/SEO 后运行 `python3 web/build_pages.py`，
生成英文、日文与 GPT 入口壳，避免语言页和去噪页漂移。

## 方法与后端

- **ESRGAN + L0**：默认的 60% 预缩 → anime-6B 4× → 原尺寸 → L0。
- **CUGAN + L0**：60% 预缩 → Real-CUGAN SE 2× / 降噪 3 档 → 原尺寸 → L0。
  复用本仓库的 `up2x-denoise3x` ncnn 模型及分块代码；不承诺与上游
  `up2x-latest-denoise3x.pth` 逐像素一致。模型按所选方法懒加载，并校验大小及 SHA-256。
- **仅 L0**：不下载模型或 WASM；L0 的 Float64 FFT 仍是单线程 JavaScript。

GPT 与主页面共用“自动 / 多线程+SIMD / SIMD / 兼容”选择与回退顺序。
自动优先多线程+SIMD，再 SIMD、basic；手动 SIMD 不启用线程，兼容只用 basic。
多线程+SIMD 实际使用共享 WASM 内存、pthread Workers 与 ncnn OpenMP，最多 4 线程；
线程设置加速神经网络推理，不会让 L0 自动并行。页脚显示实际后端及推理线程数。
切换后端会重建 Worker；处理或批量运行期间禁用切换，取消会终止 Worker。

## 构建

继续使用现有 `sh build.sh`。需要 curl、Python 3（仅构建下载脚本）、CMake 3.x、
Emscripten 和 ncnn 20220729 / fmt 依赖。可参考主 README 的环境准备步骤。
本地验证使用 Emscripten 3.1.74、CMake 3.31；现有 CI 的 Emscripten 3.1.13 配置未改动。

构建脚本自动从官方 v0.2.5.0 release 下载并校验 ncnn 模型，随后复制到 `web/models/esrgan/`。
仓库不提交 9 MB 的生成权重文件。已下载的两个模型都通过 SHA-256 校验时，不重复下载。
无网络构建可设置 `DENOISE_MODEL_ARCHIVE=/absolute/path/to/realesrgan-ncnn-vulkan-20220424-ubuntu.zip`。
文件仍必须匹配官方校验值。

静态 UI 与新引擎产物：

- `web/appTemplate.js` / `web/app.js`（两页共用 UI 与动效）
- `web/gpt-denoise.html` / `web/gptDenoise.js`（入口与 Worker 适配器）

- `web/gpt-denoise-basic.js` / `.wasm`
- `web/gpt-denoise-simd.js` / `.wasm`
- `web/gpt-denoise-simd-threads.js` / `.wasm`
- 旧版 Emscripten 额外生成的 `web/gpt-denoise-simd-threads.worker.js`（若存在）
- `web/models/up2x-denoise3x.param` / `.bin`
- `web/models/esrgan/realesrgan-x4plus-anime.param` / `.bin`
- `web/models/esrgan/LICENSE`

`basic`、`simd`、`simd-threads` 都会额外生成 GPT runtime。
完整部署请使用默认 `sh build.sh` 构建三种后端。不要只发布一个 HTML。

```sh
# 构建后检查完整静态目录
npm run check:deploy
# 无 COOP/COEP 的本地演示服务器
python3 -m http.server 8000 --bind 127.0.0.1 --directory web
# 打开 http://127.0.0.1:8000/gpt-denoise.html
```

公网使用 HTTPS（SHA-256 校验依赖 Web Crypto），本地 localhost HTTP 也可。
WASM 必须以 `application/wasm` 服务；模型是普通静态资源，不依赖文件系统写权限。
**GPT 的多线程后端需要 COOP/COEP 和 SharedArrayBuffer**，与主页面相同：

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

所有脚本、模型与 WASM 建议同源部署。不支持线程或没有隔离响应头时，
包括手动“多线程+SIMD”在内都会回退到 SIMD / basic；页面仍可正常使用。
上面的 Python 演示服务器不加隔离响应头，只能验证单线程回退。

## 推理、内存和取消

- 自动检测 SIMD、线程及跨源隔离；按所选模式加载，失败回退；均在独立 Worker 内执行。
- ncnn 处理 96×96 核心 tile，并读取裁剪到图片边缘的 96 像素真实邻域。
- 模型图固定为官方 anime-6B：`data` 输入、`501` trunk 输出、`output` 最终输出。
  C++ 在 trunk 后截取核心区域和 3 像素 feature halo，再执行 4× tail，避免对全部
  96 像素 halo 分配高分辨率 64 通道激活。不能直接替换为其他 ESRGAN graph。
- GPT 引擎关闭 ncnn 的网络级临时内存池：不同形状的 halo tile 不再累积缓存，
  避免 1672×941 默认流程在第一个二维内部 tile 超过 2 GiB WASM 上限。
  保留 SIMD、96 像素邻域、模型和 Float32 推理精度；不改 Real-CUGAN 的配置。
- CUGAN 对边长不够反射填充宽度的小图使用重复反射，1 像素边长退化为边缘复制，
  避免旧版 ncnn 的越界读取；正常分块仍使用原 SIMD / OpenMP 优化路径。
- L0 使用 Float64 和任意尺寸二维 FFT；非 2 的幂尺寸由 Bluestein 处理，
  不通过填充图片改变原算法的周期边界。
- 取消直接终止专用 Worker，能够打断同步 WASM 或 FFT；原图留在主线程供重试。
  成功处理后复用模型；取消/错误后重建 Worker。
- **ESRGAN CPU 推理比 Real-CUGAN 重很多**。本版未接 WebGPU，且 L0 也会消耗大量内存。
  限制为 400 万像素、单边 4096、文件 40 MB；低内存设备建议不超过 100 万像素。
  这些是输入上限，不是保证所有设备都能处理。大图可能仍因内存或耗时受限。

## 与 Python 版本的区别

保留处理配方，不承诺逐像素一致：官方 ncnn 权重存储为 FP16，而 PyTorch 原权重为 FP32；
CPU 浮点计算、8 位舍入与重采样系数也可能有微小差异。96 像素邻域覆盖 anime-6B
的卷积感受野，不使用小 halo 猜测拼接。回归测试包含直接全图 / 分块推理比较。

浏览器原生解码处理 EXIF 方向、色彩转换和透明图片。输出是 8 位 PNG；alpha 来自
解码后的原图并原样恢复。不保留输入文件的 ICC/EXIF 元数据，也不支持 HDR/16 位输出。
预览的原图与结果互补裁剪，避免透明像素重复叠加；同一修复也适用于主页面。

## 验证

```sh
npm ci
npx playwright install chromium
npm run test:denoise
# 两个真实模型 × 四种模式 × 有/无隔离，以及线程加载失败回退、CUGAN 多分块
PLAYWRIGHT_CHANNEL=chrome npm run test:denoise:backends
# 慢测试：1672×941 CUGAN + L0（多线程）
DENOISE_LARGE=1 PLAYWRIGHT_CHANNEL=chrome npm run test:denoise:backends
# 慢测试：1672×941 默认 ESRGAN + L0 完整流程、alpha 与 PNG
PLAYWRIGHT_CHANNEL=chrome npm run test:denoise:large
npm run check:deploy
```

已有系统 Chrome 时可使用 `PLAYWRIGHT_CHANNEL=chrome npm run test:denoise`。
`tests/denoise-core.cjs` 验证 FFT 与直接 DFT、Float64 L0 与 NumPy 参考结果、
BOX/Lanczos 与 Pillow（容许一个色阶）、alpha 和非法参数。
`tests/denoise-smoke.cjs` 用真实模型、无隔离响应头的服务器验证推理、PNG 下载、
二维 288×288 邻域、奇数边缘 tile、重复推理与 WASM 内存上限，
SIMD/basic 回退、取消重试、L0-only 零模型下载、损坏模型拒绝、真实 GPT 批量与 ZIP、非法输入拦截、
共享模板/动效代码一致性、移动布局与焦点循环、主题持久化/圆形揭示、减少动效偏好和无图片上传。

## 许可

L0 与流程来自 CXP-2024 的 MIT 项目；模型来自 Real-ESRGAN（BSD-3-Clause）；
ncnn 为 BSD-3-Clause。完整声明随静态目录放在 `web/THIRD_PARTY_NOTICES.md`。
不包含原去噪项目的示例图或 APISR 模型。
