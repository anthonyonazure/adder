import {
    AddTorrentMessage,
    GetPreAddedTorrentAndSettings,
    GetPreAddedTorrentAndSettingsResponse,
    GetSettingsMessage,
    IAddTorrentMessage,
    IGetPreAddedTorrentAndSettingsResponse,
    IPreAddTorrentMessage,
    PreAddTorrentMessage,
    AddTorrentMessageWithLabelAndDir,
    UpdateActionBadgeText,
    SaveSettingsMessage,
    IUpdateActionBadgeTextMessage,
    TestNotificationMessage,
    BulkCandidate,
    GetBulkData,
    IGetBulkDataResponse,
    GetClientExistingTorrents,
    IGetClientExistingTorrentsResponse,
    ResolveInfoHashes,
    IResolveInfoHashesResponse,
    BulkAddTorrents,
    IBulkAddTorrentsMessage,
    IScanPageResponse,
    ScanPageForTorrents
} from "../models/messages";
import { SerializedTorrent, Torrent, TorrentUploadConfig } from "../models/torrent";
import { TorrentAddingResult, TorrentWebUI, WebUISettings } from "../models/webui";
import { updateBadgeText } from "./action";
import { getAutoDirResult, getAutoLabelResult } from "./auto-label-dir-matcher";
import { downloadTorrent } from "./download";
import { showNotification } from "./notifications";
import { serializeSettings, convertTorrentToSerialized, convertSerializedToTorrent, deserializeSettings } from "./serializer";
import { Settings } from "./settings";
import { addTrailingSlash } from "./utils";
import { initiateWebUis } from "./webuis";
import { infoHashFromMagnet } from "./infohash";
import { bulkAddTorrents, mapWithConcurrency } from "./bulk-add";


const POPUP_PAGE = "popup/popup.html";
const BULK_PAGE = "bulk/bulk.html";
let bufferedTorrent: BufferedTorrentDataForPopup | null = null;
let bufferedBulk: BufferedBulkData | null = null;


export function registerMessageListener(): void {
    chrome.runtime.onMessage.addListener((message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
        let willRespondAsync = false;

        const finish = (payload?: any) => {
            try { sendResponse(payload); } catch { /* channel maybe closed */ }
        };

        const respondWithError = (err: unknown) => {
            console.error("Message handling error", message?.action, err);
            finish({ error: (err as Error)?.message || String(err) });
        };

        try {
            if (!message || !message.action) {
                finish({ error: "missing action" });
                return false;
            }

            console.debug(`Received message of type ${message.action}:`, message, sender);
            const settingsProvider = new Settings();

            switch (message.action) {
                case GetSettingsMessage.action: {
                    willRespondAsync = true;
                    settingsProvider.loadSettings()
                        .then(settings => finish(serializeSettings(settings)))
                        .catch(respondWithError);
                    break;
                }
                case SaveSettingsMessage.action: {
                    willRespondAsync = true;
                    settingsProvider.saveSettings(deserializeSettings(message.settings)!)
                        .then(() => finish({}))
                        .catch(respondWithError);
                    break;
                }
                case TestNotificationMessage.action: {
                    showNotification(message.title, message.message, message.isFailed, message.popupDurationMs, message.playSound);
                    finish({});
                    break;
                }
                case PreAddTorrentMessage.action: {
                    willRespondAsync = true;
                    chrome.windows.getLastFocused().then(lastFocusedWindow => {
                        try {
                            dispatchPreAddTorrent(message as IPreAddTorrentMessage, sender.tab?.windowId ?? lastFocusedWindow.id ?? 0);
                            finish({});
                        } catch (e) { respondWithError(e); }
                    }).catch(respondWithError);
                    break;
                }
                case AddTorrentMessage.action: {
                    willRespondAsync = true;
                    const addTorrentMessage = message as IAddTorrentMessage;
                    getWebUiById(addTorrentMessage.webUiId, settingsProvider)
                        .then((webUi: TorrentWebUI | null) => {
                            downloadAndAddTorrentToWebUi(webUi, addTorrentMessage.url, addTorrentMessage.config, addTorrentMessage);
                            finish({});
                        })
                        .catch(respondWithError);
                    break;
                }
                case GetPreAddedTorrentAndSettings.action: {
                    if (!bufferedTorrent) {
                        finish({ error: "no buffered torrent" });
                        break;
                    }
                    willRespondAsync = true;
                    convertTorrentToSerialized(bufferedTorrent.torrent)
                        .then((serializedTorrent: SerializedTorrent) => {
                            const response: IGetPreAddedTorrentAndSettingsResponse = {
                                action: GetPreAddedTorrentAndSettingsResponse.action,
                                webUiSettings: bufferedTorrent!.webUiSettings,
                                serializedTorrent: serializedTorrent,
                                autoLabelDirResult: getAutoLabelDirResultForConfig(bufferedTorrent!.torrent, bufferedTorrent!.webUiSettings)
                            };
                            console.debug("IGetPreAddedTorrentAndSettingsResponse:", response);
                            finish(response);
                        })
                        .catch(respondWithError);
                    break;
                }
                case AddTorrentMessageWithLabelAndDir.action: {
                    willRespondAsync = true;
                    const torrent = convertSerializedToTorrent(message.serializedTorrent);
                    getWebUiById(message.webUiId, settingsProvider)
                        .then(webUi => {
                            if (webUi) {
                                sendTorrentToWebUi(webUi, torrent, message.config);
                            } else {
                                console.error("No WebUI found for id", message.webUiId);
                            }
                            updateWebUiSettingsForWebUi(settingsProvider, message.webUiId, message.labels, message.directories)
                                .catch(e => console.error("Failed updating labels/dirs", e));
                            finish({});
                        })
                        .catch(respondWithError);
                    break;
                }
                case UpdateActionBadgeText.action: {
                    updateBadgeText((message as IUpdateActionBadgeTextMessage).text, sender.tab?.id || -1);
                    break;
                }
                case GetBulkData.action: {
                    if (!bufferedBulk) {
                        finish({ error: "no buffered bulk data" });
                        break;
                    }
                    willRespondAsync = true;
                    settingsProvider.loadSettings()
                        .then(settings => {
                            const candidates: BulkCandidate[] = bufferedBulk!.candidates.map(candidate => ({
                                ...candidate,
                                infoHash: candidate.isMagnet ? (infoHashFromMagnet(candidate.url) ?? undefined) : candidate.infoHash,
                            }));
                            const response: IGetBulkDataResponse = {
                                candidates,
                                webuis: settings.webuiSettings,
                                defaultWebUiId: settings.webuiSettings[0]?.id ?? null,
                            };
                            finish(response);
                        })
                        .catch(respondWithError);
                    break;
                }
                case GetClientExistingTorrents.action: {
                    willRespondAsync = true;
                    getWebUiById(message.webUiId, settingsProvider)
                        .then(async webUi => {
                            const empty: IGetClientExistingTorrentsResponse = { supported: false, infoHashes: [], labels: [] };
                            if (!webUi || !webUi.isListSupported) {
                                finish(empty);
                                return;
                            }
                            try {
                                const existing = await webUi.listExistingTorrents();
                                if (!existing) {
                                    finish(empty);
                                    return;
                                }
                                const infoHashes = existing.map(e => e.infoHash).filter(hash => !!hash);
                                const labels = Array.from(new Set(existing.map(e => e.label).filter((l): l is string => !!l)));
                                finish({ supported: true, infoHashes, labels } as IGetClientExistingTorrentsResponse);
                            } catch (e) {
                                finish({ supported: false, infoHashes: [], labels: [], error: (e as Error)?.message } as IGetClientExistingTorrentsResponse);
                            }
                        })
                        .catch(respondWithError);
                    break;
                }
                case ResolveInfoHashes.action: {
                    willRespondAsync = true;
                    const urls: string[] = Array.isArray(message.urls) ? message.urls : [];
                    const results: Record<string, string | null> = {};
                    mapWithConcurrency(urls, 4, async (url) => {
                        try {
                            if (url.startsWith("magnet:")) {
                                results[url] = infoHashFromMagnet(url);
                                return;
                            }
                            const torrent = await downloadTorrent(url);
                            results[url] = torrent.infoHash ?? null;
                        } catch {
                            results[url] = null;
                        }
                    })
                        .then(() => finish({ results } as IResolveInfoHashesResponse))
                        .catch(respondWithError);
                    break;
                }
                case BulkAddTorrents.action: {
                    willRespondAsync = true;
                    const bulkMessage = message as IBulkAddTorrentsMessage;
                    getWebUiById(bulkMessage.webUiId, settingsProvider)
                        .then(async webUi => {
                            if (!webUi) {
                                finish({ error: `No WebUI found for id ${bulkMessage.webUiId}` });
                                return;
                            }
                            const summary = await bulkAddTorrents(webUi, bulkMessage.items, bulkMessage.config);
                            if (bulkMessage.labels || bulkMessage.directories) {
                                updateWebUiSettingsForWebUi(
                                    settingsProvider,
                                    bulkMessage.webUiId,
                                    bulkMessage.labels ?? webUi.settings.labels,
                                    bulkMessage.directories ?? webUi.settings.dirs
                                ).catch(e => console.error("Failed updating labels/dirs", e));
                            }
                            const settings = await settingsProvider.loadSettings();
                            if (settings.notificationsEnabled) {
                                const isFailed = summary.added === 0 && summary.total > 0;
                                showNotification(
                                    isFailed ? "Bulk add failed" : "Bulk add complete",
                                    `${summary.added} of ${summary.total} added to ${webUi.name}${summary.failed > 0 ? ` · ${summary.failed} failed` : ""}`,
                                    isFailed,
                                    settings.notificationsDurationMs,
                                    settings.notificationsSoundEnabled,
                                    addTrailingSlash(webUi.createBaseUrl())
                                );
                            }
                            finish(summary);
                        })
                        .catch(respondWithError);
                    break;
                }
                default: {
                    finish({ error: `unknown action: ${message.action}` });
                }
            }
        } catch (err) {
            respondWithError(err);
        }

        return willRespondAsync;
    });
}

export async function dispatchPreAddTorrent(message: IPreAddTorrentMessage, windowId: number): Promise<void> {
    const settingsProvider = new Settings();
    const allWebUis = await getAllWebUis(settingsProvider);
    const webUiById = await getWebUiById(message.webUiId ?? "", settingsProvider);
    const webUi = webUiById ?? (allWebUis.length > 0 ? allWebUis[0] : null);
    if (webUi && webUi.settings.showPerTorrentConfigSelector) {
        bufferedTorrent = {
            torrent: await downloadTorrent(message.url),
            webUiSettings: webUi.settings
        };
        if (webUi.settings.useAlternativeLabelDirChooser) {
            chrome.windows.create({
                url: POPUP_PAGE,
                type: "popup",
                width: 420,
                height: 600,
                focused: true
            });
        } else {
            chrome.windows.update(windowId, { focused: true });
            chrome.action.setPopup({ popup: POPUP_PAGE });
            chrome.action.openPopup({ windowId: windowId }).then(() => chrome.action.setPopup({ popup: "" }));
        }
    } else {
        downloadAndAddTorrentToWebUi(webUi, message.url, null, message);
    }
}


async function getAllWebUis(settingsProvider: Settings): Promise<TorrentWebUI[]> {
    return new Promise((resolve) => {
        settingsProvider.loadSettings().then(async (settings) => {
            resolve(await initiateWebUis(settings));
        });
    });
}

async function getWebUiById(webUiId: string, settingsProvider: Settings): Promise<TorrentWebUI | null> {
    return new Promise((resolve) => {
        if (!webUiId) {
            resolve(null);
        }

        getAllWebUis(settingsProvider).then(allWebUis => {
            resolve(allWebUis.find(webUi => webUi.settings.id === webUiId) || null);
        });
    });
}

function downloadAndAddTorrentToWebUi(webUi: TorrentWebUI | null, url: string, config: TorrentUploadConfig | null, message: IPreAddTorrentMessage): void {
    new Settings().loadSettings().then(settings => {
        if (webUi) {
            downloadTorrent(url).then(torrent => {
                const fallbackConfig: TorrentUploadConfig = {
                    addPaused: webUi.settings.addPaused,
                    dir: getAutoDirResult(torrent, webUi._settings.autoLabelDirSettings) ?? webUi.settings.defaultDir ?? undefined,
                    label: getAutoLabelResult(torrent, webUi._settings.autoLabelDirSettings) ?? webUi.settings.defaultLabel ?? undefined
                };

                sendTorrentToWebUi(webUi, torrent, config ?? fallbackConfig);
            }).catch(error => {
                console.error("Error downloading torrent:", error);
                showNotification("Error downloading torrent",
                            `Error: ${error}`,
                            true,
                            settings.notificationsDurationMs,
                            settings.notificationsSoundEnabled,
                            addTrailingSlash(webUi.createBaseUrl()));
            });
        } else {
            console.error("No WebUI found for addTorrentMessage:", message);
            showNotification("No WebUI configured",
                        `Check your settings.`,
                        true,
                        settings.notificationsDurationMs,
                        settings.notificationsSoundEnabled);
        }
    });
}

interface BufferedTorrentDataForPopup {
    torrent: Torrent;
    webUiSettings: WebUISettings;
}

interface BufferedBulkData {
    candidates: BulkCandidate[];
    tabId: number;
}

/**
 * Scans the given tab for torrent/magnet links and opens the bulk-add window.
 * Triggered from the "Add multiple torrents from this page…" context menu item.
 */
export async function openBulkAddForTab(tab: chrome.tabs.Tab): Promise<void> {
    if (!tab.id) {
        return;
    }

    let candidates: BulkCandidate[] = [];
    try {
        const response = await chrome.tabs.sendMessage(
            tab.id,
            { action: ScanPageForTorrents.action },
            { frameId: 0 }
        ) as IScanPageResponse | undefined;
        candidates = response?.candidates ?? [];
    } catch (e) {
        console.warn("Could not scan page for torrents (no content script?):", e);
    }

    bufferedBulk = { candidates, tabId: tab.id };
    chrome.windows.create({
        url: BULK_PAGE,
        type: "popup",
        width: 720,
        height: 800,
        focused: true,
    });
}

function updateWebUiSettingsForWebUi(settingsProvider: Settings, webUiId: string, labels: string[], directories: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
        settingsProvider.loadSettings().then(settings => {
            const webUiSettings = settings.webuiSettings.find(webUi => webUi.id === webUiId);
            if (webUiSettings) {
                webUiSettings.labels = labels;
                webUiSettings.dirs = directories;
                settingsProvider.saveSettings(settings).then(() => {
                    resolve();
                });
            } else {
                const message = `WebUI with id ${webUiId} not found in settings; couldn't update labels and directories.`;
                console.error(message);
                reject(new Error(message));
            }
        });
    });
}

function getAutoLabelDirResultForConfig(torrent: Torrent, webUiSettings: WebUISettings): { label?: string; directory?: string } {
    return {
        label: getAutoLabelResult(torrent, webUiSettings.autoLabelDirSettings) ?? undefined,
        directory: getAutoDirResult(torrent, webUiSettings.autoLabelDirSettings) ?? undefined
    };
}

function sendTorrentToWebUi(webUi: TorrentWebUI, torrent: Torrent, config: TorrentUploadConfig | null) {
    new Settings().loadSettings().then(settings => {
        const webUiUrl = addTrailingSlash(webUi.createBaseUrl());
        webUi.sendTorrent(torrent, config ?? {}).then((torrentAddingResult: TorrentAddingResult) => {
            console.log(`Torrent sent successfully: ${torrent.name} to -> ${webUi.name}`);
            if (settings.notificationsEnabled) {
                if (torrentAddingResult.success) {
                    showNotification("Torrent added successfully",
                        `${torrent.name} successfully added to ${webUi.name}`,
                        false,
                        settings.notificationsDurationMs,
                        settings.notificationsSoundEnabled,
                        webUiUrl);
                } else {
                    showNotification("Torrent adding failed",
                        `HTTP Response code: ${torrentAddingResult.httpResponseCode}\nResponse body: ${torrentAddingResult.httpResponseBody}`,
                        true,
                        settings.notificationsDurationMs,
                        settings.notificationsSoundEnabled,
                        webUiUrl);
                }
            }
        }).catch(error => {
            console.error("Error sending torrent:", error);
            showNotification("Torrent adding failed", `Error (${error.httpResponseCode}):\n${error.httpResponseBody}`, true, settings.notificationsDurationMs, settings.notificationsSoundEnabled, webUiUrl);
        });
    });
}
