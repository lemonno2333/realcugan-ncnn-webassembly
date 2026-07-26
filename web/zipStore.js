// Minimal store-only (no compression) ZIP writer for the static Real-CUGAN
// web app. PNG output is already compressed, so deflating again would waste
// CPU for ~0% size gain; "store" keeps this dependency-free.
(function (root) {
    const CRC_TABLE = (() => {
        const table = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) {
                c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            }
            table[n] = c >>> 0;
        }
        return table;
    })();

    function crc32(bytes) {
        let crc = 0xffffffff;
        for (let i = 0; i < bytes.length; i++) {
            crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
        }
        return (crc ^ 0xffffffff) >>> 0;
    }

    function dosDateTime(date) {
        const time = ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | ((date.getSeconds() / 2) & 31);
        const day = (((date.getFullYear() - 1980) & 127) << 9) | (((date.getMonth() + 1) & 15) << 5) | (date.getDate() & 31);
        return {time, day};
    }

    // entries: [{name: string, bytes: Uint8Array}]. Returns a Blob.
    // Filenames are encoded as UTF-8 with the language-encoding flag set.
    function buildStoreZip(entries, date) {
        const encoder = new TextEncoder();
        const {time, day} = dosDateTime(date || new Date());
        const localParts = [];
        const centralParts = [];
        let offset = 0;

        entries.forEach((entry) => {
            const nameBytes = encoder.encode(entry.name);
            const bytes = entry.bytes;
            const crc = crc32(bytes);

            const local = new DataView(new ArrayBuffer(30));
            local.setUint32(0, 0x04034b50, true);
            local.setUint16(4, 20, true);            // version needed
            local.setUint16(6, 0x0800, true);        // UTF-8 filename flag
            local.setUint16(8, 0, true);             // method: store
            local.setUint16(10, time, true);
            local.setUint16(12, day, true);
            local.setUint32(14, crc, true);
            local.setUint32(18, bytes.length, true); // compressed size
            local.setUint32(22, bytes.length, true); // uncompressed size
            local.setUint16(26, nameBytes.length, true);
            local.setUint16(28, 0, true);            // extra length
            localParts.push(local.buffer, nameBytes, bytes);

            const central = new DataView(new ArrayBuffer(46));
            central.setUint32(0, 0x02014b50, true);
            central.setUint16(4, 20, true);          // version made by
            central.setUint16(6, 20, true);          // version needed
            central.setUint16(8, 0x0800, true);
            central.setUint16(10, 0, true);
            central.setUint16(12, time, true);
            central.setUint16(14, day, true);
            central.setUint32(16, crc, true);
            central.setUint32(20, bytes.length, true);
            central.setUint32(24, bytes.length, true);
            central.setUint16(28, nameBytes.length, true);
            central.setUint32(42, offset, true);     // local header offset
            centralParts.push(central.buffer, nameBytes);

            offset += 30 + nameBytes.length + bytes.length;
        });

        const centralSize = centralParts.reduce((sum, part) => sum + (part.byteLength || part.length), 0);
        const end = new DataView(new ArrayBuffer(22));
        end.setUint32(0, 0x06054b50, true);
        end.setUint16(8, entries.length, true);
        end.setUint16(10, entries.length, true);
        end.setUint32(12, centralSize, true);
        end.setUint32(16, offset, true);
        return new Blob([...localParts, ...centralParts, end.buffer], {type: 'application/zip'});
    }

    root.buildStoreZip = buildStoreZip;
})(typeof self !== 'undefined' ? self : window);
