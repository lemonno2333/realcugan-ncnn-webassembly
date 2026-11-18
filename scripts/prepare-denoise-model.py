#!/usr/bin/env python3
"""Extract the pinned official anime-6B ncnn model. No Python runtime is deployed."""
import hashlib
import io
import os
from pathlib import Path
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
URL = ('https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/'
       'realesrgan-ncnn-vulkan-20220424-ubuntu.zip')
ARCHIVE_SHA = 'e5aa6eb131234b87c0c51f82b89390f5e3e642b7b70f2b9bbe95b6a285a40c96'
FILES = {
    'realesrgan-x4plus-anime.param': ('2b8fb6e0ae4d2d85704ca08c119a2f5ea40add4f2ecd512eb7f4cd44b6127ed4', 30290),
    'realesrgan-x4plus-anime.bin': ('fe01c269cfd10cdef8e018ab66ebe750cf79c7af4d1f9c16c737e1295229bacc', 8943500),
}


def main():
    folder = ROOT / 'models' / 'esrgan'
    folder.mkdir(parents=True, exist_ok=True)
    if all((folder / name).is_file() and
           hashlib.sha256((folder / name).read_bytes()).hexdigest() == digest
           for name, (digest, _) in FILES.items()):
        return
    # curl uses the OS trust store (and respects HTTPS proxies) on build machines.
    override = os.environ.get('DENOISE_MODEL_ARCHIVE')
    if override:
        data = Path(override).read_bytes()
    else:
        with tempfile.TemporaryDirectory() as temp:
            archive = Path(temp) / 'model.zip'
            subprocess.run(['curl', '-fL', '--retry', '3', '--max-time', '300',
                            '-o', str(archive), URL], check=True)
            data = archive.read_bytes()
    if hashlib.sha256(data).hexdigest() != ARCHIVE_SHA:
        raise RuntimeError('Official model archive checksum mismatch')
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        for name, (digest, size) in FILES.items():
            contents = archive.read('models/' + name)
            if len(contents) != size or hashlib.sha256(contents).hexdigest() != digest:
                raise RuntimeError('Model checksum mismatch: ' + name)
            # Atomic replacement: an interrupted build never leaves a partial weight file.
            target = folder / name
            temporary = target.with_suffix(target.suffix + '.tmp')
            temporary.write_bytes(contents)
            temporary.replace(target)
    print('Prepared Real-ESRGAN anime-6B model in models/esrgan/')


if __name__ == '__main__':
    main()
