import type { SettingsProps } from '../../client/types.js';
import { fieldSettings } from '../../client/settings.js';

const NumberFields = fieldSettings([
  { key: 'rounds', label: 'Manches', min: 3, max: 8 },
  { key: 'writeSeconds', label: 'Secondes pour écrire', min: 15, max: 120 },
  { key: 'voteSeconds', label: 'Secondes pour voter', min: 10, max: 60 },
]);

/** Réglages de BOUM ! affichés dans le salon. Le serveur valide chaque valeur. */
export function BoumSettings({ settings, disabled, onChange, bounds }: SettingsProps) {
  const set = (key: string, value: unknown) => onChange({ ...settings, [key]: value });
  return (
    <div className="settings">
      <NumberFields settings={settings} disabled={disabled} onChange={onChange} bounds={bounds} />
      <label className="field check">
        <input
          type="checkbox"
          checked={settings.corse === true}
          disabled={disabled}
          onChange={(e) => set('corse', e.target.checked)}
        />
        <span>Ton corsé (contenus plus piquants)</span>
      </label>
      <label className="field check">
        <input
          type="checkbox"
          checked={settings.pack === true}
          disabled={disabled}
          onChange={(e) => set('pack', e.target.checked)}
        />
        <span>Pack Humour noir</span>
      </label>
      {settings.pack === true && (
        <p className="muted" role="note">
          Le pack Humour noir contient des contenus plus osés. Vérifiez que tous les joueurs sont d’accord.
        </p>
      )}
      <label className="field">
        <span>Effets à l’écran</span>
        <select
          value={String(settings.effects ?? 'reduits')}
          disabled={disabled}
          onChange={(e) => set('effects', e.target.value)}
        >
          <option value="complets">Complets</option>
          <option value="reduits">Réduits</option>
          <option value="aucun">Aucun</option>
        </select>
      </label>
    </div>
  );
}
