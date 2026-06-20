import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
    attachHoverTooltip,
    setTooltipDestination,
    TooltipDestination,
} from "../../src/content-script/hover-tooltip";

const HOST_ID = "rta-hover-tooltip-host";

function configured(overrides: Partial<TooltipDestination> = {}): TooltipDestination {
    return {
        configured: true,
        webUiName: "Today",
        host: "193-39-142-97.a.seedbox.vip",
        label: null,
        dir: null,
        hasAutoRules: false,
        opensChooser: false,
        webUiCount: 1,
        ...overrides,
    };
}

function tip(): HTMLElement | null | undefined {
    const host = document.getElementById(HOST_ID);
    return host?.shadowRoot?.querySelector(".rta-tip") as HTMLElement | null;
}

function hover(el: Element): void {
    el.dispatchEvent(new MouseEvent("mouseenter", { clientX: 10, clientY: 10 }));
}

describe("hover-tooltip", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        document.getElementById(HOST_ID)?.remove();
    });

    afterEach(() => {
        document.getElementById(HOST_ID)?.remove();
    });

    it("creates the shadow-hosted pill only on first hover", () => {
        setTooltipDestination(configured());
        const a = document.createElement("a");
        document.body.appendChild(a);
        attachHoverTooltip(a);

        expect(document.getElementById(HOST_ID)).toBeNull();
        hover(a);
        expect(tip()).not.toBeNull();
        expect(tip()!.classList.contains("rta-visible")).toBe(true);
    });

    it("shows the destination WebUI name and host", () => {
        setTooltipDestination(configured({ webUiName: "Today", host: "seedbox.example" }));
        const a = document.createElement("a");
        document.body.appendChild(a);
        attachHoverTooltip(a);
        hover(a);

        expect(tip()!.textContent).toContain("Today");
        expect(tip()!.textContent).toContain("seedbox.example");
        expect(tip()!.textContent).toContain("Click to send");
    });

    it("renders label/dir chips and the auto-rules hint", () => {
        setTooltipDestination(configured({ label: "td", dir: "/movies", hasAutoRules: true }));
        const a = document.createElement("a");
        document.body.appendChild(a);
        attachHoverTooltip(a);
        hover(a);

        const text = tip()!.textContent ?? "";
        expect(text).toContain("label: td");
        expect(text).toContain("dir: /movies");
        expect(text).toContain("auto-rules may apply");
    });

    it("reflects the chooser mode and multi-client default", () => {
        setTooltipDestination(configured({ opensChooser: true, webUiCount: 3 }));
        const a = document.createElement("a");
        document.body.appendChild(a);
        attachHoverTooltip(a);
        hover(a);

        const text = tip()!.textContent ?? "";
        expect(text).toContain("Click to choose");
        expect(text).toContain("default of 3");
    });

    it("warns when no client is configured", () => {
        setTooltipDestination({
            configured: false,
            webUiName: "",
            host: null,
            label: null,
            dir: null,
            hasAutoRules: false,
            opensChooser: false,
            webUiCount: 0,
        });
        const a = document.createElement("a");
        document.body.appendChild(a);
        attachHoverTooltip(a);
        hover(a);

        expect(tip()!.textContent).toContain("No torrent client configured");
    });

    it("hides on mouseleave/blur", () => {
        setTooltipDestination(configured());
        const a = document.createElement("a");
        document.body.appendChild(a);
        attachHoverTooltip(a);
        hover(a);
        expect(tip()!.classList.contains("rta-visible")).toBe(true);

        a.dispatchEvent(new MouseEvent("mouseleave"));
        expect(tip()!.classList.contains("rta-visible")).toBe(false);
    });

    it("escapes HTML in destination fields", () => {
        setTooltipDestination(configured({ webUiName: "<img src=x onerror=alert(1)>" }));
        const a = document.createElement("a");
        document.body.appendChild(a);
        attachHoverTooltip(a);
        hover(a);

        expect(tip()!.querySelector("img")).toBeNull();
        expect(tip()!.innerHTML).toContain("&lt;img");
    });

    it("does not double-bind the same element", () => {
        setTooltipDestination(configured());
        const a = document.createElement("a");
        document.body.appendChild(a);
        attachHoverTooltip(a);
        attachHoverTooltip(a);
        hover(a);

        // One shared host element, regardless of how many times we attach.
        expect(document.querySelectorAll(`#${HOST_ID}`).length).toBe(1);
    });
});
