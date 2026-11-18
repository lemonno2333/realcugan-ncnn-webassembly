cmake_minimum_required(VERSION 3.10)

project(realcugan-ncnn-webassembly)

option(LOCAL_DEBUG "debug" OFF)

set(CMAKE_BUILD_TYPE release)

if(NOT WASM_FEATURE)
    message(FATAL_ERROR "You must pass cmake option -DWASM_FEATURE and possible values are basic, simd, threads and simd-threads")
endif()

if (NOT LOCAL_DEBUG)
    # Reused browser modules must keep their models and pthread worker alive.
    set(CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} -s FORCE_FILESYSTEM=1 -sALLOW_MEMORY_GROWTH -sEXIT_RUNTIME=0 -sDISABLE_EXCEPTION_CATCHING=0")

    set(CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} -sEXPORTED_FUNCTIONS=['_process_image','_cancel_process','_get_task_state','_malloc','_free'] -sEXPORTED_RUNTIME_METHODS=['FS_createDataFile','FS_createPath','FS_unlink']")

    set(CMAKE_CXX_FLAGS_RELEASE "-O3 -fexceptions")
endif()

if(${WASM_FEATURE} MATCHES "simd")
    set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -msimd128")
    set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -msimd128")
    set(CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} -msimd128")
endif()

if(${WASM_FEATURE} MATCHES "threads")
    add_compile_definitions(REALCUGAN_USE_PTHREADS=1)
    set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -pthread -s USE_PTHREADS=1 -matomics -mbulk-memory")
    set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -pthread -s USE_PTHREADS=1 -matomics -mbulk-memory")
    set(CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} -pthread -s USE_PTHREADS=1 -s PTHREAD_POOL_SIZE=4 -matomics -mbulk-memory")
endif()

add_subdirectory(fmt)
add_subdirectory(ncnn)

add_executable(realcugan-ncnn-webassembly-${WASM_FEATURE} main.cpp realcugan.cpp)
set_property(TARGET realcugan-ncnn-webassembly-${WASM_FEATURE} PROPERTY CXX_STANDARD 11)
target_link_libraries(realcugan-ncnn-webassembly-${WASM_FEATURE} ncnn fmt)

# GPT denoising runs inside a dedicated single-thread Worker; COOP/COEP is not required.
if(WASM_FEATURE STREQUAL "basic" OR WASM_FEATURE STREQUAL "simd")
    add_executable(gpt-denoise-${WASM_FEATURE} denoise.cpp)
    target_link_libraries(gpt-denoise-${WASM_FEATURE} ncnn)
    set_property(TARGET gpt-denoise-${WASM_FEATURE} PROPERTY CXX_STANDARD 11)
    # Override the Real-CUGAN ABI flags inherited above: this module has no main().
    set_property(TARGET gpt-denoise-${WASM_FEATURE} PROPERTY LINK_FLAGS
        "--no-entry -sMODULARIZE=1 -sEXPORT_NAME=createDenoiseModule -sENVIRONMENT=worker -sEXIT_RUNTIME=0 -sEXPORTED_FUNCTIONS=['_denoise_load_model','_denoise_tile','_malloc','_free'] -sEXPORTED_RUNTIME_METHODS=['FS','UTF8ToString']")
endif()
