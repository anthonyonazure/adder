import { IBulkAddItem, IBulkAddResultDetail, IBulkAddTorrentsResponse } from "../models/messages";
import { TorrentUploadConfig } from "../models/torrent";
import { TorrentAddingResult, TorrentWebUI } from "../models/webui";
import { downloadTorrent } from "./download";

/** How many torrents we fetch + send at once, so a big batch doesn't hammer the client. */
const BULK_ADD_CONCURRENCY = 3;

export async function bulkAddTorrents(
    webUi: TorrentWebUI,
    items: IBulkAddItem[],
    config: TorrentUploadConfig
): Promise<IBulkAddTorrentsResponse> {
    const details: IBulkAddResultDetail[] = [];

    await mapWithConcurrency(items, BULK_ADD_CONCURRENCY, async (item) => {
        try {
            const torrent = await downloadTorrent(item.url);
            const result: TorrentAddingResult = await webUi.sendTorrent(torrent, config);
            details.push({
                name: torrent.name || item.name,
                url: item.url,
                success: result.success,
                error: result.success ? undefined : (result.httpResponseBody ?? undefined),
            });
        } catch (error: any) {
            details.push({
                name: item.name,
                url: item.url,
                success: false,
                error: error?.httpResponseBody ?? error?.message ?? String(error),
            });
        }
    });

    const added = details.filter(d => d.success).length;
    return {
        total: items.length,
        added,
        failed: items.length - added,
        details,
    };
}

/** Runs `worker` over `items` with at most `limit` concurrent in flight. */
export async function mapWithConcurrency<T>(
    items: T[],
    limit: number,
    worker: (item: T, index: number) => Promise<void>
): Promise<void> {
    let cursor = 0;
    const runners: Promise<void>[] = [];
    const runNext = async (): Promise<void> => {
        const index = cursor++;
        if (index >= items.length) {
            return;
        }
        await worker(items[index], index);
        await runNext();
    };
    for (let i = 0; i < Math.min(limit, items.length); i++) {
        runners.push(runNext());
    }
    await Promise.all(runners);
}
