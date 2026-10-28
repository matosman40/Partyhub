import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ajouterPersonnage, appliquerAction, creerGrille, type EtatGrille, type PublicPlayer } from '@partyhub/shared';
import { GrilleControleur, GrilleView, libelleDevant } from '@partyhub/games/client';
import { apparencesGrille } from '../components/LobbyGrille.js';

/**
 * Plateau en grille (salon de test) : les cases, les personnages à leur place, leur geste,
 * les commandes, et l’apparence de chaque joueur. Le plateau lui-même est testé côté serveur.
 */

function plateauAvecDeux(): EtatGrille {
  let e = creerGrille({ graine: 7 });
  e = ajouterPersonnage(e, 'a');
  e = ajouterPersonnage(e, 'b');
  return e;
}

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
  } as PublicPlayer;
}

describe('GrilleView', () => {
  it('dessine une case par cellule, avec des murs et du sol', () => {
    const e = plateauAvecDeux();
    const html = renderToStaticMarkup(<GrilleView etat={e} apparences={{}} label="Test" />);
    expect((html.match(/grille-case /g) ?? []).length).toBe(e.largeur * e.hauteur);
    expect(html).toContain('is-mur');
    expect(html).toContain('is-sol');
  });

  it('place chaque personnage sur sa case, avec son nom', () => {
    const e = plateauAvecDeux();
    const html = renderToStaticMarkup(
      <GrilleView etat={e} apparences={{ a: { name: 'Lina' }, b: { name: 'Théo' } }} label="Test" />,
    );
    for (const p of Object.values(e.personnages)) {
      expect(html).toContain(`data-x="${p.x}"`);
      expect(html).toContain(`data-y="${p.y}"`);
    }
    expect(html).toContain('Lina');
    expect(html).toContain('Théo');
  });

  it('un personnage sans apparence affiche son identifiant', () => {
    const html = renderToStaticMarkup(<GrilleView etat={plateauAvecDeux()} apparences={{}} label="Test" />);
    expect(html).toContain('aria-label="a"');
  });

  it('marque le personnage de cet appareil et rejoue le dernier geste une fois', () => {
    const r = appliquerAction(plateauAvecDeux(), 'a', { type: 'saluer' });
    if (!r.ok) throw new Error(r.erreur);
    const html = renderToStaticMarkup(
      <GrilleView etat={r.etat} apparences={{ a: { name: 'Lina', mine: true } }} label="Test" />,
    );
    expect(html).toContain('is-own');
    expect(html).toContain('is-geste-salut');
    expect(html).toContain('data-attitude="salut"');
  });

  it('ne rejoue aucun geste si personne ne vient de jouer', () => {
    const html = renderToStaticMarkup(<GrilleView etat={plateauAvecDeux()} apparences={{}} label="Test" />);
    expect(html).not.toContain('is-geste-');
  });
});

describe('GrilleControleur', () => {
  const noop = async () => null;

  it('propose la croix de direction et les trois boutons : Saluer, Action, Sauter', () => {
    const e = plateauAvecDeux();
    const html = renderToStaticMarkup(
      <GrilleControleur etat={e} moi="a" onAction={noop}>
        <GrilleView etat={e} apparences={{}} label="Test" />
      </GrilleControleur>,
    );
    for (const dir of ['haut', 'bas', 'gauche', 'droite']) expect(html).toContain(`Aller vers ${dir}`);
    for (const nom of ['Saluer', 'Action', 'Sauter']) expect(html).toContain(nom);
    // Le plateau est dessiné sous la manette.
    expect(html).toContain('grille-plateau');
  });

  it('désactive la croix et les boutons quand le plateau ne répond pas', () => {
    const e = plateauAvecDeux();
    const html = renderToStaticMarkup(
      <GrilleControleur etat={e} moi="a" onAction={noop} disabled>
        <GrilleView etat={e} apparences={{}} label="Test" />
      </GrilleControleur>,
    );
    expect((html.match(/disabled=""/g) ?? []).length).toBe(7);
  });

  it('dit ce qui est devant le personnage', () => {
    expect(libelleDevant('caisse', false)).toContain('Action la pousse');
    expect(libelleDevant('boite', false)).toContain('Action la prend');
    expect(libelleDevant('rien', false)).toBe('Rien devant vous');
    expect(libelleDevant('rien', true)).toContain('Vous portez une boîte');
  });
});

describe('apparencesGrille', () => {
  it('donne à chaque joueur son nom et marque le sien, avec ses étiquettes', () => {
    const apparences = apparencesGrille(
      [player({ id: 'a', name: 'Lina', ready: true }), player({ id: 'b', name: 'Théo', connected: false })],
      'a',
    );
    expect(apparences.a?.name).toBe('Lina');
    expect(apparences.a?.mine).toBe(true);
    expect(apparences.a?.tags).toEqual(['vous', 'prêt']);
    expect(apparences.b?.mine).toBe(false);
    expect(apparences.b?.away).toBe(true);
  });
});
