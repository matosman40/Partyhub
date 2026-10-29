import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ajouterPersonnage,
  appliquerAction,
  creerGrille,
  themeDePlateau,
  THEMES_PLATEAU,
  type EtatGrille,
  type PublicPlayer,
} from '@partyhub/shared';
import { GrilleControleur, GrilleView, actionDepuisTouche, libelleDevant } from '@partyhub/games/client';
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
    expect(libelleDevant('plateforme', false)).toBe('Plateforme devant vous : Sauter pour monter');
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

describe('Décor et tiroir', () => {
  const noop = async () => null;

  it('le plateau et la manette prennent les couleurs du décor choisi', () => {
    const e = creerGrille({ graine: 7, theme: 'arene' });
    const plateau = renderToStaticMarkup(<GrilleView etat={e} apparences={{}} label="Test" theme="arene" />);
    expect(plateau).toContain(THEMES_PLATEAU.arene.dalles[0]);
    const manette = renderToStaticMarkup(
      <GrilleControleur etat={e} moi="a" onAction={noop} theme="banquise">
        <GrilleView etat={e} apparences={{}} label="Test" theme="banquise" />
      </GrilleControleur>,
    );
    expect(manette).toContain(`--fond:${THEMES_PLATEAU.banquise.fond}`);
  });

  it('un décor absent ou inconnu retombe sur le décor par défaut', () => {
    expect(themeDePlateau(undefined).id).toBe('fete');
    expect(themeDePlateau('volcan').id).toBe('fete');
    expect(themeDePlateau('arene').id).toBe('arene');
  });

  it('les actions secondaires sont dans un tiroir fermé, ouvert par une poignée', () => {
    const e = plateauAvecDeux();
    const html = renderToStaticMarkup(
      <GrilleControleur etat={e} moi="a" onAction={noop} tiroir={<p>Réactions de test</p>}>
        <GrilleView etat={e} apparences={{}} label="Test" />
      </GrilleControleur>,
    );
    expect(html).toContain('grille-tiroir-poignee');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('Réactions de test');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toMatch(/inert=""/);
  });

  it('sans tiroir, il n’y a pas de poignée', () => {
    const e = plateauAvecDeux();
    const html = renderToStaticMarkup(
      <GrilleControleur etat={e} moi="a" onAction={noop}>
        <GrilleView etat={e} apparences={{}} label="Test" />
      </GrilleControleur>,
    );
    expect(html).not.toContain('grille-tiroir-poignee');
  });
});

describe('actionDepuisTouche', () => {
  it('traduit les flèches, Espace, Entrée et S en gestes', () => {
    expect(actionDepuisTouche({ key: 'ArrowUp' })).toEqual({ type: 'marcher', dir: 'up' });
    expect(actionDepuisTouche({ key: 'ArrowLeft' })).toEqual({ type: 'marcher', dir: 'left' });
    expect(actionDepuisTouche({ key: ' ' })).toEqual({ type: 'action' });
    expect(actionDepuisTouche({ key: 'Enter' })).toEqual({ type: 'sauter' });
    expect(actionDepuisTouche({ key: 's' })).toEqual({ type: 'saluer' });
    expect(actionDepuisTouche({ key: 'S' })).toEqual({ type: 'saluer' });
    expect(actionDepuisTouche({ key: 'x' })).toBeNull();
  });

  it('ignore une frappe déjà traitée ou combinée à Ctrl, Cmd ou Alt', () => {
    expect(actionDepuisTouche({ key: ' ', defaultPrevented: true })).toBeNull();
    expect(actionDepuisTouche({ key: 'ArrowUp', ctrlKey: true })).toBeNull();
    expect(actionDepuisTouche({ key: 's', metaKey: true })).toBeNull();
    expect(actionDepuisTouche({ key: 'ArrowLeft', altKey: true })).toBeNull();
  });

  it('laisse Espace et Entrée aux boutons, liens, listes et boîtes de dialogue', () => {
    for (const cible of [
      { tag: 'BUTTON' },
      { tag: 'A' },
      { tag: 'SELECT' },
      { tag: 'DIV', role: 'button' },
      { tag: 'DIV', role: 'dialog' },
      { tag: 'SPAN', dansDialogue: true },
    ]) {
      expect(actionDepuisTouche({ key: ' ', cible })).toBeNull();
      expect(actionDepuisTouche({ key: 'Enter', cible })).toBeNull();
    }
    // Les flèches restent actives sur un bouton.
    expect(actionDepuisTouche({ key: 'ArrowDown', cible: { tag: 'BUTTON' } })).toEqual({
      type: 'marcher',
      dir: 'down',
    });
  });

  it('ne touche à rien dans un champ de saisie', () => {
    for (const cible of [{ tag: 'INPUT' }, { tag: 'TEXTAREA' }, { tag: 'SELECT' }, { tag: 'DIV', editable: true }]) {
      for (const key of ['ArrowUp', ' ', 'Enter', 's']) expect(actionDepuisTouche({ key, cible })).toBeNull();
    }
  });

  it('une touche maintenue ne répète que la marche', () => {
    expect(actionDepuisTouche({ key: 'ArrowRight', repeat: true })).toEqual({ type: 'marcher', dir: 'right' });
    for (const key of [' ', 'Enter', 's']) expect(actionDepuisTouche({ key, repeat: true })).toBeNull();
  });
});
