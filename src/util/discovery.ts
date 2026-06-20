import { WebUIFactory } from "../models/clients";
import { DiscoveryResult, TorrentWebUI, WebUISettings } from "../models/webui";

// Session rule id for the transient CORS shim. Kept far above the per-WebUI CORS
// rule ids (which are small, index-based) so it never collides with saved rules.
const TRANSIENT_CORS_RULE_ID = 90001;

/**
 * Probe a candidate WebUI config (which may not be saved yet) and report what we
 * found: reachability plus any labels/directories we can import. Because the
 * config isn't persisted, its basic-auth handler and CORS shim aren't registered
 * by the normal settings flow, so we wire them up transiently for the probe and
 * tear them down afterwards.
 */
export async function discoverForSettings(settings: WebUISettings): Promise<DiscoveryResult> {
    const webui = WebUIFactory.createWebUI(settings);
    if (!webui) {
        return {
            connected: false,
            supportsLabels: false,
            supportsDirs: false,
            labels: [],
            dirs: [],
            error: "No client selected for this WebUI.",
        };
    }

    const cleanup = await registerTransientAccess(webui);
    try {
        return await webui.discover();
    } catch (error) {
        return {
            connected: false,
            supportsLabels: webui.isLabelSupported,
            supportsDirs: webui.isDirSupported,
            labels: [],
            dirs: [],
            error: (error as Error)?.message ?? String(error),
        };
    } finally {
        await cleanup();
    }
}

async function registerTransientAccess(webui: TorrentWebUI): Promise<() => Promise<void>> {
    const baseUrl = webui.createBaseUrl();
    const triedRequestIds = new Set<string>();

    const authListener = (details: chrome.webRequest.OnAuthRequiredDetails): chrome.webRequest.BlockingResponse => {
        // Only answer for extension-originated requests, and only once per request
        // so a wrong password fails instead of looping.
        if (details.tabId !== -1) {
            return {};
        }
        if (triedRequestIds.has(details.requestId)) {
            triedRequestIds.delete(details.requestId);
            return {};
        }
        triedRequestIds.add(details.requestId);
        return {
            authCredentials: {
                username: webui.settings.username,
                password: webui.settings.password,
            },
        };
    };

    const hasAuthListener = !!(webui.settings.host && webui.settings.port);
    if (hasAuthListener) {
        chrome.webRequest.onAuthRequired.addListener(authListener, { urls: [baseUrl.replace(/\/+$/, "") + "/*"] }, ["blocking"]);
    }

    if (baseUrl) {
        await chrome.declarativeNetRequest.updateSessionRules({
            removeRuleIds: [TRANSIENT_CORS_RULE_ID],
            addRules: [
                {
                    id: TRANSIENT_CORS_RULE_ID,
                    priority: 100,
                    action: {
                        type: "modifyHeaders",
                        requestHeaders: [{ header: "origin", operation: "remove" }],
                    },
                    condition: {
                        urlFilter: `|${baseUrl}*`,
                        resourceTypes: ["xmlhttprequest"],
                    },
                } as chrome.declarativeNetRequest.Rule,
            ],
        });
    }

    return async () => {
        if (hasAuthListener) {
            try { chrome.webRequest.onAuthRequired.removeListener(authListener); } catch { /* ignore */ }
        }
        try {
            await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [TRANSIENT_CORS_RULE_ID] });
        } catch { /* ignore */ }
    };
}
