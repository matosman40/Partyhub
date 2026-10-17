import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  CHARACTER_EXPRESSIONS,
  defaultCharacterFor,
  LOBBY_FACE_INFO,
  LOBBY_FACES,
  LOBBY_MOOD_INFO,
  LOBBY_MOODS,
  lobbyEmoteEmoji,
  type CharacterSpec,
} from '@partyhub/shared';
import { Character } from '@partyhub/games/client';
import { LobbyMoodBar } from '../components/LobbyPlateau.js';
import { poseOf } from '../components/useLobbyMoods.js';

/**
 * Émotions du salon : le téléphone propose des attitudes et des visages ; le personnage montre
 * le visage demandé pendant l’émotion, puis son expression habituelle revient.
 */

const spec: CharacterSpec = defaultCharacterFor('Lina');

describe('Boutons d’émotion du téléphone', () => {
  it('propose les attitudes et les six visages du profil', () => {
    const html = renderToStaticMarkup(<LobbyMoodBar onPick={() => undefined} />);
    expect(LOBBY_FACES).toEqual(CHARACTER_EXPRESSIONS);
    expect(html).toContain('Attitudes de votre personnage');
    for (const mood of LOBBY_MOODS) expect(LOBBY_MOOD_INFO[mood].label.length).toBeGreaterThan(0);
    expect(html.match(/lobby-mood-btn/g)?.length).toBe(LOBBY_MOODS.length + CHARACTER_EXPRESSIONS.length);
    for (const face of LOBBY_FACES) {
      expect(html).toContain(`aria-label="${LOBBY_FACE_INFO[face].label}"`);
    }
  });

  it('donne un emoji et un libellé à chaque visage', () => {
    for (const face of LOBBY_FACES) {
      expect(LOBBY_FACE_INFO[face].emoji.length).toBeGreaterThan(0);
      expect(LOBBY_FACE_INFO[face].label.length).toBeGreaterThan(0);
    }
  });
});

describe('Émotion reçue', () => {
  it('joue l’attitude, ou le repos quand seul le visage change', () => {
    expect(poseOf({ mood: 'dance' })).toBe('dance');
    expect(poseOf({ mood: null })).toBe('idle');
  });

  it('prend l’emoji du visage quand il y en a un, sinon celui de l’attitude', () => {
    expect(lobbyEmoteEmoji({ mood: null, face: 'triste' })).toBe(LOBBY_FACE_INFO.triste.emoji);
    expect(lobbyEmoteEmoji({ mood: 'joy', face: null })).toBe('🎉');
    expect(lobbyEmoteEmoji({ mood: null, face: null })).toBe('');
  });
});

describe('Personnage qui montre un visage', () => {
  it('change le dessin quand un visage est demandé', () => {
    const normal = renderToStaticMarkup(<Character spec={spec} mood="idle" framing="bust" />);
    const sad = renderToStaticMarkup(<Character spec={spec} mood="idle" face="triste" framing="bust" />);
    expect(sad).not.toBe(normal);
    expect(sad).not.toMatch(/NaN|undefined/);
  });

  it('montre l’expression du profil au repos, et garde le visage de l’attitude sinon', () => {
    const withExpression: CharacterSpec = { ...spec, expression: CHARACTER_EXPRESSIONS.indexOf('triste') };
    const rest = renderToStaticMarkup(<Character spec={withExpression} mood="idle" framing="bust" />);
    const explicitSad = renderToStaticMarkup(<Character spec={spec} mood="idle" face="triste" framing="bust" />);
    expect(rest).toBe(explicitSad);
    const joy = renderToStaticMarkup(<Character spec={withExpression} mood="joy" framing="bust" />);
    expect(joy).not.toBe(rest);
  });

  it.each(LOBBY_FACES)('dessine le visage %s sans valeur invalide', (face) => {
    const html = renderToStaticMarkup(<Character spec={spec} mood="idle" face={face} framing="bust" />);
    expect(html).toContain('<svg');
    expect(html).not.toMatch(/NaN|undefined/);
  });
});
