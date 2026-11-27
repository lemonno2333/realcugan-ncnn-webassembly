(function (root) {
    const manifest = {
        version: '2026.11.18-denoise.3',
        files: [
            {name: 'realesrgan-x4plus-anime.param', bytes: 30290,
                sha256: '2b8fb6e0ae4d2d85704ca08c119a2f5ea40add4f2ecd512eb7f4cd44b6127ed4'},
            {name: 'realesrgan-x4plus-anime.bin', bytes: 8943500,
                sha256: 'fe01c269cfd10cdef8e018ab66ebe750cf79c7af4d1f9c16c737e1295229bacc'}
        ],
        cuganFiles: [
            {name: 'up2x-denoise3x.param', bytes: 4761,
                sha256: '4b3b5c5710ad1d00503c8243417aa75f13fe497723e8b4952e8b1abfc08f9b84'},
            {name: 'up2x-denoise3x.bin', bytes: 2573648,
                sha256: '610ebae63f388fe6f39615cc5f4eaeb038d5aa6ba8b299ba3b989f7f7a1a280a'}
        ]
    };
    root.GPTDenoiseModels = manifest;
    if (typeof module === 'object' && module.exports) module.exports = manifest;
})(typeof self !== 'undefined' ? self : globalThis);
