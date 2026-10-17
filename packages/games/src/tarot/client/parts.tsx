import type { ReactNode } from 'react';
import { CardFace } from '../../cards/client/CardFace.js';
import { HandFan } from '../../cards/client/HandFan.js';
import {
  CONTRACT_COEF,
  CONTRACT_LABEL,
  TAROT_DEFINITION,
  cardName,
  chienSide,
  formatHalf,
  tarotEntry,
  type Contract,
} from '../rules.js';
import { handRows, signed, signedHalf, type TarotPub } from './common.js';

/** Une carte du tarot, dessinée par le rendu partagé (thème classique). */
export function TarotCard({ id }: { id: string }) {
  return <CardFace def={TAROT_DEFINITION} entry={tarotEntry(id)} label={cardName(id)} />;
}

/** Petite carte, pour le chien, l’écart et le dernier pli. Sans data-uid : elle ne vole pas. */
export function MiniCard({ id, className = '' }: { id: string; className?: string }) {
  return (
    <span className={`tarot-mini ${className}`.trim()}>
      <TarotCard id={id} />
    </span>
  );
}

export function MiniRow({ ids, label, className = '' }: { ids: readonly string[]; label: string; className?: string }) {
  return (
    <span className={`tarot-minirow ${className}`.trim()} role="group" aria-label={label}>
      {ids.map((id) => (
        <MiniCard key={id} id={id} />
      ))}
    </span>
  );
}

/** « Garde ×2 » : le contrat et son multiplicateur. */
export function contractText(contract: Contract): string {
  return `${CONTRACT_LABEL[contract]} ×${CONTRACT_COEF[contract]}`;
}

interface HandRowsProps {
  ids: readonly string[];
  mode: 'play' | 'select';
  waiting: boolean;
  disabled: boolean;
  onTap: (uid: string) => void;
  playable?: ReadonlySet<string>;
  selected?: readonly string[];
  /** Cartes qu’on ne peut pas choisir (écart) : atténuées. */
  locked?: ReadonlySet<string>;
  /** Cartes qui viennent du chien : repérées d’un trait doré. */
  fromChien?: ReadonlySet<string>;
  pendingUid?: string | null;
}

/** La main sur plusieurs rangées d’éventails : atouts d’abord, puis les couleurs. */
export function HandRows({
  ids,
  mode,
  waiting,
  disabled,
  onTap,
  playable,
  selected,
  locked,
  fromChien,
  pendingUid,
}: HandRowsProps) {
  const rows = handRows(ids);
  return (
    <div className="tarot-hand" role="group" aria-label="Votre main" tabIndex={0}>
      {rows.map((row, index) => (
        <HandFan
          key={index}
          label={`Votre main, rangée ${index + 1} sur ${rows.length}`}
          mode={mode}
          waiting={waiting}
          disabled={disabled}
          onTap={onTap}
          pendingUid={pendingUid}
          items={row.map((id) => {
            const classes = ['tarot-face', locked?.has(id) ? 'is-locked' : '', fromChien?.has(id) ? 'is-chien' : '']
              .filter(Boolean)
              .join(' ');
            return {
              uid: id,
              label: cardName(id),
              playable: playable?.has(id) ?? false,
              selected: selected?.includes(id) ?? false,
              face: (
                <span className={classes}>
                  <TarotCard id={id} />
                </span>
              ),
            };
          })}
        />
      ))}
    </div>
  );
}

interface SummaryProps {
  pub: TarotPub;
  /** Version courte (téléphone) : sans le détail du calcul. */
  compact?: boolean;
  playerId?: string;
}

/** Bilan d’une donne : calcul de la marque, puis points de chaque joueur et total. */
export function SummaryPanel({ pub, compact = false, playerId }: SummaryProps) {
  const sm = pub.summary;
  if (!sm) return null;
  const name = (id: string) => pub.names[id] ?? '?';
  const side = chienSide(sm.contract);
  const lines: [string, ReactNode, string?][] = [
    ['Points du preneur', `${formatHalf(sm.attackHalf)} sur 91`],
    ['Oudlers du preneur', `${sm.oudlers} : ${sm.needed} points à faire`],
    ['Écart', signedHalf(sm.diffHalf), sm.made ? 'is-ok' : 'is-ko'],
    ['Marque', `25 + ${sm.base - 25} = ${sm.base}, × ${sm.coef}`],
  ];
  if (sm.excuseTransfer !== 0) {
    lines.splice(1, 0, ['Excuse échangée', `${signedHalf(sm.excuseTransfer)} pour le preneur`]);
  }
  if (sm.pab !== 0)
    lines.push(['Petit au bout', `${signed(sm.pab)} × ${sm.coef} pour ${sm.pab > 0 ? 'le preneur' : 'la défense'}`]);
  if (sm.chelem !== 0)
    lines.push(['Chelem', `${signed(sm.chelem)} pour ${sm.chelem > 0 ? 'le preneur' : 'la défense'}`]);
  lines.push(['Résultat par défenseur', signed(-sm.total), sm.total >= 0 ? 'is-ko' : 'is-ok']);

  return (
    <div className="cards-reveal tarot-summary">
      <h3>
        Donne {sm.round} : {name(sm.taker)} {sm.made ? 'réussit' : 'chute'} sa {CONTRACT_LABEL[sm.contract]}
      </h3>
      {!compact && (
        <div className="tarot-summary-calc">
          <dl className="tarot-lines">
            {lines.map(([label, value, tone]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd className={tone}>{value}</dd>
              </div>
            ))}
          </dl>
          <div className="tarot-summary-chien">
            <span className="muted small">Le chien, compté pour {side === 'attack' ? 'le preneur' : 'la défense'}</span>
            <MiniRow ids={sm.chien} label="Le chien" />
            <span className="muted small">
              Plis : preneur {sm.tricks.attack}, défense {sm.tricks.defence}
            </span>
          </div>
        </div>
      )}
      <table className="tarot-table">
        <thead>
          <tr>
            <th scope="col">Joueur</th>
            <th scope="col">Camp</th>
            <th scope="col">Donne</th>
            <th scope="col">Total</th>
          </tr>
        </thead>
        <tbody>
          {pub.order.map((id) => {
            const delta = sm.deltas[id] ?? 0;
            return (
              <tr key={id} className={id === playerId ? 'is-you' : undefined}>
                <th scope="row">{name(id)}</th>
                <td>{id === sm.taker ? 'Preneur' : 'Défense'}</td>
                <td className={delta >= 0 ? 'is-ok' : 'is-ko'}>{signed(delta)}</td>
                <td>{pub.scores[id] ?? 0}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
