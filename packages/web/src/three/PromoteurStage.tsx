import type { ReactNode } from 'react';
import {
  TimerBar,
  usePrefersReducedMotion,
  useRemaining,
  useSteppedPositions,
  type PromoteurPub,
} from '@partyhub/games/client';
import PromoteurBoard3D from './PromoteurBoard3D';

/**
 * Scène du Promoteur sur l'écran TV, en 3D. Chargée à la demande (voir TvPage) pour que
 * Three.js ne pèse pas sur le premier affichage. Les phases sans plateau (attente, classement)
 * restent sur la vue 2D fournie par `flat`.
 */

interface PromoteurStageProps {
  pub: PromoteurPub;
  /** Horloge serveur, pour le compte à rebours. */
  now: number;
  flat: ReactNode;
}

export default function PromoteurStage({ pub, now, flat }: PromoteurStageProps) {
  const reduced = usePrefersReducedMotion();
  const targets: Record<string, number> = {};
  for (const p of pub.players) targets[p.id] = p.pos;
  const shown = useSteppedPositions(targets, 170, reduced);
  const remaining = useRemaining(pub.endsAt || undefined, now);

  if (pub.phase === 'ready' || pub.phase === 'final') return <>{flat}</>;

  return (
    <section className="pm3d-stage fade-in" aria-label="Plateau du Promoteur">
      <PromoteurBoard3D pub={pub} shown={shown} />

      <div className="pm3d-hud">
        {pub.phase === 'decide' && pub.pending && (
          <div className="pm3d-offer">
            <span className="label">À vendre</span>
            <strong>{pub.pending.name}</strong>
            <span className="big-number">{pub.pending.price} €</span>
          </div>
        )}
        {pub.durationMs > 0 && <TimerBar remaining={remaining} total={pub.durationMs} />}
      </div>

      <p className="sr-only" aria-live="polite">
        {pub.lastEvent}
      </p>
    </section>
  );
}
