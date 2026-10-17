import type { PokerCard } from '../rules.js';
import { CHIP_COLOURS, RANK_LABEL, SUIT_SYMBOL, cardSpeech, chipsFor } from './common.js';

/** Une carte de poker, face visible ou dos. Rendue en HTML pour rester lisible sur tous les écrans. */
export function PokerCardFace({
  card,
  back,
  small,
  empty,
}: {
  card?: PokerCard;
  back?: boolean;
  small?: boolean;
  empty?: boolean;
}) {
  const size = small ? ' pk-small' : '';
  if (empty) return <span className={`pk-card pk-slot${size}`} aria-hidden="true" />;
  if (back || !card) return <span className={`pk-card pk-back${size}`} role="img" aria-label="Carte cachée" />;
  const red = card.suit === 'h' || card.suit === 'd';
  return (
    <span className={`pk-card${red ? ' pk-red' : ''}${size}`} role="img" aria-label={cardSpeech(card)}>
      <span className="pk-rank">{RANK_LABEL[card.rank] ?? '?'}</span>
      <span className="pk-suit">{SUIT_SYMBOL[card.suit]}</span>
    </span>
  );
}

/** Pile de jetons : un aperçu empilé, le montant exact est écrit à côté. */
export function ChipStack({ amount }: { amount: number }) {
  const tokens = chipsFor(amount);
  if (tokens.length === 0) return null;
  return (
    <span className="chip-stack" aria-hidden="true">
      {tokens.map((value, i) => (
        <span
          key={i}
          className="chip"
          style={{ background: CHIP_COLOURS[value], bottom: `${i * 4}px` }}
          data-value={value}
        />
      ))}
    </span>
  );
}
