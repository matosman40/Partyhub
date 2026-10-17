import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { HostRoomView, PublicPlayer } from '@partyhub/shared';
import { TvLobby } from '../pages/tv/TvLobby.js';

/**
 * Salon de l'écran hôte : le bouton de lancement est toujours rendu (désactivé tant que le minimum
 * de joueurs n'est pas atteint), les joueurs sont affichés comme sur le téléphone, et le code hôte
 * n'apparaît que lorsqu'il a été demandé.
 */

function player(over: Partial<PublicPlayer> & { id: string; name: string }): PublicPlayer {
  return {
    connected: true,
    ready: false,
    bot: false,
    profile: false,
    devices: [],
    team: null,
    avatar: { hue: 200, emoji: '🙂', imageUrl: null },
    ...over,
  };
}

function lobby(over: Partial<HostRoomView['lobby']> = {}): HostRoomView['lobby'] {
  return {
    code: '5363',
    status: 'waiting',
    practice: false,
    game: { id: 'reflexe', name: 'Réflexe', minPlayers: 2, maxPlayers: 8 },
    players: [],
    maxPlayers: 8,
    readyCount: 0,
    gameSettings: {},
    ...over,
  } as unknown as HostRoomView['lobby'];
}

const noop = () => undefined;

describe('TvLobby', () => {
  it('affiche le bouton de lancement, désactivé sans assez de joueurs, avec la raison', () => {
    const html = renderToStaticMarkup(
      <TvLobby
        lobby={lobby({ players: [player({ id: 'a', name: 'Ana' })] })}
        joinUrl="http://x/j/5363"
        canStart={false}
        poses={{}}
        emotes={{}}
        positions={{}}
        onStart={noop}
        handoff={null}
        onHandoff={noop}
      />,
    );
    expect(html).toContain('Lancer la partie');
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Lancer la partie/);
    expect(html).toContain('Il faut au moins 2 joueur(s) connecté(s)');
    expect(html).toContain('Ana');
    expect(html).toContain('Lancer depuis mon téléphone');
    expect(html).not.toContain('stage-handoff-code');
  });

  it('active le bouton quand le minimum de joueurs est atteint', () => {
    const html = renderToStaticMarkup(
      <TvLobby
        lobby={lobby({ players: [player({ id: 'a', name: 'Ana' }), player({ id: 'b', name: 'Ben' })] })}
        joinUrl="http://x/j/5363"
        canStart
        poses={{}}
        emotes={{}}
        positions={{}}
        onStart={noop}
        handoff={null}
        onHandoff={noop}
      />,
    );
    expect(html).toMatch(/<button(?![^>]*disabled)[^>]*class="stage-launch"[^>]*>Lancer la partie/);
  });

  it('affiche le code hôte en deux blocs, avec son heure limite', () => {
    const html = renderToStaticMarkup(
      <TvLobby
        lobby={lobby()}
        joinUrl="http://x/j/5363"
        canStart={false}
        poses={{}}
        emotes={{}}
        positions={{}}
        onStart={noop}
        handoff={{ code: '819000', expiresAt: Date.now() + 180_000 }}
        onHandoff={noop}
      />,
    );
    expect(html).toContain('819 000');
    expect(html).toContain('une seule fois');
    expect(html).toContain('Nouveau code');
  });
});
