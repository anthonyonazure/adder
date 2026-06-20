import { Torrent, TorrentUploadConfig } from "../models/torrent";
import { DiscoveryResult, TorrentAddingResult, TorrentWebUI } from "../models/webui";

// Column positions in ruTorrent's httprpc "list" response. The label (custom1)
// has lived at index 14 for many years and is stable; the directory column has
// drifted across versions, so we read it defensively and only trust path-shaped
// values (see discover()).
const HTTPRPC_LABEL_INDEX = 14;
const HTTPRPC_DIRECTORY_INDEX = 25;

export class RuTorrentWebUI extends TorrentWebUI {
    public override async sendTorrent(torrent: Torrent, config: TorrentUploadConfig): Promise<TorrentAddingResult> {
        return new Promise((resolve, reject) => {
            const url = this.createRutorrentBaseUrl(config);
            let payload: string | FormData;
            let headers: Record<string, string> = {};

            if (torrent.isMagnet) {
                payload = this.createPayloadForMagnet(torrent.data as string);
                headers = { "Content-Type": "application/x-www-form-urlencoded" };
            } else {
                payload = this.createPayloadForTorrent(torrent, config);
            }

            this.sendRequest(url, payload, headers, resolve, reject);
        });
    }

    createRutorrentBaseUrl(config: TorrentUploadConfig): string {
        const targetDir = this.getDirectory(config);
        const targetLabel = this.getLabel(config);
        const addPaused = this.getAddPaused(config);
        return [
            this.createBaseUrl(),
            "/php/addtorrent.php?",
            targetDir ? `dir_edit=${encodeURIComponent(targetDir)}&` : "",
            targetLabel ? `label=${encodeURIComponent(targetLabel)}&` : "",
            addPaused ? "torrents_start_stopped=1&" : "",
            this._settings.clientSpecificSettings["dontAddNamePath"] ? "not_add_path=1&" : "", // TODO: what
        ].join("");
    }

    createPayloadForMagnet(magnetUri: string): string {
        return `url=${encodeURIComponent(magnetUri)}`;
    }

    createPayloadForTorrent(torrent: Torrent, config: TorrentUploadConfig): FormData {
        const message = new FormData();

        const dir = this.getDirectory(config);
        if (dir) {
            message.append("dir_edit", dir);
        }

        const label = this.getLabel(config);
        if (label) {
            message.append("label", label);
        }

        const blobData = new Blob([torrent.data], { type: "application/x-bittorrent" });
        const filename = torrent.name;
        message.append("torrent_file", blobData, filename);

        return message;
    }

    sendRequest(url: string, payload: string | FormData, headers: Record<string, string>, resolve: (result: TorrentAddingResult) => void, reject: (error: TorrentAddingResult) => void): void {
        this.fetch(url, {
            method: 'POST',
            headers: headers,
            body: payload
        }).then(async (response) => {
            const responseBody = await response.text();
            if (/.*result\[\]=Success.*/.exec(response.url) || /.*addTorrentSuccess.*/.exec(responseBody)) {
                resolve({ success: true, httpResponseCode: response.status, httpResponseBody: responseBody });
                return;
            }
            reject({ success: false, httpResponseCode: response.status, httpResponseBody: responseBody });
        }).catch(error => {
            reject({ success: false, httpResponseCode: 0, httpResponseBody: error.message || null });
        });
    }

    get isLabelSupported(): boolean {
        return true;
    }

    get isDirSupported(): boolean {
        return true;
    }

    get isAddPausedSupported(): boolean {
        return true;
    }

    public override async discover(): Promise<DiscoveryResult> {
        const url = this.createBaseUrl() + "/plugins/httprpc/action.php";
        let response: Response;
        try {
            response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: "mode=list",
            });
        } catch (error) {
            return this.discoveryFailure(`Couldn't reach ruTorrent: ${(error as Error)?.message ?? error}`);
        }

        if (!response.ok) {
            return this.discoveryFailure(`ruTorrent returned HTTP ${response.status}. Check the URL and credentials.`);
        }

        let json: any;
        try {
            json = JSON.parse(await response.text());
        } catch {
            return this.discoveryFailure("Connected, but ruTorrent's response wasn't valid JSON (wrong path?).");
        }

        const torrents = json?.t ?? {};
        const labels = new Set<string>();
        const dirs = new Set<string>();

        for (const hash of Object.keys(torrents)) {
            const row = torrents[hash];
            if (!Array.isArray(row)) {
                continue;
            }
            const label = this.decodeRutorrentField(row[HTTPRPC_LABEL_INDEX]);
            if (label) {
                labels.add(label);
            }
            const directory = this.decodeRutorrentField(row[HTTPRPC_DIRECTORY_INDEX]);
            // Only trust absolute-path-looking values; the column index can drift.
            if (directory && directory.startsWith("/")) {
                dirs.add(this.parentDirectory(directory));
            }
        }

        const sortedLabels = [...labels].sort();
        const sortedDirs = [...dirs].sort();
        return {
            connected: true,
            supportsLabels: true,
            supportsDirs: true,
            labels: sortedLabels,
            dirs: sortedDirs,
            message: `Imported ${sortedLabels.length} label(s) and ${sortedDirs.length} director${sortedDirs.length === 1 ? "y" : "ies"}.`,
        };
    }

    private decodeRutorrentField(value: unknown): string {
        if (typeof value !== "string" || value.length === 0) {
            return "";
        }
        try {
            return decodeURIComponent(value);
        } catch {
            return value;
        }
    }

    // A torrent's directory is "<basePath>/<torrentName>"; the useful import is
    // the parent download folder, so drop the final path segment.
    private parentDirectory(directory: string): string {
        const trimmed = directory.replace(/\/+$/, "");
        const lastSlash = trimmed.lastIndexOf("/");
        return lastSlash > 0 ? trimmed.slice(0, lastSlash) : trimmed;
    }

    private discoveryFailure(error: string): DiscoveryResult {
        return { connected: false, supportsLabels: true, supportsDirs: true, labels: [], dirs: [], error };
    }
}
