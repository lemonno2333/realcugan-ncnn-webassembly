// Model file manifest for the static Real-CUGAN web app.
window.MODEL_FILES = {
        se: {
            '-1': {
                2: {param: 'up2x-conservative.param', bin: 'up2x-conservative.bin', paramBytes: 4818, binBytes: 2573648},
                3: {param: 'up3x-conservative.param', bin: 'up3x-conservative.bin', paramBytes: 4761, binBytes: 2577104},
                4: {param: 'up4x-conservative.param', bin: 'up4x-conservative.bin', paramBytes: 5018, binBytes: 2818348},
            },
            0: {
                2: {param: 'up2x-no-denoise.param', bin: 'up2x-no-denoise.bin', paramBytes: 4818, binBytes: 2573648},
                3: {param: 'up3x-no-denoise.param', bin: 'up3x-no-denoise.bin', paramBytes: 4761, binBytes: 2577104},
                4: {param: 'up4x-no-denoise.param', bin: 'up4x-no-denoise.bin', paramBytes: 5018, binBytes: 2818348},
            },
            1: {
                2: {param: 'up2x-denoise1x.param', bin: 'up2x-denoise1x.bin', paramBytes: 4761, binBytes: 2573648},
            },
            2: {
                2: {param: 'up2x-denoise2x.param', bin: 'up2x-denoise2x.bin', paramBytes: 4761, binBytes: 2573648},
            },
            3: {
                2: {param: 'up2x-denoise3x.param', bin: 'up2x-denoise3x.bin', paramBytes: 4818, binBytes: 2573648},
                3: {param: 'up3x-denoise3x.param', bin: 'up3x-denoise3x.bin', paramBytes: 4818, binBytes: 2577104},
                4: {param: 'up4x-denoise3x.param', bin: 'up4x-denoise3x.bin', paramBytes: 5018, binBytes: 2818348},
            },
        },
        pro: {
            '-1': {
                2: {param: 'models-pro/up2x-conservative.param', bin: 'models-pro/up2x-conservative.bin', paramBytes: 4765, binBytes: 2573648},
                3: {param: 'models-pro/up3x-conservative.param', bin: 'models-pro/up3x-conservative.bin', paramBytes: 4765, binBytes: 2577104},
            },
            0: {
                2: {param: 'models-pro/up2x-no-denoise.param', bin: 'models-pro/up2x-no-denoise.bin', paramBytes: 4765, binBytes: 2573648},
                3: {param: 'models-pro/up3x-no-denoise.param', bin: 'models-pro/up3x-no-denoise.bin', paramBytes: 4765, binBytes: 2577104},
            },
            3: {
                2: {param: 'models-pro/up2x-denoise3x.param', bin: 'models-pro/up2x-denoise3x.bin', paramBytes: 4765, binBytes: 2573648},
                3: {param: 'models-pro/up3x-denoise3x.param', bin: 'models-pro/up3x-denoise3x.bin', paramBytes: 4765, binBytes: 2577104},
            },
        },
    };
