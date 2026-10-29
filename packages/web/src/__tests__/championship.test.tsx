import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { LobbyView, PublicPlayer, SeriesView } from '@partyhub/shared';
import {
  ChampionshipPanel,
  ChampionshipSettingsForm,
  GamePodium,
  MyResult,
  championshipPill,
  championshipSummary,
  replayLabel,
} from '../components/Championship.js';

/**
 * Championnat du salon, côté affichage : libellé du bouton de relance, classement avec rangs de progression
 * et icônes de victoire, équipes, podium de la partie et résultat personnel sur téléphone.
 */

const avatar = { hue: 200, emoji: '🙂', imageUrl: null };

function player(id: string, name: string, team: number | null = null): PublicPlayer {
  return { id, name, connected: true, ready: false, bot: false, profile: false, devices: [], avatar, team };
}

function series(over: Partial<SeriesView> = {}): SeriesView {
  return {
    length: 3,
    played: 1,
    finished: false,
    standings: [
      {
        playerId: 'a',
        name: 'Ana',
        points: 16,
        rank: 1,
        wins: 1,
        podiums: 1,
        played: 1,
        tier: { id: 'habitue', label: 'Habitué', icon: '🎯' },
        badges: [{ id: 'invaincu', icon: '👑', label: 'Invaincu' }],
        team: null,
      },
      {
        playerId: 'b',
        name: 'Bruno',
        points: 6,
        rank: 2,
        wins: 0,
        podiums: 1,
        played: 1,
        tier: { id: 'recrue', label: 'Recrue', icon: '🌱' },
        badges: [],
        team: null,
      },
    ],
    teams: null,
    history: [{ index: 1, game: 'Quiz', winners: ['Ana'] }],
    champion: null,
    ...over,
  };
}

function lobby(over: Partial<LobbyView> = {}): LobbyView {
  return {
    code: '1234',
    status: 'ended',
    game: { id: 'quiz-party', name: 'Quiz' } as LobbyView['game'],
    gameSettings: {},
    practice: false,
    maxPlayers: 8,
    players: [player('a', 'Ana', 0), player('b', 'Bruno', 1)],
    readyCount: 0,
    observers: { count: 0, devices: [] },
    championship: { length: 3, teams: 0 },
    series: series(),
    lastResult: {
      game: 'Quiz',
      ranking: [
        { playerId: 'b', name: 'Bruno', points: 4, rank: 2 },
        { playerId: 'a', name: 'Ana', points: 9, rank: 1 },
        { playerId: 'c', name: 'Chloé', points: 1, rank: 3 },
        { playerId: 'd', name: 'Dan', points: 0, rank: 4 },
      ],
    },
    ...over,
  } as LobbyView;
}

describe('replayLabel', () => {
  it('garde le libellé d’une partie unique', () => {
    expect(replayLabel({ series: null, championship: { length: 1, teams: 0 } })).toBe('Rejouer avec les mêmes joueurs');
  });

  it('annonce la manche suivante quand le championnat continue', () => {
    expect(replayLabel({ series: series({ played: 1 }), championship: { length: 3, teams: 0 } })).toBe(
      'Manche suivante : 2 sur 3',
    );
  });

  it('annonce un nouveau championnat après la dernière manche', () => {
    expect(replayLabel({ series: series({ played: 3, finished: true }), championship: { length: 3, teams: 0 } })).toBe(
      'Nouveau championnat',
    );
  });
});

describe('championshipPill', () => {
  it('montre le réglage avant la première manche, puis la manche en cours', () => {
    expect(championshipPill({ series: series({ played: 0 }), championship: { length: 2, teams: 2 } })).toBe(
      'Championnat : 2 manches · 2 équipes',
    );
    expect(championshipPill({ series: series({ played: 1 }), championship: { length: 3, teams: 0 } })).toBe(
      'Championnat : manche 2 sur 3',
    );
  });

  it('ne montre rien pour une partie unique sans équipes', () => {
    expect(championshipPill({ series: series(), championship: { length: 1, teams: 0 } })).toBeNull();
  });
});

describe('championshipSummary', () => {
  it('décrit les manches et les équipes', () => {
    expect(championshipSummary({ length: 1, teams: 0 })).toBe('Partie unique');
    expect(championshipSummary({ length: 3, teams: 0 })).toBe('3 manches');
    expect(championshipSummary({ length: 2, teams: 2 })).toBe('2 manches · 2 équipes');
  });
});

describe('ChampionshipPanel', () => {
  it('affiche la progression, les rangs de progression et les icônes de victoire', () => {
    const html = renderToStaticMarkup(<ChampionshipPanel series={series()} />);
    expect(html).toContain('Manche 1 sur 3');
    expect(html).toContain('Habitué');
    expect(html).toContain('aria-label="Invaincu"');
    expect(html).toContain('Ana');
    expect(html).toContain('Quiz');
  });

  it('énumère plusieurs vainqueurs de manche à la française', () => {
    const html = renderToStaticMarkup(
      <ChampionshipPanel
        series={series({ history: [{ index: 1, game: 'Quiz', winners: ['Ana', 'Bruno', 'Chloé'] }] })}
      />,
    );
    expect(html).toContain('Ana, Bruno et Chloé');
  });

  it('annonce les ex æquo en tête', () => {
    const html = renderToStaticMarkup(
      <ChampionshipPanel
        series={series({ finished: true, played: 2, champion: { names: ['Ana', 'Bruno'], team: null } })}
      />,
    );
    expect(html).toContain('Ex æquo en tête : Ana et Bruno');
  });

  it('annonce le vainqueur quand le championnat est terminé', () => {
    const html = renderToStaticMarkup(
      <ChampionshipPanel series={series({ finished: true, played: 3, champion: { names: ['Ana'], team: null } })} />,
    );
    expect(html).toContain('Terminé après 3 manches');
    expect(html).toContain('Ana remporte le championnat');
  });

  it('affiche le classement des équipes et désigne l’équipe gagnante', () => {
    const teams = [
      { index: 0, name: 'Rouge', icon: '🔴', color: '#ff5f6d', points: 14, rank: 1, members: ['Ana'] },
      { index: 1, name: 'Bleue', icon: '🔵', color: '#4cc9f0', points: 9, rank: 2, members: ['Bruno'] },
    ];
    const html = renderToStaticMarkup(
      <ChampionshipPanel
        series={series({ teams, finished: true, played: 3, champion: { names: ['Rouge'], team: 0 } })}
      />,
    );
    expect(html).toContain('Équipe Rouge');
    expect(html).toContain('Équipe Bleue');
    expect(html).toContain('Équipe Rouge remporte le championnat');
  });
});

describe('GamePodium', () => {
  it('affiche les trois premiers, classés, avec leur médaille', () => {
    const result = lobby().lastResult!;
    const html = renderToStaticMarkup(<GamePodium result={result} players={lobby().players} />);
    expect(html).toContain('aria-label="1er"');
    expect(html).toContain('aria-label="3e"');
    expect(html.indexOf('Ana')).toBeLessThan(html.indexOf('Bruno'));
    expect(html).not.toContain('Dan');
  });
});

describe('MyResult', () => {
  it('donne la place de la partie, le rang de championnat et le rang de progression', () => {
    const html = renderToStaticMarkup(<MyResult lobby={lobby()} playerId="a" />);
    expect(html).toContain('1er de la partie, 9 points');
    expect(html).toContain('Championnat : 1er, 16 points');
    expect(html).toContain('Habitué');
  });

  it('après une partie unique, ni champion ni badges : le rang n’est pas redit', () => {
    const html = renderToStaticMarkup(
      <MyResult
        lobby={lobby({
          championship: { length: 1, teams: 0 },
          series: series({ finished: true, champion: { names: ['Ana'], team: null } }),
        })}
        playerId="a"
      />,
    );
    expect(html).toContain('1er de la partie');
    expect(html).not.toContain('remporte le championnat');
    expect(html).not.toContain('Invaincu');
    expect(html).not.toContain('Championnat :');
  });

  it('montre l’équipe du joueur quand le salon en a', () => {
    const teams = [
      { index: 0, name: 'Rouge', icon: '🔴', color: '#ff5f6d', points: 16, rank: 1, members: ['Ana'] },
      { index: 1, name: 'Bleue', icon: '🔵', color: '#4cc9f0', points: 6, rank: 2, members: ['Bruno'] },
    ];
    const html = renderToStaticMarkup(
      <MyResult lobby={lobby({ championship: { length: 3, teams: 2 }, series: series({ teams }) })} playerId="a" />,
    );
    expect(html).toContain('Équipe Rouge');
  });
});

describe('ChampionshipSettingsForm', () => {
  it('propose 1 à 10 manches et les équipes', () => {
    const html = renderToStaticMarkup(
      <ChampionshipSettingsForm value={{ length: 3, teams: 0 }} onChange={() => undefined} />,
    );
    expect(html).toContain('Partie unique');
    expect(html).toContain('10 manches');
    expect(html).toContain('2 équipes');
    expect(html).toContain('4 équipes');
    expect(html).toContain('Aucune');
  });
});
