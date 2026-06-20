import { describe, it, expect } from "vitest";
import { SynologyDownloadStationWebUI } from "../../src/webuis/synology-download-station-webui";
import { makeWebUISettings, makeMagnetTorrent, makeFileTorrent } from "../helpers/fixtures";
import { mockResponse, queueFetch } from "../helpers/fetch-mock";

const build = (over = {}) =>
    new SynologyDownloadStationWebUI(makeWebUISettings({ host: "nas", port: 5000, username: "u", password: "p", ...over }));
const loginOk = () => mockResponse({ status: 200, json: { success: true, data: { sid: "sid-1" } } });

describe("SynologyDownloadStationWebUI", () => {
    it("logs in for a sid then creates a magnet task via uri", async () => {
        const fetch = queueFetch(loginOk(), mockResponse({ status: 200, json: { success: true } }));
        const result = await build().sendTorrent(makeMagnetTorrent(), {});

        expect(result.success).toBe(true);
        const loginUrl = fetch.mock.calls[0][0] as string;
        expect(loginUrl).toContain("http://nas:5000/webapi/auth.cgi?");
        expect(loginUrl).toContain("api=SYNO.API.Auth");
        expect(loginUrl).toContain("account=u");
        expect(loginUrl).toContain("session=DownloadStation");

        const [taskUrl, taskOpts] = fetch.mock.calls[1];
        expect(taskUrl).toBe("http://nas:5000/webapi/DownloadStation/task.cgi");
        const body = taskOpts.body as FormData;
        expect(body.get("api")).toBe("SYNO.DownloadStation.Task");
        expect(body.get("method")).toBe("create");
        expect(body.get("_sid")).toBe("sid-1");
        expect(body.get("uri")).toBe("magnet:?xt=urn:btih:abc123&dn=Cool+Torrent");
    });

    it("uploads a .torrent file via the file field and sets destination without a leading slash", async () => {
        const fetch = queueFetch(loginOk(), mockResponse({ status: 200, json: { success: true } }));
        await build().sendTorrent(makeFileTorrent(), { dir: "/video/movies" });

        const body = fetch.mock.calls[1][1].body as FormData;
        expect(body.get("file")).toBeInstanceOf(Blob);
        expect(body.get("destination")).toBe("video/movies");
        expect(body.get("uri")).toBeNull();
    });

    it("rejects when login does not succeed", async () => {
        queueFetch(mockResponse({ status: 200, json: { success: false, error: { code: 400 } } }));
        await expect(build().sendTorrent(makeMagnetTorrent(), {})).rejects.toMatchObject({ success: false });
    });

    it("rejects when create returns success:false", async () => {
        queueFetch(loginOk(), mockResponse({ status: 200, json: { success: false, error: { code: 403 } } }));
        await expect(build().sendTorrent(makeMagnetTorrent(), {})).rejects.toMatchObject({ success: false });
    });

    it("supports dirs only (no labels, no add-paused)", () => {
        const ui = build();
        expect(ui.isLabelSupported).toBe(false);
        expect(ui.isDirSupported).toBe(true);
        expect(ui.isAddPausedSupported).toBe(false);
    });
});
