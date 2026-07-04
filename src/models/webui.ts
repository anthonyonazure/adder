import { Client } from './clients';
import { Torrent, TorrentUploadConfig } from './torrent';

export interface WebUISettings {
    id: string;

    client: Client;
    name: string;

    host: string;
    port: number;
    secure: boolean;
    relativePath: string | null;

    username: string;
    password: string;

    showPerTorrentConfigSelector: boolean;
    useAlternativeLabelDirChooser?: boolean;
    defaultLabel: string | null;
    defaultDir: string | null;
    labels: Array<string>;
    dirs: Array<string>;
    addPaused: boolean;
    autoLabelDirSettings: Array<AutoLabelDirSetting>;

    clientSpecificSettings: Record<string, any>;
}

export abstract class TorrentWebUI {
    _settings: WebUISettings;

    constructor(settings: WebUISettings) {
        this._settings = settings;
    }

    get name(): string {
        return this._settings.name;
    }

    get client(): Client {
        return this._settings.client;
    }

    get settings(): WebUISettings {
        return this._settings;
    }

    abstract get isLabelSupported(): boolean;
    abstract get isDirSupported(): boolean;
    abstract get isAddPausedSupported(): boolean;

    /**
     * Whether this client exposes an API for listing the torrents it already
     * has. Clients that override {@link listExistingTorrents} return true so the
     * bulk-add UI can offer duplicate detection.
     */
    get isListSupported(): boolean {
        return false;
    }

    get isLabelDirChooserSupported(): boolean {
        return this.isLabelSupported || this.isDirSupported || this.isAddPausedSupported;
    }

    public abstract sendTorrent(torrent: Torrent, config: TorrentUploadConfig): Promise<TorrentAddingResult>;

    /**
     * Lists the torrents the client already knows about, for duplicate
     * detection and label discovery. Returns null when the client has no list
     * API. Implementations should resolve with an empty array (not throw) when
     * the client is reachable but holds no torrents.
     */
    public listExistingTorrents(): Promise<ExistingTorrent[] | null> {
        return Promise.resolve(null);
    }

    createBaseUrl(): string {
        let portPart: string;
        if(this.settings.secure && this._settings.port == 443) {
            portPart = "";
        } else if(!this.settings.secure && this._settings.port == 80) {
            portPart = "";
        } else {
            portPart = `:${this._settings.port}`;
        }
        return [
            "http",
            this.settings.secure ? "s" : "",
            "://",
            this.settings.host,
            portPart,
            this.settings.relativePath ? this.addLeadingAndTrimTrailingSlashes(this.settings.relativePath) : "",
        ].join("");
    }

    createBaseUrlPatternForFilter(): string {
        return this.createBaseUrl().replace(/\/+$/, "") + "/";
    }

    protected async fetch(url: string, options?: RequestInit): Promise<Response> {
        const res: Response = await fetch(url, options);
        if (!res.ok) {
            throw new Error(`HTTP error ${res.status}`);
        }
        return res;
    }

    protected addLeadingAndTrimTrailingSlashes(urlPart: string): string {
        if (!urlPart) {
            return "";
        }
        return "/" + urlPart.replace(/^\/+|\/+$/g, "");
    }

    protected getDirectory(config: TorrentUploadConfig): string | null {
        return config.dir ?? this.settings.defaultDir ?? null;
    }

    protected getLabel(config: TorrentUploadConfig): string | null {
        return config.label ?? this.settings.defaultLabel ?? null;
    }

    protected getAddPaused(config: TorrentUploadConfig): boolean | null {
        return config.addPaused ?? this.settings.addPaused ?? false;
    }

}

export interface TorrentAddingResult {
    success: boolean;
    httpResponseCode: number;
    httpResponseBody: string | null;
}

export interface ExistingTorrent {
    /** BitTorrent v1 infohash, lowercase hex. */
    infoHash: string;
    name?: string;
    label?: string;
    /** True when the client reports the torrent as fully downloaded. */
    isComplete?: boolean;
}

export interface AutoLabelDirSetting {
    criteria: Array<AutoLabelDirCriterion>;
    label: string | null;
    dir: string | null;
}

export interface AutoLabelDirCriterion {
    field: "trackerUrl";
    value: string;
}