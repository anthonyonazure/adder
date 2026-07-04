import { observe } from './mutations';
import { RTASettings } from '../models/settings';
import { deserializeSettings } from '../util/serializer';
import { BulkCandidate, GetSettingsMessage, IPreAddTorrentMessage, IScanPageResponse, IUpdateActionBadgeTextMessage, ScanPageForTorrents, UpdateActionBadgeText } from '../models/messages';
import { PreAddTorrentMessage } from '../models/messages';
import { isMatchedByRegexes } from '../util/utils';
import { getDefaultSettings } from '../util/settings-defaults';
import { getTorrentNameFromLink, getTorrentNameFromMagnetLink } from '../util/parsers';


let numFoundLinks: number;
// Kept up to date whenever settings load, so the bulk-scan handler can match
// links even when passive link-catching is disabled.
let currentLinkRegexes: RegExp[] = getDefaultSettings().linkCatchingRegexes;
loadSettingsAndRegisterActions();
registerBulkScanListener();

function loadSettingsAndRegisterActions(attemptNumber: number = 0): void {
    numFoundLinks = 0;
    chrome.runtime.sendMessage({ action: UpdateActionBadgeText.action, text: '' } as IUpdateActionBadgeTextMessage);
    chrome.runtime.sendMessage(GetSettingsMessage, function (serializedSettings: string) {
        const settings = deserializeSettings(serializedSettings);
        console.debug("Received settings from background script:", settings);
        if (!settings) {
            if (attemptNumber < 3) {
                console.warn("Service worker might've been asleep. Retrying to load settings...");
                loadSettingsAndRegisterActions(attemptNumber + 1);
            }
            return;
        }

        currentLinkRegexes = settings.linkCatchingRegexes;

        if (settings.linkCatchingEnabled) {
            registerLinks(settings.linkCatchingRegexes);
            registerForms(settings.linkCatchingRegexes);
        }
    });
}

function registerBulkScanListener(): void {
    chrome.runtime.onMessage.addListener((message: any, _sender, sendResponse) => {
        if (message?.action === ScanPageForTorrents.action) {
            sendResponse({ candidates: scanPageForTorrents() } as IScanPageResponse);
        }
        return false; // response is synchronous
    });
}

function scanPageForTorrents(): BulkCandidate[] {
    const found = new Map<string, BulkCandidate>();

    const consider = (url: string | null | undefined, linkText: string) => {
        if (!url) {
            return;
        }
        if (found.has(url)) {
            return;
        }
        if (isMatchedByRegexes(url, currentLinkRegexes) || isMagnetLink(url)) {
            found.set(url, toCandidate(url, linkText));
        }
    };

    document.querySelectorAll('a[href]').forEach(a => {
        const anchor = a as HTMLAnchorElement;
        consider(anchor.href, (anchor.textContent ?? '').trim());
    });
    document.querySelectorAll('input,button').forEach(el => {
        const form = (el as HTMLInputElement | HTMLButtonElement).form;
        consider(form?.action, (el.textContent ?? '').trim());
    });

    return Array.from(found.values());
}

function toCandidate(url: string, linkText: string): BulkCandidate {
    const isMagnet = isMagnetLink(url);
    let name = linkText;
    if (!name) {
        name = isMagnet ? getTorrentNameFromMagnetLink(url) : getTorrentNameFromLink(url);
    }
    return { url, name, isMagnet };
}

function registerLinks(linkRegexes: RegExp[]): void {
    observe('a', (element) => {
        if (element.href && (isMatchedByRegexes(element.href, linkRegexes) || isMagnetLink(element.href))) {
            registerAction(element, element.href);
        }
    });
}

function registerForms(linkRegexes: RegExp[]): void {
    observe('input,button', (element) => {
        const form = element.form;
        if (form && form.action && (isMatchedByRegexes(form.action, linkRegexes) || isMagnetLink(form.action))) {
            registerAction(element, form.action);
        }
    });
}

function isMagnetLink(url: string): boolean {
    return url.startsWith('magnet:');
}

function incrementCounter(): void {
    chrome.runtime.sendMessage({ action: UpdateActionBadgeText.action, text: (++numFoundLinks).toString() } as IUpdateActionBadgeTextMessage);
}

function registerAction(element: Element, url: string): void {
    incrementCounter();
    console.debug(`Registered action for element: ${element.tagName}, URL: ${url}`);
    element.addEventListener('click', (event: Event) => {
        const mouseEvent = event as MouseEvent;
        if (mouseEvent.ctrlKey || mouseEvent.shiftKey || mouseEvent.altKey) {
            console.log("Clicked a recognized link, but RTA action was prevented due to pressed modifier keys.");
            return;
        }
        mouseEvent.preventDefault();
        console.debug("Clicked form input");

        chrome.runtime.sendMessage({ action: PreAddTorrentMessage.action, url: url } as IPreAddTorrentMessage);
    });
}