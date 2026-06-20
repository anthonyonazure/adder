// Seedbox provider presets. Picking one fills in the parts of a ruTorrent URL
// that users routinely get wrong (port, HTTPS, the /rutorrent/ path), leaving
// only the per-account hostname to paste. "Custom" applies nothing.
//
// These cover common shared-seedbox layouts; providers that bake the username
// into the path (e.g. Feral's /<user>/rutorrent) are intentionally omitted to
// avoid producing a confidently-wrong URL.

export interface SeedboxProvider {
    id: string;
    label: string;
    // Undefined fields are left untouched when the preset is applied.
    port?: number;
    secure?: boolean;
    relativePath?: string;
    // Placeholder shown in the Host field to hint the expected format.
    hostHint?: string;
    note?: string;
}

export const CUSTOM_PROVIDER_ID = "custom";

export const SEEDBOX_PROVIDERS: SeedboxProvider[] = [
    {
        id: CUSTOM_PROVIDER_ID,
        label: "Custom / self-hosted (no preset)",
    },
    {
        id: "seedbox.vip",
        label: "Seedbox.vip",
        port: 443,
        secure: true,
        relativePath: "rutorrent",
        hostHint: "e.g. 193-39-142-97.a.seedbox.vip",
    },
    {
        id: "ultra.cc",
        label: "Ultra.cc",
        port: 443,
        secure: true,
        relativePath: "rutorrent",
        hostHint: "e.g. username.hostname.usbx.me",
    },
    {
        id: "whatbox",
        label: "Whatbox",
        port: 443,
        secure: true,
        relativePath: "rutorrent",
        hostHint: "e.g. hostname.whatbox.ca",
    },
    {
        id: "seedhost",
        label: "Seedhost.eu",
        port: 443,
        secure: true,
        relativePath: "rutorrent",
        hostHint: "e.g. username.hostname.seedhost.eu",
    },
    {
        id: "generic-https",
        label: "Generic ruTorrent over HTTPS",
        port: 443,
        secure: true,
        relativePath: "rutorrent",
        hostHint: "your seedbox hostname",
    },
];

export function findProvider(id: string): SeedboxProvider | undefined {
    return SEEDBOX_PROVIDERS.find(p => p.id === id);
}

export interface DetectedUrlParts {
    host: string;
    port: number;
    secure: boolean;
    relativePath: string;
}

/**
 * Decompose an open ruTorrent tab URL into WebUI connection fields. Returns null
 * for anything that isn't a ruTorrent URL. The relative path keeps everything up
 * to and including the "rutorrent" segment, so provider layouts that prefix the
 * username (e.g. /<user>/rutorrent) are preserved.
 */
export function parseRutorrentUrl(rawUrl: string): DetectedUrlParts | null {
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        return null;
    }
    if (!/\/rutorrent/i.test(url.pathname)) {
        return null;
    }
    const secure = url.protocol === "https:";
    const lower = url.pathname.toLowerCase();
    const end = lower.lastIndexOf("rutorrent") + "rutorrent".length;
    const relativePath = url.pathname.slice(0, end).replace(/^\/+|\/+$/g, "");
    return {
        host: url.hostname,
        port: url.port ? Number(url.port) : (secure ? 443 : 80),
        secure,
        relativePath,
    };
}
