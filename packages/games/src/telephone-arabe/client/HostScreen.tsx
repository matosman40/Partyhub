import type { HostViewProps } from '../../client/types.js';
import { useRemaining } from '../../client/hooks.js';
import { TimerBar, WaitingScreen } from '../../client/ui.js';
import type { Stroke, TelephoneKind } from '../module.js';
import { Drawing } from './Drawing.js';

interface ChainItem {
  kind: TelephoneKind;
  text: string | null;
  strokes: Stroke[] | null;
  by: string | null;
}

const KIND_TITLE: Record<TelephoneKind, string> = {
  sentence: 'Phrase de départ',
  draw: 'Dessin',
  describe: 'Description',
};

/** Une chaîne complète : chaque étape à la suite, avec son auteur. */
function ChainView({ items, index }: { items: ChainItem[]; index: number }) {
  return (
    <article className="chain" aria-label={`Chaîne ${index + 1}`}>
      <ol className="chain-steps">
        {items.map((item, j) => (
          <li key={j} className={`chain-step ${item.kind}`}>
            <p className="chain-meta">
              <span className="chain-kind">{KIND_TITLE[item.kind]}</span>
              <span className="chain-by">{item.by ?? 'Phrase tirée au hasard'}</span>
            </p>
            {item.kind === 'draw' ? (
              <Drawing strokes={item.strokes} label={`Dessin de ${item.by ?? 'la chaîne'}`} />
            ) : (
              <p className="chain-text">« {item.text} »</p>
            )}
          </li>
        ))}
      </ol>
    </article>
  );
}

export function TelephoneHost({ publicState: pub, hostState: host, now }: HostViewProps) {
  const remaining = useRemaining(pub?.endsAt, now);
  if (!pub) return null;

  if (pub.phase === 'ready') {
    return (
      <WaitingScreen
        title="En attente du lancement…"
        text="Chaque phrase fera le tour des joueurs : dessinée, puis décrite."
      />
    );
  }

  if (pub.phase === 'final') {
    const chains = pub.chains as Array<{ items: ChainItem[] }>;
    return (
      <section className="game-host telephone final fade-in">
        <h2 className="big-title">Le téléphone arabe</h2>
        <p className="muted">Chaque ligne va de la phrase de départ à la dernière description.</p>
        <div className="chain-list">
          {chains.map((chain, i) => (
            <ChainView key={i} items={chain.items} index={i} />
          ))}
        </div>
      </section>
    );
  }

  const pending: string[] = host?.pending ?? [];
  return (
    <section className="game-host telephone fade-in" key={`s-${pub.round}`}>
      <header className="telephone-header">
        <p className="label">
          Étape {pub.round + 1} / {pub.total}
        </p>
        <h2 className="telephone-instruction">{pub.instruction}</h2>
      </header>
      {pub.durationMs != null && <TimerBar remaining={remaining} total={pub.durationMs} />}
      <p className="muted">
        {pub.submittedCount} / {pub.playerCount} réponse(s)
        {pending.length > 0 && <> · En attente : {pending.join(', ')}</>}
      </p>
    </section>
  );
}
