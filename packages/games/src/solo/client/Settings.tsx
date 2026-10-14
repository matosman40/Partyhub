import type { ComponentType } from 'react';
import type { SettingsProps } from '../../client/types.js';
import { fieldSettings } from '../../client/settings.js';

export interface SoloChoice {
  key: string;
  label: string;
  options: Array<{ value: string | number; label: string }>;
}

const TimeLimit = fieldSettings([
  { key: 'timeLimitSec', label: 'Temps limite, en secondes (0 = sans limite)', min: 0, max: 3600 },
]);

/** Réglages d'un jeu solo : temps limite commun, plus les choix propres au jeu. */
export function soloSettings(choices: SoloChoice[]): ComponentType<SettingsProps> {
  return function SoloSettings(props: SettingsProps) {
    return (
      <>
        <TimeLimit {...props} />
        {choices.map((choice) => {
          const current = String(props.settings[choice.key] ?? choice.options[0]!.value);
          return (
            <label className="field" key={choice.key}>
              <span>{choice.label}</span>
              <select
                disabled={props.disabled}
                value={current}
                onChange={(e) => {
                  const picked = choice.options.find((o) => String(o.value) === e.target.value);
                  if (picked) props.onChange({ ...props.settings, [choice.key]: picked.value });
                }}
              >
                {choice.options.map((o) => (
                  <option key={String(o.value)} value={String(o.value)}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
      </>
    );
  };
}
