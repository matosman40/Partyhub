import type { ComponentType } from 'react';
import type { PlayerViewProps } from '../../client/types.js';
import { CameraEssai, DessinEssai, MicroEssai, MouvementEssai, type EssaiProps } from './essais.js';
import { EssaiTableau, type EtapeAffichee, type JoueurAffiche } from './HostScreen.js';

const ESSAI_PAR_ID: Record<string, ComponentType<EssaiProps>> = {
  micro: MicroEssai,
  camera: CameraEssai,
  mouvement: MouvementEssai,
  dessin: DessinEssai,
};

/** Téléphone : chaque essai, dans l’ordre fixé par l’écran principal, puis le bilan de ce téléphone. */
export function EssaiPlayer({ publicState: pub, playerState: moi, playerId, send }: PlayerViewProps) {
  if (!pub) return null;

  if (pub.phase === 'ready') {
    return (
      <section className="player-game fade-in">
        <p className="notice">Les essais vont commencer sur l’écran principal.</p>
      </section>
    );
  }

  if (pub.phase === 'final') {
    // Sans écran principal, ce bilan est le seul endroit où la salle voit les résultats de tous.
    return (
      <section className="player-game fade-in" aria-labelledby="essai-bilan">
        <h2 id="essai-bilan" className="question-small">
          Bilan des essais
        </h2>
        <EssaiTableau
          etapes={pub.etapes as EtapeAffichee[]}
          joueurs={pub.joueurs as JoueurAffiche[]}
          etape={null}
          moi={playerId}
        />
      </section>
    );
  }

  const etape = pub.etape as string | null;
  if (!etape) return null;
  const numero = (pub.index as number) + 1;
  const libelle = (pub.etapes as { id: string; libelle: string }[]).find((e) => e.id === etape)?.libelle ?? etape;

  if (moi?.aRepondu) {
    return (
      <section className="player-game fade-in">
        <h2 className="question-small">{libelle} : envoyé ✔</h2>
        <p className="notice">En attente des autres téléphones.</p>
      </section>
    );
  }

  const Essai = ESSAI_PAR_ID[etape];
  const envoyer = (reussi: boolean) => {
    void send('rapport', { reussi });
  };
  return (
    <section className="player-game fade-in" aria-label={`Essai ${libelle}`}>
      <h2 className="question-small">
        Essai {numero} sur {(pub.etapes as unknown[]).length} : {libelle}
      </h2>
      {Essai && <Essai key={etape} onDone={envoyer} />}
    </section>
  );
}
