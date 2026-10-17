import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../api.js';

interface JournalEntry {
  time: string;
  level: string;
  source: string;
  event: string;
  message: string;
  details: Record<string, unknown>;
}

interface JournalGroup {
  level: string;
  event: string;
  message: string;
  count: number;
  lastSeen: string;
}

interface JournalResult {
  entries: JournalEntry[];
  matched: number;
  groups: JournalGroup[];
  files: number;
  sizeBytes: number;
}

type LevelFilter = 'warn' | 'error' | 'all';

const LEVEL_LABEL: Record<string, string> = {
  fatal: 'Fatal',
  error: 'Erreur',
  warn: 'Alerte',
  info: 'Info',
  debug: 'Debug',
  trace: 'Trace',
};

const SOURCE_LABEL: Record<string, string> = { server: 'Serveur', client: 'Navigateur' };

function when(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('fr-FR');
}

/** Lit un téléchargement binaire et lève une erreur lisible si le serveur a refusé. */
async function readOrThrow(res: Response): Promise<void> {
  if (res.ok) return;
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  throw new Error(data.error ?? 'Erreur inattendue.');
}

/**
 * Journal des erreurs : serveur et navigateur dans un même fil, filtrables.
 * Les erreurs les plus fréquentes sont regroupées en tête ; chaque entrée se déplie pour voir sa pile d’appels.
 */
export function LogsAdmin() {
  const [level, setLevel] = useState<LevelFilter>('warn');
  const [source, setSource] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [data, setData] = useState<JournalResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const params = new URLSearchParams({ level, limit: '200' });
      if (source) params.set('source', source);
      if (query) params.set('q', query);
      setData(await api<JournalResult>(`/api/admin/logs?${params.toString()}`));
      setMessage(null);
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [level, source, query]);

  useEffect(() => {
    void load();
  }, [load]);

  function submitSearch(e: FormEvent) {
    e.preventDefault();
    setQuery(search.trim());
  }

  async function download() {
    setMessage(null);
    try {
      const res = await fetch('/api/admin/logs/download');
      await readOrThrow(res);
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `partyhub-journal-${new Date().toISOString().slice(0, 10)}.jsonl`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setMessage((err as Error).message);
    }
  }

  async function clear() {
    if (!window.confirm('Vider tout le journal ? Cette action est définitive.')) return;
    try {
      await api('/api/admin/logs', { method: 'DELETE' });
      setMessage('Journal vidé.');
      void load();
    } catch (err) {
      setMessage((err as Error).message);
    }
  }

  return (
    <div className="stack logs-admin">
      <p className="muted small">
        Chaque ligne donne l’heure, le niveau, la source (serveur ou navigateur), l’événement et le détail. Le champ «
        req » d’une erreur serveur renvoie à la requête qui l’a provoquée.
      </p>

      <div className="log-toolbar">
        <label className="field">
          <span>Niveau</span>
          <select value={level} onChange={(e) => setLevel(e.target.value as LevelFilter)}>
            <option value="warn">Alertes et erreurs</option>
            <option value="error">Erreurs seulement</option>
            <option value="all">Tout, y compris l’information</option>
          </select>
        </label>
        <label className="field">
          <span>Source</span>
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">Serveur et navigateur</option>
            <option value="server">Serveur</option>
            <option value="client">Navigateur</option>
          </select>
        </label>
        <form className="log-search" onSubmit={submitSearch}>
          <label className="field">
            <span>Chercher</span>
            <input
              type="search"
              value={search}
              placeholder="Message, événement, salle…"
              maxLength={200}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <button type="submit" className="btn">
            Chercher
          </button>
        </form>
      </div>

      <div className="log-actions">
        <button type="button" className="btn ghost" onClick={() => void load()} disabled={busy}>
          {busy ? 'Chargement…' : 'Actualiser'}
        </button>
        <button type="button" className="btn ghost" onClick={download}>
          Télécharger le journal
        </button>
        <button type="button" className="btn ghost" onClick={clear}>
          Vider le journal
        </button>
      </div>

      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}

      {data && (
        <>
          <p className="muted small">
            {data.matched} entrée(s) correspondante(s) · {data.files} fichier(s), {Math.round(data.sizeBytes / 1024)} Ko
            conservés
          </p>

          {data.groups.length > 0 && (
            <section className="log-groups" aria-label="Erreurs les plus fréquentes">
              <h3>Erreurs les plus fréquentes</h3>
              <ol className="log-list">
                {data.groups.map((g) => (
                  <li key={`${g.level}|${g.event}|${g.message}`} className={`log-row log-${g.level}`}>
                    <span className="log-count">×{g.count}</span>
                    <span className={`log-level log-level-${g.level}`}>{LEVEL_LABEL[g.level] ?? g.level}</span>
                    <span className="log-event">{g.event}</span>
                    <span className="log-message">{g.message}</span>
                    <span className="muted small">dernière : {when(g.lastSeen)}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {data.entries.length === 0 ? (
            <p className="muted">Aucune entrée pour ces filtres.</p>
          ) : (
            <ol className="log-list">
              {data.entries.map((e, i) => (
                <li key={`${e.time}-${i}`} className={`log-row log-${e.level}`}>
                  <details>
                    <summary>
                      <span className="log-time">{when(e.time)}</span>
                      <span className={`log-level log-level-${e.level}`}>{LEVEL_LABEL[e.level] ?? e.level}</span>
                      <span className="log-source">{SOURCE_LABEL[e.source] ?? e.source}</span>
                      <span className="log-event">{e.event}</span>
                      <span className="log-message">{e.message}</span>
                    </summary>
                    <pre className="log-details">{JSON.stringify(e.details, null, 2)}</pre>
                  </details>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  );
}
