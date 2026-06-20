import { Torrent, TorrentUploadConfig } from "../models/torrent";
import { TorrentAddingResult, TorrentWebUI } from "../models/webui";

// Synology DiskStation "Download Station" client, talking to the documented
// DSM WebAPI (DSM 6.2+/7). Flow mirrors the QNAP client: authenticate once for a
// session id (sid), then create a download task from a magnet/URL or an uploaded
// .torrent file. Download Station has no label/category concept, so only a
// destination shared-folder path is supported (e.g. "video/movies", no leading
// slash). Paused-on-add is not offered by the classic create API.
//
// Endpoints used:
//   GET  /webapi/auth.cgi              api=SYNO.API.Auth         method=login
//   POST /webapi/DownloadStation/task.cgi  api=SYNO.DownloadStation.Task method=create
const AUTH_API = "SYNO.API.Auth";
const AUTH_VERSION = "3";
const TASK_API = "SYNO.DownloadStation.Task";
const TASK_VERSION = "3";

export class SynologyDownloadStationWebUI extends TorrentWebUI {
    public override async sendTorrent(torrent: Torrent, config: TorrentUploadConfig): Promise<TorrentAddingResult> {
        return new Promise((resolve, reject) => {
            this.fetchSessionId()
                .then(sessionId => this.createTorrentFetchOptions(sessionId, torrent, config))
                .then(fetchOptions => this.sendRequest(this.createTaskUrl(), fetchOptions, resolve, reject))
                .catch(reject);
        });
    }

    private createTaskUrl(): string {
        return this.createBaseUrl() + "/webapi/DownloadStation/task.cgi";
    }

    private fetchSessionId(): Promise<string> {
        return new Promise((resolve, reject) => {
            const params = new URLSearchParams({
                api: AUTH_API,
                version: AUTH_VERSION,
                method: "login",
                account: this.settings.username,
                passwd: this.settings.password,
                session: "DownloadStation",
                format: "sid",
            });
            const loginUrl = this.createBaseUrl() + "/webapi/auth.cgi?" + params.toString();

            fetch(loginUrl, { method: "GET" })
                .then(async (response) => {
                    const responseJson = await response.json();
                    if (response.status === 200 && responseJson["success"] === true && responseJson["data"]?.["sid"]) {
                        resolve(responseJson["data"]["sid"]);
                        return;
                    }
                    reject({ success: false, httpResponseCode: response.status, httpResponseBody: JSON.stringify(responseJson) });
                })
                .catch(error => {
                    reject({ success: false, httpResponseCode: 0, httpResponseBody: error.message || null });
                });
        });
    }

    private createTorrentFetchOptions(sessionId: string, torrent: Torrent, config: TorrentUploadConfig): Promise<RequestInit> {
        return new Promise(async (resolve) => {
            const payload = new FormData();
            payload.append("api", TASK_API);
            payload.append("version", TASK_VERSION);
            payload.append("method", "create");
            payload.append("_sid", sessionId);

            const dir = this.getDirectory(config);
            if (dir) {
                // Synology wants a shared-folder-relative path with no leading slash.
                payload.append("destination", dir.replace(/^\/+/, ""));
            }

            if (torrent.isMagnet) {
                payload.append("uri", torrent.data as string);
            } else {
                payload.append("file", new Blob([await (torrent.data as Blob).arrayBuffer()], { type: "application/x-bittorrent" }), torrent.name);
            }

            resolve({
                method: "POST",
                body: payload,
            } as RequestInit);
        });
    }

    private sendRequest(url: string, fetchOptions: RequestInit, resolve: (result: TorrentAddingResult) => void, reject: (error: TorrentAddingResult) => void): void {
        this.fetch(url, fetchOptions).then(async (response) => {
            const responseText = await response.text();
            if (response.status === 200) {
                const responseJson = JSON.parse(responseText);
                if (responseJson["success"] === true) {
                    resolve({ success: true, httpResponseCode: response.status, httpResponseBody: responseText });
                    return;
                }
            }
            reject({ success: false, httpResponseCode: response.status, httpResponseBody: responseText });
        }).catch(error => {
            reject({ success: false, httpResponseCode: 0, httpResponseBody: error.message || null });
        });
    }

    get isLabelSupported(): boolean {
        return false;
    }

    get isDirSupported(): boolean {
        return true;
    }

    get isAddPausedSupported(): boolean {
        return false;
    }
}
