import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { api } from '../api.js';

/**
 * Éditeur des jeux de code : création depuis le modèle, fichiers et vérification.
 * Un brouillon ne joue jamais, et PartyHub ne signe rien : l'auteur signe le paquet hors de PartyHub.
 */

interface DraftSummary {
  id: string;
  name: string;
  version: string;
  updatedAt: string;
  installed: { version: string; status: 'en_attente' | 'active' | 'remplacee' | 'erreur' } | null;
  broken: boolean;
}

interface DraftDetail extends DraftSummary {
  description: string;
  author: string;
  files: { path: string; size: number; protected: boolean }[];
}

interface CheckReport {
  ok: boolean;
  lines: string[];
}

const INSTALLED_LABEL: Record<NonNullable<DraftSummary['installed']>['status'], string> = {
  en_attente: 'en attente de revue',
  active: 'active',
  remplacee: 'remplacée',
  erreur: 'en erreur',
};

/** Fichier ouvert à l'ouverture d'un brouillon : le code du jeu. */
const DEFAULT_FILE = 'src/server.ts';

const enc = encodeURIComponent;

export function CodeEditorAdmin() {
  const [drafts, setDrafts] = useState<DraftSummary[] | null>(null);
  const [draft, setDraft] = useState<DraftDetail | null>(null);
  const [filePath, setFilePath] = useState('');
  const [content, setContent] = useState('');
  const [saved, setSaved] = useState('');
  const [newFile, setNewFile] = useState('');
  const [meta, setMeta] = useState({ name: '', description: '', version: '' });
  const [newDraft, setNewDraft] = useState({ id: '', name: '', author: '' });
  /** Chaque sauvegarde change la révision : une vérification ne vaut que pour la révision qu'elle a lue. */
  const revisionRef = useRef(0);
  const [revision, setRevision] = useState(0);
  const [check, setCheck] = useState<(CheckReport & { revision: number }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const dirty = draft !== null && filePath !== '' && content !== saved;
  /** Vrai quand la dernière vérification vaut pour le code affiché : le paquet peut alors être signé hors de PartyHub. */
  const readyToSign = Boolean(draft && check?.ok && check.revision === revision && !dirty && !busy);

  function fail(err: unknown) {
    setError((err as Error).message);
    setIssues((err as { issues?: string[] }).issues ?? []);
  }

  function clearMessages() {
    setError(null);
    setIssues([]);
    setNotice(null);
  }

  function bump() {
    revisionRef.current += 1;
    setRevision(revisionRef.current);
  }

  async function loadDrafts() {
    try {
      setDrafts((await api<{ drafts: DraftSummary[] }>('/api/admin/code-drafts')).drafts);
    } catch (err) {
      fail(err);
    }
  }

  // Chargement initial seulement : les fonctions ci-dessus ne dépendent que de l'état qu'elles mettent à jour.
  useEffect(() => {
    void loadDrafts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshDraft(id: string) {
    const res = await api<{ draft: DraftDetail }>(`/api/admin/code-drafts/${enc(id)}`);
    setDraft(res.draft);
    return res.draft;
  }

  async function loadFile(id: string, path: string) {
    const res = await api<{ content: string }>(`/api/admin/code-drafts/${enc(id)}/file?path=${enc(path)}`);
    setFilePath(path);
    setContent(res.content);
    setSaved(res.content);
  }

  /** Enregistre le fichier ouvert s'il a changé. Renvoie faux si l'enregistrement a échoué. */
  async function saveFile(): Promise<boolean> {
    if (!draft || !dirty) return true;
    setBusy(true);
    clearMessages();
    try {
      await api(`/api/admin/code-drafts/${enc(draft.id)}/file`, {
        method: 'PUT',
        body: JSON.stringify({ path: filePath, content }),
      });
      setSaved(content);
      bump();
      return true;
    } catch (err) {
      fail(err);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function openDraft(id: string) {
    if (draft && !(await saveFile())) return;
    clearMessages();
    setCheck(null);
    try {
      const opened = await refreshDraft(id);
      setMeta({ name: opened.name, description: opened.description, version: opened.version });
      const first = opened.files.find((f) => f.path === DEFAULT_FILE) ?? opened.files[0];
      if (first) await loadFile(id, first.path);
      else {
        setFilePath('');
        setContent('');
        setSaved('');
      }
    } catch (err) {
      fail(err);
    }
  }

  async function switchFile(path: string) {
    if (!draft || path === filePath) return;
    if (!(await saveFile())) return;
    try {
      await loadFile(draft.id, path);
    } catch (err) {
      fail(err);
    }
  }

  async function closeDraft() {
    if (!(await saveFile())) return;
    setDraft(null);
    setFilePath('');
    setContent('');
    setSaved('');
    setCheck(null);
    clearMessages();
    await loadDrafts();
  }

  async function createDraft(event: FormEvent) {
    event.preventDefault();
    if (!(await saveFile())) return;
    clearMessages();
    setBusy(true);
    try {
      const res = await api<{ draft: DraftDetail }>('/api/admin/code-drafts', {
        method: 'POST',
        body: JSON.stringify(newDraft),
      });
      setNewDraft({ id: '', name: '', author: '' });
      await loadDrafts();
      await openDraft(res.draft.id);
      setNotice(`Brouillon « ${res.draft.name} » créé. Modifiez le code, puis vérifiez-le.`);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function removeDraft(item: DraftSummary) {
    if (
      !window.confirm(`Supprimer le brouillon « ${item.name} » ? Les versions déjà installées ne sont pas touchées.`)
    ) {
      return;
    }
    clearMessages();
    try {
      await api(`/api/admin/code-drafts/${enc(item.id)}`, { method: 'DELETE' });
      if (draft?.id === item.id) {
        setDraft(null);
        setFilePath('');
        setContent('');
        setSaved('');
        setCheck(null);
      }
      setNotice(`Brouillon « ${item.name} » supprimé.`);
      await loadDrafts();
    } catch (err) {
      fail(err);
    }
  }

  async function addFile(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    const path = newFile.trim();
    if (!path) return;
    if (draft.files.some((f) => f.path === path)) {
      setError(`« ${path} » existe déjà : ouvrez-le dans la liste.`);
      return;
    }
    if (!(await saveFile())) return;
    clearMessages();
    setBusy(true);
    try {
      await api(`/api/admin/code-drafts/${enc(draft.id)}/file`, {
        method: 'PUT',
        body: JSON.stringify({ path, content: '' }),
      });
      setNewFile('');
      bump();
      await refreshDraft(draft.id);
      await loadFile(draft.id, path);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function removeFile(path: string) {
    if (!draft) return;
    if (!window.confirm(`Supprimer « ${path} » ?`)) return;
    clearMessages();
    try {
      await api(`/api/admin/code-drafts/${enc(draft.id)}/file?path=${enc(path)}`, { method: 'DELETE' });
      bump();
      const refreshed = await refreshDraft(draft.id);
      if (filePath === path) {
        const next = refreshed.files.find((f) => f.path === DEFAULT_FILE) ?? refreshed.files[0];
        if (next) await loadFile(draft.id, next.path);
        else {
          setFilePath('');
          setContent('');
          setSaved('');
        }
      }
    } catch (err) {
      fail(err);
    }
  }

  /** Nom, description, version : écrits dans manifest.json et src/server.ts à la fois. */
  async function saveMeta(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    if (!(await saveFile())) return;
    clearMessages();
    setBusy(true);
    try {
      await api(`/api/admin/code-drafts/${enc(draft.id)}/metadata`, {
        method: 'POST',
        body: JSON.stringify(meta),
      });
      bump();
      const refreshed = await refreshDraft(draft.id);
      setMeta({ name: refreshed.name, description: refreshed.description, version: refreshed.version });
      // src/server.ts a pu changer sur le disque : on relit le fichier ouvert.
      if (filePath) await loadFile(draft.id, filePath);
      setNotice('Informations enregistrées.');
      await loadDrafts();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function runCheck() {
    if (!draft) return;
    if (!(await saveFile())) return;
    clearMessages();
    setBusy(true);
    try {
      const report = await api<CheckReport>(`/api/admin/code-drafts/${enc(draft.id)}/check`, { method: 'POST' });
      setCheck({ ...report, revision: revisionRef.current });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  /** Ctrl+S (ou Cmd+S) enregistre le fichier ouvert, sans quitter l'éditeur. */
  function onEditorKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void saveFile();
    }
  }

  const checkState = !check
    ? 'pas encore lancée'
    : check.revision !== revision || dirty
      ? 'à refaire : le code a changé depuis la dernière vérification'
      : check.ok
        ? 'réussie'
        : 'échouée';

  return (
    <div className="stack">
      <h4>Créer et modifier un jeu de code</h4>
      <p className="muted small">
        Un brouillon est le dossier source d’un jeu. Il ne joue jamais. PartyHub ne détient aucune clé : l’auteur signe
        le paquet hors de PartyHub, puis le paquet arrive en revue par le dossier de dépôt ou par un lien.
      </p>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {issues.length > 0 && (
        <ul className="error small">
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}
      {notice && (
        <p className="muted" role="status">
          {notice}
        </p>
      )}

      <form className="admin-form" onSubmit={createDraft} aria-label="Nouveau jeu de code">
        <label className="field">
          <span>Identifiant</span>
          <input
            type="text"
            placeholder="mon-jeu"
            value={newDraft.id}
            disabled={busy}
            onChange={(e) => setNewDraft({ ...newDraft, id: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Nom affiché</span>
          <input
            type="text"
            placeholder="Mon jeu"
            value={newDraft.name}
            disabled={busy}
            onChange={(e) => setNewDraft({ ...newDraft, name: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Auteur</span>
          <input
            type="text"
            value={newDraft.author}
            disabled={busy}
            onChange={(e) => setNewDraft({ ...newDraft, author: e.target.value })}
          />
        </label>
        <button type="submit" className="btn primary" disabled={busy || !newDraft.id || !newDraft.name}>
          Créer un jeu depuis le modèle
        </button>
      </form>

      {drafts === null && <p className="muted">Chargement des brouillons…</p>}
      {drafts?.length === 0 && <p className="muted">Aucun brouillon. Créez un jeu ci-dessus.</p>}
      <ul className="ed-list">
        {drafts?.map((item) => (
          <li key={item.id} className="ed-list-item">
            <div className="ed-list-preview" aria-hidden="true">
              ✏️
            </div>
            <div className="ed-list-body">
              <strong>{item.name}</strong>
              <span className="muted small">
                {item.id} · version {item.version || '?'}
                {item.installed
                  ? ` · installé : ${item.installed.version}, ${INSTALLED_LABEL[item.installed.status]}`
                  : ' · jamais installé'}
              </span>
              {item.broken && <span className="error small">manifest.json ne se lit plus : corrigez-le.</span>}
            </div>
            <div className="ed-list-actions">
              <button
                type="button"
                className={draft?.id === item.id ? 'btn primary small' : 'btn ghost small'}
                aria-pressed={draft?.id === item.id}
                onClick={() => openDraft(item.id)}
                disabled={busy}
              >
                {draft?.id === item.id ? 'Ouvert' : 'Modifier'}
              </button>
              <button type="button" className="btn ghost small" onClick={() => removeDraft(item)} disabled={busy}>
                Supprimer
              </button>
            </div>
          </li>
        ))}
      </ul>

      {draft && (
        <section className="stack" aria-label={`Éditeur de ${draft.name}`}>
          <div className="row wrap">
            <h4>
              {draft.name} <span className="muted small">{draft.id}</span>
            </h4>
            <button type="button" className="btn ghost small" onClick={closeDraft} disabled={busy}>
              Fermer le brouillon
            </button>
          </div>

          <form className="admin-form" onSubmit={saveMeta} aria-label="Informations du jeu">
            <label className="field">
              <span>Nom affiché</span>
              <input
                type="text"
                value={meta.name}
                disabled={busy}
                onChange={(e) => setMeta({ ...meta, name: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Description (160 caractères au plus)</span>
              <input
                type="text"
                value={meta.description}
                disabled={busy}
                onChange={(e) => setMeta({ ...meta, description: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Version (X.Y.Z)</span>
              <input
                type="text"
                value={meta.version}
                disabled={busy}
                onChange={(e) => setMeta({ ...meta, version: e.target.value })}
              />
            </label>
            <button type="submit" className="btn ghost" disabled={busy}>
              Enregistrer les informations
            </button>
          </form>

          <div className="row wrap" role="group" aria-label="Fichiers du jeu">
            {draft.files.map((f) => (
              <span key={f.path} className="row small">
                <button
                  type="button"
                  className={f.path === filePath ? 'btn primary small' : 'btn ghost small'}
                  aria-pressed={f.path === filePath}
                  onClick={() => switchFile(f.path)}
                  disabled={busy}
                >
                  {f.path}
                </button>
                {!f.protected && (
                  <button
                    type="button"
                    className="link-btn small"
                    onClick={() => removeFile(f.path)}
                    disabled={busy}
                    aria-label={`Supprimer ${f.path}`}
                  >
                    Supprimer
                  </button>
                )}
              </span>
            ))}
          </div>
          <form className="row wrap" onSubmit={addFile} aria-label="Nouveau fichier">
            <label className="field">
              <span>Nouveau fichier (dans src/, licenses/ ou README.md)</span>
              <input
                type="text"
                placeholder="src/aide.ts"
                value={newFile}
                disabled={busy}
                onChange={(e) => setNewFile(e.target.value)}
              />
            </label>
            <button type="submit" className="btn ghost small" disabled={busy || !newFile.trim()}>
              Ajouter le fichier
            </button>
          </form>

          {filePath && (
            <label className="field">
              <span>
                {filePath} {dirty ? '· modifié, non enregistré' : '· enregistré'}
              </span>
              <textarea
                className="code-editor-text"
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                value={content}
                disabled={busy}
                onChange={(e) => setContent(e.target.value)}
                onKeyDown={onEditorKey}
                style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', minHeight: '24rem' }}
              />
            </label>
          )}

          <ol className="stack small" aria-label="Étapes">
            <li>
              <strong>Enregistrer.</strong> {dirty ? 'Des modifications ne sont pas enregistrées.' : 'À jour.'}{' '}
              <button
                type="button"
                className="btn ghost small"
                onClick={() => void saveFile()}
                disabled={busy || !dirty}
              >
                Enregistrer le fichier
              </button>
            </li>
            <li>
              <strong>Vérifier.</strong> Construction, puis partie complète jouée par des robots. Vérification :{' '}
              {checkState}.{' '}
              <button type="button" className="btn ghost small" onClick={runCheck} disabled={busy}>
                Vérifier le jeu
              </button>
            </li>
            <li>
              <strong>Signer hors de PartyHub.</strong>{' '}
              {readyToSign
                ? 'La vérification est réussie. Signez le dossier avec la clé de l’auteur, par exemple :'
                : 'Disponible après une vérification réussie de la version actuelle.'}
              {readyToSign && (
                <>
                  <pre className="small">
                    <code>{`phgame pack DATA_DIR/jeux-en-cours/${draft.id} ${draft.id}.phgame cle-privee.pem`}</code>
                  </pre>
                  <span className="muted small">
                    Puis déposez le fichier .phgame dans le dossier « depot-jeux » de DATA_DIR, ou collez son lien HTTPS
                    dans « Ajouter un jeu de code » ci-dessus. Le jeu arrive en revue et ne joue qu’après approbation.
                  </span>
                </>
              )}
            </li>
          </ol>
          {check && (
            <pre className="small" style={{ maxHeight: '30vh', overflow: 'auto' }}>
              {check.lines.join('\n')}
            </pre>
          )}
        </section>
      )}
    </div>
  );
}
