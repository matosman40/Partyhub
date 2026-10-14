import type { HostViewProps } from '../../client/types.js';
import { useRemaining } from '../../client/hooks.js';
import { Avatar, Ranking, RankRow, TimerBar, WaitingScreen } from '../../client/ui.js';
import { ROLE_INFO, type Role } from '../roles.js';

interface LoupsPub {
  phase: 'ready' | 'deal' | 'night' | 'reveal' | 'debate' | 'vote' | 'final';
  round: number;
  players: { id: string; name: string; alive: boolean; seen: boolean }[];
  aliveCount: number;
  dead: { id: string; name: string; role: Role }[];
  reveal: { kind: 'night' | 'vote'; victimName: string | null; victimRole: Role | null; saved: boolean } | null;
  voteCount: number;
  winner: 'village' | 'loups' | null;
  finalRoles: { id: string; name: string; role: Role }[] | null;
  endsAt: number;
  durationMs: number;
  ranking: RankRow[];
}

interface LoupsHost {
  seenCount: number;
  total: number;
  nightDone: number;
  nightTotal: number;
}

function Roster({ pub }: { pub: LoupsPub }) {
  return (
    <ul className="lv-roster" aria-label="Joueurs">
      {pub.players.map((p) => (
        <li key={p.id} className={p.alive ? undefined : 'is-dead'}>
          <Avatar name={p.name} size="sm" />
          <span className="name">{p.name}</span>
          {!p.alive && <span className="badge">éliminé(e)</span>}
        </li>
      ))}
    </ul>
  );
}

/** Écran principal des Loups : ne montre jamais les rôles en cours de partie. */
export function LoupsHostScreen({ publicState, hostState, now }: HostViewProps) {
  const pub = publicState as LoupsPub | null;
  const host = hostState as LoupsHost | null;
  const remaining = useRemaining(pub?.endsAt || undefined, now);
  if (!pub) return null;

  if (pub.phase === 'ready') {
    return <WaitingScreen title="Les Loups du village : en attente du lancement…" text={`${pub.players.length} joueur(s)`} />;
  }

  if (pub.phase === 'final') {
    const winners = pub.winner === 'village' ? 'Le village gagne !' : 'Les loups gagnent !';
    return (
      <section className="game-host fade-in final">
        <h2 className="big-title">{winners}</h2>
        <ul className="lv-final">
          {(pub.finalRoles ?? []).map((p) => (
            <li key={p.id}>
              <span className="lv-icon" aria-hidden="true">{ROLE_INFO[p.role].icon}</span>
              <span className="name">{p.name}</span>
              <span className="muted">{ROLE_INFO[p.role].label}</span>
            </li>
          ))}
        </ul>
        <Ranking entries={pub.ranking} />
      </section>
    );
  }

  if (pub.phase === 'deal') {
    return (
      <section className="game-host fade-in">
        <h2 className="huge-word small">Chacun découvre son rôle</h2>
        <p className="muted">Regardez votre téléphone. Ne laissez pas les autres voir l’écran.</p>
        <p className="big-number">
          {host?.seenCount ?? 0} / {host?.total ?? pub.players.length}
        </p>
        <p className="muted">ont vu leur rôle</p>
        <TimerBar remaining={remaining} total={pub.durationMs} />
      </section>
    );
  }

  if (pub.phase === 'night') {
    return (
      <section className="game-host fade-in lv-night" key={`n-${pub.round}`}>
        <div className="round-info">Nuit {pub.round}</div>
        <h2 className="huge-word small">Le village dort…</h2>
        <p className="muted">
          Les rôles de nuit agissent sur leur téléphone · {host?.nightDone ?? 0} / {host?.nightTotal ?? 0}
        </p>
        <Roster pub={pub} />
        <TimerBar remaining={remaining} total={pub.durationMs} />
      </section>
    );
  }

  if (pub.phase === 'reveal') {
    const r = pub.reveal;
    let title = 'Aucune victime cette nuit';
    let detail = '';
    if (r?.kind === 'night') {
      if (r.saved) {
        title = 'Personne n’est mort cette nuit';
        detail = 'Les loups ont attaqué, mais la cible était protégée.';
      } else if (r.victimName) {
        title = `${r.victimName} a été dévoré(e)`;
        detail = r.victimRole ? `Il ou elle était : ${ROLE_INFO[r.victimRole].label}` : '';
      }
    } else if (r?.kind === 'vote') {
      if (r.victimName) {
        title = `${r.victimName} est éliminé(e)`;
        detail = r.victimRole ? `Il ou elle était : ${ROLE_INFO[r.victimRole].label}` : '';
      } else {
        title = 'Égalité : personne n’est éliminé(e)';
      }
    }
    return (
      <section className="game-host fade-in" key={`r-${pub.round}-${r?.kind}`}>
        <div className="round-info">{r?.kind === 'vote' ? 'Vote' : 'Nuit'} · révélation</div>
        <h2 className="huge-word small">{title}</h2>
        {detail && <p className="verdict-host ko">{detail}</p>}
        <Roster pub={pub} />
      </section>
    );
  }

  if (pub.phase === 'debate') {
    return (
      <section className="game-host fade-in">
        <div className="round-info">Jour {pub.round} · débat</div>
        <h2 className="huge-word small">Qui sont les loups ?</h2>
        <p className="muted">Débattez à voix haute. Le vote commencera à la fin du temps.</p>
        <Roster pub={pub} />
        <TimerBar remaining={remaining} total={pub.durationMs} />
      </section>
    );
  }

  // vote
  return (
    <section className="game-host fade-in" key={`v-${pub.round}`}>
      <div className="round-info">Jour {pub.round} · vote</div>
      <h2 className="huge-word small">Votez pour éliminer un suspect</h2>
      <Roster pub={pub} />
      <p className="muted">{pub.voteCount} / {pub.aliveCount} vote(s)</p>
      <TimerBar remaining={remaining} total={pub.durationMs} />
    </section>
  );
}
