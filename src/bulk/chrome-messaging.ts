import {
    BulkAddTorrents,
    GetBulkData,
    GetClientExistingTorrents,
    IBulkAddTorrentsResponse,
    IGetBulkDataResponse,
    IGetClientExistingTorrentsResponse,
    IResolveInfoHashesResponse,
    ResolveInfoHashes,
} from "../models/messages";
import { TorrentUploadConfig } from "../models/torrent";

export function getBulkData(): Promise<IGetBulkDataResponse> {
    return chrome.runtime.sendMessage({ action: GetBulkData.action });
}

export function getClientExistingTorrents(webUiId: string): Promise<IGetClientExistingTorrentsResponse> {
    return chrome.runtime.sendMessage({ action: GetClientExistingTorrents.action, webUiId });
}

export function resolveInfoHashes(urls: string[]): Promise<IResolveInfoHashesResponse> {
    return chrome.runtime.sendMessage({ action: ResolveInfoHashes.action, urls });
}

export interface BulkAddRequest {
    webUiId: string;
    items: Array<{ url: string; name: string; isMagnet: boolean }>;
    config: TorrentUploadConfig;
    labels?: string[];
    directories?: string[];
}

export function bulkAddTorrents(request: BulkAddRequest): Promise<IBulkAddTorrentsResponse> {
    return chrome.runtime.sendMessage({ action: BulkAddTorrents.action, ...request });
}
