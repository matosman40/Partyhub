import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GameContext, PlayerRef } from '@partyhub/shared';
import { gagsEnRafale, type GagsState } from '../gags-en-rafale/module.js';
import { GAG_IDS, GAGS, type GagId } from '../gags-en-rafale/gags.js';
import { GagsHost } from '../gags-en-rafale/client/HostScreen.js';
import { GagsPlayer } from '../gags-en-rafale/client/PlayerScreen.js';

/**
 * Les vues du jeu, rendues à partir d'états réels du moteur : chaque gag, chaque phase, côté écran principal
 * et côté téléphone. Le rendu ne doit jamais échouer, ni afficher de valeur absurde.
 */

const PLAYERS: PlayerRef[] = [
  { id: 'ana', name: 'Ana' },
  { id: 'leo', name: 'Léo' },
];

function clock(connected: string[]) {
  const now = 1_000_000;
  const timers = new Map<string, number>();
  const ctx: GameContext = {
    now: () => now,
    schedule: (key, ms) => void timers.set(key, now + ms),
    cancel: (key) => void timers.delete(key),
    random: (() => {
      let seed = 3;
      return () => {
        seed = (seed * 16807) % 2147483647;
        return seed / 2147483647;
      };
    })(),
    connectedPlayerIds: () => connected,
  };
  return { ctx, timers, now: () => now };
}

/** Partie en cours, au gag `gag` (forcé en première manche), à la phase demandée. */
function stateAt(gag: GagId, phase: 'intro' | 'play' | 'reveal'): GagsState {
  const c = clock(['ana', 'leo']);
  const init = gagsEnRafale.initialize({ rounds: 2 }, PLAYERS, c.ctx);
  const started = gagsEnRafale.start(init, c.ctx);
  if (!started.ok) throw new Error(started.error);
  let s: GagsState = { ...started.state, plan: [{ gag, seed: 4242 }, ...started.state.plan.slice(1)] };
  if (phase === 'play' || phase === 'reveal') {
    s = gagsEnRafale.onTimer(s, 'intro-end', c.ctx);
  }
  if (phase === 'reveal') {
    const res = gagsEnRafale.handleAction(s, PLAYERS[0]!, 'done', { value: 0 }, c.ctx);
    if (!res.ok) throw new Error(res.error);
    s = res.state;
    s = gagsEnRafale.onTimer(s, 'play-end', c.ctx);
  }
  return s;
}

const hostView = (s: GagsState) => ({
  publicState: gagsEnRafale.getPublicState(s),
  hostState: gagsEnRafale.getHostState(s),
  now: 1_000_000,
});

const playerView = (s: GagsState, playerId = 'ana') => ({
  publicState: gagsEnRafale.getPublicState(s),
  playerState: gagsEnRafale.getPlayerState(s, playerId),
  playerId,
  now: 1_000_000,
  send: async () => ({ ok: true }),
});

describe('Gags en rafale : écran principal', () => {
  it('affiche chaque gag pendant sa présentation et pendant son défi', () => {
    for (const gag of GAG_IDS) {
      const intro = renderToStaticMarkup(<GagsHost {...hostView(stateAt(gag, 'intro'))} />);
      expect(intro, gag).toContain(GAGS[gag].name);
      expect(intro, gag).toContain(GAGS[gag].flavor);
      const play = renderToStaticMarkup(<GagsHost {...hostView(stateAt(gag, 'play'))} />);
      expect(play, gag).toContain(GAGS[gag].instruction);
      // Un gag d'attente ne liste pas qui doit encore jouer : on y touche ou on n'y touche pas.
      if (gag !== 'patience') expect(play.includes('En attente'), gag).toBe(true);
      expect(play, gag).not.toMatch(/NaN|undefined/);
    }
  });

  it('affiche le bilan avec la réplique du gag, sans révéler la réponse attendue avant', () => {
    const play = renderToStaticMarkup(<GagsHost {...hostView(stateAt('ballon', 'play'))} />);
    expect(play).not.toContain('Réussi');
    const reveal = renderToStaticMarkup(<GagsHost {...hostView(stateAt('ballon', 'reveal'))} />);
    expect(reveal).toContain('Bilan');
    expect(reveal).toContain(GAGS.ballon.quips.lose);
  });

  it('montre la mouche à sa position de départ, et l’écran d’attente avant le lancement', () => {
    const fly = renderToStaticMarkup(<GagsHost {...hostView(stateAt('mouche', 'play'))} />);
    expect(fly).toContain('gag-fly');
    expect(fly).toContain('🪰');
    const ready = gagsEnRafale.initialize({ rounds: 2 }, PLAYERS, clock(['ana']).ctx);
    expect(renderToStaticMarkup(<GagsHost {...hostView(ready)} />)).toContain('En attente du lancement');
  });
});

describe('Gags en rafale : téléphone', () => {
  it('propose le bon défi à chaque gag', () => {
    for (const gag of GAG_IDS) {
      const play = renderToStaticMarkup(<GagsPlayer {...playerView(stateAt(gag, 'play'))} />);
      expect(play, gag).toContain(GAGS[gag].name);
      expect(play, gag).not.toMatch(/NaN|undefined/);
    }
  });

  it('montre la présentation avec la consigne et la phrase absurde', () => {
    const intro = renderToStaticMarkup(<GagsPlayer {...playerView(stateAt('crepe', 'intro'))} />);
    expect(intro).toContain(GAGS.crepe.instruction);
    expect(intro).toContain(GAGS.crepe.flavor);
  });

  it('montre le bouton « ne pas toucher » pour le gag d’attente', () => {
    const wait = renderToStaticMarkup(<GagsPlayer {...playerView(stateAt('patience', 'play'))} />);
    expect(wait).toContain('NE PAS TOUCHER');
  });

  it('montre le ticket à gratter et la surface à 0 %', () => {
    const scratch = renderToStaticMarkup(<GagsPlayer {...playerView(stateAt('gratte', 'play'))} />);
    expect(scratch).toContain('Gratté : 0 %');
    expect(scratch).toContain('🍌');
  });

  it('affiche le verdict du bilan', () => {
    const reveal = renderToStaticMarkup(<GagsPlayer {...playerView(stateAt('crepe', 'reveal'))} />);
    expect(reveal).toMatch(/Réussi|Raté|Pas de réponse/);
  });
});
