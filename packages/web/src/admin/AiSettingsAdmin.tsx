import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api.js';

/**
 * Fournisseurs d’IA : clés saisies ici, modèle, adresse (« Autre service »), interrupteur et test.
 * Le serveur ne renvoie jamais une clé : on voit seulement si elle existe et d’où elle vient.
 */

type KeySource = 'admin' | 'env' | 'unreadable' | 'none';

interface AiProviderStatus {
  id: string;
  label: string;
  free: boolean;
  keySource: KeySource;
  enabled: boolean;
  active: boolean;
  problem: string | null;
  model: string;
  defaultModel: string | null;
  baseUrl: string | null;
  customBaseUrl: boolean;
  maxCallsPerDay: number | null;
}

interface AiStatus {
  providers: AiProviderStatus[];
  timeoutMs: number;
  maxCallsPerHour: number;
  chain: string[];
}

const KEY_TEXT: Record<KeySource, string> = {
  admin: 'Clé enregistrée ici, chiffrée sur le serveur.',
  env: 'Clé fournie par le serveur (variable d’environnement).',
  unreadable: 'Clé illisible : ressaisissez-la.',
  none: 'Aucune clé.',
};

type Note = { ok: boolean; text: string } | null;

export function AiSettingsAdmin() {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<AiStatus>('/api/admin/ai')
      .then(setStatus)
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error)
    return (
      <p className="error" role="alert">
        {error}
      </p>
    );
  if (!status) return <p className="muted">Chargement…</p>;

  const names = status.chain.map((id) => status.providers.find((p) => p.id === id)?.label ?? id);
  return (
    <div className="stack">
      <p className="muted small">
        Les clés saisies ici sont chiffrées sur le serveur et ne reviennent jamais dans cette page. Sans clé saisie ici,
        la clé fournie par le serveur reste utilisée. Les changements s’appliquent tout de suite.
      </p>
      <p>
        {names.length > 0
          ? `Ordre d’appel : ${names.join(', puis ')}. Si l’un échoue, le suivant prend le relais.`
          : 'Aucune IA active : les jeux racontés utilisent leur histoire de secours.'}
      </p>
      {status.providers.map((provider) => (
        <AiProviderCard key={provider.id} provider={provider} onStatus={setStatus} />
      ))}
    </div>
  );
}

function AiProviderCard({ provider: p, onStatus }: { provider: AiProviderStatus; onStatus: (next: AiStatus) => void }) {
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(p.model);
  const [baseUrl, setBaseUrl] = useState(p.baseUrl ?? '');
  const [perDay, setPerDay] = useState(p.maxCallsPerDay === null ? '' : String(p.maxCallsPerDay));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);

  // Quand le serveur renvoie de nouveaux réglages, les champs reprennent leurs valeurs.
  useEffect(() => {
    setModel(p.model);
    setBaseUrl(p.baseUrl ?? '');
    setPerDay(p.maxCallsPerDay === null ? '' : String(p.maxCallsPerDay));
  }, [p.model, p.baseUrl, p.maxCallsPerDay]);

  async function save(patch: Record<string, unknown>, okText: string) {
    setBusy(true);
    setNote(null);
    try {
      const next = await api<AiStatus>(`/api/admin/ai/${p.id}`, { method: 'PUT', body: JSON.stringify(patch) });
      onStatus(next);
      setApiKey('');
      setNote({ ok: true, text: okText });
    } catch (err) {
      setNote({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function runTest() {
    setBusy(true);
    setNote(null);
    try {
      const res = await api<{ ok: boolean; message: string }>(`/api/admin/ai/${p.id}/test`, { method: 'POST' });
      setNote({ ok: res.ok, text: res.message });
    } catch (err) {
      setNote({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const patch: Record<string, unknown> = {};
    if (apiKey.trim()) patch.apiKey = apiKey.trim();
    if (model.trim() !== p.model) patch.model = model.trim() || null;
    if (p.customBaseUrl && baseUrl.trim() !== (p.baseUrl ?? '')) patch.baseUrl = baseUrl.trim() || null;
    const day = perDay.trim() === '' ? null : Number(perDay);
    if (day !== p.maxCallsPerDay) patch.maxCallsPerDay = day;
    if (Object.keys(patch).length === 0) {
      setNote({ ok: true, text: 'Rien à enregistrer.' });
      return;
    }
    void save(patch, 'Réglages enregistrés.');
  }

  const state = !p.enabled
    ? 'Désactivé.'
    : p.active
      ? 'Actif : il répond dans l’ordre d’appel.'
      : (p.problem ?? 'Inactif.');

  return (
    <article className="ai-provider">
      <header>
        <h3>{p.label}</h3>
        <span className={`badge${p.free ? ' ready' : ''}`}>{p.free ? 'Palier gratuit' : 'Payant'}</span>
      </header>
      <p className="small">
        {KEY_TEXT[p.keySource]}
        {p.keySource === 'none' ? '' : ` ${state}`}
      </p>
      <form className="admin-form" onSubmit={onSubmit}>
        <label className="field">
          <span>{p.keySource === 'admin' ? 'Remplacer la clé' : 'Clé d’API'}</span>
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={p.keySource === 'admin' ? 'Nouvelle clé (facultatif)' : 'Coller la clé'}
            value={apiKey}
            disabled={busy}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Modèle</span>
          <input
            type="text"
            value={model}
            placeholder={p.defaultModel ?? 'Nom du modèle'}
            disabled={busy}
            onChange={(e) => setModel(e.target.value)}
          />
        </label>
        {p.customBaseUrl && (
          <label className="field">
            <span>Adresse du service</span>
            <input
              type="url"
              value={baseUrl}
              placeholder="https://…"
              disabled={busy}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </label>
        )}
        <label className="field">
          <span>Appels maximum par jour (facultatif)</span>
          <input
            type="number"
            min={1}
            max={1000000}
            value={perDay}
            disabled={busy}
            onChange={(e) => setPerDay(e.target.value)}
          />
        </label>
        <div className="ai-provider-actions">
          <button type="submit" className="btn primary" disabled={busy}>
            Enregistrer
          </button>
          <button type="button" className="btn ghost" disabled={busy} onClick={() => void runTest()}>
            Tester
          </button>
          {p.keySource === 'admin' && (
            <button
              type="button"
              className="btn ghost"
              disabled={busy}
              onClick={() => void save({ apiKey: null }, 'Clé retirée de l’administration.')}
            >
              Retirer la clé
            </button>
          )}
          <label className="check">
            <input
              type="checkbox"
              checked={p.enabled}
              disabled={busy}
              onChange={(e) =>
                void save(
                  { enabled: e.target.checked },
                  e.target.checked ? 'Fournisseur activé.' : 'Fournisseur désactivé.',
                )
              }
            />
            <span>Activé</span>
          </label>
        </div>
        {note && (
          <p className={note.ok ? 'notice' : 'error'} role="status">
            {note.text}
          </p>
        )}
      </form>
    </article>
  );
}
