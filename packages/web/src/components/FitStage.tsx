import { useEffect, useRef, type ReactNode } from 'react';

interface FitStageProps {
  children: ReactNode;
  /** Échelle minimale : en dessous, on préfère laisser le contenu défiler plutôt que devenir illisible. */
  minScale?: number;
}

/**
 * Ajuste un écran de jeu à l'espace disponible : si le contenu est plus grand
 * que la zone, il est réduit proportionnellement (jamais agrandi). Ainsi, la
 * scène tient toujours dans l'écran TV, quel que soit le jeu et la résolution.
 */
export function FitStage({ children, minScale = 0.45 }: FitStageProps) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;

    const fit = () => {
      // Mesure en taille naturelle, puis applique le facteur de réduction.
      i.style.zoom = '1';
      const naturalH = i.scrollHeight;
      const naturalW = i.scrollWidth;
      const scale = Math.min(1, o.clientHeight / Math.max(1, naturalH), o.clientWidth / Math.max(1, naturalW));
      i.style.zoom = String(Math.max(minScale, Math.floor(scale * 1000) / 1000));
    };

    // Le recalcul est repoussé à l'image suivante : changer le zoom modifie la taille observée, et le faire dans le
    // même cycle que l'observateur provoquerait l'avertissement « ResizeObserver loop » du navigateur.
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    };

    fit();
    const ro = new ResizeObserver(schedule);
    ro.observe(o);
    ro.observe(i);
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [minScale]);

  return (
    <div className="fit-stage" ref={outer}>
      <div className="fit-inner" ref={inner}>
        {children}
      </div>
    </div>
  );
}
