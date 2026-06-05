# RealCUGAN-ncnn-webassembly
本项目使用 WebAssembly 技术，基于 ncnn 运行 Real-CUGAN 模型。目前使用 CPU
进行计算，在浏览器本地完成图片处理，不会上传图片到服务器。

本 fork 保留仓库内现有的 ncnn 模型文件，不需要重新转换或生成模型。构建会产出
`simd-threads`、`simd` 和 `basic` 三个 WebAssembly 后端，浏览器会优先使用最快的
`simd-threads`，不支持 pthread/SharedArrayBuffer 时会自动降级到单线程 CPU 后端。

网页前端也做了更新，方便本地查看图片细节：

- 固定页头/页脚的工具式布局，工作区留给图片预览；
- 参考 Material Design Monet，从上传图片中提取主题色并应用到界面；
- 只保留叠图对比模式，分割线以预览窗格相对位置计算；
- 支持受限范围内的放大、缩小、滚轮缩放和鼠标拖拽平移；
- 上传或处理完图片后，可以用“复位”清空当前结果并处理下一张图片。

[Real-CUGAN](https://github.com/bilibili/ailab/tree/main/Real-CUGAN) 是一个使用百万级动漫数据进行训练的，结构与Waifu2x兼容的通用动漫图像超分辨率模型。它支持2x\3x\4x倍超分辨率，其中2倍模型支持4种降噪强度与保守修复，3倍/4倍模型支持2种降噪强度与保守修复。

代码实现上深度参考了nihui大佬的[realcugan-ncnn-vulkan](https://github.com/nihui/realcugan-ncnn-vulkan)和[ncnn-webassembly-nanodet](https://github.com/nihui/ncnn-webassembly-nanodet)

# 使用
网站地址： https://real-cugan.animesales.xyz/

目前不支持iOS，Android请在独立浏览器内打开，PC推荐使用最新版本的Chrome或Firefox。

# How to build
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
`.data` 和 worker 文件。仍建议配置 COOP/COEP 响应头，这样支持线程的浏览器可以
使用最快的 `simd-threads` 后端；如果没有这些响应头，页面会尝试使用较慢的单线程后端。

注意：请固定使用 ncnn `20220729`。较新的 ncnn 版本可能能编译通过，但会导致旧
Real-CUGAN 模型输出雪花、彩色条纹或错位图像。

# 致谢

本 fork 基于原项目
[hanFengSan/realcugan-ncnn-webassembly](https://github.com/hanFengSan/realcugan-ncnn-webassembly)。
