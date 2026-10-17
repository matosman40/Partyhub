import { useRef, type ReactNode } from 'react';

export interface FanItem {
  uid: string;
  /** Nom lu par les lecteurs d’écran. */
  label: string;
  face: ReactNode;
  /** Carte jouable maintenant : elle se redresse et luit. */
  playable?: boolean;
  /** Carte sélectionnée (sélection multiple). */
  selected?: boolean;
}

interface HandFanProps {
  items: FanItem[];
  /** « play » : les cartes non jouables sont assombries. « select » : sélection libre. */
  mode: 'play' | 'select';
  /** Pas votre tour : toute la main est assombrie. */
  waiting: boolean;
  disabled: boolean;
  label: string;
  onTap: (uid: string) => void;
  /** Carte envoyée au serveur, en attente de confirmation : elle se soulève tout de suite. */
  pendingUid?: string | null;
}

/**
 * Main en éventail : les cartes s’étalent en arc, se chevauchent davantage
 * quand la main grandit, et se redressent quand elles sont jouables.
 * Le calcul d’espacement se fait en CSS (voir styles.css, « Éventail »).
 */
export function HandFan({ items, mode, waiting, disabled, label, onTap, pendingUid = null }: HandFanProps) {
  const n = items.length;
  const classes = ['hand-fan', mode === 'play' ? 'is-play' : '', waiting ? 'is-waiting' : ''].filter(Boolean).join(' ');

  // Seules les cartes qui arrivent depuis le dernier affichage s’animent (distribution ou pioche),
  // en file. Les cartes déjà en main ne bougent pas : une pioche n’attend plus la fin de la main.
  // Le délai de chaque carte est fixé à son arrivée puis gardé : un rendu ultérieur ne le remet pas à zéro,
  // sinon une animation en cours sauterait ou toute la file partirait d’un coup.
  const delays = useRef(new Map<string, number>());
  const known = delays.current;
  const next = new Map<string, number>();
  let arrival = 0;
  for (const item of items) {
    const delay = known.get(item.uid);
    if (delay !== undefined) {
      next.set(item.uid, delay);
    } else {
      next.set(item.uid, arrival * 70);
      arrival += 1;
    }
  }
  delays.current = next;

  return (
    <div className={classes} role="group" aria-label={label} style={{ ['--nm1' as string]: Math.max(1, n - 1) }}>
      {items.map((item, i) => {
        const cls = [
          'hand-card',
          item.playable ? 'is-playable' : '',
          item.selected ? 'is-selected' : '',
          item.uid === pendingUid ? 'is-pending' : '',
        ]
          .filter(Boolean)
          .join(' ');
        const delay = next.get(item.uid) ?? 0;
        return (
          <button
            key={item.uid}
            type="button"
            className={cls}
            data-uid={item.uid}
            data-zone="hand"
            style={{ ['--i' as string]: i, ['--o' as string]: i - (n - 1) / 2 }}
            aria-label={item.label}
            aria-pressed={mode === 'select' ? !!item.selected : undefined}
            disabled={disabled}
            onClick={() => onTap(item.uid)}
          >
            <span className="hand-card-face" style={{ ['--i' as string]: i, ['--d' as string]: `${delay}ms` }}>
              {item.face}
            </span>
          </button>
        );
      })}
    </div>
  );
}
