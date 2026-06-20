import { describe, it, expect } from "vitest";
import { RuTorrentWebUI } from "../../src/webuis/rutorrent-webui";
import { QBittorrentWebUI } from "../../src/webuis/qbittorrent-webui";
import { TransmissionWebUI } from "../../src/webuis/transmission-webui";
import { Client } from "../../src/models/clients";
import { makeWebUISettings } from "../helpers/fixtures";
import { mockResponse, queueFetch } from "../helpers/fetch-mock";

// Build an httprpc "list" row: an array where index 14 is the URL-encoded label
// (custom1) and index 25 is the torrent's absolute directory.
function row(label: string, directory: string): string[] {
    const arr = new Array(26).fill("");
    arr[14] = label;
    arr[25] = directory;
    return arr;
}

describe("RuTorrentWebUI.discover", () => {
    const build = () => new RuTorrentWebUI(makeWebUISettings({ client: Client.RuTorrentWebUI, host: "h", port: 443, secure: true, relativePath: "rutorrent" }));

    it("imports distinct labels (URL-decoded) and parent directories", async () => {
        queueFetch(mockResponse({
            status: 200,
            json: {
                t: {
                    h1: row("HD%20Movies", "/home/u/dl/A.Movie"),
                    h2: row("TV", "/home/u/dl/B.Show"),
                    h3: row("HD%20Movies", "/home/u/media/C.Thing"),
                    h4: row("", "/home/u/dl/D.NoLabel"),
                },
            },
        }));

        const result = await build().discover();

        expect(result.connected).toBe(true);
        expect(result.labels).toEqual(["HD Movies", "TV"]);
        expect(result.dirs).toEqual(["/home/u/dl", "/home/u/media"]);
    });

    it("posts mode=list to the httprpc action endpoint", async () => {
        const fetch = queueFetch(mockResponse({ status: 200, json: { t: {} } }));
        await build().discover();
        const [url, opts] = fetch.mock.calls[0];
        expect(url).toBe("https://h/rutorrent/plugins/httprpc/action.php");
        expect(opts.body).toBe("mode=list");
    });

    it("reports a failure when the endpoint errors", async () => {
        queueFetch(mockResponse({ status: 401, body: "denied" }));
        const result = await build().discover();
        expect(result.connected).toBe(false);
        expect(result.error).toContain("401");
    });
});

describe("QBittorrentWebUI.discover", () => {
    const build = () => new QBittorrentWebUI(makeWebUISettings({ client: Client.QBittorrentWebUI, host: "h", port: 8080 }));

    it("logs in then imports categories as labels and their save paths as dirs", async () => {
        queueFetch(
            mockResponse({ status: 200, body: "Ok." }), // auth/login
            mockResponse({
                status: 200,
                json: {
                    Movies: { name: "Movies", savePath: "/dl/movies" },
                    TV: { name: "TV", savePath: "/dl/tv" },
                    NoPath: { name: "NoPath", savePath: "" },
                },
            }),
        );

        const result = await build().discover();

        expect(result.connected).toBe(true);
        expect(result.labels).toEqual(["Movies", "NoPath", "TV"]);
        expect(result.dirs).toEqual(["/dl/movies", "/dl/tv"]);
    });

    it("reports a failure when login fails", async () => {
        queueFetch(mockResponse({ status: 403, body: "Fails." }));
        const result = await build().discover();
        expect(result.connected).toBe(false);
        expect(result.error).toContain("Login failed");
    });
});

describe("base discover (clients without an override)", () => {
    it("returns a reachability result with capability flags and no imports", async () => {
        queueFetch(mockResponse({ status: 200, body: "" }));
        const ui = new TransmissionWebUI(makeWebUISettings({ client: Client.TransmissionWebUI, host: "h", port: 9091 }));

        const result = await ui.discover();

        expect(result.connected).toBe(true);
        expect(result.supportsLabels).toBe(false);
        expect(result.supportsDirs).toBe(true);
        expect(result.labels).toEqual([]);
        expect(result.dirs).toEqual([]);
    });

    it("reports not-connected when the host is unreachable", async () => {
        queueFetch(() => { throw new Error("network down"); });
        const ui = new TransmissionWebUI(makeWebUISettings({ client: Client.TransmissionWebUI, host: "h", port: 9091 }));
        const result = await ui.discover();
        expect(result.connected).toBe(false);
        expect(result.error).toBeTruthy();
    });
});
