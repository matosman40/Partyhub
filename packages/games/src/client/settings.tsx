import { useEffect, useState, type ComponentType } from 'react';
import type { SettingsProps } from './types.js';

export interface SettingOption {
  value: string;
  label: string;
}

export interface SettingField {
  key: string;
  label: string;
  /** Champ numérique : bornes. */
  min?: number;
  max?: number;
  /** Champ à choix : une liste déroulante, dont la valeur est une chaîne. */
  options?: SettingOption[];
}

/**
 * Réglages génériques : un formulaire est décrit par une liste de champs, numériques (bornés) ou à choix.
 * La valeur numérique est confirmée à la sortie du champ, bornée côté navigateur puis revalidée par le serveur
 * (la source de vérité reste le serveur). Un choix est envoyé dès qu’il change.
 */
export function fieldSettings(fields: SettingField[]): ComponentType<SettingsProps> {
  return function FieldSettings({ settings, disabled, onChange, bounds }: SettingsProps) {
    return (
      <div className="settings">
        {fields.map((f) => {
          if (f.options) {
            const fallback = f.options[0]?.value ?? '';
            return (
              <SelectField
                key={f.key}
                label={f.label}
                options={f.options}
                value={String(settings[f.key] ?? fallback)}
                disabled={disabled}
                onCommit={(v) => onChange({ ...settings, [f.key]: v })}
              />
            );
          }
          const exact = bounds?.[f.key];
          const min = exact?.min ?? f.min ?? 0;
          const max = exact?.max ?? f.max ?? min;
          return (
            <NumberField
              key={f.key}
              label={f.label}
              min={min}
              max={max}
              value={Number(settings[f.key] ?? min)}
              disabled={disabled}
              onCommit={(n) => onChange({ ...settings, [f.key]: n })}
            />
          );
        })}
      </div>
    );
  };
}

function NumberField({
  label,
  min,
  max,
  value,
  disabled,
  onCommit,
}: {
  label: string;
  min: number;
  max: number;
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
    const clamped = Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : value;
    setDraft(String(clamped));
    if (clamped !== value) onCommit(clamped);
  }

  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
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

function SelectField({
  label,
  options,
  value,
  disabled,
  onCommit,
}: {
  label: string;
  options: SettingOption[];
  value: string;
  disabled: boolean;
  onCommit: (v: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} disabled={disabled} onChange={(e) => onCommit(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
