import { useEffect, useState, type ComponentType } from 'react';
import type { SettingsProps } from './types.js';

export interface SettingField {
  key: string;
  label: string;
  min: number;
  max: number;
}

/**
 * Réglages numériques génériques : un formulaire est décrit par une liste de champs.
 * La valeur est confirmée à la sortie du champ, bornée côté navigateur puis
 * revalidée par le serveur (la source de vérité reste le serveur).
 */
export function fieldSettings(fields: SettingField[]): ComponentType<SettingsProps> {
  return function FieldSettings({ settings, disabled, onChange }: SettingsProps) {
    return (
      <div className="settings">
        {fields.map((f) => (
          <NumberField
            key={f.key}
            field={f}
            value={Number(settings[f.key] ?? f.min)}
            disabled={disabled}
            onCommit={(n) => onChange({ ...settings, [f.key]: n })}
          />
        ))}
      </div>
    );
  };
}

function NumberField({
  field,
  value,
  disabled,
  onCommit,
}: {
  field: SettingField;
  value: number;
  disabled: boolean;
  onCommit: (n: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  function commit() {
    const n = Math.round(Number(draft));
    const clamped = Number.isFinite(n) ? Math.min(field.max, Math.max(field.min, n)) : value;
    setDraft(String(clamped));
    if (clamped !== value) onCommit(clamped);
  }

  return (
    <label className="field">
      <span>{field.label}</span>
      <input
        type="number"
        min={field.min}
        max={field.max}
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
      />
    </label>
  );
}
