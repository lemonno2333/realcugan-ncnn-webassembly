#!/bin/sh

set -eu

JOBS="${JOBS:-4}"
FEATURES="${WASM_FEATURES:-basic simd simd-threads}"
NCNN_TAG="${NCNN_TAG:-20220729}"
: "${EMSDK:?EMSDK is not set. Run: source /path/to/emsdk/emsdk_env.sh}"
TOOLCHAIN_FILE="${EMSDK}/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake"

if [ ! -d ./fmt ] || [ ! -d ./ncnn ]; then
    echo "Missing dependencies: ./fmt and/or ./ncnn"
    echo "Run: git submodule update --init --recursive"
    echo "Or clone them manually if this fork does not contain submodule gitlinks:"
    echo "  git clone --depth 1 https://github.com/fmtlib/fmt.git fmt"
    echo "  git clone --depth 1 https://github.com/Tencent/ncnn.git ncnn"
    exit 1
fi

if [ -d ./ncnn/.git ]; then
    current_ncnn_tag="$(git -c safe.directory="$(pwd)/ncnn" -C ./ncnn describe --tags --always 2>/dev/null || true)"
    if [ "${current_ncnn_tag}" != "${NCNN_TAG}" ]; then
        echo "ncnn version mismatch: expected ${NCNN_TAG}, got ${current_ncnn_tag}"
        echo "Run: git -C ncnn fetch --depth 1 origin tag ${NCNN_TAG}"
        echo "Then: git -C ncnn checkout ${NCNN_TAG}"
        exit 1
    fi
fi

mkdir -p ./build ./web
cp -R ./models/. ./web

for feature in ${FEATURES}; do
    build_dir="./build/${feature}"
    mkdir -p "${build_dir}"

    threads=OFF
    sse2=OFF
    if [ "${feature}" = "simd" ] || [ "${feature}" = "simd-threads" ]; then
        sse2=ON
    fi
    if [ "${feature}" = "simd-threads" ]; then
        threads=ON
    fi

    (
        cd "${build_dir}"
        cmake \
            -DCMAKE_TOOLCHAIN_FILE="${TOOLCHAIN_FILE}" \
            -DWASM_FEATURE="${feature}" \
            -DNCNN_THREADS="${threads}" \
            -DNCNN_OPENMP="${threads}" \
            -DNCNN_SIMPLEOMP="${threads}" \
            -DNCNN_RUNTIME_CPU=OFF \
            -DNCNN_SSE2="${sse2}" \
            -DNCNN_AVX2=OFF \
            -DNCNN_AVX=OFF \
            -DNCNN_BUILD_TOOLS=OFF \
            -DNCNN_BUILD_EXAMPLES=OFF \
            -DNCNN_BUILD_BENCHMARK=OFF \
            -DNCNN_TTT=ON \
            ../..
        cmake --build . --parallel "${JOBS}"
        cp realcugan-ncnn-webassembly-* ../../web
    )
done
