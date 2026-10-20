import { useEffect, useState } from 'react';
import { api } from '../api.js';

/** Réglage du serveur, tel que renvoyé par l’API. Les secrets n’ont jamais de valeur (value = null). */
interface Setting {
  env: string;
  label: string;
  help: string;
  group: string;
  kind: 'text' | 'secret' | 'int' | 'choice' | 'bool';
  choices?: string[];
  min?: number;
  max?: number;
  value: string | null;
  source: 'app' | 'fichier' | 'defaut';
  configured: boolean;
  defaultValue: string;
}

interface Payload {
  settings: Setting[];
  groups: { id: string; title: string; text: string }[];
  pendingRestart: boolean;
}

const SOURCE_LABEL: Record<Setting['source'], string> = {
  app: 'Réglé dans l’application',
  fichier: 'Fichier .env',
  defaut: 'Valeur par défaut',
};

function SettingRow({
  setting,
  busy,
  onSave,
}: {
  setting: Setting;
  busy: boolean;
  onSave: (env: string, value: string) => void;
}) {
  const initial = setting.kind === 'secret' ? '' : (setting.value ?? '');
  const [draft, setDraft] = useState(initial);
  // Une valeur enregistrée remplace le brouillon (après sauvegarde ou rétablissement).
  useEffect(() => setDraft(initial), [initial]);

  const id = `setting-${setting.env}`;
  const label = (
    <label htmlFor={id}>
      <strong>{setting.label}</strong>
      <span className="muted small">
        {' '}
        · {SOURCE_LABEL[setting.source]}
        {setting.source === 'defaut' ? ` (${setting.defaultValue || 'vide'})` : ''}
      </span>
    </label>
  );

  if (setting.kind === 'bool') {
    return (
      <div className="stack">
        {label}
        <select
          id={id}
          value={setting.value ?? 'false'}
          disabled={busy}
          onChange={(e) => onSave(setting.env, e.target.value)}
        >
          <option value="true">Oui</option>
          <option value="false">Non</option>
        </select>
        <p className="muted small">{setting.help}</p>
        {setting.source === 'app' && <ResetButton busy={busy} onReset={() => onSave(setting.env, '')} />}
      </div>
    );
  }

  if (setting.kind === 'choice') {
    return (
      <div className="stack">
        {label}
        <select
          id={id}
          value={setting.value ?? ''}
          disabled={busy}
          onChange={(e) => onSave(setting.env, e.target.value)}
        >
          {(setting.choices ?? []).map((choice) => (
            <option key={choice} value={choice}>
              {choice}
            </option>
          ))}
        </select>
        <p className="muted small">{setting.help}</p>
        {setting.source === 'app' && <ResetButton busy={busy} onReset={() => onSave(setting.env, '')} />}
      </div>
    );
  }

  const secret = setting.kind === 'secret';
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(setting.env, draft);
      }}
    >
      {label}
      <div className="row">
        <input
          id={id}
          type={secret ? 'password' : setting.kind === 'int' ? 'number' : 'text'}
          autoComplete="off"
          value={draft}
          min={setting.min}
          max={setting.max}
          placeholder={secret ? (setting.configured ? '•••••••• (défini)' : 'non défini') : setting.defaultValue}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button
          type="submit"
          className="btn primary small"
          disabled={busy || (secret ? draft === '' : draft === initial)}
        >
          Enregistrer
        </button>
        {setting.source === 'app' && <ResetButton busy={busy} onReset={() => onSave(setting.env, '')} />}
      </div>
      <p className="muted small">{setting.help}</p>
    </form>
  );
}

function ResetButton({ busy, onReset }: { busy: boolean; onReset: () => void }) {
  return (
    <button type="button" className="btn ghost small" disabled={busy} onClick={onReset}>
      Rétablir la valeur du fichier .env
    </button>
  );
}

/**
 * Réglages du serveur : tout ce qui se réglait dans le fichier .env, modifiable ici. Une valeur saisie prend le pas
 * sur .env ; elle est appliquée au redémarrage. L’adresse et les ports restent dans .env (ils dépendent du conteneur).
 */
export function ServerSettings() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setPayload(await api<Payload>('/api/admin/server-settings'));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save(env: string, value: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      setPayload(
        await api<Payload>(`/api/admin/server-settings/${encodeURIComponent(env)}`, {
          method: 'PUT',
          body: JSON.stringify({ value }),
        }),
      );
      setMessage(value === '' ? `${env} : retour à la valeur du fichier .env.` : `${env} enregistré.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function restart() {
    if (!window.confirm('Redémarrer PartyHub maintenant ? Les parties en cours seront interrompues.')) return;
    setBusy(true);
    try {
      await api('/api/admin/server-settings/restart', { method: 'POST' });
      setMessage('PartyHub redémarre. La page se rechargera dans quelques secondes.');
      setTimeout(() => window.location.reload(), 6000);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (!payload) {
    return error ? (
      <p className="error" role="alert">
        {error}
      </p>
    ) : (
      <p className="muted">Chargement…</p>
    );
  }

  return (
    <div className="stack">
      {payload.pendingRestart && (
        <div className="notice" role="status">
          <p>Des réglages attendent un redémarrage pour prendre effet.</p>
          <button type="button" className="btn primary small" disabled={busy} onClick={restart}>
            Redémarrer PartyHub
          </button>
        </div>
      )}
      {message && <p role="status">{message}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {payload.groups.map((group) => {
        const rows = payload.settings.filter((s) => s.group === group.id);
        if (rows.length === 0) return null;
        return (
          <section key={group.id} className="stack" aria-label={group.title}>
            <h3>{group.title}</h3>
            <p className="muted small">{group.text}</p>
            {rows.map((setting) => (
              <SettingRow key={setting.env} setting={setting} busy={busy} onSave={save} />
            ))}
          </section>
        );
      })}

      <p className="muted small">
        Restent dans le fichier .env : l’adresse du serveur (<code>PARTYHUB_HOST</code>), les ports HTTPS et les
        dossiers de données. Ils dépendent du conteneur, voir{' '}
        <a href="https://github.com/matosman40/Partyhub/blob/main/docs/HTTPS-LAN.md">docs/HTTPS-LAN.md</a>.
      </p>
    </div>
  );
}
