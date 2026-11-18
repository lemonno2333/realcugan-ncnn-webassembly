(function (root) {
    const manifest = {
        version: '2026.11.18-denoise.2',
        files: [
            {name: 'realesrgan-x4plus-anime.param', bytes: 30290,
                sha256: '2b8fb6e0ae4d2d85704ca08c119a2f5ea40add4f2ecd512eb7f4cd44b6127ed4'},
            {name: 'realesrgan-x4plus-anime.bin', bytes: 8943500,
                sha256: 'fe01c269cfd10cdef8e018ab66ebe750cf79c7af4d1f9c16c737e1295229bacc'}
        ]
    };
    root.GPTDenoiseModels = manifest;
    if (typeof module === 'object' && module.exports) module.exports = manifest;
})(typeof self !== 'undefined' ? self : globalThis);
