import { useEffect, useMemo, useState } from 'react';
import { Button } from '../popup/components/ui/button';
import { Toggle } from '../popup/components/ui/toggle';
import { ComboBox } from '../popup/components/ui/combobox';
import { cn } from '../popup/lib/utils';
import { WebUIFactory } from '../models/clients';
import { WebUISettings } from '../models/webui';
import { BulkCandidate, IBulkAddTorrentsResponse } from '../models/messages';
import { bulkAddTorrents, getBulkData, getClientExistingTorrents, resolveInfoHashes } from './chrome-messaging';

type Filter = 'all' | 'magnet' | 'torrent';

interface Capabilities {
  label: boolean;
  dir: boolean;
  paused: boolean;
  list: boolean;
}

export default function BulkApp() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [candidates, setCandidates] = useState<BulkCandidate[]>([]);
  const [webuis, setWebuis] = useState<WebUISettings[]>([]);
  const [selectedWebUiId, setSelectedWebUiId] = useState('');

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>('all');

  const [label, setLabel] = useState('');
  const [directory, setDirectory] = useState('');
  const [paused, setPaused] = useState(false);
  const [labelOptions, setLabelOptions] = useState<string[]>([]);
  const [directoryOptions, setDirectoryOptions] = useState<string[]>([]);

  // Duplicate detection state
  const [existingHashes, setExistingHashes] = useState<Set<string> | null>(null);
  const [resolved, setResolved] = useState<Record<string, string | null>>({});
  const [checkingDupes, setCheckingDupes] = useState(false);
  const [dupeMessage, setDupeMessage] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [summary, setSummary] = useState<IBulkAddTorrentsResponse | null>(null);

  const selectedSettings = useMemo(
    () => webuis.find(w => w.id === selectedWebUiId) ?? null,
    [webuis, selectedWebUiId]
  );

  const caps: Capabilities = useMemo(() => {
    if (!selectedSettings) {
      return { label: false, dir: false, paused: false, list: false };
    }
    const webui = WebUIFactory.createWebUI(selectedSettings);
    return {
      label: webui?.isLabelSupported ?? false,
      dir: webui?.isDirSupported ?? false,
      paused: webui?.isAddPausedSupported ?? false,
      list: webui?.isListSupported ?? false,
    };
  }, [selectedSettings]);

  useEffect(() => {
    getBulkData()
      .then(data => {
        setCandidates(data.candidates);
        setWebuis(data.webuis);
        setSelectedWebUiId(data.defaultWebUiId ?? '');
        setSelected(new Set(data.candidates.map(c => c.url)));
      })
      .catch(err => setError(err?.message ?? String(err)))
      .finally(() => setLoading(false));
  }, []);

  // Reset config + duplicate info whenever the target client changes.
  useEffect(() => {
    if (!selectedSettings) {
      return;
    }
    setLabelOptions(selectedSettings.labels ?? []);
    setDirectoryOptions(selectedSettings.dirs ?? []);
    setLabel(selectedSettings.defaultLabel ?? selectedSettings.labels?.[0] ?? '');
    setDirectory(selectedSettings.defaultDir ?? selectedSettings.dirs?.[0] ?? '');
    setPaused(selectedSettings.addPaused ?? false);
    setExistingHashes(null);
    setResolved({});
    setDupeMessage(null);
  }, [selectedWebUiId]); // eslint-disable-line react-hooks/exhaustive-deps

  const hashFor = (c: BulkCandidate): string | null | undefined =>
    (c.infoHash ?? resolved[c.url])?.toLowerCase();

  const isDupe = (c: BulkCandidate): boolean => {
    if (!existingHashes) {
      return false;
    }
    const h = hashFor(c);
    return !!h && existingHashes.has(h);
  };

  const filtered = candidates.filter(c =>
    filter === 'all' ? true : filter === 'magnet' ? c.isMagnet : !c.isMagnet
  );

  const selectedCount = candidates.filter(c => selected.has(c.url)).length;
  const selectedDupeCount = candidates.filter(c => selected.has(c.url) && isDupe(c)).length;

  const toggle = (url: string) =>
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(url)) {
        next.delete(url);
      } else {
        next.add(url);
      }
      return next;
    });

  const selectAllFiltered = () =>
    setSelected(prev => {
      const next = new Set(prev);
      filtered.forEach(c => next.add(c.url));
      return next;
    });

  const selectNoneFiltered = () =>
    setSelected(prev => {
      const next = new Set(prev);
      filtered.forEach(c => next.delete(c.url));
      return next;
    });

  const selectNonDuplicates = () =>
    setSelected(new Set(candidates.filter(c => !isDupe(c)).map(c => c.url)));

  const handleCheckDuplicates = async () => {
    if (!selectedWebUiId) {
      return;
    }
    setCheckingDupes(true);
    setDupeMessage(null);
    try {
      const existing = await getClientExistingTorrents(selectedWebUiId);
      if (!existing.supported) {
        setExistingHashes(null);
        setDupeMessage(existing.error ?? 'Could not read the torrent list from this client.');
        return;
      }
      const hashSet = new Set(existing.infoHashes.map(h => h.toLowerCase()));
      if (existing.labels.length) {
        setLabelOptions(prev => Array.from(new Set([...prev, ...existing.labels])));
      }

      const toResolve = candidates
        .filter(c => !c.isMagnet && !c.infoHash && !(c.url in resolved))
        .map(c => c.url);
      let resolvedMap = resolved;
      if (toResolve.length) {
        const res = await resolveInfoHashes(toResolve);
        resolvedMap = { ...resolved, ...res.results };
        setResolved(resolvedMap);
      }

      setExistingHashes(hashSet);

      // Discard duplicates by default; the user can re-check a row to override.
      let dupeCount = 0;
      setSelected(prev => {
        const next = new Set(prev);
        candidates.forEach(c => {
          const h = (c.infoHash ?? resolvedMap[c.url])?.toLowerCase();
          if (h && hashSet.has(h)) {
            dupeCount++;
            next.delete(c.url);
          }
        });
        return next;
      });
      setDupeMessage(
        dupeCount > 0
          ? `${dupeCount} already on ${selectedSettings?.name ?? 'the client'} — deselected. Re-check a row to add it anyway.`
          : 'No duplicates found.'
      );
    } catch (e: any) {
      setDupeMessage(e?.message ?? String(e));
    } finally {
      setCheckingDupes(false);
    }
  };

  const handleAdd = async () => {
    const items = candidates
      .filter(c => selected.has(c.url))
      .map(c => ({ url: c.url, name: c.name, isMagnet: c.isMagnet }));
    if (!items.length || !selectedWebUiId) {
      return;
    }
    setAdding(true);
    setError(null);
    const augmentedLabels = caps.label
      ? [label, ...labelOptions.filter(x => x !== label)].filter(Boolean)
      : labelOptions;
    const augmentedDirs = caps.dir
      ? [directory, ...directoryOptions.filter(x => x !== directory)].filter(Boolean)
      : directoryOptions;
    try {
      const result = await bulkAddTorrents({
        webUiId: selectedWebUiId,
        items,
        config: {
          label: caps.label && label ? label : undefined,
          dir: caps.dir && directory ? directory : undefined,
          addPaused: caps.paused ? paused : undefined,
        },
        labels: augmentedLabels,
        directories: augmentedDirs,
      });
      setSummary(result);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setAdding(false);
    }
  };

  if (loading) {
    return <Centered>Loading…</Centered>;
  }

  if (summary) {
    return <Summary summary={summary} clientName={selectedSettings?.name} onClose={() => window.close()} />;
  }

  return (
    <div className="min-h-full bg-background p-5 text-foreground">
      <div className="mx-auto max-w-2xl space-y-4">
        <header>
          <h1 className="text-lg font-bold">Add multiple torrents</h1>
          <p className="text-xs text-muted-foreground">
            {candidates.length} link{candidates.length === 1 ? '' : 's'} found on this page · {selectedCount} selected
          </p>
        </header>

        {error && (
          <div className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {webuis.length === 0 ? (
          <div className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
            No clients configured. Open the extension options to add one.
          </div>
        ) : (
          <>
            <div className="space-y-3 rounded-lg border border-border bg-card p-4 shadow-sm">
              <div>
                <label className="mb-2 block text-sm font-medium">Send to</label>
                <select
                  value={selectedWebUiId}
                  onChange={e => setSelectedWebUiId(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {webuis.map(w => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </div>

              {caps.label && (
                <ComboBox
                  label="Label (applied to all)"
                  value={label}
                  onChange={setLabel}
                  options={labelOptions}
                  placeholder="Select or type label…"
                />
              )}
              {caps.dir && (
                <ComboBox
                  label="Directory (applied to all)"
                  value={directory}
                  onChange={setDirectory}
                  options={directoryOptions}
                  placeholder="Select or type directory…"
                />
              )}
              {caps.paused && (
                <Toggle label="Start paused" checked={paused} onChange={setPaused} />
              )}
            </div>

            <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-3 text-sm shadow-sm">
              {caps.list ? (
                <Button variant="outline" size="sm" onClick={handleCheckDuplicates} disabled={checkingDupes}>
                  {checkingDupes ? 'Checking…' : 'Check for duplicates'}
                </Button>
              ) : (
                <span className="text-muted-foreground">Duplicate detection isn’t available for this client.</span>
              )}
              {dupeMessage && <span className="text-muted-foreground">{dupeMessage}</span>}
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <select
                value={filter}
                onChange={e => setFilter(e.target.value as Filter)}
                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              >
                <option value="all">All ({candidates.length})</option>
                <option value="magnet">Magnets ({candidates.filter(c => c.isMagnet).length})</option>
                <option value="torrent">.torrent ({candidates.filter(c => !c.isMagnet).length})</option>
              </select>
              <Button variant="ghost" size="sm" onClick={selectAllFiltered}>Select all</Button>
              <Button variant="ghost" size="sm" onClick={selectNoneFiltered}>Select none</Button>
              {existingHashes && (
                <Button variant="ghost" size="sm" onClick={selectNonDuplicates}>Only non-duplicates</Button>
              )}
            </div>

            <div className="max-h-80 overflow-auto rounded-lg border border-border bg-card shadow-sm">
              {filtered.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">No matching links.</div>
              ) : (
                <ul className="divide-y divide-border">
                  {filtered.map(c => {
                    const dupe = isDupe(c);
                    const checked = selected.has(c.url);
                    return (
                      <li
                        key={c.url}
                        className={cn(
                          'flex items-center gap-3 px-3 py-2',
                          dupe && 'bg-destructive/5'
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(c.url)}
                          className="h-4 w-4 shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm" title={c.name}>{c.name}</div>
                          <div className="truncate text-xs text-muted-foreground" title={c.url}>{c.url}</div>
                        </div>
                        <span className={cn(
                          'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase',
                          c.isMagnet ? 'bg-accent text-accent-foreground' : 'bg-secondary text-secondary-foreground'
                        )}>
                          {c.isMagnet ? 'magnet' : 'torrent'}
                        </span>
                        {dupe && (
                          <span className="shrink-0 rounded bg-destructive px-1.5 py-0.5 text-[10px] font-medium uppercase text-destructive-foreground">
                            duplicate
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="space-y-2">
              {selectedDupeCount > 0 && (
                <p className="text-xs text-destructive">
                  {selectedDupeCount} of your selection {selectedDupeCount === 1 ? 'is a' : 'are'} duplicate{selectedDupeCount === 1 ? '' : 's'} (will be added anyway).
                </p>
              )}
              <Button
                className="w-full"
                onClick={handleAdd}
                disabled={adding || selectedCount === 0 || !selectedWebUiId}
              >
                {adding ? 'Adding…' : `Add ${selectedCount} torrent${selectedCount === 1 ? '' : 's'}`}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center bg-background p-6 text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function Summary({
  summary,
  clientName,
  onClose,
}: {
  summary: IBulkAddTorrentsResponse;
  clientName?: string;
  onClose: () => void;
}) {
  const failures = summary.details.filter(d => !d.success);
  return (
    <div className="min-h-full bg-background p-5 text-foreground">
      <div className="mx-auto max-w-2xl space-y-4">
        <header>
          <h1 className="text-lg font-bold">Bulk add complete</h1>
          <p className="text-sm text-muted-foreground">
            {summary.added} of {summary.total} added{clientName ? ` to ${clientName}` : ''}
            {summary.failed > 0 ? ` · ${summary.failed} failed` : ''}
          </p>
        </header>
        {failures.length > 0 && (
          <div className="max-h-80 overflow-auto rounded-lg border border-border bg-card shadow-sm">
            <ul className="divide-y divide-border">
              {failures.map(f => (
                <li key={f.url} className="px-3 py-2">
                  <div className="truncate text-sm" title={f.name}>{f.name}</div>
                  <div className="truncate text-xs text-destructive" title={f.error}>{f.error ?? 'Failed'}</div>
                </li>
              ))}
            </ul>
          </div>
        )}
        <Button className="w-full" onClick={onClose}>Close</Button>
      </div>
    </div>
  );
}
