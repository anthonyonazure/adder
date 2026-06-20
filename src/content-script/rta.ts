import { observe } from './mutations';
import { RTASettings } from '../models/settings';
import { WebUISettings } from '../models/webui';
import { deserializeSettings } from '../util/serializer';
import { GetSettingsMessage, IPreAddTorrentMessage, IUpdateActionBadgeTextMessage, UpdateActionBadgeText } from '../models/messages';
import { PreAddTorrentMessage } from '../models/messages';
import { isMatchedByRegexes } from '../util/utils';
import { attachHoverTooltip, setTooltipDestination, TooltipDestination } from './hover-tooltip';


let numFoundLinks: number;
loadSettingsAndRegisterActions();

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

        setTooltipDestination(buildTooltipDestination(settings));

        if (settings.linkCatchingEnabled) {
            registerLinks(settings.linkCatchingRegexes);
            registerForms(settings.linkCatchingRegexes);
        }
    });
}

// Mirror the service worker's link-click target: a plain link carries no
// webUiId, so dispatchPreAddTorrent falls back to the first configured WebUI.
// The hover pill must preview that same destination.
function buildTooltipDestination(settings: RTASettings): TooltipDestination {
    const webuis: WebUISettings[] = settings.webuiSettings ?? [];
    const target = webuis[0];

    if (!target) {
        return {
            configured: false,
            webUiName: '',
            host: null,
            label: null,
            dir: null,
            hasAutoRules: false,
            opensChooser: false,
            webUiCount: 0,
        };
    }

    return {
        configured: true,
        webUiName: target.name || target.host || 'client',
        host: target.host || null,
        label: target.defaultLabel ?? null,
        dir: target.defaultDir ?? null,
        hasAutoRules: (target.autoLabelDirSettings?.length ?? 0) > 0,
        opensChooser: target.showPerTorrentConfigSelector === true,
        webUiCount: webuis.length,
    };
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
    attachHoverTooltip(element);
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