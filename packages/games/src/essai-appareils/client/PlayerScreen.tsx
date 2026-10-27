import type { ComponentType } from 'react';
import type { PlayerViewProps } from '../../client/types.js';
import {
  CameraEssai,
  DessinEssai,
  MicroEssai,
  MouvementEssai,
  ToucheEssai,
  type EssaiProps,
  type Reglages,
} from './essais.js';
import { EssaiTableau, type EtapeAffichee, type JoueurAffiche } from './HostScreen.js';

const ESSAI_PAR_ID: Record<string, ComponentType<EssaiProps>> = {
  micro: MicroEssai,
  camera: CameraEssai,
  mouvement: MouvementEssai,
  dessin: DessinEssai,
  touche: ToucheEssai,
};

/** Rangée de pastilles : un essai fait, en cours, ou à venir. */
function Parcours({
  etapes,
  index,
  joueurs,
  playerId,
  phase,
}: {
  etapes: EtapeAffichee[];
  index: number;
  joueurs: JoueurAffiche[];
  playerId: string;
  phase: string;
}) {
  const moi = joueurs.find((j) => j.id === playerId);
  return (
    <ol className="essai-parcours" aria-label="Progression des essais">
      {etapes.map((e, i) => {
        const r = moi?.resultats[i];
        const etat =
          phase === 'final' || i < index
            ? r === true
              ? 'is-ok'
              : r === false
                ? 'is-ko'
                : 'is-passe'
            : i === index
              ? 'is-courant'
              : 'is-a-venir';
        return (
          <li key={e.id} className={etat} aria-current={i === index && phase === 'essai' ? 'step' : undefined}>
            <span aria-hidden="true">{e.icone}</span>
            <small>{e.libelle}</small>
          </li>
        );
      })}
    </ol>
  );
}

/** Téléphone : chaque essai dans l’ordre fixé par l’écran principal, puis le bilan de la salle. */
export function EssaiPlayer({ publicState: pub, playerState: moi, playerId, send }: PlayerViewProps) {
  if (!pub) return null;

  const etapes = pub.etapes as EtapeAffichee[];
  const joueurs = pub.joueurs as JoueurAffiche[];
  const reglages = pub.reglages as Reglages;
  const index = pub.index as number;

  if (pub.phase === 'ready') {
    return (
      <section className="essai-ecran fade-in" aria-label="Essai des appareils">
        <Parcours etapes={etapes} index={0} joueurs={joueurs} playerId={playerId} phase="ready" />
        <p className="essai-texte">Les essais vont commencer sur l’écran principal.</p>
      </section>
    );
  }

  if (pub.phase === 'final') {
    // Sans écran principal, ce bilan est le seul endroit où la salle voit les résultats de tous.
    return (
      <section className="essai-ecran fade-in" aria-labelledby="essai-bilan">
        <h2 id="essai-bilan" className="essai-titre">
          Bilan des essais
        </h2>
        <Parcours etapes={etapes} index={index} joueurs={joueurs} playerId={playerId} phase="final" />
        <EssaiTableau etapes={etapes} joueurs={joueurs} etape={null} moi={playerId} compact />
      </section>
    );
  }

  const etape = pub.etape as string | null;
  if (!etape) return null;
  const etapeCourante = etapes.find((e) => e.id === etape);
  const libelle = etapeCourante?.libelle ?? etape;

  if (moi?.aRepondu && !reglages.reprise) {
    return (
      <section className="essai-ecran fade-in">
        <Parcours etapes={etapes} index={index} joueurs={joueurs} playerId={playerId} phase="essai" />
        <h2 className="essai-titre">
          {etapeCourante?.icone} {libelle} : envoyé ✔
        </h2>
        <p className="essai-texte">En attente des autres téléphones.</p>
      </section>
    );
  }

  const Essai = ESSAI_PAR_ID[etape];
  const envoyer = (reussi: boolean) => {
    void send('rapport', { reussi });
  };
  return (
    <section className="essai-ecran fade-in" aria-label={`Essai ${libelle}`}>
      <Parcours etapes={etapes} index={index} joueurs={joueurs} playerId={playerId} phase="essai" />
      <h2 className="essai-titre">
        {etapeCourante?.icone} {libelle}
      </h2>
      <p className="essai-compteur">
        Essai {index + 1} sur {etapes.length}
        {moi?.aRepondu && ' · résultat corrigeable'}
      </p>
      {Essai && <Essai key={etape} onDone={envoyer} reglages={reglages} />}
    </section>
  );
}
