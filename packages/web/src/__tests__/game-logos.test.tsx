import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GameLogo } from '../components/GameLogo.js';
import { GAME_LOGOS, fallbackLogo, logoFor, type LogoMark } from '../components/gameLogos.js';

/** Identité visuelle des jeux : chaque jeu intégré a la sienne, les autres en reçoivent une stable. */

const BUILTIN_IDS = [
  'association',
  'aventure-ia',
  'banquise',
  'bombes-party',
  'boum',
  'cartes-coco',
  'cartes-couleurs',
  'essai-appareils',
  'funambule',
  'gags-en-rafale',
  'imite-moi',
  'imposteur',
  'loups-village',
  'micro-defis',
  'mots-croises',
  'phrases-trous',
  'plus-ou-moins',
  'plutot-qui',
  'poker-texas',
  'president',
  'promoteur',
  'quiz-party',
  'rami-51',
  'reflexe',
  'sauteurs',
  'solitaire',
  'sudoku',
  'taquin',
  'tarot',
];

const FILL_PALETTE = new Set(['#FFD23F', '#FF4F8B', '#ECEAE3']);
const EDGE_PALETTE = new Set(['#FF4F8B', '#3247E0', '#FFD23F', '#ECEAE3']);
const INK_PALETTE = new Set(['#14122E', '#1B1A4B']);

const MARKS: LogoMark[] = [
  'bubble',
  'fuse',
  'lens',
  'moon',
  'arrows',
  'crown',
  'skyline',
  'deck',
  'bolt',
  'star',
  'duo',
  'frame',
  'runner',
];

describe('Logos des jeux', () => {
  it('ont une identité dessinée pour chaque jeu intégré', () => {
    for (const id of BUILTIN_IDS) {
      const spec = GAME_LOGOS[id];
      expect(spec, id).toBeDefined();
      expect(spec!.lines[0].length, id).toBeGreaterThan(0);
    }
  });

  it('utilisent au moins huit motifs et des combinaisons de couleurs et motifs distinctes', () => {
    const specs = BUILTIN_IDS.map((id) => GAME_LOGOS[id]!);
    expect(new Set(specs.map((s) => s.mark)).size).toBeGreaterThanOrEqual(8);
    const combinations = specs.map((s) => `${s.fill}|${s.edge}|${s.mark}`);
    expect(new Set(combinations).size).toBe(specs.length);
    for (const spec of specs) expect(MARKS).toContain(spec.mark);
  });

  it('limite les couleurs des logos et des replis aux encres de la charte', () => {
    const fallbacks = Array.from({ length: 16 }, (_, i) => {
      const id = `repli-${i}`;
      return [id, fallbackLogo(id, `Jeu ${i}`)] as const;
    });
    const specs = [...Object.entries(GAME_LOGOS).map(([id, spec]) => [id, spec] as const), ...fallbacks];
    for (const [id, spec] of specs) {
      expect(FILL_PALETTE.has(spec.fill), `${id}: fill ${spec.fill}`).toBe(true);
      expect(EDGE_PALETTE.has(spec.edge), `${id}: edge ${spec.edge}`).toBe(true);
      expect(INK_PALETTE.has(spec.ink), `${id}: ink ${spec.ink}`).toBe(true);
      for (const sky of spec.sky) expect(['#14122E', '#1B1A4B'], `${id}: sky ${sky}`).toContain(sky);
    }
  });

  it('donnent au repli une identité stable pour un même identifiant', () => {
    expect(fallbackLogo('paquet-xyz', 'Mon jeu')).toEqual(fallbackLogo('paquet-xyz', 'Mon jeu'));
    const spec = fallbackLogo('paquet-xyz', 'Mon super jeu de société');
    expect(spec.lines).toEqual(['Mon', 'super jeu de société']);
    expect(MARKS).toContain(spec.mark);
  });

  it('préfèrent la spécification dessinée au repli', () => {
    expect(logoFor('tarot', 'Tarot')).toBe(GAME_LOGOS.tarot);
  });

  it('rendent un SVG nommé par le titre du jeu, sans valeur invalide', () => {
    for (const id of [...BUILTIN_IDS, 'jeu-inconnu']) {
      const html = renderToStaticMarkup(<GameLogo gameId={id} name="Un nom de jeu" />);
      expect(html).toContain('<svg');
      expect(html).toContain('role="img"');
      expect(html).toContain('aria-label="Un nom de jeu"');
      expect(html).not.toMatch(/NaN|undefined/);
    }
  });

  it('gardent un identifiant de trame unique par instance', () => {
    const html = renderToStaticMarkup(
      <>
        <GameLogo gameId="quiz-party" name="Quiz Party" />
        <GameLogo gameId="quiz-party" name="Quiz Party" />
      </>,
    );
    const patternIds = [...html.matchAll(/<pattern id="([^"]+)"/g)].map((match) => match[1]);
    expect(patternIds).toHaveLength(2);
    expect(new Set(patternIds).size).toBe(2);
  });
});
