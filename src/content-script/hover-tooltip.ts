// Hover affordance: when the cursor is over a recognized torrent/magnet link,
// float a small pill near it announcing which client the torrent will be sent
// to (and the label/dir it will land in). The actual send still happens on the
// normal left-click handled in rta.ts — this is purely a "where is this going?"
// preview so the user no longer has to open the right-click menu to find out.

export interface TooltipDestination {
    // Whether a target WebUI exists at all. When false we nudge to options.
    configured: boolean;
    // Human name of the destination WebUI (the "Name" field, e.g. "Today").
    webUiName: string;
    // Destination host, shown as a dim secondary hint (e.g. seedbox hostname).
    host: string | null;
    // Default label/dir the torrent will get, if configured.
    label: string | null;
    dir: string | null;
    // True when auto label/dir rules exist — the preview is then best-effort,
    // since the final label/dir can depend on the torrent's tracker.
    hasAutoRules: boolean;
    // Clicking opens the per-torrent chooser instead of sending immediately.
    opensChooser: boolean;
    // How many WebUIs are configured; >1 means this is the default of several.
    webUiCount: number;
}

const HOST_ID = "rta-hover-tooltip-host";
const CURSOR_OFFSET = 14;

let destination: TooltipDestination | null = null;
let hostEl: HTMLElement | null = null;
let shadow: ShadowRoot | null = null;
let bodyEl: HTMLElement | null = null;
let visible = false;

export function setTooltipDestination(dest: TooltipDestination | null): void {
    destination = dest;
    // If the pill is currently up (e.g. settings changed mid-hover), refresh it.
    if (visible) {
        render();
    }
}

// Wire a single link/button element so hovering it shows the destination pill.
// Safe to call many times for the same element — guarded by a marker flag.
export function attachHoverTooltip(element: Element): void {
    const marked = element as Element & { __rtaHover?: boolean };
    if (marked.__rtaHover) {
        return;
    }
    marked.__rtaHover = true;

    element.addEventListener("mouseenter", onEnter);
    element.addEventListener("mousemove", onMove);
    element.addEventListener("mouseleave", onLeave);
    // Keyboard users / focus-driven navigation get the same hint.
    element.addEventListener("focus", onEnter);
    element.addEventListener("blur", onLeave);
}

function onEnter(event: Event): void {
    ensureTooltip();
    render();
    show();
    positionFromEvent(event as MouseEvent);
}

function onMove(event: Event): void {
    if (visible) {
        positionFromEvent(event as MouseEvent);
    }
}

function onLeave(): void {
    hide();
}

function ensureTooltip(): void {
    if (hostEl && hostEl.isConnected) {
        return;
    }

    hostEl = document.getElementById(HOST_ID);
    if (!hostEl) {
        hostEl = document.createElement("div");
        hostEl.id = HOST_ID;
        // The host itself is inert and out of layout; the pill lives in shadow.
        hostEl.style.cssText = "all: initial; position: fixed; top: 0; left: 0; z-index: 2147483647; pointer-events: none;";
        // Attach to <html> so it survives pages that rewrite <body>.
        (document.documentElement || document.body).appendChild(hostEl);
    }

    shadow = (hostEl as any).shadowRoot ?? hostEl.attachShadow({ mode: "open" });
    shadow!.innerHTML = "";

    const style = document.createElement("style");
    style.textContent = TOOLTIP_CSS;
    shadow!.appendChild(style);

    bodyEl = document.createElement("div");
    bodyEl.className = "rta-tip";
    bodyEl.setAttribute("role", "status");
    shadow!.appendChild(bodyEl);
}

function render(): void {
    if (!bodyEl) {
        return;
    }

    if (!destination || !destination.configured) {
        bodyEl.innerHTML =
            `<div class="rta-row rta-warn"><span class="rta-ico">⚠</span>` +
            `<span>No torrent client configured</span></div>` +
            `<div class="rta-sub">Open the extension options to add one</div>`;
        return;
    }

    const d = destination;
    const action = d.opensChooser ? "Click to choose &amp; send" : "Click to send";
    const hostHint = d.host ? `<span class="rta-host">${escapeHtml(d.host)}</span>` : "";
    const multi = d.webUiCount > 1 ? `<span class="rta-pill">default of ${d.webUiCount}</span>` : "";

    const chips: string[] = [];
    if (d.label) {
        chips.push(`<span class="rta-chip">label: ${escapeHtml(d.label)}</span>`);
    }
    if (d.dir) {
        chips.push(`<span class="rta-chip">dir: ${escapeHtml(d.dir)}</span>`);
    }
    if (d.hasAutoRules) {
        chips.push(`<span class="rta-chip rta-auto">auto-rules may apply</span>`);
    }
    const chipsRow = chips.length ? `<div class="rta-chips">${chips.join("")}</div>` : "";

    bodyEl.innerHTML =
        `<div class="rta-row"><span class="rta-arrow">➜</span>` +
        `<span class="rta-dest">${escapeHtml(d.webUiName)}</span>${hostHint}${multi}</div>` +
        chipsRow +
        `<div class="rta-sub">${action}</div>`;
}

function positionFromEvent(event: MouseEvent): void {
    if (!bodyEl || !hostEl) {
        return;
    }

    const rect = bodyEl.getBoundingClientRect();
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;

    let x = event.clientX + CURSOR_OFFSET;
    let y = event.clientY + CURSOR_OFFSET;

    // Flip to the other side of the cursor when we'd overflow the viewport.
    if (x + rect.width > vw) {
        x = event.clientX - rect.width - CURSOR_OFFSET;
    }
    if (y + rect.height > vh) {
        y = event.clientY - rect.height - CURSOR_OFFSET;
    }

    hostEl.style.transform = `translate(${Math.max(0, x)}px, ${Math.max(0, y)}px)`;
}

function show(): void {
    if (bodyEl) {
        bodyEl.classList.add("rta-visible");
        visible = true;
    }
}

function hide(): void {
    if (bodyEl) {
        bodyEl.classList.remove("rta-visible");
    }
    visible = false;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

const TOOLTIP_CSS = `
.rta-tip {
    position: fixed;
    top: 0; left: 0;
    max-width: 320px;
    box-sizing: border-box;
    padding: 8px 10px;
    border-radius: 8px;
    background: #1b1f24;
    color: #e8eaed;
    font: 12px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    box-shadow: 0 6px 24px rgba(0,0,0,.45);
    border: 1px solid #3a4048;
    opacity: 0;
    transform: translateY(2px);
    transition: opacity .08s ease, transform .08s ease;
    pointer-events: none;
}
.rta-tip.rta-visible { opacity: 1; transform: translateY(0); }
.rta-row { display: flex; align-items: center; gap: 6px; }
.rta-arrow { color: #5ec27a; font-weight: 700; }
.rta-ico { color: #f0b429; }
.rta-warn { color: #f0b429; font-weight: 600; }
.rta-dest { font-weight: 600; color: #fff; }
.rta-host { color: #9aa3ad; font-size: 11px; }
.rta-pill {
    margin-left: auto;
    font-size: 10px;
    color: #cbd2d9;
    background: #2b3138;
    border-radius: 999px;
    padding: 1px 6px;
}
.rta-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 5px; }
.rta-chip {
    font-size: 10px;
    color: #cbd2d9;
    background: #2b3138;
    border-radius: 4px;
    padding: 1px 6px;
}
.rta-chip.rta-auto { color: #f0b429; background: #2f2a1c; }
.rta-sub { margin-top: 5px; color: #9aa3ad; font-size: 11px; }
`;
