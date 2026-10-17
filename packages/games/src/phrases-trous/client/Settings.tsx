import { useEffect, useState } from 'react';
import type { SettingsProps } from '../../client/types.js';
import { clampInt } from '../../common/client/numbers.js';

interface PhrasesDraft {
  rounds: number;
  handSize: number;
  topicSeconds: number;
  fillSeconds: number;
  voteSeconds: number;
}

const FIELDS: Array<{ key: keyof PhrasesDraft; label: string; min: number; max: number }> = [
  { key: 'rounds', label: 'Tours', min: 3, max: 8 },
  { key: 'handSize', label: 'Cartes en main', min: 3, max: 6 },
  { key: 'topicSeconds', label: 'Secondes pour les mots-clés, par joueur', min: 10, max: 60 },
  { key: 'fillSeconds', label: 'Secondes pour poser une carte', min: 10, max: 60 },
  { key: 'voteSeconds', label: 'Secondes pour voter', min: 10, max: 60 },
];

/**
 * Réglages des phrases à trous. Les bornes sont aussi vérifiées par le serveur : le navigateur n’est qu’un confort.
 * La saisie est bornée à la perte de focus, pour qu’un champ vidé n’envoie jamais 0.
 */
export function PhrasesSettings({ settings, disabled, onChange }: SettingsProps) {
  const current = settings as unknown as PhrasesDraft;
  const [draft, setDraft] = useState<PhrasesDraft>(current);
  // Le brouillon se recale sur les réglages du serveur quand ils changent (comparaison par valeur).
  const signature = JSON.stringify(current);

  useEffect(() => {
    setDraft(JSON.parse(signature) as PhrasesDraft);
  }, [signature]);

  function commit(next: PhrasesDraft) {
    setDraft(next);
    onChange({ ...next });
  }

  return (
    <div className="settings">
      {FIELDS.map((f) => (
        <label className="field" key={f.key}>
          <span>{f.label}</span>
          <input
            type="number"
            min={f.min}
            max={f.max}
            value={draft[f.key]}
            disabled={disabled}
            onChange={(e) => setDraft({ ...draft, [f.key]: Number(e.target.value) })}
            onBlur={() => commit({ ...draft, [f.key]: clampInt(draft[f.key], f.min, f.max) })}
          />
        </label>
      ))}
    </div>
  );
}
