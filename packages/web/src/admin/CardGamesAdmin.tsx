import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  CARD_EFFECTS,
  CARD_THEMES,
  MATCH_MODES,
  WILD_FAMILY,
  type CardEntry,
  type CardGameDefinition,
  type CardTheme,
} from '@partyhub/shared';
import { CardFace, cardGamePresets } from '@partyhub/games/client';
import { api } from '../api.js';

export interface CardGameRecord {
  id: string;
  definition: CardGameDefinition;
  updatedAt: string;
}

const THEME_LABEL: Record<CardTheme, string> = {
  arcade: 'Arcade · couleurs vives',
  coco: 'Coco · crème et tropical',
  nuit: 'Nuit · néon',
  classique: 'Classique · cartes à jouer',
};

const EFFECT_LABEL: Record<string, string> = {
  none: 'Aucun',
  skip: 'Passe le tour',
  reverse: 'Inverse le sens',
  draw2: 'Pioche 2',
  draw4: 'Pioche 4 (joker)',
  wild: 'Choix de couleur (joker)',
};

const MATCH_LABEL: Record<string, string> = {
  family: 'Même couleur seulement',
  symbol: 'Même symbole seulement',
  either: 'Même couleur ou même symbole',
};

/** Identifiant court et valide (minuscules, chiffres, tirets). */
function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 7)}`;
}

function blankDefinition(): CardGameDefinition {
  const red = newId('f');
  const blue = newId('f');
  return {
    name: 'Mon jeu de cartes',
    description: 'Décrivez le jeu en une phrase.',
    icon: '🎴',
    theme: 'arcade',
    families: [
      { id: red, label: 'Rouge', color: '#ff4d5a' },
      { id: blue, label: 'Bleu', color: '#3f8cff' },
    ],
    cards: [
      { id: newId('c'), label: '1', symbol: '1', family: red, effect: 'none', count: 12, points: 1 },
      { id: newId('c'), label: '1', symbol: '1', family: blue, effect: 'none', count: 12, points: 1 },
      { id: newId('c'), label: 'Joker', symbol: '★', family: WILD_FAMILY, effect: 'wild', count: 4, points: 30 },
    ],
    rules: { minPlayers: 2, maxPlayers: 4, handSize: 5, matchOn: 'family', targetScore: 200, turnSeconds: 20 },
    notice: {
      goal: 'Vider votre main le premier.',
      steps: ['Posez une carte de même couleur que la carte du dessus.'],
      tips: [],
    },
  };
}

function linesOf(text: string): string[] {
  return text.split('\n').map((l) => l.trim()).filter(Boolean);
}

/** Liste des jeux de cartes personnalisés, avec création, modification et suppression. */
export function CardGamesAdmin({ onChanged }: { onChanged: () => void }) {
  const [records, setRecords] = useState<CardGameRecord[] | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; draft: CardGameDefinition } | null>(null);
  const [model, setModel] = useState<string>('blank');
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await api<{ games: CardGameRecord[] }>('/api/admin/card-games');
      setRecords(res.games);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function startNew() {
    const base =
      model === 'blank' ? blankDefinition() : structuredClone(cardGamePresets[model as keyof typeof cardGamePresets]);
    if (model !== 'blank') base.name = `${base.name} (copie)`;
    setError(null);
    setEditing({ id: null, draft: base });
  }

  function startEdit(record: CardGameRecord) {
    setError(null);
    setEditing({ id: record.id, draft: structuredClone(record.definition) });
  }

  async function importFile(file: File) {
    setError(null);
    try {
      const data = JSON.parse(await file.text()) as unknown;
      await api('/api/admin/card-games/import', { method: 'POST', body: JSON.stringify(data) });
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof SyntaxError ? 'Ce fichier n’est pas un JSON valide.' : (err as Error).message);
    }
  }

  async function duplicate(record: CardGameRecord) {
    setError(null);
    try {
      await api(`/api/admin/card-games/${encodeURIComponent(record.id)}/duplicate`, { method: 'POST' });
      await load();
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(record: CardGameRecord) {
    if (!window.confirm(`Supprimer « ${record.definition.name} » ? Les salles qui le jouent seront fermées.`)) return;
    setError(null);
    try {
      await api(`/api/admin/card-games/${encodeURIComponent(record.id)}`, { method: 'DELETE' });
      await load();
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (editing) {
    return (
      <CardGameEditor
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
        Créez vos propres jeux de cartes : familles, cartes, règles et thème. Vous pouvez partir d’un modèle
        intégré et le modifier. Les joueurs les retrouvent dans le catalogue, comme les autres jeux.
      </p>
      <div className="ed-new">
        <label className="field">
          <span>Partir de</span>
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="blank">Jeu vierge</option>
            <option value="cartes-couleurs">Couleurs &amp; chiffres (modèle)</option>
            <option value="cartes-coco">Blanc-manger coco (modèle)</option>
          </select>
        </label>
        <button type="button" className="btn primary" onClick={startNew}>
          Nouveau jeu de cartes
        </button>
        <label className="btn ghost">
          Importer un fichier
          <input
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importFile(file);
              e.target.value = '';
            }}
          />
        </label>
      </div>

      {error && <p className="error" role="alert">{error}</p>}
      {records === null && <p className="muted">Chargement…</p>}
      {records?.length === 0 && <p className="muted">Aucun jeu de cartes personnalisé pour l’instant.</p>}

      <ul className="ed-list">
        {records?.map((r) => (
          <li key={r.id} className="ed-list-item">
            <div className="ed-list-preview">
              <CardFace def={r.definition} entry={r.definition.cards[0]} />
            </div>
            <div className="ed-list-body">
              <strong>
                <span aria-hidden="true">{r.definition.icon}</span> {r.definition.name}
              </strong>
              <span className="muted small">
                {THEME_LABEL[r.definition.theme]} · {r.definition.cards.reduce((n, c) => n + c.count, 0)} cartes ·{' '}
                {r.definition.rules.minPlayers}–{r.definition.rules.maxPlayers} joueurs · objectif{' '}
                {r.definition.rules.targetScore} pts
              </span>
            </div>
            <div className="ed-list-actions">
              <button type="button" className="btn ghost small" onClick={() => startEdit(r)}>
                Modifier
              </button>
              <button type="button" className="btn ghost small" onClick={() => duplicate(r)}>
                Dupliquer
              </button>
              <a className="btn ghost small" href={`/api/admin/card-games/${encodeURIComponent(r.id)}/export`} download>
                Exporter
              </a>
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

function CardGameEditor({
  editingId,
  initial,
  onCancel,
  onSaved,
}: {
  editingId: string | null;
  initial: CardGameDefinition;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [draft, setDraft] = useState<CardGameDefinition>(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const deckSize = draft.cards.reduce((n, c) => n + (Number(c.count) || 0), 0);
  const needed = draft.rules.maxPlayers * draft.rules.handSize + 5;

  function patch(fields: Partial<CardGameDefinition>) {
    setDraft((d) => ({ ...d, ...fields }));
  }

  function patchRule(fields: Partial<CardGameDefinition['rules']>) {
    setDraft((d) => ({ ...d, rules: { ...d.rules, ...fields } }));
  }

  function patchNotice(fields: Partial<CardGameDefinition['notice']>) {
    setDraft((d) => ({ ...d, notice: { ...d.notice, ...fields } }));
  }

  function updateFamily(id: string, fields: Partial<CardGameDefinition['families'][number]>) {
    setDraft((d) => ({ ...d, families: d.families.map((f) => (f.id === id ? { ...f, ...fields } : f)) }));
  }

  function addFamily() {
    setDraft((d) => ({
      ...d,
      families: [...d.families, { id: newId('f'), label: `Famille ${d.families.length + 1}`, color: '#b6ff5c' }],
    }));
  }

  function removeFamily(id: string) {
    setDraft((d) => {
      const rest = d.families.filter((f) => f.id !== id);
      const fallback = rest[0]?.id ?? WILD_FAMILY;
      return {
        ...d,
        families: rest,
        cards: d.cards.map((c) => (c.family === id ? { ...c, family: fallback } : c)),
      };
    });
  }

  function updateCard(id: string, fields: Partial<CardEntry>) {
    setDraft((d) => ({ ...d, cards: d.cards.map((c) => (c.id === id ? { ...c, ...fields } : c)) }));
  }

  /** Le choix d'une famille « joker » entraîne un effet joker, et réciproquement. */
  function changeFamily(card: CardEntry, family: string) {
    if (family === WILD_FAMILY) {
      updateCard(card.id, { family, effect: card.effect === 'draw4' ? 'draw4' : 'wild' });
    } else {
      updateCard(card.id, { family, effect: card.effect === 'wild' || card.effect === 'draw4' ? 'none' : card.effect });
    }
  }

  function addCard(copyOf?: CardEntry) {
    const base: CardEntry = copyOf
      ? { ...copyOf, id: newId('c') }
      : {
          id: newId('c'),
          label: 'Nouvelle',
          symbol: '?',
          family: draft.families[0]?.id ?? WILD_FAMILY,
          effect: 'none',
          count: 2,
          points: 1,
        };
    setDraft((d) => ({ ...d, cards: [...d.cards, base] }));
  }

  function removeCard(id: string) {
    setDraft((d) => ({ ...d, cards: d.cards.filter((c) => c.id !== id) }));
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      if (editingId) {
        await api(`/api/admin/card-games/${encodeURIComponent(editingId)}`, {
          method: 'PUT',
          body: JSON.stringify(draft),
        });
      } else {
        await api('/api/admin/card-games', { method: 'POST', body: JSON.stringify(draft) });
      }
      await onSaved();
    } catch (err) {
      setMessage((err as Error).message);
      setSaving(false);
    }
  }

  const families = draft.families;

  return (
    <form className="card stack ed-editor" onSubmit={save}>
      <div className="ed-top">
        <h3>{editingId ? 'Modifier le jeu' : 'Nouveau jeu de cartes'}</h3>
        <div>
          <button type="button" className="btn ghost" onClick={onCancel}>
            Annuler
          </button>{' '}
          <button type="submit" className="btn primary" disabled={saving}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>

      {message && <p className="error" role="alert">{message}</p>}

      <Section title="Identité">
        <div className="ed-grid-2">
          <label className="field">
            <span>Nom</span>
            <input value={draft.name} maxLength={40} onChange={(e) => patch({ name: e.target.value })} />
          </label>
          <label className="field">
            <span>Icône</span>
            <input value={draft.icon} maxLength={8} onChange={(e) => patch({ icon: e.target.value })} />
          </label>
        </div>
        <label className="field">
          <span>Description</span>
          <input value={draft.description} maxLength={160} onChange={(e) => patch({ description: e.target.value })} />
        </label>
        <div className="ed-themes" role="radiogroup" aria-label="Thème graphique">
          {CARD_THEMES.map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={draft.theme === t}
              className={`ed-theme${draft.theme === t ? ' is-on' : ''}`}
              onClick={() => patch({ theme: t as CardTheme })}
            >
              <span className="ed-theme-thumb">
                <CardFace def={{ ...draft, theme: t }} entry={draft.cards[0]} />
              </span>
              {THEME_LABEL[t]}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Familles de couleur">
        <p className="muted small">Les couleurs donnent l’identité des cartes. Huit familles au maximum.</p>
        <div className="ed-families">
          {families.map((f) => (
            <div className="ed-row" key={f.id}>
              <input
                type="color"
                aria-label={`Couleur de ${f.label}`}
                value={f.color}
                onChange={(e) => updateFamily(f.id, { color: e.target.value })}
              />
              <input
                value={f.label}
                maxLength={20}
                aria-label="Nom de la famille"
                onChange={(e) => updateFamily(f.id, { label: e.target.value })}
              />
              <button
                type="button"
                className="btn ghost small"
                disabled={families.length <= 1}
                onClick={() => removeFamily(f.id)}
              >
                Retirer
              </button>
            </div>
          ))}
        </div>
        <button type="button" className="btn ghost small" disabled={families.length >= 8} onClick={addFamily}>
          Ajouter une famille
        </button>
      </Section>

      <Section title={`Cartes (${deckSize} au total)`}>
        <p className="muted small">
          Le paquet doit contenir au moins {needed} cartes pour {draft.rules.maxPlayers} joueurs à{' '}
          {draft.rules.handSize} cartes. {deckSize < needed && <strong className="warn">Il en manque {needed - deckSize}.</strong>}
        </p>
        <div className="ed-cards">
          <div className="ed-cards-head" aria-hidden="true">
            <span />
            <span>Nom</span>
            <span>Symbole</span>
            <span>Famille</span>
            <span>Effet</span>
            <span>Nombre</span>
            <span>Points</span>
            <span />
          </div>
          {draft.cards.map((c) => (
            <div className="ed-card-row" key={c.id}>
              <span className="ed-card-thumb">
                <CardFace def={draft} entry={c} />
              </span>
              <input
                value={c.label}
                maxLength={24}
                aria-label="Nom de la carte"
                onChange={(e) => updateCard(c.id, { label: e.target.value })}
              />
              <input
                value={c.symbol}
                maxLength={4}
                aria-label="Symbole"
                className="ed-symbol"
                onChange={(e) => updateCard(c.id, { symbol: e.target.value })}
              />
              <select
                aria-label="Famille"
                value={c.family}
                onChange={(e) => changeFamily(c, e.target.value)}
              >
                {families.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
                <option value={WILD_FAMILY}>Joker</option>
              </select>
              <select
                aria-label="Effet"
                value={c.effect}
                onChange={(e) => updateCard(c.id, { effect: e.target.value as CardEntry['effect'] })}
              >
                {CARD_EFFECTS.filter((eff) =>
                  c.family === WILD_FAMILY ? eff === 'wild' || eff === 'draw4' : eff !== 'wild' && eff !== 'draw4',
                ).map((eff) => (
                  <option key={eff} value={eff}>
                    {EFFECT_LABEL[eff]}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                max={20}
                aria-label="Nombre d’exemplaires"
                value={c.count}
                onChange={(e) => updateCard(c.id, { count: Number(e.target.value) })}
              />
              <input
                type="number"
                min={0}
                max={100}
                aria-label="Points"
                value={c.points}
                onChange={(e) => updateCard(c.id, { points: Number(e.target.value) })}
              />
              <span className="ed-card-actions">
                <button type="button" className="btn ghost small" onClick={() => addCard(c)} aria-label="Dupliquer">
                  ⧉
                </button>
                <button type="button" className="btn ghost small" onClick={() => removeCard(c.id)} aria-label="Supprimer">
                  ✕
                </button>
              </span>
            </div>
          ))}
        </div>
        <button type="button" className="btn ghost small" disabled={draft.cards.length >= 60} onClick={() => addCard()}>
          Ajouter une carte
        </button>
      </Section>

      <Section title="Aperçu">
        <div className="ed-preview">
          {draft.cards.map((c) => (
            <div className="ed-preview-card" key={c.id}>
              <CardFace def={draft} entry={c} />
            </div>
          ))}
          <div className="ed-preview-card">
            <CardFace def={draft} back />
          </div>
        </div>
      </Section>

      <Section title="Règles">
        <div className="ed-grid-3">
          <label className="field">
            <span>Joueurs minimum</span>
            <input type="number" min={2} max={8} value={draft.rules.minPlayers} onChange={(e) => patchRule({ minPlayers: Number(e.target.value) })} />
          </label>
          <label className="field">
            <span>Joueurs maximum</span>
            <input type="number" min={2} max={8} value={draft.rules.maxPlayers} onChange={(e) => patchRule({ maxPlayers: Number(e.target.value) })} />
          </label>
          <label className="field">
            <span>Cartes en main au départ</span>
            <input type="number" min={3} max={10} value={draft.rules.handSize} onChange={(e) => patchRule({ handSize: Number(e.target.value) })} />
          </label>
          <label className="field">
            <span>Pour poser une carte</span>
            <select value={draft.rules.matchOn} onChange={(e) => patchRule({ matchOn: e.target.value as CardGameDefinition['rules']['matchOn'] })}>
              {MATCH_MODES.map((m) => (
                <option key={m} value={m}>
                  {MATCH_LABEL[m]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Points pour gagner</span>
            <input type="number" min={50} max={2000} value={draft.rules.targetScore} onChange={(e) => patchRule({ targetScore: Number(e.target.value) })} />
          </label>
          <label className="field">
            <span>Secondes par tour (0 = libre)</span>
            <input type="number" min={0} max={60} value={draft.rules.turnSeconds} onChange={(e) => patchRule({ turnSeconds: Number(e.target.value) })} />
          </label>
        </div>
      </Section>

      <Section title="Notice">
        <label className="field">
          <span>But du jeu</span>
          <input value={draft.notice.goal} maxLength={300} onChange={(e) => patchNotice({ goal: e.target.value })} />
        </label>
        <label className="field">
          <span>Étapes (une par ligne)</span>
          <textarea rows={4} value={draft.notice.steps.join('\n')} onChange={(e) => patchNotice({ steps: linesOf(e.target.value) })} />
        </label>
        <label className="field">
          <span>Conseils (une par ligne)</span>
          <textarea rows={3} value={draft.notice.tips.join('\n')} onChange={(e) => patchNotice({ tips: linesOf(e.target.value) })} />
        </label>
      </Section>
    </form>
  );
}
