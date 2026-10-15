import type { SettingsProps } from '../../client/types.js';
import { LEVELS, type Level } from '../module.js';

const LEVEL_LABEL: Record<Level, string> = {
  galerie: 'Niveau 1 · Galerie : une photo de votre téléphone',
  grimace: 'Niveau 2 · Grimace : prenez-vous en photo',
  cri: 'Niveau 3 · Cri : enregistrez votre voix',
  melange: 'Niveau 4 · Mélange : les trois',
};

function clamp(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
}

export function ImiteSettings({ settings, disabled, onChange }: SettingsProps) {
  const level = LEVELS.includes(settings.level as Level) ? String(settings.level) : 'melange';
  const rounds = Number(settings.rounds ?? 4);
  const answerSeconds = Number(settings.answerSeconds ?? 40);

  return (
    <div className="stack">
      <label className="field">
        <span>Niveau</span>
        <select value={level} disabled={disabled} onChange={(e) => onChange({ ...settings, level: e.target.value })}>
          {LEVELS.map((value) => (
            <option key={value} value={value}>
              {LEVEL_LABEL[value]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Manches</span>
        <input
          type="number"
          min={1}
          max={10}
          value={rounds}
          disabled={disabled}
          onChange={(e) => onChange({ ...settings, rounds: clamp(e.target.valueAsNumber, 1, 10, 4) })}
        />
      </label>
      <label className="field">
        <span>Secondes pour répondre</span>
        <input
          type="number"
          min={15}
          max={120}
          value={answerSeconds}
          disabled={disabled}
          onChange={(e) => onChange({ ...settings, answerSeconds: clamp(e.target.valueAsNumber, 15, 120, 40) })}
        />
      </label>
    </div>
  );
}
