import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { play } from '../../client/audio.js';
import { vibrate } from '../../client/device.js';

/**
 * Sons, vibrations et trajets des jeux de cartes.
 * Tout se déclenche à partir des changements d’état déjà reçus : aucun message réseau
 * supplémentaire, et rien ne joue au premier affichage.
 */

function reduceMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Appelle `onChange` quand `value` change d’un affichage à l’autre. */
export function useChange<T>(value: T, onChange: (before: T, after: T) => void): void {
  const last = useRef(value);
  const latest = useRef(onChange);
  useEffect(() => {
    latest.current = onChange;
  });
  useEffect(() => {
    if (Object.is(last.current, value)) return;
    const before = last.current;
    last.current = value;
    latest.current(before, value);
  }, [value]);
}

/** Votre tour : un accord et une vibration courte (ignorée sur iPhone). */
export function cueTurn(): void {
  play('turn');
  vibrate([70, 40, 70]);
}

interface Snapshot {
  /** Position de chaque carte visible, avec sa zone (« hand » ou « table »). */
  cards: Map<string, { rect: DOMRect; zone: string }>;
  /** Siège dont c’était le tour à l’affichage précédent : celui qui vient de jouer. */
  turn: DOMRect | null;
}

/** Fait voler une carte de `from` jusqu’à sa place réelle. */
function fly(el: HTMLElement, from: DOMRect): void {
  const target = el.querySelector<HTMLElement>('[data-fly-target]') ?? el;
  if (typeof target.animate !== 'function') return;
  // On coupe d’abord l’animation d’entrée par défaut, sinon la place mesurée serait celle du début du retournement.
  target.style.animation = 'none';
  const to = target.getBoundingClientRect();
  if (to.width === 0 || from.width === 0) return;
  const dx = from.left + from.width / 2 - (to.left + to.width / 2);
  const dy = from.top + from.height / 2 - (to.top + to.height / 2);
  const scale = Math.min(1.6, Math.max(0.4, from.width / to.width));
  target.animate(
    [
      { transform: `translate(${dx}px, ${dy}px) scale(${scale}) rotate(-8deg)`, opacity: 0.85 },
      { transform: 'translate(0px, 0px) scale(1) rotate(0deg)', opacity: 1 },
    ],
    { duration: 520, easing: 'cubic-bezier(0.2, 0.85, 0.25, 1)' },
  );
}

/**
 * Trajets entre zones. Une carte qui passe de la main à la table vole depuis sa place dans la main ;
 * une carte qui apparaît sur la table sans venir de la main part du siège de celui qui vient de jouer.
 * Les éléments se signalent par data-uid et data-zone, les sièges par data-seat et la classe is-turn.
 */
export function useCardFlights(rootRef: RefObject<HTMLElement | null>): void {
  const prev = useRef<Snapshot | null>(null);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const els = Array.from(root.querySelectorAll<HTMLElement>('[data-uid]'));
    const cards = new Map<string, { rect: DOMRect; zone: string }>();
    for (const el of els) {
      cards.set(el.dataset.uid ?? '', { rect: el.getBoundingClientRect(), zone: el.dataset.zone ?? '' });
    }
    const turnEl = root.querySelector<HTMLElement>('[data-seat].is-turn');
    const turn = turnEl ? turnEl.getBoundingClientRect() : null;

    const before = prev.current;
    prev.current = { cards, turn };
    if (!before || reduceMotion()) return;

    for (const el of els) {
      if (el.dataset.zone !== 'table') continue;
      const uid = el.dataset.uid ?? '';
      const earlier = before.cards.get(uid);
      if (earlier) {
        if (earlier.zone !== 'table') fly(el, earlier.rect);
      } else if (before.turn) {
        fly(el, before.turn);
      }
    }
  });
}
