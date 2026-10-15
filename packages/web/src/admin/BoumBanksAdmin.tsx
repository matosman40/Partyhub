import { useEffect, useState, type FormEvent } from 'react';
import {
  BANK_TYPES,
  BANK_TYPE_INFO,
  LEVELS,
  LEVEL_LABELS,
  STATUSES,
  STATUS_LABELS,
  type BankType,
  type EntryStatus,
  type ImportPreview,
  type Level,
} from '@partyhub/games/client';
import { api } from '../api.js';

/** Banques de contenu de BOUM ! : entrées, validation, propositions des joueurs, import et export. */

export interface BankEntryView {
  id: string;
  type: BankType;
  level: Level;
  text: string;
  answer: string | null;
  status: EntryStatus;
  reason: string | null;
  authorName: string;
  createdAt: string;
  updatedAt: string;
}

interface Counts {
  types: { type: BankType; valid: number; toValidate: number; proposed: number; retired: number }[];
  lowStock: BankType[];
}

interface Draft {
  id: string | null;
  type: BankType;
  level: Level;
  text: string;
  answer: string;
  /** Vrai quand on modifie une proposition : elle est validée juste après l'enregistrement. */
  validateAfter: boolean;
}

const ALL = '';
/** Entrées affichées par page : la banque complète peut compter des centaines de lignes. */
const PAGE_SIZE = 50;
const LOW_STOCK_NOTE = 'Moins de 8 entrées validées : la partie risque de manquer de contenu pour ce type.';

function emptyDraft(): Draft {
  return { id: null, type: 'metier', level: 'doux', text: '', answer: '', validateAfter: false };
}

function draftFrom(entry: BankEntryView, validateAfter = false): Draft {
  return {
    id: entry.id,
    type: entry.type,
    level: entry.level,
    text: entry.text,
    answer: entry.answer ?? '',
    validateAfter,
  };
}

/** Aperçu d'une entrée tel qu'il s'affiche sur l'écran ou le téléphone. */
export function EntryPreview({ type, text, answer }: { type: BankType; text: string; answer: string | null }) {
  const info = BANK_TYPE_INFO[type];
  const parts = text.split('___');
  return (
    <div className="boum-preview" aria-label="Aperçu">
      <p className="boum-preview-text">
        {type === 'phrase_trous'
          ? parts.map((part, i) => (
              <span key={i}>
                {part}
                {i < parts.length - 1 && <span className="boum-blank">______</span>}
              </span>
            ))
          : text || '…'}
      </p>
      {info.answer !== 'none' && <p className="muted small">Réponse attendue : {answer || '…'}</p>}
    </div>
  );
}

export function BoumBanksAdmin() {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [entries, setEntries] = useState<BankEntryView[] | null>(null);
  const [shown, setShown] = useState(PAGE_SIZE);
  const [proposals, setProposals] = useState<BankEntryView[] | null>(null);
  const [filterType, setFilterType] = useState(ALL);
  const [filterLevel, setFilterLevel] = useState(ALL);
  const [filterStatus, setFilterStatus] = useState(ALL);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [refusals, setRefusals] = useState<Record<string, string>>({});
  const [importText, setImportText] = useState('');
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [validateNow, setValidateNow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function loadCounts() {
    const res = await api<Counts>('/api/admin/boum/counts');
    setCounts(res);
  }

  async function loadEntries() {
    const params = new URLSearchParams();
    if (filterType) params.set('type', filterType);
    if (filterLevel) params.set('level', filterLevel);
    if (filterStatus) params.set('status', filterStatus);
    if (search.trim()) params.set('q', search.trim());
    const res = await api<{ entries: BankEntryView[] }>(`/api/admin/boum/entries?${params.toString()}`);
    setEntries(res.entries);
  }

  async function loadProposals() {
    const res = await api<{ entries: BankEntryView[] }>('/api/admin/boum/proposals');
    setProposals(res.entries);
  }

  async function refreshAll() {
    await Promise.all([loadCounts(), loadEntries(), loadProposals()]);
  }

  useEffect(() => {
    refreshAll().catch((err: Error) => setMessage({ ok: false, text: err.message }));
    // Chargement initial seulement : les filtres relancent la liste ci-dessous.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // loadEntries change à chaque rendu : seuls les filtres doivent relancer la liste.
    loadEntries().catch((err: Error) => setMessage({ ok: false, text: err.message }));
    setShown(PAGE_SIZE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterType, filterLevel, filterStatus, search]);

  /** Lance une action serveur, affiche le résultat et recharge tout. */
  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      await refreshAll();
      setMessage({ ok: true, text: success });
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  function setStatuses(ids: string[], status: EntryStatus, reason: string | null = null) {
    return api('/api/admin/boum/entries/status', {
      method: 'POST',
      body: JSON.stringify({ ids, status, reason }),
    });
  }

  function toggleSelected(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function saveDraft(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    const info = BANK_TYPE_INFO[draft.type];
    const body = JSON.stringify({
      type: draft.type,
      level: draft.level,
      text: draft.text,
      answer: info.answer === 'none' ? null : draft.answer,
    });
    await run(
      async () => {
        if (draft.id) {
          await api(`/api/admin/boum/entries/${draft.id}`, { method: 'PUT', body });
          if (draft.validateAfter) await setStatuses([draft.id], 'valide');
        } else {
          await api('/api/admin/boum/entries', { method: 'POST', body });
        }
        setDraft(null);
      },
      draft.validateAfter ? 'Proposition modifiée et validée.' : 'Entrée enregistrée.',
    );
  }

  async function previewImport() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await api<{ preview: ImportPreview }>('/api/admin/boum/import/preview', {
        method: 'POST',
        body: JSON.stringify({ text: importText }),
      });
      setImportPreview(res.preview);
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function readFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 300 * 1024) {
      setMessage({ ok: false, text: 'Fichier trop volumineux (300 Ko maximum).' });
      return;
    }
    setImportText(await file.text());
    setImportPreview(null);
  }

  async function commitImport() {
    if (validateNow && !window.confirm('Valider immédiatement toutes les lignes acceptées ?')) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await api<{ imported?: number; validatedNow?: boolean }>('/api/admin/boum/import', {
        method: 'POST',
        body: JSON.stringify({ text: importText, validateNow }),
      });
      setMessage({
        ok: true,
        text: `${res.imported ?? 0} entrée(s) importée(s)${res.validatedNow ? ', validées à l’import' : ', à valider'}.`,
      });
      setImportPreview(null);
      setImportText('');
      setValidateNow(false);
      await refreshAll();
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const lowStockTypes = counts?.lowStock ?? [];
  const selectedIds = [...selected];

  return (
    <div className="stack">
      {message && (
        <p className={message.ok ? 'notice' : 'error'} role="status">
          {message.text}
        </p>
      )}

      <h3>Contenu disponible</h3>
      {counts ? (
        <>
          {lowStockTypes.length > 0 && <p className="error small">{LOW_STOCK_NOTE}</p>}
          <div className="boum-counts" role="region" aria-label="Entrées par type" tabIndex={0}>
            <table>
              <caption className="muted small">Entrées par type</caption>
              <thead>
                <tr>
                  <th scope="col">Type</th>
                  <th scope="col">Validées</th>
                  <th scope="col">À valider</th>
                  <th scope="col">Proposées</th>
                  <th scope="col">Retirées</th>
                </tr>
              </thead>
              <tbody>
                {counts.types.map((row) => (
                  <tr key={row.type}>
                    <th scope="row">
                      {BANK_TYPE_INFO[row.type].label}
                      {lowStockTypes.includes(row.type) && <span className="error small"> (peu d’entrées)</span>}
                    </th>
                    <td>{row.valid}</td>
                    <td>{row.toValidate}</td>
                    <td>{row.proposed}</td>
                    <td>{row.retired}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="muted small">Chargement des compteurs…</p>
      )}

      <h3>Propositions des joueurs</h3>
      {proposals === null ? (
        <p className="muted small">Chargement des propositions…</p>
      ) : proposals.length === 0 ? (
        <p className="muted small">Aucune proposition en attente.</p>
      ) : (
        <ul className="boum-list">
          {proposals.map((entry) => (
            <li key={entry.id} className="boum-row">
              <div className="stack">
                <p className="small">
                  <strong>{entry.authorName}</strong> · {BANK_TYPE_INFO[entry.type].label} · {LEVEL_LABELS[entry.level]}
                </p>
                <EntryPreview type={entry.type} text={entry.text} answer={entry.answer} />
                <div className="row wrap">
                  <button
                    type="button"
                    className="btn primary"
                    disabled={busy}
                    onClick={() => run(() => setStatuses([entry.id], 'valide'), 'Proposition validée.')}
                  >
                    Valider
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => setDraft(draftFrom(entry, true))}
                  >
                    Modifier puis valider
                  </button>
                </div>
                <label className="field">
                  <span>Motif de refus</span>
                  <input
                    value={refusals[entry.id] ?? ''}
                    maxLength={200}
                    onChange={(e) => setRefusals((current) => ({ ...current, [entry.id]: e.target.value }))}
                  />
                </label>
                <button
                  type="button"
                  className="btn"
                  disabled={busy || !(refusals[entry.id] ?? '').trim()}
                  onClick={() =>
                    run(
                      () => setStatuses([entry.id], 'retire', (refusals[entry.id] ?? '').trim()),
                      'Proposition refusée. Le joueur voit le motif.',
                    )
                  }
                >
                  Refuser
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <h3>Banque</h3>
      <div className="row wrap">
        <label className="field">
          <span>Type</span>
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
            <option value={ALL}>Tous</option>
            {BANK_TYPES.map((type) => (
              <option key={type} value={type}>
                {BANK_TYPE_INFO[type].label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Niveau</span>
          <select value={filterLevel} onChange={(e) => setFilterLevel(e.target.value)}>
            <option value={ALL}>Tous</option>
            {LEVELS.map((level) => (
              <option key={level} value={level}>
                {LEVEL_LABELS[level]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Statut</span>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value={ALL}>Tous</option>
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Rechercher dans le texte</span>
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setDraft(emptyDraft());
            setMessage(null);
          }}
        >
          Ajouter une entrée
        </button>
      </div>

      {draft && (
        <form
          className="stack boum-draft"
          onSubmit={saveDraft}
          aria-label={draft.id ? 'Modifier une entrée' : 'Nouvelle entrée'}
        >
          <h4>
            {draft.id ? (draft.validateAfter ? 'Modifier la proposition' : 'Modifier l’entrée') : 'Nouvelle entrée'}
          </h4>
          <label className="field">
            <span>Type</span>
            <select
              value={draft.type}
              onChange={(e) => {
                const type = e.target.value as BankType;
                setDraft({
                  ...draft,
                  type,
                  level: draft.level === 'limite' && !BANK_TYPE_INFO[type].limitAllowed ? 'doux' : draft.level,
                });
              }}
            >
              {BANK_TYPES.map((type) => (
                <option key={type} value={type}>
                  {BANK_TYPE_INFO[type].label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Niveau</span>
            <select value={draft.level} onChange={(e) => setDraft({ ...draft, level: e.target.value as Level })}>
              {LEVELS.filter((level) => level !== 'limite' || BANK_TYPE_INFO[draft.type].limitAllowed).map((level) => (
                <option key={level} value={level}>
                  {LEVEL_LABELS[level]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Texte</span>
            <textarea
              value={draft.text}
              maxLength={BANK_TYPE_INFO[draft.type].maxLength}
              rows={3}
              onChange={(e) => setDraft({ ...draft, text: e.target.value })}
            />
          </label>
          {BANK_TYPE_INFO[draft.type].answer !== 'none' && (
            <label className="field">
              <span>Réponse attendue</span>
              <input
                value={draft.answer}
                maxLength={200}
                onChange={(e) => setDraft({ ...draft, answer: e.target.value })}
              />
            </label>
          )}
          <EntryPreview type={draft.type} text={draft.text} answer={draft.answer || null} />
          <div className="row wrap">
            <button type="submit" className="btn primary" disabled={busy}>
              {draft.validateAfter ? 'Enregistrer et valider' : 'Enregistrer'}
            </button>
            <button type="button" className="btn" onClick={() => setDraft(null)}>
              Annuler
            </button>
          </div>
        </form>
      )}

      <div className="row wrap">
        <button
          type="button"
          className="btn"
          disabled={busy || selectedIds.length === 0}
          onClick={() =>
            run(() => setStatuses(selectedIds, 'valide'), `${selectedIds.length} entrée(s) validée(s).`).then(() =>
              setSelected(new Set()),
            )
          }
        >
          Valider la sélection ({selectedIds.length})
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy || selectedIds.length === 0}
          onClick={() =>
            run(() => setStatuses(selectedIds, 'retire'), `${selectedIds.length} entrée(s) retirée(s).`).then(() =>
              setSelected(new Set()),
            )
          }
        >
          Retirer la sélection ({selectedIds.length})
        </button>
        <a className="btn" href="/api/admin/boum/export" download>
          Exporter en fichier texte
        </a>
      </div>

      {entries === null ? (
        <p className="muted small">Chargement des entrées…</p>
      ) : entries.length === 0 ? (
        <p className="muted small">Aucune entrée ne correspond à ces filtres.</p>
      ) : (
        <>
          <p className="muted small">
            {Math.min(shown, entries.length)} sur {entries.length} entrée(s).
          </p>
          <ul className="boum-list">
            {entries.slice(0, shown).map((entry) => (
              <li key={entry.id} className="boum-row">
                <label className="row">
                  <input
                    type="checkbox"
                    checked={selected.has(entry.id)}
                    onChange={() => toggleSelected(entry.id)}
                    aria-label={`Sélectionner : ${entry.text}`}
                  />
                </label>
                <div className="stack grow">
                  <p className="small">
                    {BANK_TYPE_INFO[entry.type].label} · {LEVEL_LABELS[entry.level]} · {STATUS_LABELS[entry.status]}
                    {entry.authorName !== 'admin' && <> · proposée par {entry.authorName}</>}
                  </p>
                  <EntryPreview type={entry.type} text={entry.text} answer={entry.answer} />
                  {entry.reason && <p className="muted small">Motif : {entry.reason}</p>}
                  <div className="row wrap">
                    <button type="button" className="btn" disabled={busy} onClick={() => setDraft(draftFrom(entry))}>
                      Modifier
                    </button>
                    {entry.status !== 'valide' && (
                      <button
                        type="button"
                        className="btn"
                        disabled={busy}
                        onClick={() => run(() => setStatuses([entry.id], 'valide'), 'Entrée validée.')}
                      >
                        Valider
                      </button>
                    )}
                    {entry.status !== 'retire' && (
                      <button
                        type="button"
                        className="btn"
                        disabled={busy}
                        onClick={() => run(() => setStatuses([entry.id], 'retire'), 'Entrée retirée.')}
                      >
                        Retirer
                      </button>
                    )}
                    {entry.status === 'retire' && (
                      <button
                        type="button"
                        className="btn"
                        disabled={busy}
                        onClick={() => run(() => setStatuses([entry.id], 'a_valider'), 'Entrée restaurée, à valider.')}
                      >
                        Restaurer
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {shown < entries.length && (
            <button type="button" className="btn" onClick={() => setShown((n) => n + PAGE_SIZE)}>
              Afficher {Math.min(PAGE_SIZE, entries.length - shown)} de plus
            </button>
          )}
        </>
      )}

      <h3>Importer un fichier texte</h3>
      <p className="muted small">
        Une entrée par ligne : <code>type ; niveau ; texte ; réponse</code>. Les lignes commençant par # sont ignorées.
        Maximum 300 Ko et 2 000 lignes. L’import ajoute sans rien écraser ni supprimer.
      </p>
      <label className="field">
        <span>Fichier .txt</span>
        <input type="file" accept=".txt,text/plain" onChange={(e) => void readFile(e.target.files?.[0])} />
      </label>
      <label className="field">
        <span>Ou coller le contenu</span>
        <textarea
          rows={6}
          value={importText}
          onChange={(e) => {
            setImportText(e.target.value);
            setImportPreview(null);
          }}
        />
      </label>
      <div className="row wrap">
        <button
          type="button"
          className="btn"
          disabled={busy || !importText.trim()}
          onClick={() => void previewImport()}
        >
          Analyser (aperçu sans écriture)
        </button>
      </div>

      {importPreview && (
        <div className="stack">
          {importPreview.fatal ? (
            <p className="error" role="alert">
              {importPreview.fatal}
            </p>
          ) : (
            <>
              <p className="notice">
                {importPreview.accepted.length} ligne(s) acceptée(s), {importPreview.rejected.length} refusée(s),{' '}
                {importPreview.duplicates.length} doublon(s) ignoré(s).
              </p>
              {importPreview.rejected.length > 0 && (
                <ul className="small">
                  {importPreview.rejected.map((item) => (
                    <li key={`r${item.line}`}>
                      Ligne {item.line} : {item.reason}
                    </li>
                  ))}
                </ul>
              )}
              {importPreview.duplicates.length > 0 && (
                <ul className="small muted">
                  {importPreview.duplicates.map((item) => (
                    <li key={`d${item.line}`}>
                      Ligne {item.line} (doublon) : {item.raw}
                    </li>
                  ))}
                </ul>
              )}
              <label className="field row">
                <input type="checkbox" checked={validateNow} onChange={(e) => setValidateNow(e.target.checked)} />
                <span>Valider immédiatement les lignes acceptées (sinon elles restent à valider)</span>
              </label>
              <div className="row wrap">
                <button
                  type="button"
                  className="btn primary"
                  disabled={busy || importPreview.accepted.length === 0}
                  onClick={() => void commitImport()}
                >
                  Importer {importPreview.accepted.length} ligne(s)
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
