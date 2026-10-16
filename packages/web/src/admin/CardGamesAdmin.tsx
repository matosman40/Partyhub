import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  CARD_BACK_PATTERNS,
  CARD_EFFECTS,
  CARD_FONT_PRESETS,
  CARD_THEMES,
  MATCH_MODES,
  RACE_TRICK_MAX_CARDS,
  WILD_FAMILY,
  type CardBackPattern,
  type CardEntry,
  type CardFontPreset,
  type CardGameDefinition,
  type CardMechanic,
  type CardTheme,
} from '@partyhub/shared';
import { CardFace, cardGamePresets, cardGameTemplates } from '@partyhub/games/client';
import { api } from '../api.js';
import { GameMenu } from '../components/GameMenu.js';

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

const MECHANIC_LABEL: Record<CardMechanic, string> = {
  shedding: 'Défausse : poser ses cartes sur la pile',
  memory: 'Mémo : retourner deux cartes, trouver les paires',
  race: 'Ressemblance : toucher la carte du centre dès qu’elle ressemble à une des siennes',
  trick: 'Plis : jouer une carte à chaque tour, remporter les plis',
};

/** Mécaniques sans effet ni joker : leurs cartes sont toutes sans effet et de familles normales. */
const PURE_MECHANICS: CardMechanic[] = ['memory', 'race', 'trick'];

const PATTERN_LABEL: Record<CardBackPattern, string> = {
  uni: 'Uni',
  rayures: 'Rayures',
  pois: 'Pois',
  losanges: 'Losanges',
  quadrillage: 'Quadrillage',
};

const FONT_PRESET_LABEL: Record<CardFontPreset, string> = {
  lisible: 'Lisible (Atkinson Hyperlegible)',
  symboles: 'Symboles (Noto Sans Symbols 2)',
  titre: 'Titre (Luckiest Guy)',
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
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Liste des jeux de cartes personnalisés, avec création, modification et suppression. */
export function CardGamesAdmin({ onChanged }: { onChanged: () => void }) {
  const [records, setRecords] = useState<CardGameRecord[] | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; draft: CardGameDefinition } | null>(null);
  const [model, setModel] = useState<string>('blank');
  const [error, setError] = useState<string | null>(null);
  /** CSV de cartes choisi : il est ajouté au prochain import JSON (cartes à texte). */
  const [pendingCsv, setPendingCsv] = useState<{ name: string; text: string } | null>(null);

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
    let base: CardGameDefinition;
    if (model === 'blank') {
      base = blankDefinition();
    } else if (model.startsWith('tpl:')) {
      // Un modèle prêt à l’emploi garde son nom : c’est un nouveau jeu, pas une copie.
      const template = cardGameTemplates.find((t) => `tpl:${t.id}` === model);
      base = structuredClone(template?.definition ?? blankDefinition());
    } else {
      base = structuredClone(cardGamePresets[model as keyof typeof cardGamePresets]);
      base.name = `${base.name} (copie)`;
    }
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
      const data = JSON.parse(await file.text()) as Record<string, unknown>;
      if (pendingCsv) {
        // Le CSV rejoint la définition : ses lignes deviennent des cartes à texte.
        const target =
          data.definition && typeof data.definition === 'object' ? (data.definition as Record<string, unknown>) : data;
        target.csv = pendingCsv.text;
      }
      await api('/api/admin/card-games/import', { method: 'POST', body: JSON.stringify(data) });
      setPendingCsv(null);
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
        Créez vos propres jeux de cartes : familles, cartes, règles et thème. Vous pouvez partir d’un modèle intégré et
        le modifier. Les joueurs les retrouvent dans le catalogue, comme les autres jeux.
      </p>
      <div className="ed-new">
        <label className="field">
          <span>Partir de</span>
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="blank">Jeu vierge</option>
            <option value="cartes-couleurs">Couleurs &amp; chiffres (modèle)</option>
            <option value="cartes-coco">Blanc-manger coco (modèle)</option>
            <optgroup label="Modèles prêts à l’emploi">
              {cardGameTemplates.map((t) => (
                <option key={t.id} value={`tpl:${t.id}`}>
                  {t.title}
                </option>
              ))}
            </optgroup>
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
        <label className="btn ghost">
          CSV de cartes (facultatif)
          <input
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              setError(null);
              setPendingCsv({ name: file.name, text: await file.text() });
            }}
          />
        </label>
        {pendingCsv && (
          <span className="muted small">
            « {pendingCsv.name} » sera lié au prochain import JSON.{' '}
            <button type="button" className="link-btn" onClick={() => setPendingCsv(null)}>
              Retirer
            </button>
          </span>
        )}
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
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
              <GameMenu
                gameName={r.definition.name}
                items={[
                  { label: 'Dupliquer', onSelect: () => void duplicate(r) },
                  {
                    label: 'Exporter (JSON, avec ses fichiers)',
                    href: `/api/admin/card-games/${encodeURIComponent(r.id)}/export`,
                  },
                  { label: 'Supprimer', danger: true, onSelect: () => void remove(r) },
                ]}
              />
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
  const [library, setLibrary] = useState<{ id: string; name: string; kind: string }[]>([]);

  useEffect(() => {
    api<{ assets: { id: string; name: string; kind: string }[] }>('/api/admin/assets')
      .then((res) => setLibrary(res.assets))
      .catch(() => setLibrary([]));
  }, []);

  const images = library.filter((a) => a.kind === 'image');
  const fonts = library.filter((a) => a.kind === 'font');

  function patchBack(fields: Partial<NonNullable<CardGameDefinition['back']>>) {
    setDraft((d) => {
      const next = { ...d.back, ...fields };
      const empty = !next.color && !next.label && !next.imageAssetId;
      return { ...d, back: empty ? undefined : next };
    });
  }
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const deckSize = draft.cards.reduce((n, c) => n + (Number(c.count) || 0), 0);
  const needed = draft.rules.maxPlayers * draft.rules.handSize + 5;
  const mechanic: CardMechanic = draft.rules.mechanic ?? 'shedding';
  const { maxPlayers, handSize } = draft.rules;
  /** Sans effet ni joker : seules les cartes de familles normales peuvent exister. */
  const pure = PURE_MECHANICS.includes(mechanic);
  /** Cartes nécessaires pour distribuer les mains (et une carte au centre à la ressemblance). */
  const neededDeck = mechanic === 'race' ? maxPlayers * handSize + 1 : maxPlayers * handSize;

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
        // Un atout supprimé ne doit pas rester référencé : le jeu redevient sans atout.
        rules: d.rules.trump === id ? { ...d.rules, trump: undefined } : d.rules,
      };
    });
  }

  /**
   * Change la mécanique. Passer au mémo, à la ressemblance ou aux plis retire effets et jokers : on prévient
   * d'abord. L'atout n'existe que pour les plis et disparaît dès qu'on en sort.
   */
  function changeMechanic(next: CardMechanic) {
    const current = draft.rules.mechanic ?? 'shedding';
    if (next === current) return;
    const becomesPure = PURE_MECHANICS.includes(next) && !PURE_MECHANICS.includes(current);
    if (becomesPure) {
      const affected = draft.cards.filter((c) => c.effect !== 'none' || c.family === WILD_FAMILY).length;
      if (
        affected > 0 &&
        !window.confirm(
          `Cette mécanique n’utilise ni effets ni jokers. ${affected > 1 ? `${affected} cartes perdront` : '1 carte perdra'} leur effet ou leur statut de joker. Continuer ?`,
        )
      ) {
        return;
      }
    }
    setDraft((d) => {
      const fallback = d.families[0]?.id ?? WILD_FAMILY;
      return {
        ...d,
        cards: becomesPure
          ? d.cards.map((c) => ({
              ...c,
              effect: 'none',
              family: c.family === WILD_FAMILY ? fallback : c.family,
            }))
          : d.cards,
        rules: {
          ...d.rules,
          mechanic: next === 'shedding' ? undefined : next,
          trump: next === 'trick' ? d.rules.trump : undefined,
        },
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

  /** Police choisie, codée pour le menu : « asset: » (médiathèque), « preset: » (livrée) ou vide (thème). */
  const fontChoice = draft.fontAssetId
    ? `asset:${draft.fontAssetId}`
    : draft.fontPreset
      ? `preset:${draft.fontPreset}`
      : '';

  function chooseFont(value: string) {
    if (value.startsWith('asset:')) {
      patch({ fontAssetId: value.slice('asset:'.length), fontPreset: undefined });
    } else if (value.startsWith('preset:')) {
      patch({ fontPreset: value.slice('preset:'.length) as CardFontPreset, fontAssetId: undefined });
    } else {
      patch({ fontAssetId: undefined, fontPreset: undefined });
    }
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

      {message && (
        <p className="error" role="alert">
          {message}
        </p>
      )}

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
        <label className="field">
          <span>Police des cartes</span>
          <select value={fontChoice} onChange={(e) => chooseFont(e.target.value)}>
            <option value="">Police du thème</option>
            <optgroup label="Livrées avec l’application">
              {CARD_FONT_PRESETS.map((p) => (
                <option key={p} value={`preset:${p}`}>
                  {FONT_PRESET_LABEL[p]}
                </option>
              ))}
            </optgroup>
            {fonts.length > 0 && (
              <optgroup label="Médiathèque">
                {fonts.map((f) => (
                  <option key={f.id} value={`asset:${f.id}`}>
                    {f.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
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

      <Section title="Dos de carte">
        <p className="muted small">
          Visible sur la pioche et sur les cartes cachées. Sans réglage, le dos suit le thème.
        </p>
        <div className="ed-grid-2">
          <label className="field">
            <span>Couleur de fond</span>
            <input
              type="color"
              value={draft.back?.color ?? '#1d2a5c'}
              onChange={(e) => patchBack({ color: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Texte au centre</span>
            <input
              value={draft.back?.label ?? ''}
              maxLength={16}
              onChange={(e) => patchBack({ label: e.target.value || undefined })}
            />
          </label>
        </div>
        <label className="field">
          <span>Motif (sans image)</span>
          <select
            value={draft.back?.pattern ?? 'uni'}
            onChange={(e) => patchBack({ pattern: e.target.value as CardBackPattern })}
          >
            {CARD_BACK_PATTERNS.map((p) => (
              <option key={p} value={p}>
                {PATTERN_LABEL[p]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Image (médiathèque)</span>
          <select
            value={draft.back?.imageAssetId ?? ''}
            onChange={(e) => patchBack({ imageAssetId: e.target.value || undefined })}
          >
            <option value="">Aucune</option>
            {images.map((img) => (
              <option key={img.id} value={img.id}>
                {img.name}
              </option>
            ))}
          </select>
        </label>
        <div className="row">
          <div className="ed-theme-thumb">
            <CardFace def={draft} back />
          </div>
          <button
            type="button"
            className="btn ghost small"
            disabled={!draft.back}
            onClick={() => setDraft((d) => ({ ...d, back: undefined }))}
          >
            Revenir au dos du thème
          </button>
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
          {draft.rules.handSize} cartes.{' '}
          {deckSize < needed && <strong className="warn">Il en manque {needed - deckSize}.</strong>}
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
              <select aria-label="Famille" value={c.family} onChange={(e) => changeFamily(c, e.target.value)}>
                {families.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
                {!pure && <option value={WILD_FAMILY}>Joker</option>}
              </select>
              <select
                aria-label="Effet"
                value={c.effect}
                onChange={(e) => updateCard(c.id, { effect: e.target.value as CardEntry['effect'] })}
              >
                {CARD_EFFECTS.filter((eff) => {
                  if (pure) return eff === 'none';
                  return c.family === WILD_FAMILY
                    ? eff === 'wild' || eff === 'draw4'
                    : eff !== 'wild' && eff !== 'draw4';
                }).map((eff) => (
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
                <button
                  type="button"
                  className="btn ghost small"
                  onClick={() => removeCard(c.id)}
                  aria-label="Supprimer"
                >
                  ✕
                </button>
              </span>
              <div className="ed-card-extra">
                <label className="field ed-card-text">
                  <span>Texte</span>
                  <input
                    value={c.text ?? ''}
                    maxLength={240}
                    onChange={(e) => updateCard(c.id, { text: e.target.value || undefined })}
                  />
                </label>
                <label className="field">
                  <span>Paire (mémo)</span>
                  <input
                    value={c.pair ?? ''}
                    maxLength={40}
                    onChange={(e) => updateCard(c.id, { pair: e.target.value || undefined })}
                  />
                </label>
                <label className="field">
                  <span>Rang (tri de la main)</span>
                  <input
                    type="number"
                    min={0}
                    max={999}
                    value={c.rank ?? ''}
                    onChange={(e) =>
                      updateCard(c.id, { rank: e.target.value === '' ? undefined : Number(e.target.value) })
                    }
                  />
                </label>
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="btn ghost small"
          disabled={draft.cards.length >= 200}
          onClick={() => addCard()}
        >
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
        <label className="field">
          <span>Mécanique</span>
          <select value={mechanic} onChange={(e) => changeMechanic(e.target.value as CardMechanic)}>
            {(Object.keys(MECHANIC_LABEL) as CardMechanic[]).map((m) => (
              <option key={m} value={m}>
                {MECHANIC_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
        {mechanic === 'memory' && (
          <p className="muted small">
            Au mémo, deux cartes forment une paire si elles ont la même étiquette « Paire », ou si ce sont deux
            exemplaires identiques. La main, la pioche et les effets ne servent pas.
          </p>
        )}
        {mechanic === 'race' && (
          <p className="muted small">
            Une carte est visible au centre, chaque joueur a une main cachée. Quand une de ses cartes ressemble au
            centre (selon « Ce qui rend deux cartes semblables »), il la touche : il prend la carte et ses points, et sa
            carte devient le centre. Une fausse touche le bloque 1,5 s. Sans réponse pendant « Secondes par tour », le
            centre change. Pas d’effet ni de joker.
          </p>
        )}
        {mechanic === 'trick' && (
          <p className="muted small">
            Le premier joueur pose une carte, les autres doivent suivre la couleur s’ils le peuvent. Le pli va à la plus
            forte carte de la couleur demandée, ou à l’atout s’il y en a un. Son gagnant prend les points du pli et
            ouvre le suivant. La manche finit quand les mains sont vides : gagne qui a fait le plus de plis. Pas d’effet
            ni de joker.
          </p>
        )}
        {(mechanic === 'race' || mechanic === 'trick') && (
          <p className={`small ${deckSize >= neededDeck && deckSize <= RACE_TRICK_MAX_CARDS ? 'muted' : 'error'}`}>
            {deckSize} cartes dans le paquet. Il en faut au moins {neededDeck} ({maxPlayers} joueurs à {handSize} cartes
            {mechanic === 'race' ? ' et une au centre' : ''}), {RACE_TRICK_MAX_CARDS} au plus.
          </p>
        )}
        <div className="ed-grid-3">
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
            <span>Cartes en main au départ</span>
            <input
              type="number"
              min={3}
              max={10}
              value={draft.rules.handSize}
              onChange={(e) => patchRule({ handSize: Number(e.target.value) })}
            />
          </label>
          {(mechanic === 'shedding' || mechanic === 'race') && (
            <label className="field">
              <span>{mechanic === 'race' ? 'Ce qui rend deux cartes semblables' : 'Pour poser une carte'}</span>
              <select
                value={draft.rules.matchOn}
                onChange={(e) => patchRule({ matchOn: e.target.value as CardGameDefinition['rules']['matchOn'] })}
              >
                {MATCH_MODES.map((m) => (
                  <option key={m} value={m}>
                    {MATCH_LABEL[m]}
                  </option>
                ))}
              </select>
            </label>
          )}
          {mechanic === 'trick' && (
            <label className="field">
              <span>Atout</span>
              <select
                value={draft.rules.trump ?? ''}
                onChange={(e) => patchRule({ trump: e.target.value || undefined })}
              >
                <option value="">Sans atout</option>
                {families.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field">
            <span>Points pour gagner</span>
            <input
              type="number"
              min={50}
              max={2000}
              value={draft.rules.targetScore}
              onChange={(e) => patchRule({ targetScore: Number(e.target.value) })}
            />
          </label>
          <label className="field">
            <span>Secondes par tour (0 = libre)</span>
            <input
              type="number"
              min={0}
              max={60}
              value={draft.rules.turnSeconds}
              onChange={(e) => patchRule({ turnSeconds: Number(e.target.value) })}
            />
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
          <textarea
            rows={4}
            value={draft.notice.steps.join('\n')}
            onChange={(e) => patchNotice({ steps: linesOf(e.target.value) })}
          />
        </label>
        <label className="field">
          <span>Conseils (une par ligne)</span>
          <textarea
            rows={3}
            value={draft.notice.tips.join('\n')}
            onChange={(e) => patchNotice({ tips: linesOf(e.target.value) })}
          />
        </label>
      </Section>
    </form>
  );
}
