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
     * Connect to the client and report what we found: whether it's reachable,
     * and any labels/directories already in use that we can import into the
     * config so the user doesn't have to type them by hand. The base
     * implementation only does a reachability check (and reports capabilities);
     * clients that can enumerate labels/dirs override this.
     */
    async discover(): Promise<DiscoveryResult> {
        const connected = await this.testReachable();
        return {
            connected,
            supportsLabels: this.isLabelSupported,
            supportsDirs: this.isDirSupported,
            labels: [],
            dirs: [],
            message: connected
                ? "Connected. This client can't auto-import labels/directories; set them manually if needed."
                : undefined,
            error: connected ? undefined : "Couldn't reach the client. Check host, port, and the HTTPS toggle.",
        };
    }

    /** True when the base URL answers with any HTTP response (even 401/404). */
    protected async testReachable(): Promise<boolean> {
        try {
            // Raw fetch (not this.fetch): any HTTP status means the host is up.
            await fetch(this.createBaseUrl(), { method: "GET" });
            return true;
        } catch {
            return false;
        }
    }

    get isLabelDirChooserSupported(): boolean {
        return this.isLabelSupported || this.isDirSupported || this.isAddPausedSupported;
    }

    public abstract sendTorrent(torrent: Torrent, config: TorrentUploadConfig): Promise<TorrentAddingResult>;

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

export interface DiscoveryResult {
    connected: boolean;
    supportsLabels: boolean;
    supportsDirs: boolean;
    labels: string[];
    dirs: string[];
    // Friendly note on success (e.g. "Imported 4 labels, 2 directories").
    message?: string;
    // Set when the connection/probe failed.
    error?: string;
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