import { describe, expect, it } from 'vitest';
import { essaiAppareils, ESSAIS, type EssaiState } from '../essai-appareils/module.js';

const alice = { id: 'a', name: 'Alice' };
const bob = { id: 'b', name: 'Bob' };

function lancerAvec(settings: Record<string, unknown>): EssaiState {
  const s0 = essaiAppareils.initialize(settings, [alice, bob]) as EssaiState;
  const r = essaiAppareils.start(s0);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

function lancer(): EssaiState {
  const s0 = essaiAppareils.initialize({}, [alice, bob]) as EssaiState;
  const r = essaiAppareils.start(s0);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

function rapport(s: EssaiState, p: { id: string; name: string }, reussi: boolean) {
  return essaiAppareils.handleAction(s, p, 'rapport', { reussi });
}

describe('Essai des appareils : déroulé', () => {
  it('démarre sur le micro, puis enchaîne les quatre essais dans l’ordre', () => {
    let s = lancer();
    expect(essaiAppareils.getPublicState(s).etape).toBe('micro');
    const attendu = ['micro', 'camera', 'mouvement', 'dessin'];
    for (const etape of attendu) {
      expect(essaiAppareils.getPublicState(s).etape).toBe(etape);
      s = essaiAppareils.nextRound(s);
    }
    expect(s.phase).toBe('final');
    expect(essaiAppareils.isFinished(s)).toBe(true);
  });

  it('ne peut pas démarrer deux fois', () => {
    const s = lancer();
    expect(essaiAppareils.start(s).ok).toBe(false);
  });

  it('n’accepte aucun résultat avant le début, ni après la fin', () => {
    const avant = essaiAppareils.initialize({}, [alice]) as EssaiState;
    expect(rapport(avant, alice, true).ok).toBe(false);
    let s = lancer();
    for (let i = 0; i < ESSAIS.length; i++) s = essaiAppareils.nextRound(s);
    expect(rapport(s, alice, true).ok).toBe(false);
  });

  it('calcule aucun score : c’est un contrôle, pas une compétition', () => {
    const s = lancer();
    expect(essaiAppareils.calculateScores(s, [])).toEqual([]);
  });
});

describe('Essai des appareils : résultats déclarés', () => {
  it('enregistre le résultat d’un téléphone pour l’essai en cours', () => {
    const s = lancer();
    const r = rapport(s, alice, true);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.resultats.a).toEqual({ micro: true });
  });

  it('refuse un second résultat pour le même essai, mais accepte le suivant', () => {
    let s = lancerAvec({ reprise: false });
    const premier = rapport(s, alice, false);
    if (!premier.ok) throw new Error('premier résultat refusé');
    s = premier.state;
    expect(rapport(s, alice, true).ok).toBe(false);
    s = essaiAppareils.nextRound(s);
    const suivant = rapport(s, alice, true);
    expect(suivant.ok).toBe(true);
  });

  it('refuse une action inconnue', () => {
    const s = lancer();
    expect(essaiAppareils.handleAction(s, alice, 'triche', {}).ok).toBe(false);
  });

  it('ne modifie jamais l’état reçu', () => {
    const s = lancer();
    const avant = JSON.stringify(s);
    rapport(s, alice, true);
    expect(JSON.stringify(s)).toBe(avant);
  });
});

describe('Essai des appareils : vues', () => {
  it('la vue publique compte les réponses de l’essai en cours, sans secret', () => {
    let s = lancer();
    const r = rapport(s, alice, true);
    if (!r.ok) throw new Error('refusé');
    s = r.state;
    const pub = essaiAppareils.getPublicState(s);
    expect(pub.repondus).toBe(1);
    expect(pub.total).toBe(2);
    expect(pub.joueurs.find((j: { id: string }) => j.id === 'a')?.resultats[0]).toBe(true);
    expect(pub.joueurs.find((j: { id: string }) => j.id === 'b')?.resultats[0]).toBe(null);
  });

  it('la vue hôte liste les téléphones qui n’ont pas répondu à l’essai en cours', () => {
    const s = lancer();
    const r = rapport(s, alice, true);
    if (!r.ok) throw new Error('refusé');
    expect(essaiAppareils.getHostState(r.state).attente).toEqual(['Bob']);
  });

  it('la vue privée dit au joueur s’il a déjà répondu, et à quel essai', () => {
    let s = lancer();
    const r = rapport(s, alice, true);
    if (!r.ok) throw new Error('refusé');
    s = r.state;
    expect(essaiAppareils.getPlayerState(s, 'a')).toEqual({ etape: 'micro', aRepondu: true, monResultat: true });
    expect(essaiAppareils.getPlayerState(s, 'b')).toEqual({ etape: 'micro', aRepondu: false, monResultat: null });
    s = essaiAppareils.nextRound(s);
    expect(essaiAppareils.getPlayerState(s, 'a').aRepondu).toBe(false);
  });

  it('une fois fini, la vue publique donne le bilan de chaque téléphone', () => {
    let s = lancer();
    const r = rapport(s, alice, true);
    if (!r.ok) throw new Error('refusé');
    s = r.state;
    for (let i = 0; i < ESSAIS.length; i++) s = essaiAppareils.nextRound(s);
    const pub = essaiAppareils.getPublicState(s);
    expect(pub.phase).toBe('final');
    expect(pub.joueurs[0].resultats).toEqual([true, null, null, null]);
  });
});

describe('Essai des appareils : départs et retours', () => {
  it('un téléphone qui arrive en cours d’essai est compté, et un qui part n’est plus attendu', () => {
    let s = lancer();
    s = essaiAppareils.onPlayerJoin(s, { id: 'c', name: 'Chloé' });
    expect(essaiAppareils.getHostState(s).attente).toEqual(['Alice', 'Bob', 'Chloé']);
    s = essaiAppareils.onPlayerLeave(s, { id: 'b', name: 'Bob' });
    expect(essaiAppareils.getHostState(s).attente).toEqual(['Alice', 'Chloé']);
  });
});

describe('Essai des appareils : réglages', () => {
  function avec(settings: Record<string, unknown>): EssaiState {
    const s0 = essaiAppareils.initialize(settings, [alice, bob]) as EssaiState;
    const r = essaiAppareils.start(s0);
    if (!r.ok) throw new Error(r.error);
    return r.state;
  }

  it('n’enchaîne que les essais activés, dans l’ordre', () => {
    const s = avec({ micro: false, dessin: false });
    expect(s.essais).toEqual(['camera', 'mouvement']);
    expect(essaiAppareils.getPublicState(s).etapes.map((e: { id: string }) => e.id)).toEqual(['camera', 'mouvement']);
  });

  it('si tous les essais sont désactivés, la partie les fait tous', () => {
    const s = avec({ micro: false, camera: false, mouvement: false, dessin: false });
    expect(s.essais).toEqual([...ESSAIS]);
  });

  it('le serveur borne les seuils : une valeur hors limite est refusée à la configuration', () => {
    expect(() => essaiAppareils.initialize({ dureeSon: 50 }, [alice])).toThrow();
    expect(() => essaiAppareils.initialize({ longueurTrait: 9999 }, [alice])).toThrow();
    expect(() => essaiAppareils.initialize({ inclinaison: 10 }, [alice])).toThrow();
  });

  it('la vue publique donne les seuils à tous les téléphones', () => {
    const s = avec({ dureeSon: 1500, longueurTrait: 200, inclinaison: 70 });
    expect(essaiAppareils.getPublicState(s).reglages).toMatchObject({
      dureeSon: 1500,
      longueurTrait: 200,
      inclinaison: 70,
    });
  });

  it('sans reprise, un téléphone ne corrige pas son résultat', () => {
    let s = avec({ reprise: false });
    const premier = rapport(s, alice, false);
    if (!premier.ok) throw new Error('refusé');
    s = premier.state;
    expect(rapport(s, alice, true).ok).toBe(false);
  });

  it('avec reprise, un téléphone peut corriger son résultat pendant l’essai', () => {
    const s = avec({ reprise: true });
    const premier = rapport(s, alice, false);
    if (!premier.ok) throw new Error('refusé');
    const corrige = rapport(premier.state, alice, true);
    expect(corrige.ok).toBe(true);
    if (!corrige.ok) return;
    expect(corrige.state.resultats.a).toEqual({ micro: true });
  });

  it('une configuration vide ou partielle garde les valeurs par défaut', () => {
    const s = essaiAppareils.initialize({}, [alice]) as EssaiState;
    expect(s.settings).toMatchObject({
      micro: true,
      dureeSon: 1000,
      longueurTrait: 150,
      inclinaison: 50,
      reprise: true,
    });
  });
});
