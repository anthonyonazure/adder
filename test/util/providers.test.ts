import { describe, it, expect } from "vitest";
import { parseRutorrentUrl, findProvider } from "../../src/util/providers";

describe("parseRutorrentUrl", () => {
    it("parses a seedbox.vip HTTPS ruTorrent URL", () => {
        expect(parseRutorrentUrl("https://193-39-142-97.a.seedbox.vip/rutorrent/")).toEqual({
            host: "193-39-142-97.a.seedbox.vip",
            port: 443,
            secure: true,
            relativePath: "rutorrent",
        });
    });

    it("keeps a username-prefixed path (Feral-style)", () => {
        expect(parseRutorrentUrl("https://host.feralhosting.com/bob/rutorrent/")).toEqual({
            host: "host.feralhosting.com",
            port: 443,
            secure: true,
            relativePath: "bob/rutorrent",
        });
    });

    it("uses the explicit port when present", () => {
        expect(parseRutorrentUrl("http://10.0.0.5:8080/rutorrent/")).toEqual({
            host: "10.0.0.5",
            port: 8080,
            secure: false,
            relativePath: "rutorrent",
        });
    });

    it("defaults the port to 80 for plain HTTP", () => {
        expect(parseRutorrentUrl("http://nas.local/rutorrent")?.port).toBe(80);
    });

    it("returns null for non-ruTorrent URLs", () => {
        expect(parseRutorrentUrl("https://www.torrentday.com/browse.php")).toBeNull();
        expect(parseRutorrentUrl("chrome://extensions")).toBeNull();
        expect(parseRutorrentUrl("not a url")).toBeNull();
    });
});

describe("findProvider", () => {
    it("returns the seedbox.vip preset with HTTPS + rutorrent path", () => {
        const p = findProvider("seedbox.vip");
        expect(p?.port).toBe(443);
        expect(p?.secure).toBe(true);
        expect(p?.relativePath).toBe("rutorrent");
    });

    it("returns undefined for an unknown id", () => {
        expect(findProvider("nope")).toBeUndefined();
    });
});
