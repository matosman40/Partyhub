import { useEffect, useRef, useState } from 'react';
import type { PlayerViewProps } from '../../client/types.js';
import { useRemaining } from '../../client/hooks.js';
import { Countdown, FinalScreen, WaitingScreen } from '../../client/ui.js';
import { vibrate } from '../../client/device.js';
import { GROUP_COLOR, type Group } from '../board.js';

interface PlayerPlayerState {
  cash: number;
  worth: number;
  rank: number | null;
  jailed: boolean;
  bankrupt: boolean;
  isMyTurn: boolean;
  canRoll: boolean;
  canBail: boolean;
  canBuy: boolean;
  pending: { index: number; name: string; price: number } | null;
  properties: { index: number; name: string; group: Group | null; houses: number; canBuild: boolean }[];
}

interface PromoteurPub {
  phase: 'ready' | 'roll' | 'decide' | 'final';
  currentName: string | null;
  dice: [number, number] | null;
  lastEvent: string;
  endsAt: number;
  durationMs: number;
}

const euros = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} €`;

/** Téléphone du Promoteur : lancer les dés, acheter, construire, payer la caution. */
export function PromoteurPlayer({ publicState, playerState, now, send }: PlayerViewProps) {
  const pub = publicState as PromoteurPub | null;
  const me = playerState as PlayerPlayerState | null;
  const remaining = useRemaining(pub?.endsAt || undefined, now);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Vibration à l’arrivée de son tour (si l’appareil sait vibrer).
  const wasMyTurn = useRef(false);
  useEffect(() => {
    const mine = !!me?.isMyTurn;
    if (mine && !wasMyTurn.current) vibrate([120, 60, 120]);
    wasMyTurn.current = mine;
  }, [me?.isMyTurn]);

  useEffect(() => {
    setError(null);
  }, [pub?.lastEvent]);

  if (!pub) return null;

  if (pub.phase === 'ready') {
    return <WaitingScreen title="Préparez-vous !" text="La partie va commencer sur l’écran principal." />;
  }
  if (pub.phase === 'final') {
    return <FinalScreen points={me?.worth ?? 0} rank={me?.rank ?? null} />;
  }

  async function run(type: string, payload?: unknown) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await send(type, payload);
    setBusy(false);
    if (!res.ok) setError(res.error ?? 'Action refusée');
  }

  const banner = me?.isMyTurn
    ? pub.phase === 'roll'
      ? me.jailed
        ? 'Vous êtes en prison : faites un double, payez ou attendez'
        : 'À vous de jouer'
      : 'Achetez-vous cette case ?'
    : `Tour de ${pub.currentName ?? '…'}`;

  return (
    <section className="player-game fade-in pm-player">
      <div className="pm-wallet">
        <p className="label">Liquidités</p>
        <p className="big-number">{euros(me?.cash ?? 0)}</p>
        <p className="muted small">
          Patrimoine {euros(me?.worth ?? 0)}
          {me?.rank ? ` · ${me.rank}ᵉ` : ''}
          {me?.jailed ? ' · en prison' : ''}
        </p>
      </div>

      <p className={`cards-banner${me?.isMyTurn ? ' is-mine' : ''}`}>{banner}</p>

      {pub.dice && (
        <p className="muted small">
          Dernier jet : {pub.dice[0]} + {pub.dice[1]}
        </p>
      )}

      {me?.isMyTurn && pub.durationMs > 0 && (
        <p className="round-info">
          <Countdown remaining={remaining} />
        </p>
      )}

      {me?.isMyTurn && pub.phase === 'decide' && me.pending && (
        <div className="pm-offer-card">
          <p className="pm-offer-name">{me.pending.name}</p>
          <p className="muted small">Prix : {euros(me.pending.price)}</p>
          <div className="control-dock">
            <button type="button" className="btn ghost big" disabled={busy} onClick={() => void run('pass')}>
              Laisser
            </button>
            <button
              type="button"
              className="btn primary big"
              disabled={busy || !me.canBuy}
              onClick={() => void run('buy')}
            >
              Acheter
            </button>
          </div>
        </div>
      )}

      {me?.canRoll && (
        <button type="button" className="btn primary big" disabled={busy} onClick={() => void run('roll')}>
          Lancer les dés
        </button>
      )}
      {me?.canBail && (
        <button type="button" className="btn big" disabled={busy} onClick={() => void run('bail')}>
          Payer la caution ({euros(50)})
        </button>
      )}

      {me && me.properties.length > 0 && (
        <div className="pm-properties">
          <p className="label">Vos rues</p>
          <ul>
            {me.properties.map((p) => (
              <li key={p.index}>
                <span className="pm-band" style={{ background: p.group ? GROUP_COLOR[p.group] : 'transparent' }} />
                <span className="name">{p.name}</span>
                <span className="muted small">{p.houses > 0 ? '●'.repeat(p.houses) : ''}</span>
                {p.canBuild && (
                  <button
                    type="button"
                    className="link-btn"
                    disabled={busy}
                    onClick={() => void run('build', { square: p.index })}
                  >
                    Construire
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="notice pm-event-line">{pub.lastEvent}</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
