import { useContext } from 'react';
import { defaultCharacterFor, type CharacterSpec, type PixelPose } from '@partyhub/shared';
import type { HostViewProps } from '../../client/types.js';
import { AvatarsContext } from '../../client/avatar-context.js';
import { useRemaining } from '../../client/hooks.js';
import { PixelSprite } from '../../client/PixelSprite.js';
import { WaitingScreen } from '../../client/ui.js';
import { formatSeconds } from './hud.js';
import { RaceView } from './RaceView.js';
import type { LevelResultRow, SauteursHostState, SauteursPub } from './types.js';

/** Personnage d'un joueur : celui de la salle, sinon un personnage tiré de son pseudo (comme `Avatar`). */
function useSpecOf(): (name: string) => CharacterSpec {
  const avatars = useContext(AvatarsContext);
  return (name) => avatars[name]?.character ?? defaultCharacterFor(name);
}

export function SauteursHost({ publicState, hostState, now, onAction }: HostViewProps) {
  const pub = publicState as SauteursPub | null;
  if (!pub) return null;
  if (pub.phase === 'ready') return <Lobby pub={pub} />;
  if (pub.phase === 'final') return <Podium pub={pub} />;
  if (pub.phase === 'between') return <Between pub={pub} now={now} />;
  if (pub.phase === 'playing' && pub.level) {
    return (
      <RaceView
        key={`${pub.step}-${pub.levelIndex}`}
        pub={pub}
        hostState={hostState as SauteursHostState | null}
        now={now}
        onAction={onAction}
      />
    );
  }
  return <WaitingScreen title="Niveau suivant…" />;
}

function Lobby({ pub }: { pub: SauteursPub }) {
  const specOf = useSpecOf();
  return (
    <section className="game-host fade-in sau-screen" aria-label="Course des sauteurs">
      <h2 className="sau-title">Course des sauteurs</h2>
      <p className="sau-lead">
        {pub.levelCount > 1 ? `${pub.levelCount} niveaux` : 'Un niveau'} : courez, sautez, atteignez le drapeau !
      </p>
      <ul className="sau-roster">
        {pub.players
          .filter((p) => !p.left)
          .map((p, i) => (
            <li key={p.id} className="sau-roster-item">
              <PixelSprite
                spec={specOf(p.name)}
                kind="walk"
                dir="side"
                frame={(i % 4) as 0 | 1 | 2 | 3}
                scale={4}
                label={`${p.name}, prêt à courir`}
              />
              <span className="sau-name">{p.name}</span>
            </li>
          ))}
      </ul>
      <p className="sau-hint">
        Téléphone en paysage : ◀ ▶ pour courir, gros bouton pour sauter. Clavier : flèches et espace.
      </p>
    </section>
  );
}

export function poseFor(row: LevelResultRow): PixelPose {
  if (row.rank === 1) return 'victoire';
  if (row.finishTick !== null) return 'joie';
  return 'defaite';
}

function Between({ pub, now }: { pub: SauteursPub; now: number }) {
  const specOf = useSpecOf();
  const remaining = useRemaining(pub.betweenEndsAt, now);
  const rows = pub.levelResults ?? [];
  const last = pub.step >= pub.levelCount;
  return (
    <section className="game-host fade-in sau-screen" aria-label="Bilan du niveau">
      <h2 className="sau-title">
        Niveau {pub.step} sur {pub.levelCount} terminé
      </h2>
      <ol className="sau-results">
        {rows.slice(0, 8).map((r) => (
          <li key={r.playerId} className={`sau-result${r.rank === 1 ? ' is-first' : ''}`}>
            <PixelSprite
              spec={specOf(r.name)}
              kind="pose"
              index={poseFor(r)}
              scale={3}
              label={`${r.name} : ${r.finishTick !== null ? `arrivé ${r.rank}e` : 'pas arrivé'}`}
            />
            <span className="sau-rank">{r.rank !== null ? `${r.rank}.` : '–'}</span>
            <span className="sau-name">{r.name}</span>
            <span className="sau-time">{r.finishTick !== null ? formatSeconds(r.finishTick) : 'pas arrivé'}</span>
            <span className="sau-coins" title="Pièces">
              {r.coins} pièces
            </span>
            <span className="sau-deaths">{r.deaths} chutes</span>
            <span className="sau-points">+{r.points}</span>
            <span className="sau-total">{pub.points[r.playerId] ?? 0} pts</span>
          </li>
        ))}
      </ol>
      <p className="sau-hint" aria-live="polite">
        {last ? 'Résultats finaux dans' : 'Niveau suivant dans'} {Math.ceil(remaining / 1000)} s
      </p>
    </section>
  );
}

export function podiumPose(rank: number): PixelPose {
  return rank === 1 ? 'victoire' : rank <= 3 ? 'joie' : 'defaite';
}

function Podium({ pub }: { pub: SauteursPub }) {
  const specOf = useSpecOf();
  const top = pub.ranking.slice(0, 3);
  const rest = pub.ranking.slice(3, 8);
  // Ordre de l'estrade : deuxième, premier, troisième.
  const order = [top[1], top[0], top[2]].filter((e): e is NonNullable<typeof e> => Boolean(e));
  return (
    <section className="game-host fade-in sau-screen" aria-label="Podium final">
      <h2 className="sau-title">Podium</h2>
      <div className="sau-podium">
        {order.map((e) => (
          <div key={e.playerId} className={`sau-step is-${e.rank}`}>
            <PixelSprite
              spec={specOf(e.name)}
              kind="pose"
              index={podiumPose(e.rank)}
              scale={e.rank === 1 ? 6 : 5}
              label={`${e.name}, ${e.rank}${e.rank === 1 ? 'er' : 'e'}`}
            />
            <span className="sau-name">{e.name}</span>
            <span className="sau-points">{e.points} pts</span>
            <span className="sau-block" aria-hidden="true">
              {e.rank}
            </span>
          </div>
        ))}
      </div>
      {rest.length > 0 && (
        <ol className="sau-others" start={4}>
          {rest.map((e) => (
            <li key={e.playerId}>
              <PixelSprite spec={specOf(e.name)} kind="pose" index="defaite" scale={2} label={e.name} />
              <span className="sau-name">
                {e.rank}. {e.name}
              </span>
              <span className="sau-points">{e.points} pts</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
