import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PublicPlayer } from '@partyhub/shared';
import { LobbyHeads } from '../components/LobbyPlateau.js';

/**
 * Salon épuré du téléphone (tous les jeux) : une tête par joueur, son pseudo, ses étiquettes
 * (vous, prêt, robot) et son émotion en cours. Pas de plateau ni de déplacement.
 */

function player(over: Partial<PublicPlayer> & { id: string; name: string }): PublicPlayer {
  return {
    connected: true,
    ready: false,
    bot: false,
    profile: false,
    devices: [],
    avatar: { hue: 200, emoji: '🙂', imageUrl: null },
    ...over,
  };
}

describe('LobbyHeads', () => {
  it('affiche une tête, un pseudo et les étiquettes de chaque joueur', () => {
    const html = renderToStaticMarkup(
      <LobbyHeads
        me="a"
        emotes={{}}
        players={[player({ id: 'a', name: 'Lina', ready: true }), player({ id: 'b', name: 'Théo', bot: true })]}
      />,
    );
    expect(html).toContain('class="lobby-heads"');
    expect(html.match(/class="lobby-head[ "]/g)?.length).toBe(2);
    expect(html).toContain('Lina');
    expect(html).toContain('Théo');
    expect(html).toContain('>vous<');
    expect(html).toContain('lobby-head-tag is-ready');
    expect(html).toContain('>robot<');
    expect(html).toContain('is-me');
  });

  it("n'affiche pas de plateau ni de décor", () => {
    const html = renderToStaticMarkup(<LobbyHeads emotes={{}} players={[player({ id: 'a', name: 'Lina' })]} />);
    expect(html).not.toContain('plateau');
    expect(html).not.toContain('lobby-plateau');
  });

  it('marque un joueur absent sans le retirer de la liste', () => {
    const html = renderToStaticMarkup(
      <LobbyHeads emotes={{}} players={[player({ id: 'a', name: 'Lina', connected: false })]} />,
    );
    expect(html).toContain('lobby-head is-away');
    expect(html).toContain('Lina');
  });

  it("affiche l'émotion en cours sur la tête", () => {
    const html = renderToStaticMarkup(
      <LobbyHeads
        emotes={{ a: { id: 'e1', mood: 'joy' } }}
        players={[player({ id: 'a', name: 'Lina' }), player({ id: 'b', name: 'Théo' })]}
      />,
    );
    expect(html.match(/lobby-head-emote/g)?.length).toBe(1);
  });

  it("affiche un texte d'attente quand la salle est vide", () => {
    const html = renderToStaticMarkup(<LobbyHeads emotes={{}} players={[]} />);
    expect(html).toContain('En attente des premiers joueurs');
    expect(html).not.toContain('<ul');
  });

  it('ne produit aucune valeur absente dans le HTML', () => {
    const html = renderToStaticMarkup(<LobbyHeads emotes={{}} players={[player({ id: 'a', name: 'Lina' })]} />);
    expect(html).not.toMatch(/NaN|undefined/);
  });
});
