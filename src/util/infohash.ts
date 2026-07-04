/**
 * BitTorrent v1 infohash computation.
 *
 * Used for duplicate detection: we compute the infohash of a candidate torrent
 * and compare it against the infohashes the target client already knows about.
 *
 * - Magnet links carry the infohash in the `xt=urn:btih:` parameter (40-char hex
 *   or 32-char base32). We normalise to lowercase hex.
 * - `.torrent` files: the infohash is SHA-1 of the *raw bencoded* `info` dict.
 *   We slice the original bytes rather than re-encoding, so a torrent with
 *   non-canonical key ordering still hashes to the value trackers/clients use.
 */

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function infoHashFromMagnet(magnet: string): string | null {
    const match = magnet.match(/xt=urn:btih:([^&]+)/i);
    if (!match) {
        return null;
    }
    const raw = decodeURIComponent(match[1]).trim();
    if (/^[0-9a-fA-F]{40}$/.test(raw)) {
        return raw.toLowerCase();
    }
    if (/^[A-Za-z2-7]{32}$/.test(raw)) {
        const decoded = base32Decode(raw.toUpperCase());
        if (decoded && decoded.length === 20) {
            return bytesToHex(decoded);
        }
    }
    // v2 (urn:btmh) and malformed values are unsupported for dedup.
    return null;
}

export async function infoHashFromTorrentBytes(bytes: Uint8Array): Promise<string | null> {
    const span = findInfoDictSpan(bytes);
    if (!span) {
        return null;
    }
    const infoBytes = bytes.slice(span[0], span[1]);
    const digest = await crypto.subtle.digest("SHA-1", infoBytes);
    return bytesToHex(new Uint8Array(digest));
}

export async function infoHashFromBlob(blob: Blob): Promise<string | null> {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return infoHashFromTorrentBytes(bytes);
}

/** Locates the byte range [start, end) of the top-level `info` dict's value. */
function findInfoDictSpan(buf: Uint8Array): [number, number] | null {
    if (buf[0] !== 0x64 /* 'd' */) {
        return null;
    }
    let i = 1;
    while (i < buf.length && buf[i] !== 0x65 /* 'e' */) {
        // Dict keys are always bencoded strings: <len>:<bytes>
        if (buf[i] < 0x30 || buf[i] > 0x39) {
            return null; // malformed
        }
        let len = 0;
        while (i < buf.length && buf[i] >= 0x30 && buf[i] <= 0x39) {
            len = len * 10 + (buf[i] - 0x30);
            i++;
        }
        i++; // skip ':'
        const key = new TextDecoder().decode(buf.subarray(i, i + len));
        i += len;
        const valueStart = i;
        const valueEnd = skipBencodedValue(buf, i);
        if (key === "info") {
            return [valueStart, valueEnd];
        }
        i = valueEnd;
    }
    return null;
}

/** Returns the index just past the bencoded value that starts at `pos`. */
function skipBencodedValue(buf: Uint8Array, pos: number): number {
    const c = buf[pos];
    if (c === 0x69 /* 'i' */) {
        let i = pos + 1;
        while (i < buf.length && buf[i] !== 0x65 /* 'e' */) {
            i++;
        }
        return i + 1;
    }
    if (c === 0x6c /* 'l' */ || c === 0x64 /* 'd' */) {
        let i = pos + 1;
        while (i < buf.length && buf[i] !== 0x65 /* 'e' */) {
            i = skipBencodedValue(buf, i);
        }
        return i + 1;
    }
    if (c >= 0x30 && c <= 0x39 /* digit -> string */) {
        let i = pos;
        let len = 0;
        while (i < buf.length && buf[i] >= 0x30 && buf[i] <= 0x39) {
            len = len * 10 + (buf[i] - 0x30);
            i++;
        }
        return i + 1 + len; // skip ':' + payload
    }
    throw new Error(`Invalid bencode at offset ${pos}`);
}

function base32Decode(input: string): Uint8Array | null {
    let bits = 0;
    let value = 0;
    const out: number[] = [];
    for (const ch of input) {
        const idx = BASE32_ALPHABET.indexOf(ch);
        if (idx === -1) {
            return null;
        }
        value = (value << 5) | idx;
        bits += 5;
        if (bits >= 8) {
            out.push((value >>> (bits - 8)) & 0xff);
            bits -= 8;
        }
    }
    return new Uint8Array(out);
}

export function bytesToHex(bytes: Uint8Array): string {
    let hex = "";
    for (const b of bytes) {
        hex += b.toString(16).padStart(2, "0");
    }
    return hex;
}
