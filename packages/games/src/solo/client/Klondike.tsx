import { useState } from 'react';
import type { SoloBoardProps } from './SoloPlayer.js';

interface CardPub {
  rank?: number;
  suit?: number;
  up: boolean;
}

interface KlondikePublic {
  drawCount: number;
  tableau: CardPub[][];
  stockCount: number;
  waste: CardPub[];
  foundations: CardPub[][];
}

const RANKS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'V', 'D', 'R'];
const SUITS = ['♠', '♥', '♦', '♣'];
const isRed = (suit: number | undefined) => suit === 1 || suit === 2;

/** Sélection : l’emplacement d’origine (« w » ou « tN ») et l’indice de la carte dans la colonne. */
interface Selection {
  from: string;
  index: number;
}

function CardFace({ card, className = '' }: { card: CardPub; className?: string }) {
  if (!card.up || card.rank === undefined || card.suit === undefined) {
    return <span className={`solo-card is-back ${className}`} role="img" aria-label="Carte cachée" />;
  }
  return (
    <span className={`solo-card is-up ${isRed(card.suit) ? 'is-red' : ''} ${className}`}>
      <span className="solo-card-rank">{RANKS[card.rank]}</span>
      <span className="solo-card-suit">{SUITS[card.suit]}</span>
    </span>
  );
}

/**
 * Solitaire sur téléphone : on touche une carte (ou un tas), puis son emplacement.
 * Toucher le talon pioche. Une carte visible emmène avec elle celles qui sont au-dessus.
 */
export function KlondikeView({ board, disabled, send }: SoloBoardProps) {
  const view = board as KlondikePublic;
  const [selection, setSelection] = useState<Selection | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(payload: Record<string, unknown>) {
    setError(null);
    const res = await send('play', payload);
    if (!res.ok) setError(res.error ?? 'Coup refusé');
    setSelection(null);
  }

  function moveTo(to: string) {
    if (!selection) return;
    const column = selection.from.startsWith('t') ? view.tableau[Number(selection.from.slice(1))] : undefined;
    const count = column ? column.length - selection.index : 1;
    void act({ type: 'move', from: selection.from, count, to });
  }

  /** Toucher une colonne (vide ou non) pose la carte sélectionnée au bout de cette colonne. */
  function tapColumn(c: number) {
    if (disabled || !selection) return;
    if (selection.from === `t${c}`) return setSelection(null);
    moveTo(`t${c}`);
  }

  function tapCard(c: number, i: number) {
    if (disabled) return;
    const card = view.tableau[c]?.[i];
    if (!card?.up) return;
    if (selection) {
      if (selection.from === `t${c}` && selection.index === i) return setSelection(null);
      return moveTo(`t${c}`);
    }
    setSelection({ from: `t${c}`, index: i });
  }

  function tapWaste() {
    if (disabled || view.waste.length === 0) return;
    if (selection?.from === 'w') return setSelection(null);
    setSelection({ from: 'w', index: view.waste.length - 1 });
  }

  function tapFoundation(f: number) {
    if (disabled) return;
    if (selection) return moveTo(`f${f}`);
  }

  const selectedFrom = selection?.from;

  return (
    <div className="solo-klondike">
      <div className="solo-klondike-top">
        <button
          type="button"
          className="solo-pile solo-stock"
          aria-label={view.stockCount > 0 ? `Talon : ${view.stockCount} cartes` : 'Talon vide : recycler la défausse'}
          disabled={disabled}
          onClick={() => {
            setSelection(null);
            void act({ type: 'draw' });
          }}
        >
          {view.stockCount > 0 ? <CardFace card={{ up: false }} /> : <span className="solo-recycle">↻</span>}
        </button>
        <button
          type="button"
          className={`solo-pile solo-waste ${selectedFrom === 'w' ? 'is-selected' : ''}`}
          aria-label="Défausse"
          disabled={disabled}
          onClick={tapWaste}
        >
          {view.waste.length > 0 ? (
            <CardFace card={{ ...view.waste[view.waste.length - 1]!, up: true }} />
          ) : (
            <span className="solo-slot" />
          )}
        </button>
        <span className="solo-spacer" />
        {view.foundations.map((pile, f) => {
          const top = pile[pile.length - 1];
          return (
            <button
              key={f}
              type="button"
              className="solo-pile solo-foundation"
              aria-label={`Fondation ${SUITS[f]}, ${pile.length} carte(s)`}
              disabled={disabled}
              onClick={() => tapFoundation(f)}
            >
              {top ? <CardFace card={{ ...top, up: true }} /> : <span className="solo-slot">{SUITS[f]}</span>}
            </button>
          );
        })}
      </div>

      <div className="solo-tableau">
        {view.tableau.map((column, c) => (
          <div
            key={c}
            className={`solo-col ${selectedFrom === `t${c}` ? 'has-selection' : ''}`}
            role="group"
            aria-label={`Colonne ${c + 1}, ${column.length} carte(s)`}
            onClick={() => tapColumn(c)}
          >
            {column.length === 0 && <span className="solo-slot" />}
            {column.map((card, i) => {
              const picked = selectedFrom === `t${c}` && selection !== null && i >= selection.index;
              return (
                <span
                  key={i}
                  className="solo-card-wrap"
                  onClick={(e) => {
                    e.stopPropagation();
                    tapCard(c, i);
                  }}
                >
                  <CardFace card={card} className={picked ? 'is-picked' : ''} />
                </span>
              );
            })}
          </div>
        ))}
      </div>

      <p className="muted small solo-hint">
        {selection
          ? 'Touchez l’emplacement d’arrivée (colonne ou fondation).'
          : 'Touchez une carte, puis son emplacement.'}
      </p>
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
