import { useEffect, useState } from 'react';
import { parseYoutubeId } from '@partyhub/shared';
import type { SettingsProps } from '../../client/types.js';

/** Valeurs par défaut, identiques à celles du module serveur. */
const DEFAUTS = {
  micro: true,
  camera: true,
  mouvement: true,
  dessin: true,
  touche: true,
  lecture: true,
  lienVideo: '',
  dureeSon: 1000,
  longueurTrait: 150,
  inclinaison: 50,
  enregistrement: true,
  imagesMin: 12,
  seuilTouche: 150,
  reprise: true,
};

const ESSAIS_OPTIONS = [
  { id: 'micro', icone: '🎤', titre: 'Micro', aide: 'Maintenir un son pendant la durée réglée' },
  { id: 'camera', icone: '📷', titre: 'Caméra', aide: 'Démarrer l’image et confirmer qu’on se voit' },
  { id: 'mouvement', icone: '🧭', titre: 'Mouvement', aide: 'Pencher le téléphone d’un côté, puis de l’autre' },
  { id: 'dessin', icone: '✏️', titre: 'Dessin', aide: 'Tracer un trait sur l’écran' },
  { id: 'touche', icone: '👆', titre: 'Touches', aide: 'Toucher une cible qui bouge, le retour est mesuré' },
  { id: 'lecture', icone: '🎬', titre: 'Vidéo', aide: 'Lire la vidéo du lien ci-dessous dans un cadre' },
] as const;

/**
 * Réglages du salon : quels essais, et les seuils. Les essais désactivés n’apparaissent pas dans la partie ;
 * si tous sont désactivés, la partie les fait tous.
 */
export function EssaiSettings({ settings, disabled, onChange }: SettingsProps) {
  const v = { ...DEFAUTS, ...settings } as typeof DEFAUTS;
  const set = (patch: Partial<typeof DEFAUTS>) => onChange({ ...v, ...patch });
  const lienReconnu = parseYoutubeId(v.lienVideo) !== null;
  // L’essai Vidéo n’apparaît coché que s’il peut tourner, c’est-à-dire avec un lien valide.
  const actif = (id: (typeof ESSAIS_OPTIONS)[number]['id']) => (id === 'lecture' ? v.lecture && lienReconnu : v[id]);

  return (
    <fieldset className="essai-reglages" disabled={disabled}>
      <legend className="essai-reglages-titre">Essais à faire</legend>
      <ul className="essai-options">
        {ESSAIS_OPTIONS.map((o) => (
          <li key={o.id}>
            <label className={`essai-option${actif(o.id) ? ' is-on' : ''}`}>
              <input
                type="checkbox"
                checked={actif(o.id)}
                disabled={o.id === 'lecture' && !lienReconnu}
                onChange={(e) => set({ [o.id]: e.target.checked } as Partial<typeof DEFAUTS>)}
              />
              <span className="essai-option-icone" aria-hidden="true">
                {o.icone}
              </span>
              <span className="essai-option-texte">
                <strong>{o.titre}</strong>
                <small>{o.aide}</small>
              </span>
            </label>
          </li>
        ))}
      </ul>

      <legend className="essai-reglages-titre">Caméra et vidéo</legend>
      <label className="check essai-reprise">
        <input type="checkbox" checked={v.enregistrement} onChange={(e) => set({ enregistrement: e.target.checked })} />
        <span>Enregistrer 2 secondes de vidéo et la relire sur le téléphone</span>
      </label>
      <Curseur
        label="Images par seconde minimum"
        valeur={v.imagesMin}
        min={5}
        max={30}
        pas={1}
        affiche={`${v.imagesMin} img/s`}
        onChange={(n) => set({ imagesMin: n })}
      />

      <legend className="essai-reglages-titre">Vidéo à lire</legend>
      <LienVideo valeur={v.lienVideo} disabled={disabled} onCommit={(lien) => set({ lienVideo: lien })} />

      <legend className="essai-reglages-titre">Seuils</legend>
      <Curseur
        label="Durée du son"
        valeur={v.dureeSon}
        min={500}
        max={3000}
        pas={100}
        affiche={`${(v.dureeSon / 1000).toFixed(1)} s`}
        onChange={(n) => set({ dureeSon: n })}
      />
      <Curseur
        label="Longueur du trait"
        valeur={v.longueurTrait}
        min={50}
        max={400}
        pas={10}
        affiche={`${v.longueurTrait} px`}
        onChange={(n) => set({ longueurTrait: n })}
      />
      <Curseur
        label="Inclinaison à atteindre"
        valeur={v.inclinaison}
        min={30}
        max={90}
        pas={5}
        affiche={`${v.inclinaison} %`}
        onChange={(n) => set({ inclinaison: n })}
      />
      <Curseur
        label="Délai maximal du toucher"
        valeur={v.seuilTouche}
        min={50}
        max={400}
        pas={10}
        affiche={`${v.seuilTouche} ms`}
        onChange={(n) => set({ seuilTouche: n })}
      />

      <label className="check essai-reprise">
        <input type="checkbox" checked={v.reprise} onChange={(e) => set({ reprise: e.target.checked })} />
        <span>Autoriser à refaire un essai et corriger son résultat</span>
      </label>
    </fieldset>
  );
}

function Curseur({
  label,
  valeur,
  min,
  max,
  pas,
  affiche,
  onChange,
}: {
  label: string;
  valeur: number;
  min: number;
  max: number;
  pas: number;
  affiche: string;
  onChange: (n: number) => void;
}) {
  return (
    <label className="essai-curseur">
      <span className="essai-curseur-entete">
        <span>{label}</span>
        <output>{affiche}</output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={pas}
        value={valeur}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

/**
 * Lien de la vidéo : validé à la frappe, enregistré à la sortie du champ ou sur Entrée, pour ne pas envoyer
 * une mise à jour à chaque lettre. Seuls les liens YouTube sont acceptés.
 */
function LienVideo({
  valeur,
  disabled,
  onCommit,
}: {
  valeur: string;
  disabled?: boolean;
  onCommit: (lien: string) => void;
}) {
  const [brouillon, setBrouillon] = useState(valeur);
  useEffect(() => {
    setBrouillon(valeur);
  }, [valeur]);

  const texte = brouillon.trim();
  const reconnu = texte !== '' && parseYoutubeId(texte) !== null;
  const enregistre = () => {
    if (texte !== valeur) onCommit(texte);
  };
  let statut = 'Aucun lien : l’essai Vidéo est retiré.';
  if (texte !== '') statut = reconnu ? 'Vidéo reconnue.' : 'Lien non reconnu : seuls les liens YouTube sont acceptés.';

  return (
    <div className="essai-lien">
      <label>
        <span className="essai-lien-titre">Lien YouTube à lire dans un cadre</span>
        <input
          type="url"
          inputMode="url"
          placeholder="https://youtu.be/…"
          maxLength={300}
          value={brouillon}
          disabled={disabled}
          onChange={(e) => setBrouillon(e.target.value)}
          onBlur={enregistre}
          onKeyDown={(e) => {
            if (e.key === 'Enter') enregistre();
          }}
        />
      </label>
      <p className={`essai-lien-statut${texte !== '' && !reconnu ? ' is-erreur' : ''}`} role="status">
        {statut}
      </p>
    </div>
  );
}
