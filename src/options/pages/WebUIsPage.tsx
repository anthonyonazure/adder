import { useEffect, useState } from "react";
import { useSettings } from "../SettingsContext";
import ChipList from "../components/ChipList";
import AutoLabelDirSettingsEditor from "../components/AutoLabelDirSettingsEditor";
import Select from "../components/Select";
import { Client, ClientClassByClient, ClientDisplayName, WebUIFactory } from "../../models/clients";
import type { DiscoveryResult, WebUISettings } from "../../models/webui";
import { DiscoverWebUIMessage } from "../../models/messages";
import { SEEDBOX_PROVIDERS, findProvider, CUSTOM_PROVIDER_ID, parseRutorrentUrl } from "../../util/providers";
import Toggle from "../components/Toggle";
import { generateId } from "../../util/utils";

const clientOptions = Object.values(Client).map(c => ({ value: c, label: ClientDisplayName[c] }));
const providerOptions = SEEDBOX_PROVIDERS.map(p => ({ value: p.id, label: p.label }));

// Round-trip a discovery probe through the service worker, where auth + CORS
// shims live. Rejects only on a messaging-layer failure; a failed *probe* still
// resolves (with connected:false and an error message) so the UI can show it.
function discoverWebUI(settings: WebUISettings): Promise<DiscoveryResult> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: DiscoverWebUIMessage.action, settings }, (resp: any) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      if (!resp || (resp.error && resp.connected === undefined)) {
        reject(new Error(resp?.error ?? "No response from the extension service worker."));
        return;
      }
      resolve(resp as DiscoveryResult);
    });
  });
}

function uniqueSorted(...lists: string[][]): string[] {
  return Array.from(new Set(lists.flat().filter(Boolean))).sort();
}

// Read the seedbox host/port/scheme/path from an already-open ruTorrent tab, so
// the user never has to type their per-account hostname. Looks for any tab whose
// path contains "rutorrent" and decomposes its URL into WebUI fields.
function detectRutorrentFromTabs(): Promise<Partial<WebUISettings> | null> {
  return new Promise(resolve => {
    try {
      chrome.tabs.query({}, tabs => {
        if (chrome.runtime.lastError) { resolve(null); return; }
        for (const tab of tabs ?? []) {
          const parts = tab.url ? parseRutorrentUrl(tab.url) : null;
          if (parts) { resolve(parts); return; }
        }
        resolve(null);
      });
    } catch { resolve(null); }
  });
}

function isClientSelected(client: Client | ""): client is Client {
  return !!client && client in ClientClassByClient;
}

const fieldInputStyle: React.CSSProperties = {
  fontSize: 15,
  borderRadius: 8,
  padding: "6px 12px",
  border: "1px solid var(--rta-border, #b7c9a7)",
  background: "var(--rta-input-bg, #fff)",
  color: "var(--rta-text, #1b241d)",
};

function getDefaultWebUISettings(): WebUISettings {
  return {
    id: generateId(),
    // No client is chosen yet: the user picks one in the detail panel, which is
    // what reveals the rest of the configuration. Until then this entry is a
    // draft and is filtered out by consumers that resolve a concrete client.
    client: "" as Client,
    name: "",
    host: "",
    port: 80,
    secure: false,
    relativePath: "",
    username: "",
    password: "",
    showPerTorrentConfigSelector: false,
    defaultLabel: null,
    defaultDir: null,
    labels: [],
    dirs: [],
    addPaused: false,
    autoLabelDirSettings: [],
    clientSpecificSettings: {},
    useAlternativeLabelDirChooser: false,
  };
}

interface WebUIListItemProps {
  webui: WebUISettings;
  selected: boolean;
  isPrimary: boolean;
  onSelect: () => void;
  onNameChange: (name: string) => void;
}

function WebUIListItem({ webui, selected, isPrimary, onSelect, onNameChange }: WebUIListItemProps) {
  const subtitle = isClientSelected(webui.client) ? ClientDisplayName[webui.client] : "No client selected";

  return (
    <div
      onClick={onSelect}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: "10px 12px",
        borderRadius: 10,
        cursor: "pointer",
        background: selected ? "var(--rta-accent, #b7c9a7)" : "transparent",
        border: selected ? "1px solid var(--rta-green-dark, #4e6a57)" : "1px solid transparent",
        transition: "background 0.15s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {selected ? (
          <input
            type="text"
            value={webui.name}
            autoFocus={!webui.name}
            onClick={e => e.stopPropagation()}
            onChange={e => onNameChange(e.target.value)}
            placeholder="Unnamed WebUI"
            style={{
              ...fieldInputStyle,
              flex: 1,
              minWidth: 0,
              padding: "4px 8px",
              fontWeight: 600,
            }}
          />
        ) : (
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontWeight: 600,
              fontSize: 15,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              color: webui.name ? "var(--rta-text, #1b241d)" : "var(--rta-text-muted, #888)",
            }}
          >
            {webui.name || "Unnamed WebUI"}
          </span>
        )}
        {isPrimary && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "#fff",
              background: "var(--rta-green, #6e8b74)",
              borderRadius: 6,
              padding: "2px 6px",
              whiteSpace: "nowrap",
            }}
          >
            Primary
          </span>
        )}
      </div>
      <span style={{ fontSize: 12, color: selected ? "var(--rta-green-dark, #4e6a57)" : "var(--rta-text-muted, #888)" }}>
        {subtitle}
      </span>
    </div>
  );
}

interface WebUIDetailProps {
  webui: WebUISettings;
  onChange: (w: WebUISettings) => void;
  onRemove: () => void;
  onPromote: () => void;
  isPrimary: boolean;
}

function WebUIDetail({ webui, onChange, onRemove, onPromote, isPrimary }: WebUIDetailProps) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [providerId, setProviderId] = useState(CUSTOM_PROVIDER_ID);
  const [discovering, setDiscovering] = useState(false);
  const [discoverStatus, setDiscoverStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const clientChosen = isClientSelected(webui.client);
  const webUiInstance = clientChosen ? WebUIFactory.createWebUI(webui) : null;
  const isRutorrent = webui.client === Client.RuTorrentWebUI;
  const hostHint = findProvider(providerId)?.hostHint;

  const applyProvider = (id: string) => {
    setProviderId(id);
    const preset = findProvider(id);
    if (!preset || id === CUSTOM_PROVIDER_ID) return;
    onChange({
      ...webui,
      port: preset.port ?? webui.port,
      secure: preset.secure ?? webui.secure,
      relativePath: preset.relativePath ?? webui.relativePath,
    });
  };

  const handleDetectFromTab = async (): Promise<WebUISettings | null> => {
    const detected = await detectRutorrentFromTabs();
    if (!detected?.host) {
      setDiscoverStatus({ ok: false, text: "No open ruTorrent tab found. Open your seedbox ruTorrent in a browser tab, then click Detect." });
      return null;
    }
    const updated = { ...webui, ...detected };
    onChange(updated);
    setDiscoverStatus({ ok: true, text: `Filled from open tab: ${detected.host}` });
    return updated;
  };

  const handleConnectAndImport = async () => {
    setDiscovering(true);
    setDiscoverStatus(null);
    try {
      // No host yet? Pull it from an open ruTorrent tab before probing.
      let effective = webui;
      if (!effective.host) {
        const detected = await detectRutorrentFromTabs();
        if (detected?.host) {
          effective = { ...webui, ...detected };
          onChange(effective);
        }
      }
      if (!effective.host) {
        setDiscoverStatus({ ok: false, text: "No host. Open your ruTorrent in a browser tab (then I can detect it), or type the host above." });
        return;
      }
      const result = await discoverWebUI(effective);
      if (!result.connected) {
        setDiscoverStatus({ ok: false, text: result.error ?? "Could not connect." });
        return;
      }
      const labels = uniqueSorted(effective.labels, result.labels);
      const dirs = uniqueSorted(effective.dirs, result.dirs);
      onChange({ ...effective, labels, dirs });
      const imported = (result.labels.length || result.dirs.length)
        ? `Imported ${result.labels.length} label(s) and ${result.dirs.length} director(ies).`
        : (result.message ?? "Connected.");
      setDiscoverStatus({ ok: true, text: `Connected. ${imported}` });
    } catch (e) {
      setDiscoverStatus({ ok: false, text: (e as Error).message });
    } finally {
      setDiscovering(false);
    }
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 20 }}>
        <span style={{ fontWeight: 700, fontSize: 22, flex: 1 }}>{webui.name || "Unnamed WebUI"}</span>
        {!isPrimary && (
          <button
            onClick={onPromote}
            style={{
              background: "var(--rta-info, #4682B4)",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "6px 16px",
              fontWeight: 700,
              cursor: "pointer",
              transition: "all 0.15s",
            }}
          >Promote to Primary</button>
        )}
        <button
          onClick={() => {
            if (confirmRemove) onRemove();
            else setConfirmRemove(true);
          }}
          style={{
            background: confirmRemove ? "var(--rta-danger-dark, #8B0000)" : "var(--rta-danger, #B22222)",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            padding: "6px 16px",
            fontWeight: 700,
            cursor: "pointer",
            boxShadow: confirmRemove ? "0 0 8px 2px var(--rta-danger-dark, #8B0000)" : undefined,
            transition: "all 0.15s",
          }}
        >
          {confirmRemove ? "For real?" : "Remove"}
        </button>
        {confirmRemove && (
          <button
            onClick={() => setConfirmRemove(false)}
            style={{
              background: "var(--rta-neutral, #eee)",
              color: "var(--rta-danger, #B22222)",
              border: "none",
              borderRadius: 8,
              padding: "6px 12px",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >Cancel</button>
        )}
      </div>

      {/* Client type: choosable while still a draft, locked once chosen. */}
      <div style={{ marginBottom: 20 }}>
        <Select
          label="Client"
          value={webui.client}
          changeable={!clientChosen}
          options={clientOptions}
          onChange={clientChosen ? undefined : value => onChange({ ...webui, client: value as Client })}
        />
      </div>

      {!clientChosen ? (
        <div style={{ color: "var(--rta-text-muted, #888)", fontSize: 15 }}>
          Select a client type above to configure this WebUI.
        </div>
      ) : (
        <>
          {/* Seedbox provider preset (ruTorrent): fills port/HTTPS/path so the
              user only pastes their hostname. */}
          {isRutorrent && (
            <div style={{ marginBottom: 20, maxWidth: 360 }}>
              <Select
                label="Seedbox provider (optional preset)"
                value={providerId}
                changeable={true}
                options={providerOptions}
                onChange={applyProvider}
              />
            </div>
          )}
          {/* Host + Port + Secure + Relative Path */}
          <div style={{ display: "flex", gap: 16, alignItems: "flex-end", marginBottom: 20, flexWrap: "wrap" }}>
            <div>
              <label style={{ fontWeight: 500, marginBottom: 4, display: "block" }}>Host</label>
              <input type="text" value={webui.host} placeholder={hostHint} onChange={e => onChange({ ...webui, host: e.target.value })} style={{ ...fieldInputStyle, minWidth: 120 }} />
            </div>
            <div>
              <label style={{ fontWeight: 500, marginBottom: 4, display: "block" }}>Port</label>
              <input type="number" value={webui.port} onChange={e => onChange({ ...webui, port: Number(e.target.value) })} style={{ ...fieldInputStyle, minWidth: 80 }} />
            </div>
            <Toggle checked={webui.secure} onChange={v => onChange({ ...webui, secure: v })} label="Secure (HTTPS)" />
            <div>
              <label style={{ fontWeight: 500, marginBottom: 4, display: "block" }}>Relative Path</label>
              <input type="text" value={webui.relativePath || ""} onChange={e => onChange({ ...webui, relativePath: e.target.value })} style={{ ...fieldInputStyle, minWidth: 120 }} />
            </div>
          </div>
          <div style={{ marginBottom: 20, color: "var(--rta-text-muted, #888)" }}>Base URL for API calls: {webUiInstance?.createBaseUrl()}</div>
          {/* Username + Password */}
          <div style={{ display: "flex", gap: 16, alignItems: "flex-end", marginBottom: 20, flexWrap: "wrap" }}>
            <div>
              <label style={{ fontWeight: 500, marginBottom: 4, display: "block" }}>Username</label>
              <input type="text" value={webui.username} onChange={e => onChange({ ...webui, username: e.target.value })} style={{ ...fieldInputStyle, minWidth: 120 }} />
            </div>
            <div>
              <label style={{ fontWeight: 500, marginBottom: 4, display: "block" }}>Password</label>
              <input type="password" value={webui.password} onChange={e => onChange({ ...webui, password: e.target.value })} style={{ ...fieldInputStyle, minWidth: 120 }} />
            </div>
          </div>
          {/* Detect (read host from an open ruTorrent tab) + Connect & Import
              (test the connection and pull existing labels/dirs). */}
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 20, flexWrap: "wrap" }}>
            {isRutorrent && (
              <button
                onClick={handleDetectFromTab}
                disabled={discovering}
                title="Read the host/port/path from your open ruTorrent tab"
                style={{
                  background: "var(--rta-info, #4682B4)",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  padding: "8px 16px",
                  fontWeight: 700,
                  cursor: discovering ? "default" : "pointer",
                }}
              >
                Detect from open tab
              </button>
            )}
            <button
              onClick={handleConnectAndImport}
              disabled={discovering}
              title="Test the connection and import labels/directories"
              style={{
                background: discovering ? "var(--rta-neutral, #5a6b5d)" : "var(--rta-success, #228B22)",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                padding: "8px 18px",
                fontWeight: 700,
                cursor: discovering ? "default" : "pointer",
              }}
            >
              {discovering ? "Connecting…" : "Connect & Import"}
            </button>
            {discoverStatus && (
              <span style={{ fontSize: 13, fontWeight: 600, color: discoverStatus.ok ? "var(--rta-green-dark, #2e7d32)" : "var(--rta-danger, #B22222)" }}>
                {discoverStatus.ok ? "✓ " : "✗ "}{discoverStatus.text}
              </span>
            )}
          </div>
          {/* Only show these fields if supported by the WebUI instance */}
          {webUiInstance?.isAddPausedSupported && (
            <div style={{ display: "flex", gap: 16, alignItems: "flex-end", marginBottom: 20 }}>
              <Toggle checked={webui.addPaused} onChange={v => onChange({ ...webui, addPaused: v })} label="Add torrents paused" />
            </div>
          )}
          {webUiInstance?.isLabelDirChooserSupported && (
            <div style={{ display: "flex", gap: 16, alignItems: "flex-end", marginBottom: 20, flexWrap: "wrap" }}>
              <Toggle checked={webui.showPerTorrentConfigSelector} onChange={v => onChange({ ...webui, showPerTorrentConfigSelector: v })} label="Show per-torrent config selector" />
              <Toggle checked={webui.useAlternativeLabelDirChooser ?? false} onChange={v => onChange({ ...webui, useAlternativeLabelDirChooser: v })} label="Use alternative container (window instead of popup)" />
            </div>
          )}
          {webUiInstance?.isLabelSupported && (
            <>
              <div style={{ marginBottom: 8 }}>
                <label style={{ fontWeight: 500, marginBottom: 4, display: "block" }}>Default Label</label>
                <input
                  type="text"
                  value={webui.defaultLabel ?? ""}
                  onChange={e => onChange({ ...webui, defaultLabel: e.target.value })}
                  style={{ ...fieldInputStyle, minWidth: 180 }}
                  placeholder="Default label"
                />
              </div>
              <ChipList label="Labels for per-torrent selection" values={webui.labels} onChange={labels => onChange({ ...webui, labels })} placeholder="Add label" />
            </>
          )}
          {webUiInstance?.isDirSupported && (
            <>
              <div style={{ marginBottom: 8 }}>
                <label style={{ fontWeight: 500, marginBottom: 4, display: "block" }}>Default Directory</label>
                <input
                  type="text"
                  value={webui.defaultDir ?? ""}
                  onChange={e => onChange({ ...webui, defaultDir: e.target.value })}
                  style={{ ...fieldInputStyle, minWidth: 180 }}
                  placeholder="Default directory"
                />
              </div>
              <ChipList label="Directories for per-torrent selection" values={webui.dirs} onChange={dirs => onChange({ ...webui, dirs })} placeholder="Add directory" />
            </>
          )}
          {webUiInstance?.isLabelDirChooserSupported && (
            <AutoLabelDirSettingsEditor
              value={webui.autoLabelDirSettings}
              onChange={autoLabelDirSettings => onChange({ ...webui, autoLabelDirSettings })}
              showLabel={!!webUiInstance?.isLabelSupported}
              showDir={!!webUiInstance?.isDirSupported}
              labels={webui.labels}
              dirs={webui.dirs}
            />
          )}
        </>
      )}
    </div>
  );
}

export default function WebUIsPage() {
  const { settings, updateSetting, loading } = useSettings();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const webuis = settings?.webuiSettings ?? [];

  // Default to the primary WebUI so the page never opens to an empty panel,
  // and keep the selection valid if the selected entry is removed.
  useEffect(() => {
    if (webuis.length === 0) {
      if (selectedId !== null) setSelectedId(null);
    } else if (!webuis.some(w => w.id === selectedId)) {
      setSelectedId(webuis[0].id);
    }
  }, [webuis, selectedId]);

  if (loading || !settings) return <div>Loading...</div>;

  const handleAdd = () => {
    const newWebUI = getDefaultWebUISettings();
    updateSetting("webuiSettings", [...webuis, newWebUI]);
    setSelectedId(newWebUI.id);
  };

  const handleChange = (id: string, updated: WebUISettings) => {
    updateSetting("webuiSettings", webuis.map(w => (w.id === id ? updated : w)));
  };

  const handleRemove = (id: string) => {
    updateSetting("webuiSettings", webuis.filter(w => w.id !== id));
  };

  const handlePromote = (id: string) => {
    const idx = webuis.findIndex(w => w.id === id);
    if (idx <= 0) return; // not found or already primary
    const arr = [...webuis];
    const [item] = arr.splice(idx, 1);
    arr.unshift(item);
    updateSetting("webuiSettings", arr);
  };

  const selected = webuis.find(w => w.id === selectedId) ?? null;

  return (
    <div style={{ display: "flex", gap: 20, alignItems: "stretch", minHeight: 360 }}>
      {/* Left panel: list of configured WebUIs */}
      <div
        style={{
          width: 260,
          flexShrink: 0,
          borderRight: "1px solid var(--rta-border, #b7c9a7)",
          paddingRight: 16,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <span style={{ fontWeight: 700, fontSize: 16 }}>WebUIs</span>
          <button
            onClick={handleAdd}
            title="Add new WebUI"
            aria-label="Add new WebUI"
            style={{
              background: "var(--rta-success, #228B22)",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              width: 32,
              height: 32,
              fontSize: 22,
              lineHeight: 1,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >+</button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {webuis.length === 0 ? (
            <div style={{ color: "var(--rta-text-muted, #888)", fontSize: 14, padding: "8px 4px" }}>
              No WebUIs yet. Click + to add one.
            </div>
          ) : (
            webuis.map((webui, idx) => (
              <WebUIListItem
                key={webui.id}
                webui={webui}
                selected={webui.id === selectedId}
                isPrimary={idx === 0}
                onSelect={() => setSelectedId(webui.id)}
                onNameChange={name => handleChange(webui.id, { ...webui, name })}
              />
            ))
          )}
        </div>
      </div>

      {/* Right panel: configuration for the selected WebUI */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {selected ? (
          <WebUIDetail
            webui={selected}
            onChange={updated => handleChange(selected.id, updated)}
            onRemove={() => handleRemove(selected.id)}
            onPromote={() => handlePromote(selected.id)}
            isPrimary={webuis[0]?.id === selected.id}
          />
        ) : (
          <div style={{ color: "var(--rta-text-muted, #888)", fontSize: 15, paddingTop: 8 }}>
            Select a WebUI on the left, or click + to add a new one.
          </div>
        )}
      </div>
    </div>
  );
}
