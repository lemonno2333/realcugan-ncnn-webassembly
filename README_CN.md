# RealCUGAN-ncnn-webassembly
本项目使用 WebAssembly 技术，基于 ncnn 运行 Real-CUGAN 模型。目前使用 CPU
进行计算，在浏览器本地完成图片处理，不会上传图片到服务器。

本 fork 保留仓库内现有的 ncnn 模型文件，不需要重新转换或生成模型。构建会产出
`simd-threads`、`simd` 和 `basic` 三个 WebAssembly 后端，浏览器会优先使用最快的
`simd-threads`，不支持 pthread/SharedArrayBuffer 时会自动降级到单线程 CPU 后端。

网页前端也做了更新，方便本地查看图片细节：

- 可选择 SE 和 Pro 两套 Real-CUGAN 模型，并包含完整的上游 SE 模型；
- 固定页头/页脚的工具式布局，工作区留给图片预览；
- 参考 Material Design Monet，从上传图片中提取主题色并应用到界面；
- 处理中会根据图片主色生成动态 mesh 弥散渐变等待态；
- 只保留叠图对比模式，分割线以预览窗格相对位置计算；
- 桌面端支持受限范围内的放大、缩小、滚轮缩放和鼠标拖拽平移；
- 移动端使用自然滚动布局，并支持手指拖拽查看放大后的图片区域；
- 上传或处理完图片后，可以用“复位”清空当前结果并处理下一张图片。

本 fork 还完成了 WebAssembly 后端优化：

- `basic` 和 `simd` fallback 后端移入独立 Web Worker，在线程版 WASM 不可用时也能保持界面响应；
- 模型改为从 `web/models/` 按需加载并使用普通 HTTP 缓存，不再打包进一个大型 Emscripten `.data` 文件；
- 前端会根据后端能力、CPU 线程数、设备内存和视口尺寸自适应选择推理线程数和 tile 大小；
- 后端按 tile 直接写入最终 RGBA 输出，尽量避免完整中间图和重复大缓冲，降低峰值内存；
- 进度、完成、取消和错误事件改为更低开销的直接回调，不再通过 stdout 格式化 JSON；
- 已 benchmark `-flto` 和 `emmalloc` 构建，目前两者收益不明显，因此默认不启用。

[Real-CUGAN](https://github.com/bilibili/ailab/tree/main/Real-CUGAN) 是一个使用百万级动漫数据进行训练的，结构与Waifu2x兼容的通用动漫图像超分辨率模型。它支持2x\3x\4x倍超分辨率。本项目内置的 SE 模型已对齐上游 `models-se`：2倍模型支持保守、无降噪、denoise1x/2x/3x，3倍和4倍模型支持保守、无降噪、denoise3x。

代码实现上深度参考了nihui大佬的[realcugan-ncnn-vulkan](https://github.com/nihui/realcugan-ncnn-vulkan)和[ncnn-webassembly-nanodet](https://github.com/nihui/ncnn-webassembly-nanodet)

# 使用
网站地址： https://realcugan.lemonno.xyz/

Android/iOS请在独立浏览器内打开，PC推荐使用最新版本的Chrome或Firefox。

# How to build

你可以在GitHub Actions里面下载构建好的版本，或者按照下面的教程手动构建

 1. 安装[emscripten](https://github.com/emscripten-core/emscripten)
 ```shell
 git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
./emsdk install 3.1.13
./emsdk activate 3.1.13

source emsdk/emsdk_env.sh # 或者添加到.zshrc等地方
 ```
2. 构建项目:
```shell
git clone https://github.com/lemonno2333/realcugan-ncnn-webassembly.git
cd realcugan-ncnn-webassembly

git submodule update --init
# 如果当前 fork 没有记录 submodule gitlink，可以手动准备依赖：
# git clone --depth 1 https://github.com/fmtlib/fmt.git fmt
# git clone --depth 1 --branch 20220729 https://github.com/Tencent/ncnn.git ncnn
sh build.sh

go run local_server.go
```
然后打开: http://localhost:8000

默认会构建全部后端。如只想构建某个后端，可以设置：

```shell
WASM_FEATURES=basic sh build.sh
WASM_FEATURES="simd simd-threads" sh build.sh
```

公网部署时请在构建后完整复制 `web/` 目录，前端需要其中生成的 `.wasm`、`.js`、
worker 文件以及 `web/models/` 模型文件。模型会按当前选择通过普通 HTTP 缓存按需加载，
不再打包进一个 `.data` 文件。仍建议配置 COOP/COEP 响应头，这样支持线程的浏览器可以
使用最快的 `simd-threads` 后端；如果没有这些响应头，页面会尝试使用较慢的单线程后端。

发布前建议运行：

```shell
npm run check:deploy
```

推荐的 COOP/COEP 响应头、`.wasm` MIME 类型、缓存头，以及 Nginx/Apache 示例见
`docs/deployment.md`。

发布重新构建的 runtime、worker 或模型资源时，请同步递增 `web/index.html` 里的
`APP_VERSION`，确保浏览器请求新的 `?v=` 资源地址，而不是继续使用旧缓存。

注意：请固定使用 ncnn `20220729`。较新的 ncnn 版本可能能编译通过，但会导致旧
Real-CUGAN 模型输出雪花、彩色条纹或错位图像。

# 性能测量

构建完成后，可以用下面的命令测量代表性峰值内存：

```shell
node tests/measure-peak-memory.cjs --backend basic
```

脚本也支持 `--backend simd`、`--backend simd-threads` 和 `--json`。当前 1080p、
1440p、4K 的缓冲区基线和测量说明见 `docs/performance-memory.md`。

运行时线程数和 tile 大小矩阵可以用下面的命令测量：

```shell
node tests/benchmark-runtime-settings.cjs --backend simd-threads
```

自适应默认值和 benchmark 矩阵见 `docs/runtime-settings.md`。

更多实现和 benchmark 记录：

- `docs/worker-architecture.md`：worker 消息协议和取消行为。
- `docs/performance-memory.md`：峰值内存测量说明。
- `docs/performance-cleanup.md`：`-flto` 和 `emmalloc` benchmark 结果。

快速 smoke 检查：

```shell
node tests/backend-smoke.cjs basic
node tests/backend-smoke.cjs simd
node tests/backend-smoke.cjs simd-threads
```

# 致谢

本 fork 基于原项目
[hanFengSan/realcugan-ncnn-webassembly](https://github.com/hanFengSan/realcugan-ncnn-webassembly)。
