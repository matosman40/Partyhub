import { useEffect, useRef, useState } from 'react';
import type { PlayerViewProps } from '../../client/types.js';
import { useRemaining } from '../../client/hooks.js';
import { Countdown, WaitingScreen } from '../../client/ui.js';
import { vibrate } from '../../client/device.js';
import { ROLE_INFO, type Role } from '../roles.js';

interface LoupsPlayerState {
  role: Role | null;
  roleInfo: { label: string; icon: string; team: string; text: string } | null;
  alive: boolean;
  seen: boolean;
  canSeen: boolean;
  canAct: boolean;
  acted: boolean;
  canVote: boolean;
  voted: string | null;
  targets: { id: string; name: string }[];
  checks: { round: number; name: string; wolf: boolean }[];
  allies: string[];
  points: number;
  rank: number | null;
  winner: 'village' | 'loups' | null;
  won: boolean;
}

interface LoupsPub {
  phase: 'ready' | 'deal' | 'night' | 'reveal' | 'debate' | 'vote' | 'final';
  round: number;
  players: { id: string; name: string; alive: boolean }[];
  reveal: { kind: 'night' | 'vote'; victimName: string | null; victimRole: Role | null; saved: boolean } | null;
  endsAt: number;
  durationMs: number;
}

const ACTION_LABEL: Record<Role, string> = {
  villageois: '',
  loup: 'Dévorer',
  voyante: 'Inspecter',
  gardienne: 'Protéger',
};

/** Carte de rôle, masquée tant que le joueur ne la révèle pas. */
function RoleCard({ me }: { me: LoupsPlayerState }) {
  const [shown, setShown] = useState(false);
  if (!me.role) return null;
  const info = ROLE_INFO[me.role];
  if (!shown) {
    return (
      <button type="button" className="lv-role-card is-hidden" onClick={() => setShown(true)}>
        Afficher mon rôle
      </button>
    );
  }
  return (
    <div className={`lv-role-card team-${info.team}`}>
      <span className="lv-icon" aria-hidden="true">{info.icon}</span>
      <p className="lv-role-title">{info.label}</p>
      <p className="muted small">{info.text}</p>
      {me.allies.length > 0 && <p className="small">Vos alliés loups : {me.allies.join(', ')}</p>}
      <button type="button" className="link-btn" onClick={() => setShown(false)}>
        Masquer
      </button>
    </div>
  );
}

/** Téléphone des Loups : rôle secret, actions de nuit, débat et vote. */
export function LoupsPlayerScreen({ publicState, playerState, send, now }: PlayerViewProps) {
  const pub = publicState as LoupsPub | null;
  const me = playerState as LoupsPlayerState | null;
  const remaining = useRemaining(pub?.endsAt || undefined, now);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Vibration à la distribution des rôles : rappelle de regarder son téléphone.
  const dealt = useRef(false);
  useEffect(() => {
    if (pub?.phase === 'deal' && !dealt.current) {
      dealt.current = true;
      vibrate([80, 40, 80]);
    }
    if (pub?.phase !== 'deal') dealt.current = false;
  }, [pub?.phase]);

  if (!pub || !me) return null;

  async function run(type: string, payload?: unknown) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await send(type, payload);
    setBusy(false);
    if (!res.ok) setError(res.error ?? 'Action refusée');
  }

  if (pub.phase === 'ready') {
    return <WaitingScreen title="Préparez-vous !" text="Les rôles seront distribués sur l’écran principal." />;
  }

  if (pub.phase === 'final') {
    return (
      <section className="player-game fade-in">
        <p className={`verdict ${me.won ? 'ok' : 'ko'}`}>{me.won ? 'Victoire !' : 'Défaite'}</p>
        {me.roleInfo && <p>Vous étiez : {me.roleInfo.label}</p>}
        <p className="big-number">{me.points} pts</p>
        {me.rank && <p className="muted">{me.rank}ᵉ du classement</p>}
      </section>
    );
  }

  if (pub.phase === 'deal') {
    if (!me.seen) {
      return (
        <section className="player-game fade-in">
          <p className="big">Votre rôle est secret</p>
          <p className="muted">Personne d’autre ne doit voir votre écran.</p>
          <RoleCard me={me} />
          <button type="button" className="btn primary big" disabled={busy} onClick={() => void run('seen')}>
            J’ai compris mon rôle
          </button>
          {error && <p className="error" role="alert">{error}</p>}
        </section>
      );
    }
    return <WaitingScreen title="Rôle confirmé ✔" text="En attente des autres joueurs…" />;
  }

  const header = (
    <div className="round-info">
      {pub.phase === 'night' && `Nuit ${pub.round}`}
      {pub.phase === 'reveal' && 'Révélation'}
      {(pub.phase === 'debate' || pub.phase === 'vote') && `Jour ${pub.round}`}
      {pub.durationMs > 0 && pub.phase !== 'reveal' && (
        <>
          {' · '}
          <Countdown remaining={remaining} />
        </>
      )}
    </div>
  );

  if (pub.phase === 'night') {
    if (!me.alive) {
      return (
        <section className="player-game fade-in">
          {header}
          <p className="big">Vous êtes éliminé(e)</p>
          <p className="muted">Restez silencieux(se) jusqu’à la fin de la partie.</p>
        </section>
      );
    }
    if (!me.canAct && !me.acted) {
      return (
        <section className="player-game fade-in">
          {header}
          <p className="big">Dormez…</p>
          <RoleCard me={me} />
        </section>
      );
    }
    const label = me.role ? ACTION_LABEL[me.role] : '';
    return (
      <section className="player-game fade-in">
        {header}
        <RoleCard me={me} />
        {me.acted ? (
          <p className="notice">Choix enregistré ✔ · En attente des autres…</p>
        ) : (
          <>
            <p className="label">{label} un joueur</p>
            <div className="candidate-list">
              {me.targets.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="candidate"
                  disabled={busy || remaining <= 0}
                  onClick={() => void run('night', { target: t.id })}
                >
                  <span>{t.name}</span>
                </button>
              ))}
            </div>
          </>
        )}
        {me.role === 'voyante' && me.checks.length > 0 && (
          <ul className="clue-list">
            {me.checks.map((c, i) => (
              <li key={i}>
                <span className="clue-author">Nuit {c.round} · {c.name}</span>
                <span className="clue-text">{c.wolf ? 'Loup 🐺' : 'Pas un loup'}</span>
              </li>
            ))}
          </ul>
        )}
        {error && <p className="error" role="alert">{error}</p>}
      </section>
    );
  }

  if (pub.phase === 'reveal') {
    const r = pub.reveal;
    let text = 'Aucune victime cette nuit.';
    if (r?.kind === 'night' && r.saved) text = 'Les loups ont attaqué, mais la cible était protégée.';
    else if (r?.victimName) text = `${r.victimName} ${r.kind === 'vote' ? 'est éliminé(e)' : 'a été dévoré(e)'}.`;
    else if (r?.kind === 'vote') text = 'Égalité : personne n’est éliminé(e).';
    return (
      <section className="player-game fade-in">
        {header}
        <p className="big">{text}</p>
        <RoleCard me={me} />
      </section>
    );
  }

  if (pub.phase === 'debate') {
    return (
      <section className="player-game fade-in">
        {header}
        <p className="big">Débattez à voix haute</p>
        <p className="muted">Qui vous semble suspect ?</p>
        <RoleCard me={me} />
      </section>
    );
  }

  // vote
  if (!me.alive) {
    return (
      <section className="player-game fade-in">
        {header}
        <p className="big">Vous observez le vote</p>
      </section>
    );
  }
  return (
    <section className="player-game fade-in">
      {header}
      <p className="label">Éliminer quelqu’un ?</p>
      <div className="candidate-list">
        {me.targets.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`candidate${me.voted === t.id ? ' selected' : ''}`}
            disabled={busy || !me.canVote || remaining <= 0}
            onClick={() => void run('vote', { target: t.id })}
          >
            <span>{t.name}</span>
          </button>
        ))}
      </div>
      {me.voted && <p className="notice">Vote enregistré ✔</p>}
      <RoleCard me={me} />
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
