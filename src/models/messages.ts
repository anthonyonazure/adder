import { RTASettings } from "./settings";
import { SerializedTorrent, TorrentUploadConfig } from "./torrent";
import { WebUISettings } from "./webui";

export const GetSettingsMessage: IMessagable = {
    action: "getSettings"
}

export const SaveSettingsMessage: IMessagable = {
    action: "saveSettings"
}

export const TestNotificationMessage: IMessagable = {
    action: "testNotification"
}

export const PreAddTorrentMessage: IMessagable = {
    action: "preAddTorrent"
}

export const AddTorrentMessage: IMessagable = {
    action: "addTorrent"
}

export const AddTorrentMessageWithLabelAndDir: IMessagable = {
    action: "addTorrentMessageWithLabelAndDir"
}

export const GetPreAddedTorrentAndSettings: IMessagable = {
    action: "getPreAddedTorrentAndSettings"
}

export const GetPreAddedTorrentAndSettingsResponse: IMessagable = {
    action: "getPreAddedTorrentAndSettingsResponse"
}

export const UpdateActionBadgeText: IMessagable = {
    action: "updateActionBadgeText"
}

export const PlaySoundMessage: IMessagable = {
    action: "playSound"
}

// --- Bulk add (multi-select) ---

export const ScanPageForTorrents: IMessagable = {
    action: "scanPageForTorrents"
}

export const GetBulkData: IMessagable = {
    action: "getBulkData"
}

export const GetClientExistingTorrents: IMessagable = {
    action: "getClientExistingTorrents"
}

export const ResolveInfoHashes: IMessagable = {
    action: "resolveInfoHashes"
}

export const BulkAddTorrents: IMessagable = {
    action: "bulkAddTorrents"
}

export interface IGetPreAddedTorrentAndSettingsResponse extends IMessagable {
    webUiSettings: WebUISettings;
    serializedTorrent: SerializedTorrent;
    autoLabelDirResult?: {
        label?: string;
        directory?: string;
    };
}

export interface IAddTorrentMessage extends IPreAddTorrentMessage {
    webUiId: string;
    config: TorrentUploadConfig;
}

export interface IAddTorrentMessageWithLabelAndDir extends IMessagable {
    webUiId: string;
    config: TorrentUploadConfig;
    serializedTorrent: SerializedTorrent;
    labels: string[];
    directories: string[];
}

export interface IPreAddTorrentMessage extends IMessagable {
    url: string;
    webUiId?: string | null;
}

export interface IUpdateActionBadgeTextMessage extends IMessagable {
    text: string;
}

export interface ISaveSettingsMessage extends IMessagable {
    settings: RTASettings;
}

export interface ITestNotificationMessage extends IMessagable {
    title: string;
    message: string;
    isFailed: boolean;
    popupDurationMs: number;
    playSound: boolean;
}

export interface IPlaySoundMessage extends IMessagable {
    isFailed: boolean;
}

interface IMessagable {
    action: string;
}

// --- Bulk add (multi-select) payloads ---

/** A torrent/magnet link discovered on a page, offered for bulk selection. */
export interface BulkCandidate {
    url: string;
    name: string;
    isMagnet: boolean;
    /** Present for magnets (parsed from the link); resolved on demand for .torrent files. */
    infoHash?: string;
}

export interface IScanPageResponse {
    candidates: BulkCandidate[];
}

export interface IGetBulkDataResponse {
    candidates: BulkCandidate[];
    webuis: WebUISettings[];
    defaultWebUiId: string | null;
}

export interface IGetClientExistingTorrentsMessage extends IMessagable {
    webUiId: string;
}

export interface IGetClientExistingTorrentsResponse {
    /** False when the client has no list API or the list call failed. */
    supported: boolean;
    infoHashes: string[];
    labels: string[];
    error?: string;
}

export interface IResolveInfoHashesMessage extends IMessagable {
    urls: string[];
}

export interface IResolveInfoHashesResponse {
    /** Maps each requested URL to its infohash (lowercase hex), or null if unresolved. */
    results: Record<string, string | null>;
}

export interface IBulkAddItem {
    url: string;
    name: string;
    isMagnet: boolean;
}

export interface IBulkAddTorrentsMessage extends IMessagable {
    webUiId: string;
    items: IBulkAddItem[];
    config: TorrentUploadConfig;
    /** Persisted back to the client's remembered label/dir option lists, like single-add. */
    labels?: string[];
    directories?: string[];
}

export interface IBulkAddResultDetail {
    name: string;
    url: string;
    success: boolean;
    error?: string;
}

export interface IBulkAddTorrentsResponse {
    total: number;
    added: number;
    failed: number;
    details: IBulkAddResultDetail[];
}


export interface RegisteredListeners {
    actionIconListener: (tab: chrome.tabs.Tab) => Promise<void>;
}