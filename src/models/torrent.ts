
export interface Torrent {
    data: Blob | string;
    name: string;
    isMagnet: boolean;
    trackers?: string[];
    files?: string[];
    isPrivate?: boolean;
    /** BitTorrent v1 infohash (lowercase hex), used for duplicate detection. */
    infoHash?: string;
}

export interface SerializedTorrent extends Torrent {
    data: string;
}

export interface TorrentUploadConfig {
    dir?: string;
    label?: string;
    addPaused?: boolean;
}
