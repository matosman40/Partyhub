import type { SettingsProps } from '../../client/types.js';

/** Aucun réglage : les trois niveaux sont toujours joués, dans le même ordre. */
export function BanquiseSettings(_props: SettingsProps) {
  return <p className="muted small">Aucun réglage : trois niveaux, dans l’ordre, avec les mêmes règles.</p>;
}
