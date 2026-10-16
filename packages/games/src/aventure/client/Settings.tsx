import { useEffect, useState } from 'react';
import type { SettingsProps } from '../../client/types.js';
import { TONES, TONE_LABELS, type Tone } from '../schemas.js';

interface AventureDraft {
  scenes: number;
  theme: string;
  tone: Tone;
  voteSeconds: number;
}

const BOUNDS = { scenes: [3, 10], voteSeconds: [15, 180] } as const;

function clamp(value: number, [min, max]: readonly [number, number]): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? Math.round(value) : min));
}

/**
 * Réglages de l'Aventure IA. Le serveur valide tout : le navigateur ne fait que borner la saisie.
 */
export function AventureSettings({ settings, disabled, onChange }: SettingsProps) {
  const { scenes, theme, tone, voteSeconds } = settings as unknown as AventureDraft;
  const [draft, setDraft] = useState<AventureDraft>({ scenes, theme, tone, voteSeconds });

  useEffect(() => {
    setDraft({ scenes, theme, tone, voteSeconds });
  }, [scenes, theme, tone, voteSeconds]);

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
        <span>Thème (facultatif)</span>
        <input
          type="text"
          maxLength={120}
          placeholder="Au choix du conteur"
          value={draft.theme}
          disabled={disabled}
          onChange={(e) => setDraft({ ...draft, theme: e.target.value })}
          onBlur={() => commit(draft)}
        />
      </label>
    </div>
  );
}
