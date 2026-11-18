# Real-ESRGAN anime-6B model

`realesrgan-x4plus-anime.param` / `.bin` are the official ncnn export of
`RealESRGAN_x4plus_anime_6B`, from the upstream v0.2.5.0 Linux distribution.
Prepared at build time by `scripts/prepare-denoise-model.py`, with archive and
individual-file SHA-256 checks. Do not substitute the anime-video-v3 model.

Source: https://github.com/xinntao/Real-ESRGAN/releases/tag/v0.2.5.0
License: BSD-3-Clause; see `LICENSE`. The ncnn weight storage is FP16; inference
uses FP32. This is not guaranteed to be bit-identical to PyTorch FP32 weights.

The graph's input, trunk output and final output blobs are `data`, `501`,
`output`. `denoise.cpp` relies on this pinned graph to split the high-memory tail.
