import { useEffect, useState, type ReactNode } from 'react';
import {
  BOARD_CELL_KINDS,
  BOARD_CELL_LABELS,
  BOARD_VALUED_KINDS,
  CARD_THEMES,
  type BoardCell,
  type BoardCellKind,
  type BoardGameDefinition,
  type CardTheme,
} from '@partyhub/shared';
import { api } from '../api.js';

export interface BoardGameRecord {
  id: string;
  definition: BoardGameDefinition;
  updatedAt: string;
}

const THEME_LABEL: Record<CardTheme, string> = {
  arcade: 'Arcade · couleurs vives',
  coco: 'Coco · crème et tropical',
  nuit: 'Nuit · néon',
  classique: 'Classique · cartes à jouer',
};

const MIN_CELLS = 8;
const MAX_CELLS = 60;

/** Modèle de départ : un parcours complet avec chaque type de case. */
function starterBoard(): BoardGameDefinition {
  const cell = (label: string, kind: BoardCellKind = 'normal', value = 0): BoardCell => ({ label, kind, value });
  return {
    name: 'Mon plateau',
    description: 'Un parcours jusqu’à l’arrivée, avec des bonus et des pièges.',
    icon: '🎲',
    theme: 'arcade',
    cells: [
      cell('Départ'),
      cell(''),
      cell('Bonus', 'gain', 2),
      cell(''),
      cell('Glissade', 'recule', 2),
      cell(''),
      cell('Pause', 'passe'),
      cell(''),
      cell('Tremplin', 'avance', 2),
      cell(''),
      cell('Amende', 'perte', 1),
      cell(''),
      cell('Trésor', 'gain', 3),
      cell(''),
      cell('Toboggan', 'recule', 3),
      cell(''),
      cell('Pause', 'passe'),
      cell(''),
      cell('Fusée', 'avance', 3),
      cell(''),
      cell('Péage', 'perte', 2),
      cell(''),
      cell('Pièce', 'gain', 1),
      cell('Arrivée', 'arrivee'),
    ],
    rules: { minPlayers: 2, maxPlayers: 4, dice: 1, turnSeconds: 20 },
    notice: {
      goal: 'Atteindre la case d’arrivée le premier.',
      steps: ['À votre tour, lancez les dés et avancez votre pion.', 'Appliquez l’effet de la case où vous tombez.'],
      tips: ['Les effets ne s’enchaînent pas : une case d’avance ne déclenche pas la case suivante.'],
    },
  };
}

function badgeOf(cell: BoardCell): string {
  switch (cell.kind) {
    case 'avance':
      return `+${cell.value}`;
    case 'recule':
      return `−${cell.value}`;
    case 'gain':
      return `+${cell.value} pts`;
    case 'perte':
      return `−${cell.value} pts`;
    case 'passe':
      return '⏸';
    case 'arrivee':
      return '🏁';
    default:
      return '';
  }
}

function linesOf(text: string): string[] {
  return text.split('\n').map((l) => l.trim()).filter(Boolean);
}

/** Liste des plateaux personnalisés, avec création, modification, copie et suppression. */
export function BoardGamesAdmin({ onChanged }: { onChanged: () => void }) {
  const [records, setRecords] = useState<BoardGameRecord[] | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; draft: BoardGameDefinition } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await api<{ games: BoardGameRecord[] }>('/api/admin/board-games');
      setRecords(res.games);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function act(path: string, init: RequestInit) {
    setError(null);
    try {
      await api(path, init);
      await load();
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(record: BoardGameRecord) {
    if (!window.confirm(`Supprimer « ${record.definition.name} » ? Les salles qui le jouent seront fermées.`)) return;
    await act(`/api/admin/board-games/${encodeURIComponent(record.id)}`, { method: 'DELETE' });
  }

  if (editing) {
    return (
      <BoardGameEditor
        key={editing.id ?? 'new'}
        editingId={editing.id}
        initial={editing.draft}
        onCancel={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null);
          await load();
          onChanged();
        }}
      />
    );
  }

  return (
    <div className="stack">
      <p className="muted">
        Créez vos plateaux de parcours : une suite de cases, des dés et des règles simples. Les cases peuvent faire
        avancer, reculer, gagner ou perdre des points, passer un tour, ou mener à l’arrivée. Les joueurs les
        retrouvent dans le catalogue, dans la catégorie plateau.
      </p>
      <div className="ed-new">
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            setError(null);
            setEditing({ id: null, draft: starterBoard() });
          }}
        >
          Nouveau plateau
        </button>
      </div>

      {error && <p className="error" role="alert">{error}</p>}
      {records === null && <p className="muted">Chargement…</p>}
      {records?.length === 0 && <p className="muted">Aucun plateau personnalisé pour l’instant.</p>}

      <ul className="ed-list">
        {records?.map((r) => (
          <li key={r.id} className="ed-list-item">
            <div className="ed-list-preview" aria-hidden="true">
              <span style={{ fontSize: '1.6rem' }}>{r.definition.icon}</span>
            </div>
            <div className="ed-list-body">
              <strong>{r.definition.name}</strong>
              <span className="muted small">
                {THEME_LABEL[r.definition.theme]} · {r.definition.cells.length} cases ·{' '}
                {r.definition.rules.minPlayers}–{r.definition.rules.maxPlayers} joueurs · {r.definition.rules.dice}{' '}
                dé{r.definition.rules.dice > 1 ? 's' : ''}
              </span>
            </div>
            <div className="ed-list-actions">
              <button type="button" className="btn ghost small" onClick={() => setEditing({ id: r.id, draft: structuredClone(r.definition) })}>
                Modifier
              </button>
              <button
                type="button"
                className="btn ghost small"
                onClick={() => act(`/api/admin/board-games/${encodeURIComponent(r.id)}/duplicate`, { method: 'POST' })}
              >
                Dupliquer
              </button>
              <button type="button" className="btn ghost small" onClick={() => remove(r)}>
                Supprimer
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="ed-section">
      <legend>{title}</legend>
      {children}
    </fieldset>
  );
}

function BoardGameEditor({
  editingId,
  initial,
  onCancel,
  onSaved,
}: {
  editingId: string | null;
  initial: BoardGameDefinition;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [draft, setDraft] = useState<BoardGameDefinition>(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const cells = draft.cells;
  const last = cells.length - 1;

  function patch(fields: Partial<BoardGameDefinition>) {
    setDraft((d) => ({ ...d, ...fields }));
  }

  function patchRule(fields: Partial<BoardGameDefinition['rules']>) {
    setDraft((d) => ({ ...d, rules: { ...d.rules, ...fields } }));
  }

  function patchNotice(fields: Partial<BoardGameDefinition['notice']>) {
    setDraft((d) => ({ ...d, notice: { ...d.notice, ...fields } }));
  }

  function patchCell(index: number, fields: Partial<BoardCell>) {
    setDraft((d) => ({
      ...d,
      cells: d.cells.map((c, i) => {
        if (i !== index) return c;
        const next = { ...c, ...fields };
        if (!BOARD_VALUED_KINDS.includes(next.kind)) next.value = 0;
        else if (next.value < 1) next.value = 1;
        return next;
      }),
    }));
  }

  /** Insère une case normale après `index` (jamais après l'arrivée). */
  function insertAfter(index: number) {
    setDraft((d) => {
      if (d.cells.length >= MAX_CELLS) return d;
      const cellsNext = [...d.cells];
      cellsNext.splice(index + 1, 0, { label: '', kind: 'normal', value: 0 });
      return { ...d, cells: cellsNext };
    });
  }

  function removeCell(index: number) {
    setDraft((d) => {
      if (d.cells.length <= MIN_CELLS || index === 0 || index === d.cells.length - 1) return d;
      return { ...d, cells: d.cells.filter((_, i) => i !== index) };
    });
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const path = editingId ? `/api/admin/board-games/${encodeURIComponent(editingId)}` : '/api/admin/board-games';
      await api(path, { method: editingId ? 'PUT' : 'POST', body: JSON.stringify(draft) });
      await onSaved();
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <p className="muted">
        {editingId ? 'Modifier le plateau' : 'Nouveau plateau'}. Les parties en cours sur ce plateau ne sont pas
        modifiées avant leur prochaine partie.
      </p>

      <Section title="Identité">
        <label className="field">
          <span>Nom</span>
          <input value={draft.name} maxLength={40} onChange={(e) => patch({ name: e.target.value })} required />
        </label>
        <label className="field">
          <span>Icône</span>
          <input value={draft.icon} maxLength={8} onChange={(e) => patch({ icon: e.target.value })} required />
        </label>
        <label className="field">
          <span>Description</span>
          <input value={draft.description} maxLength={160} onChange={(e) => patch({ description: e.target.value })} required />
        </label>
        <label className="field">
          <span>Thème graphique</span>
          <select value={draft.theme} onChange={(e) => patch({ theme: e.target.value as CardTheme })}>
            {CARD_THEMES.map((t) => (
              <option key={t} value={t}>
                {THEME_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
      </Section>

      <Section title="Règles">
        <label className="field">
          <span>Joueurs minimum</span>
          <input
            type="number"
            min={2}
            max={8}
            value={draft.rules.minPlayers}
            onChange={(e) => patchRule({ minPlayers: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          <span>Joueurs maximum</span>
          <input
            type="number"
            min={2}
            max={8}
            value={draft.rules.maxPlayers}
            onChange={(e) => patchRule({ maxPlayers: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          <span>Dés à chaque tour</span>
          <select value={draft.rules.dice} onChange={(e) => patchRule({ dice: Number(e.target.value) })}>
            <option value={1}>Un dé</option>
            <option value={2}>Deux dés (total)</option>
          </select>
        </label>
        <label className="field">
          <span>Secondes par tour (0 = sans limite)</span>
          <input
            type="number"
            min={0}
            max={60}
            value={draft.rules.turnSeconds}
            onChange={(e) => patchRule({ turnSeconds: Number(e.target.value) })}
          />
        </label>
      </Section>

      <Section title={`Cases (${cells.length} sur ${MAX_CELLS} au plus)`}>
        <p className="muted small">
          La première case est le départ et la dernière l’arrivée. Une case d’avance, de recul, de gain ou de perte
          a besoin d’une valeur d’au moins 1. Les effets ne s’enchaînent pas.
        </p>
        <table className="bd-cells">
          <thead>
            <tr>
              <th scope="col">N°</th>
              <th scope="col">Nom</th>
              <th scope="col">Effet</th>
              <th scope="col">Valeur</th>
              <th scope="col" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {cells.map((cell, i) => {
              const valued = BOARD_VALUED_KINDS.includes(cell.kind);
              return (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>
                    <input
                      value={cell.label}
                      maxLength={24}
                      aria-label={`Nom de la case ${i + 1}`}
                      onChange={(e) => patchCell(i, { label: e.target.value })}
                    />
                  </td>
                  <td>
                    <select
                      value={cell.kind}
                      aria-label={`Effet de la case ${i + 1}`}
                      disabled={i === 0 || i === last}
                      onChange={(e) => patchCell(i, { kind: e.target.value as BoardCellKind })}
                    >
                      {i === 0 && <option value="normal">{BOARD_CELL_LABELS.normal}</option>}
                      {i === last && <option value="arrivee">{BOARD_CELL_LABELS.arrivee}</option>}
                      {i !== 0 &&
                        i !== last &&
                        BOARD_CELL_KINDS.filter((k) => k !== 'arrivee').map((k) => (
                          <option key={k} value={k}>
                            {BOARD_CELL_LABELS[k]}
                          </option>
                        ))}
                    </select>
                  </td>
                  <td>
                    <input
                      type="number"
                      min={valued ? 1 : 0}
                      max={12}
                      value={valued ? cell.value : ''}
                      disabled={!valued}
                      aria-label={`Valeur de la case ${i + 1}`}
                      onChange={(e) => patchCell(i, { value: Math.round(Number(e.target.value)) })}
                    />
                  </td>
                  <td className="ed-list-actions">
                    {i !== last && cells.length < MAX_CELLS && (
                      <button type="button" className="btn ghost small" onClick={() => insertAfter(i)}>
                        Insérer après
                      </button>
                    )}
                    {i !== 0 && i !== last && cells.length > MIN_CELLS && (
                      <button type="button" className="btn ghost small" onClick={() => removeCell(i)}>
                        Retirer
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="bd-track" aria-label="Aperçu du parcours">
          {cells.map((cell, i) => (
            <div
              key={i}
              className={`bd-cell kind-${cell.kind}${i === 0 ? ' is-start' : ''}${i === last ? ' is-goal' : ''}`}
            >
              <span className="bd-index">{i + 1}</span>
              <span className="bd-label">{cell.label || (i === 0 ? 'Départ' : '')}</span>
              {badgeOf(cell) && <span className="bd-badge">{badgeOf(cell)}</span>}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Notice">
        <label className="field">
          <span>But du jeu</span>
          <input value={draft.notice.goal} onChange={(e) => patchNotice({ goal: e.target.value })} required />
        </label>
        <label className="field">
          <span>Étapes (une par ligne)</span>
          <textarea
            rows={3}
            value={draft.notice.steps.join('\n')}
            onChange={(e) => patchNotice({ steps: linesOf(e.target.value) })}
          />
        </label>
        <label className="field">
          <span>Conseils (un par ligne)</span>
          <textarea
            rows={2}
            value={draft.notice.tips.join('\n')}
            onChange={(e) => patchNotice({ tips: linesOf(e.target.value) })}
          />
        </label>
      </Section>

      {message && <p className="error" role="alert">{message}</p>}
      <div className="ed-list-actions">
        <button type="submit" className="btn primary" disabled={saving}>
          Enregistrer le plateau
        </button>
        <button type="button" className="btn ghost" onClick={onCancel}>
          Annuler
        </button>
      </div>
    </form>
  );
}
