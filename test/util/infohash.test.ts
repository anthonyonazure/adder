import { describe, it, expect, beforeAll } from "vitest";
import { createHash, webcrypto } from "node:crypto";
import { infoHashFromMagnet, infoHashFromTorrentBytes, bytesToHex } from "../../src/util/infohash";

// The SUT uses the global Web Crypto (available in service workers / extension
// pages). jsdom doesn't provide subtle crypto, so back it with Node's.
beforeAll(() => {
    if (!(globalThis as any).crypto?.subtle) {
        (globalThis as any).crypto = webcrypto;
    }
});

const enc = (s: string) => new TextEncoder().encode(s);

describe("infoHashFromMagnet", () => {
    it("returns a 40-char hex btih lowercased", () => {
        const hash = "ABCDEF0123456789ABCDEF0123456789ABCDEF01";
        expect(infoHashFromMagnet(`magnet:?xt=urn:btih:${hash}&dn=x`)).toBe(hash.toLowerCase());
    });

    it("decodes a 32-char base32 btih to hex", () => {
        // Base32 of 20 zero bytes is "AAAA...A" (32 A's) -> 40 hex zeros.
        expect(infoHashFromMagnet("magnet:?xt=urn:btih:" + "A".repeat(32))).toBe("0".repeat(40));
    });

    it("returns null when there is no btih parameter", () => {
        expect(infoHashFromMagnet("magnet:?dn=NoHashHere")).toBeNull();
    });

    it("returns null for a v2 (btmh) magnet", () => {
        expect(infoHashFromMagnet("magnet:?xt=urn:btmh:1220abcd")).toBeNull();
    });

    it("returns null for a malformed hash length", () => {
        expect(infoHashFromMagnet("magnet:?xt=urn:btih:tooshort")).toBeNull();
    });
});

describe("infoHashFromTorrentBytes", () => {
    it("hashes exactly the raw info dict bytes", async () => {
        const info = "d6:lengthi12e4:name4:teste";
        // info is not the first key, and there is a key after it, to exercise the scanner.
        const torrent = `d8:announce13:udp://tr/12344:info${info}e`;
        const expected = createHash("sha1").update(Buffer.from(info, "ascii")).digest("hex");
        expect(await infoHashFromTorrentBytes(enc(torrent))).toBe(expected);
    });

    it("returns null when the buffer is not a bencoded dict", async () => {
        expect(await infoHashFromTorrentBytes(enc("not a torrent"))).toBeNull();
    });

    it("returns null when there is no info key", async () => {
        expect(await infoHashFromTorrentBytes(enc("d4:name4:teste"))).toBeNull();
    });
});

describe("bytesToHex", () => {
    it("zero-pads each byte to two hex chars", () => {
        expect(bytesToHex(new Uint8Array([0, 15, 255, 16]))).toBe("000fff10");
    });
});
