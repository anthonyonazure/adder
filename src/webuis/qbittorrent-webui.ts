import { Torrent, TorrentUploadConfig } from "../models/torrent";
import { DiscoveryResult, TorrentAddingResult, TorrentWebUI } from "../models/webui";

export class QBittorrentWebUI extends TorrentWebUI {
    public override async sendTorrent(torrent: Torrent, config: TorrentUploadConfig): Promise<TorrentAddingResult> {
        return new Promise((resolve, reject) => {
            const url = this.createBaseUrl() + "/api/v2/torrents/add";

            this.authenticate()
                .then(() => this.createTorrentFetchOptions(torrent, config))
                .then(fetchOpts => {
                    this.sendRequest(url, fetchOpts, resolve, reject);
                })
                .catch(error => {
                    reject({ success: false, httpResponseCode: 0, httpResponseBody: error.message || null });
                });
        });
    }

    private authenticate(): Promise<void> {
        return new Promise((resolve, reject) => {
            const authenticationUrl = this.createBaseUrl() + "/api/v2/auth/login";
            const authenticationBody = new URLSearchParams();
            authenticationBody.append("username", this._settings.username);
            authenticationBody.append("password", this._settings.password);
            this.fetch(authenticationUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded; charset=utf-8"
                },
                body: authenticationBody
            }).then(response => {
                if (response.status == 200 || response.status == 204) {
                    resolve();
                } else {
                    reject(new Error("Authentication failed"));
                }
            }).catch(error => {
                reject(error);
            });
        });
    }

    private createTorrentFetchOptions(torrent: Torrent, config: TorrentUploadConfig): Promise<RequestInit> {
        return new Promise(async (resolve, reject) => {
            let fetchOpts: RequestInit = {
                method: "POST",
            };

            fetchOpts["body"] = new FormData();
            if (torrent.isMagnet) {
                fetchOpts["body"].append("urls", torrent.data as string);
            } else {
                fetchOpts["body"].append("torrents", new File([torrent.data as Blob], torrent.name, { type: "application/x-bittorrent" }));
            }

            const dir = this.getDirectory(config);
            if (dir) {
                fetchOpts["body"].append("savepath", dir);
            }

            const label = this.getLabel(config);
            if (label) {
                fetchOpts["body"].append("category", label);
            }

            const addPaused = this.getAddPaused(config);
            if (addPaused !== null) {
                fetchOpts["body"].append("stopped", addPaused.toString());
            }

            resolve(fetchOpts);
        });
    }

    private sendRequest(url: string, fetchOpts: RequestInit, resolve: (result: TorrentAddingResult) => void, reject: (error: TorrentAddingResult) => void): void {
        this.fetch(url, fetchOpts).then(async (response) => {
            const responseBody = await response.text();
            if (response.status === 200) {
                switch (responseBody) {
                    case "Fails.":
                        reject({ success: false, httpResponseCode: response.status, httpResponseBody: responseBody });
                        break;
                    default:
                        resolve({ success: true, httpResponseCode: response.status, httpResponseBody: responseBody });
                }
            } else {
                reject({ success: false, httpResponseCode: response.status, httpResponseBody: responseBody });
            }
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
        try {
            await this.authenticate();
        } catch (error) {
            return this.discoveryFailure(`Login failed: ${(error as Error)?.message ?? error}. Check username/password.`);
        }

        let response: Response;
        try {
            response = await fetch(this.createBaseUrl() + "/api/v2/torrents/categories", { method: "GET" });
        } catch (error) {
            return this.discoveryFailure(`Couldn't reach qBittorrent: ${(error as Error)?.message ?? error}`);
        }

        if (!response.ok) {
            return this.discoveryFailure(`qBittorrent returned HTTP ${response.status} for categories.`);
        }

        const labels = new Set<string>();
        const dirs = new Set<string>();
        try {
            // Shape: { "<name>": { name: string, savePath: string }, ... }
            const categories = await response.json();
            for (const key of Object.keys(categories ?? {})) {
                const name = categories[key]?.name || key;
                if (name) {
                    labels.add(name);
                }
                const savePath = categories[key]?.savePath;
                if (savePath) {
                    dirs.add(savePath);
                }
            }
        } catch {
            return this.discoveryFailure("Connected, but couldn't parse the categories response.");
        }

        const sortedLabels = [...labels].sort();
        const sortedDirs = [...dirs].sort();
        return {
            connected: true,
            supportsLabels: true,
            supportsDirs: true,
            labels: sortedLabels,
            dirs: sortedDirs,
            message: `Imported ${sortedLabels.length} categor${sortedLabels.length === 1 ? "y" : "ies"} and ${sortedDirs.length} save path(s).`,
        };
    }

    private discoveryFailure(error: string): DiscoveryResult {
        return { connected: false, supportsLabels: true, supportsDirs: true, labels: [], dirs: [], error };
    }
}
