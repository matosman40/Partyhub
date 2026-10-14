import type { SettingsProps } from '../../client/types.js';
import { fieldSettings } from '../../client/settings.js';

const NumericFields = fieldSettings([
  { key: 'startingChips', label: 'Jetons de départ', min: 100, max: 100000 },
  { key: 'smallBlind', label: 'Petite blinde', min: 1, max: 10000 },
  { key: 'bigBlind', label: 'Grosse blinde', min: 2, max: 20000 },
  { key: 'turnSeconds', label: 'Secondes par tour (0 = sans limite)', min: 0, max: 120 },
  { key: 'hands', label: 'Nombre de mains (0 = jusqu’au dernier joueur)', min: 0, max: 200 },
  { key: 'seats', label: 'Places à la table (les autres joueurs observent)', min: 2, max: 8 },
]);

const THEMES: [string, string][] = [
  ['arcade', 'Arcade'],
  ['coco', 'Coco'],
  ['nuit', 'Nuit'],
  ['classique', 'Classique'],
];

const AMBIANCES: [string, string][] = [
  ['casino', 'Casino'],
  ['nuit', 'Nuit'],
  ['bar', 'Bar enfumé'],
  ['tournoi', 'Tournoi'],
];

/** Réglages du poker : champs numériques, puis thème du tapis et ambiance de la salle. */
export function PokerSettings(props: SettingsProps) {
  const { settings, disabled, onChange } = props;
  return (
    <>
      <NumericFields {...props} />
      <div className="settings">
        <label className="field">
          <span>Thème du tapis</span>
          <select
            value={String(settings.theme ?? 'arcade')}
            disabled={disabled}
            onChange={(e) => onChange({ ...settings, theme: e.target.value })}
          >
            {THEMES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Ambiance</span>
          <select
            value={String(settings.ambiance ?? 'casino')}
            disabled={disabled}
            onChange={(e) => onChange({ ...settings, ambiance: e.target.value })}
          >
            {AMBIANCES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </>
  );
}
