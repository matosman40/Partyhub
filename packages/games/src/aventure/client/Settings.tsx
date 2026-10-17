import { useEffect, useState } from 'react';
import type { SettingsProps } from '../../client/types.js';
import { DIFFICULTIES, DIFFICULTY_LABELS, TONES, TONE_LABELS, type Difficulty, type Tone } from '../schemas.js';
import { THEMES } from '../themes.js';

interface AventureDraft {
  scenes: number;
  /** Thème du catalogue, `auto` (au hasard parmi eux), ou `libre` (seul le texte compte). */
  themeId: string;
  /** Précision libre, ajoutée au thème choisi. */
  theme: string;
  tone: Tone;
  difficulte: Difficulty;
  voteSeconds: number;
}

/** Parties courtes : de trois à six scènes, un vote de 15 secondes à deux minutes. */
const BOUNDS = { scenes: [3, 6], voteSeconds: [15, 120] } as const;

function clamp(value: number, [min, max]: readonly [number, number]): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? Math.round(value) : min));
}

/**
 * Réglages de l’Aventure IA. Le serveur valide tout : le navigateur ne fait que borner la saisie.
 */
export function AventureSettings({ settings, disabled, onChange }: SettingsProps) {
  const { scenes, themeId, theme, tone, difficulte, voteSeconds } = settings as unknown as AventureDraft;
  const [draft, setDraft] = useState<AventureDraft>({ scenes, themeId, theme, tone, difficulte, voteSeconds });

  useEffect(() => {
    setDraft({ scenes, themeId, theme, tone, difficulte, voteSeconds });
  }, [scenes, themeId, theme, tone, difficulte, voteSeconds]);

  function commit(next: AventureDraft) {
    const bounded = {
      ...next,
      scenes: clamp(next.scenes, BOUNDS.scenes),
      voteSeconds: clamp(next.voteSeconds, BOUNDS.voteSeconds),
      theme: next.theme.slice(0, 120),
    };
    setDraft(bounded);
    onChange({ ...bounded });
  }

  return (
    <div className="settings">
      <label className="field">
        <span>Scènes</span>
        <input
          type="number"
          min={BOUNDS.scenes[0]}
          max={BOUNDS.scenes[1]}
          value={draft.scenes}
          disabled={disabled}
          onChange={(e) => setDraft({ ...draft, scenes: Number(e.target.value) })}
          onBlur={() => commit(draft)}
        />
      </label>
      <label className="field">
        <span>Thème</span>
        <select
          value={draft.themeId}
          disabled={disabled}
          onChange={(e) => commit({ ...draft, themeId: e.target.value })}
        >
          <option value="auto">Au hasard parmi les thèmes</option>
          {THEMES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
          <option value="libre">Libre : seule la précision compte</option>
        </select>
      </label>
      <label className="field">
        <span>Précision (facultatif)</span>
        <input
          type="text"
          maxLength={120}
          placeholder="Un détail que le conteur doit garder"
          value={draft.theme}
          disabled={disabled}
          onChange={(e) => setDraft({ ...draft, theme: e.target.value })}
          onBlur={() => commit(draft)}
        />
      </label>
      <label className="field">
        <span>Ton</span>
        <select
          value={draft.tone}
          disabled={disabled}
          onChange={(e) => commit({ ...draft, tone: e.target.value as Tone })}
        >
          {TONES.map((t) => (
            <option key={t} value={t}>
              {TONE_LABELS[t]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Difficulté</span>
        <select
          value={draft.difficulte}
          disabled={disabled}
          onChange={(e) => commit({ ...draft, difficulte: e.target.value as Difficulty })}
        >
          {DIFFICULTIES.map((d) => (
            <option key={d} value={d}>
              {DIFFICULTY_LABELS[d]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Secondes pour voter</span>
        <input
          type="number"
          min={BOUNDS.voteSeconds[0]}
          max={BOUNDS.voteSeconds[1]}
          value={draft.voteSeconds}
          disabled={disabled}
          onChange={(e) => setDraft({ ...draft, voteSeconds: Number(e.target.value) })}
          onBlur={() => commit(draft)}
        />
      </label>
    </div>
  );
}
