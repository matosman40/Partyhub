import { useEffect, useState } from 'react';
import type { SettingsProps } from '../../client/types.js';
import { clampInt } from '../../common/client/numbers.js';

interface PhotoDraft {
  rounds: number;
  guessSeconds: number;
  difficulty: number;
}

/** Libellés des trois niveaux, dans l’ordre du curseur. */
const NIVEAUX = ['Facile · pays affiché', 'Moyen', 'Difficile · points plus sévères'];

/** Réglages de Photo mystère. Le serveur valide les valeurs ; le navigateur ne fait que borner la saisie. */
export function PhotoSettings({ settings, disabled, onChange }: SettingsProps) {
  const current = settings as unknown as PhotoDraft;
  const [draft, setDraft] = useState<PhotoDraft>(current);
  const signature = JSON.stringify(current);

  useEffect(() => {
    setDraft(JSON.parse(signature) as PhotoDraft);
  }, [signature]);

  function commit(next: PhotoDraft) {
    setDraft(next);
    onChange({ ...next });
  }

  return (
    <div className="settings">
      <label className="field">
        <span>Photos par partie</span>
        <input
          type="number"
          min={1}
          max={10}
          value={draft.rounds}
          disabled={disabled}
          onChange={(e) => setDraft({ ...draft, rounds: Number(e.target.value) })}
          onBlur={() => commit({ ...draft, rounds: clampInt(draft.rounds, 1, 10) })}
        />
      </label>
      <label className="field">
        <span>Difficulté : {NIVEAUX[(draft.difficulty ?? 2) - 1]}</span>
        <input
          type="range"
          min={1}
          max={3}
          step={1}
          value={draft.difficulty ?? 2}
          disabled={disabled}
          aria-valuetext={NIVEAUX[(draft.difficulty ?? 2) - 1]}
          onChange={(e) => commit({ ...draft, difficulty: Number(e.target.value) })}
        />
      </label>
      <label className="field">
        <span>Secondes pour placer le point</span>
        <input
          type="number"
          min={20}
          max={180}
          value={draft.guessSeconds}
          disabled={disabled}
          onChange={(e) => setDraft({ ...draft, guessSeconds: Number(e.target.value) })}
          onBlur={() => commit({ ...draft, guessSeconds: clampInt(draft.guessSeconds, 20, 180) })}
        />
      </label>
    </div>
  );
}
