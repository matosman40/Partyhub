import { useEffect, useState, type FormEvent } from 'react';
import {
  MEDIA_KIND_LABEL,
  MEDIA_MODE_LABEL,
  type MediaMode,
  MEDIA_KIND_ICON,
  parseTimeInput,
  parseYoutubeId,
  youtubeStartFromUrl,
  type MediaItem,
  type MediaKind,
  type MediaQuizDefinition,
} from '@partyhub/shared';
import { api, newId } from '../api.js';
import type { AssetRecord } from './AssetLibrary.js';

/** Éditeur d'un jeu de questions médias : réglages, puis une liste d'extraits. */

export interface MediaGameRecord {
  id: string;
  definition: MediaQuizDefinition;
  updatedAt: string;
  missingAssets: string[];
}

const MAX_ITEMS = 60;

/** Un extrait tel qu'il est saisi : les liens et temps restent du texte jusqu'à l'enregistrement. */
interface ItemDraft {
  key: string;
  id: string;
  answer: string;
  aliases: string;
  detail: string;
  sourceType: 'youtube' | 'asset';
  youtube: string;
  assetId: string;
  startText: string;
  durationSec: number;
}

interface Draft {
  mode: MediaMode;
  kind: MediaKind;
  name: string;
  description: string;
  icon: string;
  questionCount: number;
  answerSeconds: number;
  speedBonus: boolean;
  items: ItemDraft[];
}

export function formatTime(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** Libellés courts du type de média (le mode de jeu, lui, est choisi à part). */
const KIND_SHORT_LABEL: Record<MediaKind, string> = {
  film: 'Film',
  musique: 'Chanson',
  extrait: 'Extrait sonore ou vidéo',
};

function blankItem(): ItemDraft {
  return {
    key: newId(),
    id: newId().slice(0, 12),
    answer: '',
    aliases: '',
    detail: '',
    sourceType: 'youtube',
    youtube: '',
    assetId: '',
    startText: '0:00',
    durationSec: 20,
  };
}

function draftOf(def: MediaQuizDefinition): Draft {
  return {
    mode: def.mode,
    kind: def.kind,
    name: def.name,
    description: def.description,
    icon: def.icon,
    questionCount: def.rules.questionCount,
    answerSeconds: def.rules.answerSeconds,
    speedBonus: def.rules.speedBonus,
    items: def.items.map((item) => ({
      key: newId(),
      id: item.id,
      answer: item.answer,
      aliases: item.aliases.join(', '),
      detail: item.detail,
      sourceType: item.source.type,
      youtube: item.source.type === 'youtube' ? `https://youtu.be/${item.source.videoId}` : '',
      assetId: item.source.type === 'asset' ? item.source.assetId : '',
      startText: formatTime(item.startSec),
      durationSec: item.durationSec,
    })),
  };
}

/** Transforme le brouillon en définition, ou renvoie la première erreur à corriger. */
function definitionOf(draft: Draft, assets: AssetRecord[]): { ok: true; def: MediaQuizDefinition } | { ok: false; error: string } {
  const items: MediaItem[] = [];
  for (const [i, it] of draft.items.entries()) {
    const label = `Extrait ${i + 1}`;
    const devine = draft.mode === 'devine';
    if (devine && !it.answer.trim()) return { ok: false, error: `${label} : indiquez la réponse attendue.` };
    let source: MediaItem['source'];
    if (it.sourceType === 'youtube') {
      const videoId = parseYoutubeId(it.youtube);
      if (!videoId) return { ok: false, error: `${label} : lien YouTube non reconnu.` };
      source = { type: 'youtube', videoId };
    } else {
      const asset = assets.find((a) => a.id === it.assetId);
      if (!asset || asset.kind === 'image') return { ok: false, error: `${label} : choisissez un fichier audio ou vidéo.` };
      source = { type: 'asset', assetId: asset.id, mediaKind: asset.kind === 'video' ? 'video' : 'audio' };
    }
    const startSec = parseTimeInput(it.startText);
    if (startSec === null) return { ok: false, error: `${label} : le début doit être un temps, comme 1:30.` };
    items.push({
      id: it.id,
      answer: it.answer.trim(),
      aliases: devine
        ? it.aliases
            .split(',')
            .map((a) => a.trim())
            .filter(Boolean)
        : [],
      detail: it.detail.trim(),
      source,
      startSec,
      durationSec: it.durationSec,
    });
  }
  return {
    ok: true,
    def: {
      mode: draft.mode,
      kind: draft.kind,
      name: draft.name.trim(),
      description: draft.description.trim(),
      icon: draft.icon.trim() || MEDIA_KIND_ICON[draft.kind],
      rules: {
        questionCount: draft.questionCount,
        answerSeconds: draft.answerSeconds,
        speedBonus: draft.speedBonus,
      },
      items,
    },
  };
}

/** Vérifie une vidéo auprès de YouTube (oEmbed) : titre si elle existe et peut être intégrée. */
async function checkYoutube(videoId: string): Promise<{ ok: true; title: string } | { ok: false; error: string }> {
  const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`;
  try {
    const res = await fetch(url);
    if (!res.ok) return { ok: false, error: 'Vidéo introuvable, privée, ou non autorisée à l’intégration.' };
    const data = (await res.json()) as { title?: string };
    return { ok: true, title: data.title ?? 'Sans titre' };
  } catch {
    return { ok: false, error: 'Vérification impossible : YouTube est injoignable depuis cet appareil.' };
  }
}

function ItemEditor({
  index,
  item,
  mode,
  assets,
  total,
  onChange,
  onMove,
  onRemove,
}: {
  index: number;
  item: ItemDraft;
  mode: MediaMode;
  assets: AssetRecord[];
  total: number;
  onChange: (next: ItemDraft) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const [check, setCheck] = useState<{ ok: boolean; text: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const videoId = item.sourceType === 'youtube' ? parseYoutubeId(item.youtube) : null;
  const playable = assets.filter((a) => a.kind !== 'image');
  const asset = playable.find((a) => a.id === item.assetId);
  const startSec = parseTimeInput(item.startText) ?? 0;
  const missing = item.sourceType === 'asset' && item.assetId && !asset;

  function setYoutube(value: string) {
    const fromUrl = youtubeStartFromUrl(value);
    onChange({
      ...item,
      youtube: value,
      startText: fromUrl !== null && item.startText === '0:00' ? formatTime(fromUrl) : item.startText,
    });
    setCheck(null);
  }

  async function verify() {
    if (!videoId) return;
    setChecking(true);
    const res = await checkYoutube(videoId);
    setChecking(false);
    setCheck(res.ok ? { ok: true, text: `« ${res.title} »` } : { ok: false, text: res.error });
  }

  return (
    <li className="mq-item">
      <header className="mq-item-head">
        <strong>
          {index + 1}.{' '}
          {item.answer.trim() || (
            <span className="muted">{mode === 'devine' ? 'réponse à saisir' : 'sans traduction de référence'}</span>
          )}
        </strong>
        <div className="ed-card-actions">
          <button type="button" className="btn ghost small" disabled={index === 0} onClick={() => onMove(-1)} aria-label={`Monter l’extrait ${index + 1}`}>
            ↑
          </button>
          <button type="button" className="btn ghost small" disabled={index === total - 1} onClick={() => onMove(1)} aria-label={`Descendre l’extrait ${index + 1}`}>
            ↓
          </button>
          <button type="button" className="btn ghost small" onClick={onRemove}>
            Supprimer
          </button>
        </div>
      </header>

      <div className="mq-item-grid">
        <div className="mq-source" role="radiogroup" aria-label="Source de l’extrait">
          <label className="mq-radio">
            <input
              type="radio"
              name={`src-${item.key}`}
              checked={item.sourceType === 'youtube'}
              onChange={() => onChange({ ...item, sourceType: 'youtube' })}
            />
            Vidéo YouTube
          </label>
          <label className="mq-radio">
            <input
              type="radio"
              name={`src-${item.key}`}
              checked={item.sourceType === 'asset'}
              onChange={() => onChange({ ...item, sourceType: 'asset' })}
            />
            Fichier de la médiathèque
          </label>
        </div>

        {item.sourceType === 'youtube' ? (
          <div className="field mq-wide">
            <span>Lien YouTube ou identifiant</span>
            <div className="mq-inline">
              <input
                value={item.youtube}
                onChange={(e) => setYoutube(e.target.value)}
                placeholder="https://youtu.be/…"
                spellCheck={false}
                autoComplete="off"
              />
              <button type="button" className="btn ghost small" disabled={!videoId || checking} onClick={verify}>
                {checking ? 'Vérification…' : 'Vérifier'}
              </button>
            </div>
            {item.youtube && !videoId && <span className="error small">Lien non reconnu.</span>}
            {check && <span className={check.ok ? 'ok small' : 'error small'}>{check.text}</span>}
          </div>
        ) : (
          <label className="field mq-wide">
            <span>Fichier</span>
            <select value={item.assetId} onChange={(e) => onChange({ ...item, assetId: e.target.value })}>
              <option value="">— choisir —</option>
              {playable.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.kind === 'video' ? '🎞️' : '🔊'} {a.name}
                </option>
              ))}
            </select>
            {missing && <span className="error small">Ce fichier n’est plus dans la médiathèque.</span>}
            {playable.length === 0 && <span className="muted small">Ajoutez d’abord un fichier dans la médiathèque.</span>}
          </label>
        )}

        <label className="field">
          <span>{mode === 'devine' ? 'Réponse attendue' : 'Traduction de référence (facultative)'}</span>
          <input
            value={item.answer}
            onChange={(e) => onChange({ ...item, answer: e.target.value })}
            maxLength={mode === 'devine' ? 80 : 200}
            placeholder={mode === 'devine' ? '' : 'Ce que dit réellement la scène, révélé à la fin'}
          />
        </label>
        {mode === 'devine' && (
          <label className="field">
            <span>Autres formulations (séparées par des virgules)</span>
            <input value={item.aliases} onChange={(e) => onChange({ ...item, aliases: e.target.value })} maxLength={400} />
          </label>
        )}
        <label className="field">
          <span>{mode === 'devine' ? 'Précision après la réponse' : 'Indice pour les joueurs (langue, contexte)'}</span>
          <input
            value={item.detail}
            onChange={(e) => onChange({ ...item, detail: e.target.value })}
            maxLength={160}
            placeholder={mode === 'devine' ? '1994 · Robert Zemeckis' : 'Italien, dispute entre deux amis'}
          />
        </label>
        <div className="mq-timing">
          <label className="field">
            <span>Début de l’extrait</span>
            <input
              value={item.startText}
              onChange={(e) => onChange({ ...item, startText: e.target.value })}
              onBlur={() => {
                const sec = parseTimeInput(item.startText);
                if (sec !== null) onChange({ ...item, startText: formatTime(sec) });
              }}
              inputMode="numeric"
              aria-invalid={parseTimeInput(item.startText) === null}
            />
          </label>
          <label className="field">
            <span>Durée (secondes)</span>
            <input
              type="number"
              min={3}
              max={60}
              value={item.durationSec}
              onChange={(e) => onChange({ ...item, durationSec: Number(e.target.value) })}
            />
          </label>
        </div>
      </div>

      <div className="mq-preview">
        {item.sourceType === 'youtube' && videoId && (
          <iframe
            title={`Aperçu de l’extrait ${index + 1}`}
            src={`https://www.youtube-nocookie.com/embed/${videoId}?start=${startSec}&end=${startSec + item.durationSec}&rel=0`}
            allow="encrypted-media; picture-in-picture"
            loading="lazy"
          />
        )}
        {item.sourceType === 'asset' && asset && asset.kind === 'audio' && (
          <audio controls preload="none" src={`/api/assets/${asset.id}`} />
        )}
        {item.sourceType === 'asset' && asset && asset.kind === 'video' && (
          <video controls preload="metadata" src={`/api/assets/${asset.id}`} />
        )}
      </div>
    </li>
  );
}

export function MediaGameEditor({
  editing,
  initial,
  onCancel,
  onSaved,
}: {
  editing: MediaGameRecord | null;
  initial: MediaQuizDefinition | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() =>
    draftOf(
      initial ?? {
        mode: 'devine',
        kind: 'film',
        name: 'Devine le film',
        description: '',
        icon: MEDIA_KIND_ICON.film,
        rules: { questionCount: 8, answerSeconds: 30, speedBonus: true },
        items: [],
      },
    ),
  );
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<{ assets: AssetRecord[] }>('/api/admin/assets')
      .then((r) => setAssets(r.assets))
      .catch((err: Error) => setError(err.message));
  }, []);

  const count = draft.items.length;
  // Le moteur tire au plus autant d'extraits qu'il y en a dans le jeu.
  const questionCount = Math.min(draft.questionCount, Math.max(1, count));

  function setItem(index: number, next: ItemDraft) {
    setDraft((d) => ({ ...d, items: d.items.map((it, i) => (i === index ? next : it)) }));
  }

  function move(index: number, dir: -1 | 1) {
    setDraft((d) => {
      const items = [...d.items];
      const target = index + dir;
      if (target < 0 || target >= items.length) return d;
      [items[index], items[target]] = [items[target]!, items[index]!];
      return { ...d, items };
    });
  }

  /** Changer de mode renomme le jeu par défaut (« Devine le film » ne convient pas aux sous-titres). */
  function changeMode(mode: MediaMode) {
    setDraft((d) => {
      const defaultNames = Object.values(MEDIA_KIND_LABEL) as string[];
      const name = defaultNames.includes(d.name) ? (mode === 'sous-titres' ? `Sous-titres : ${KIND_SHORT_LABEL[d.kind]}` : MEDIA_KIND_LABEL[d.kind]) : d.name;
      return { ...d, mode, name };
    });
  }

  function changeKind(kind: MediaKind) {
    setDraft((d) => ({
      ...d,
      kind,
      icon: d.icon === MEDIA_KIND_ICON[d.kind] ? MEDIA_KIND_ICON[kind] : d.icon,
    }));
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const built = definitionOf(draft, assets);
    if (!built.ok) {
      setError(built.error);
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await api(`/api/admin/media-games/${encodeURIComponent(editing.id)}`, {
          method: 'PUT',
          body: JSON.stringify(built.def),
        });
      } else {
        await api('/api/admin/media-games', { method: 'POST', body: JSON.stringify(built.def) });
      }
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="mq-editor stack" onSubmit={save}>
      <div className="ed-top">
        <h3>{editing ? 'Modifier le jeu' : 'Nouveau jeu de questions'}</h3>
        <div className="ed-new">
          <button type="button" className="btn ghost" onClick={onCancel}>
            Annuler
          </button>
          <button type="submit" className="btn primary" disabled={saving}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>

      {error && <p className="error" role="alert">{error}</p>}

      <section className="ed-section">
        <div className="mq-settings">
          <label className="field">
            <span>Mode de jeu</span>
            <select value={draft.mode} onChange={(e) => changeMode(e.target.value as MediaMode)}>
              {(Object.keys(MEDIA_MODE_LABEL) as MediaMode[]).map((m) => (
                <option key={m} value={m}>
                  {MEDIA_MODE_LABEL[m]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Type de média</span>
            <select value={draft.kind} onChange={(e) => changeKind(e.target.value as MediaKind)}>
              {(Object.keys(KIND_SHORT_LABEL) as MediaKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_SHORT_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Nom du jeu</span>
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={40} />
          </label>
          <label className="field">
            <span>Icône</span>
            <input value={draft.icon} onChange={(e) => setDraft({ ...draft, icon: e.target.value })} maxLength={8} />
          </label>
          <label className="field mq-wide">
            <span>Description (catalogue)</span>
            <input
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              maxLength={200}
              placeholder="Des films des années 80 : le titre, vite et juste."
            />
          </label>
          <label className="field">
            <span>Extraits par partie</span>
            <input
              type="number"
              min={1}
              max={Math.max(1, Math.min(30, count))}
              value={draft.questionCount}
              onChange={(e) => setDraft({ ...draft, questionCount: Number(e.target.value) })}
            />
            <span className="muted small">
              {count === 0 ? 'Ajoutez des extraits.' : `${questionCount} tiré(s) parmi ${count} au hasard`}
            </span>
          </label>
          <label className="field">
            <span>Secondes pour répondre</span>
            <input
              type="number"
              min={10}
              max={90}
              value={draft.answerSeconds}
              onChange={(e) => setDraft({ ...draft, answerSeconds: Number(e.target.value) })}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.speedBonus}
              onChange={(e) => setDraft({ ...draft, speedBonus: e.target.checked })}
            />
            <span>Bonus pour les réponses rapides</span>
          </label>
        </div>
      </section>

      <section className="ed-section stack">
        <div className="section-head">
          <h3>Extraits ({count}/{MAX_ITEMS})</h3>
          <button
            type="button"
            className="btn ghost small"
            disabled={count >= MAX_ITEMS}
            onClick={() => setDraft((d) => ({ ...d, items: [...d.items, blankItem()] }))}
          >
            Ajouter un extrait
          </button>
        </div>
        {count === 0 && <p className="muted">Aucun extrait. Ajoutez un lien YouTube ou un fichier de la médiathèque.</p>}
        <ol className="mq-items">
          {draft.items.map((item, i) => (
            <ItemEditor
              key={item.key}
              index={i}
              item={item}
              mode={draft.mode}
              assets={assets}
              total={count}
              onChange={(next) => setItem(i, next)}
              onMove={(dir) => move(i, dir)}
              onRemove={() => setDraft((d) => ({ ...d, items: d.items.filter((_, j) => j !== i) }))}
            />
          ))}
        </ol>
      </section>
    </form>
  );
}
