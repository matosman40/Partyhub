import type { CSSProperties } from 'react';
import type {
  ChampionshipSettings,
  LastResultView,
  LobbyView,
  PublicPlayer,
  SeriesTeamView,
  SeriesView,
} from '@partyhub/shared';
import { PlayerAvatar } from './PlayerAvatar.js';

/**
 * Championnat d’un salon : podium de la dernière partie (pour tous les jeux), classement cumulé,
 * équipes, icônes de victoire et réglage avant la partie. Les calculs sont faits par le serveur ;
 * ici on n’affiche que ce qui est reçu.
 */

const MEDALS = ['🥇', '🥈', '🥉'] as const;

/** Vrai quand le salon joue un championnat (plusieurs manches ou des équipes), pas une simple partie. */
export function hasChampionship(c: ChampionshipSettings): boolean {
  return c.length > 1 || c.teams >= 2;
}

/** « Partie unique » ou « 3 manches », suivi du nombre d’équipes s’il y en a. */
export function championshipSummary(c: ChampionshipSettings): string {
  const manches = c.length === 1 ? 'Partie unique' : `${c.length} manches`;
  return c.teams >= 2 ? `${manches} · ${c.teams} équipes` : manches;
}

/**
 * Libellé du bouton « rejouer » : il annonce ce qui va se passer. Rejouer ramène au salon, où l’hôte
 * lance ensuite la manche avec « Lancer la partie ».
 */
export function replayLabel(lobby: Pick<LobbyView, 'series' | 'championship'>): string {
  const series = lobby.series;
  if (!series || lobby.championship.length <= 1) return 'Rejouer avec les mêmes joueurs';
  if (series.finished) return 'Nouveau championnat';
  return `Manche suivante : ${series.played + 1} sur ${series.length}`;
}

/** Pastille du salon : le réglage avant la première manche, puis la progression du championnat. */
export function championshipPill(lobby: Pick<LobbyView, 'series' | 'championship'>): string | null {
  if (!hasChampionship(lobby.championship)) return null;
  const series = lobby.series;
  if (!series || series.played === 0 || series.finished)
    return `Championnat : ${championshipSummary(lobby.championship)}`;
  return `Championnat : manche ${series.played + 1} sur ${series.length}`;
}

/** 1er, 2e, 3e… */
export function rankLabel(rank: number): string {
  return `${rank}${rank === 1 ? 'er' : 'e'}`;
}

function points(n: number): string {
  return `${n} point${n > 1 ? 's' : ''}`;
}

function medal(rank: number): string {
  return MEDALS[rank - 1] ?? rankLabel(rank);
}

type Champion = NonNullable<SeriesView['champion']>;

/** Énumération en français : « A », « A et B », « A, B et C ». */
export function frenchList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} et ${items[items.length - 1]}`;
}

/** Texte du vainqueur : une équipe, un joueur, ou plusieurs ex æquo. */
export function championText(champion: Champion, teams: SeriesTeamView[] | null): string {
  const label = (name: string) => (champion.team !== null || teams ? `Équipe ${name}` : name);
  if (champion.names.length === 1) return `${label(champion.names[0] ?? '')} remporte le championnat`;
  return `Ex æquo en tête : ${frenchList(champion.names.map(label))}`;
}

/** Podium de la dernière partie : les trois premiers, avec leur icône de rang. Vaut pour tous les jeux. */
export function GamePodium({ result, players }: { result: LastResultView; players: PublicPlayer[] }) {
  const top = result.ranking.filter((r) => r.rank <= 3).sort((a, b) => a.rank - b.rank || b.points - a.points);
  return (
    <section className="podium" aria-label={`Podium : ${result.game}`}>
      <h3 className="podium-title">{result.game}</h3>
      <ol className="podium-list">
        {top.map((r) => {
          const avatar = players.find((p) => p.id === r.playerId)?.avatar;
          return (
            <li key={r.playerId} className={`podium-row place-${r.rank}`}>
              <span className="podium-medal" role="img" aria-label={rankLabel(r.rank)}>
                {medal(r.rank)}
              </span>
              {avatar && <PlayerAvatar avatar={avatar} name={r.name} size="sm" />}
              <span className="podium-name">{r.name}</span>
              <span className="podium-points">{points(r.points)}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function TeamStandings({ teams }: { teams: SeriesTeamView[] }) {
  return (
    <ol className="champ-teams" aria-label="Classement des équipes">
      {teams.map((t) => (
        <li key={t.index} className="champ-team" style={{ '--team': t.color } as CSSProperties}>
          <span className="champ-rank">{rankLabel(t.rank)}</span>
          <span className="champ-team-name">
            <span aria-hidden="true">{t.icon}</span> Équipe {t.name}
          </span>
          <span className="champ-points">{points(t.points)}</span>
          <span className="champ-members">{t.members.join(', ')}</span>
        </li>
      ))}
    </ol>
  );
}

function BadgeList({ badges }: { badges: { id: string; icon: string; label: string }[] }) {
  if (badges.length === 0) return null;
  return (
    <span className="champ-badges">
      {badges.map((b) => (
        <span key={b.id} className="champ-badge" role="img" aria-label={b.label} title={b.label}>
          {b.icon}
        </span>
      ))}
    </span>
  );
}

/** Classement cumulé du championnat : rangs de progression, icônes de victoire, équipes et historique. */
export function ChampionshipPanel({ series }: { series: SeriesView }) {
  const progress = series.finished
    ? `Terminé après ${series.played} manche${series.played > 1 ? 's' : ''}`
    : `Manche ${series.played} sur ${series.length}`;
  return (
    <section className="champ" aria-label="Championnat">
      <header className="champ-head">
        <h3>Championnat</h3>
        <span className="champ-progress">{progress}</span>
      </header>
      {series.champion && (
        <p className="champ-champion">
          <span aria-hidden="true">🏆</span> {championText(series.champion, series.teams)}
        </p>
      )}
      {series.teams && <TeamStandings teams={series.teams} />}
      {series.standings.length > 0 && (
        <ol className="champ-standings">
          {series.standings.map((row) => (
            <li key={row.playerId} className="champ-row">
              <span className="champ-rank">{rankLabel(row.rank)}</span>
              <span className="champ-name">{row.name}</span>
              <span className="champ-tier" title={row.tier.label}>
                <span aria-hidden="true">{row.tier.icon}</span> {row.tier.label}
              </span>
              <span className="champ-points">{points(row.points)}</span>
              <BadgeList badges={row.badges} />
            </li>
          ))}
        </ol>
      )}
      {series.history.length > 0 && (
        <ol className="champ-history" aria-label="Historique des manches">
          {series.history.map((h) => (
            <li key={h.index}>
              <span className="champ-history-game">
                {h.index}. {h.game}
              </span>
              <span className="champ-history-winner">{frenchList(h.winners) || 'Personne'}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** Vrai s’il y a quelque chose à montrer en fin de partie : un podium ou le championnat. */
export function hasEndResults(lobby: LobbyView): boolean {
  const podium = Boolean(lobby.lastResult && lobby.lastResult.ranking.length > 0);
  return podium || Boolean(lobby.series && hasChampionship(lobby.championship));
}

/**
 * Colonne de droite de l’écran principal, à la fin d’une partie : podium puis championnat.
 * Un jeu sans score (contrôle, bilan) n’a ni podium ni classement : pas de colonne vide.
 */
export function GameEndPanel({ lobby }: { lobby: LobbyView }) {
  if (!hasEndResults(lobby)) return null;
  return (
    <aside className="results-panel" aria-label="Résultats de la partie">
      {lobby.lastResult && lobby.lastResult.ranking.length > 0 && (
        <GamePodium result={lobby.lastResult} players={lobby.players} />
      )}
      {lobby.series && hasChampionship(lobby.championship) && <ChampionshipPanel series={lobby.series} />}
    </aside>
  );
}

/** Réglage du championnat, dans le menu de l’écran principal, avant la partie. */
export function ChampionshipSettingsForm({
  value,
  onChange,
}: {
  value: ChampionshipSettings;
  onChange: (next: ChampionshipSettings) => void;
}) {
  return (
    <div className="champ-form">
      <label className="field">
        <span>Manches</span>
        <select value={value.length} onChange={(e) => onChange({ ...value, length: Number(e.target.value) })}>
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n === 1 ? 'Partie unique' : `${n} manches`}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Équipes</span>
        <select value={value.teams} onChange={(e) => onChange({ ...value, teams: Number(e.target.value) })}>
          <option value={0}>Aucune</option>
          <option value={2}>2 équipes</option>
          <option value={3}>3 équipes</option>
          <option value={4}>4 équipes</option>
        </select>
      </label>
      <p className="muted small">
        Chaque manche rapporte des points selon le rang : 10 au premier, puis 6, 4, 3, 2 et 1. Les points s’additionnent
        d’une manche à l’autre.
      </p>
    </div>
  );
}

/** Équipe d’un joueur, en pastille. Rien tant que le salon n’a pas d’équipes. */
export function TeamBadge({ lobby, playerId }: { lobby: LobbyView; playerId: string }) {
  const index = lobby.players.find((p) => p.id === playerId)?.team ?? null;
  const team = index !== null ? lobby.series?.teams?.[index] : undefined;
  if (!team) return null;
  return (
    <span className="team-chip" style={{ '--team': team.color } as CSSProperties}>
      <span aria-hidden="true">{team.icon}</span> Équipe {team.name}
    </span>
  );
}

/** Résultat personnel sur téléphone : place de la partie, rang de championnat, équipe, icônes. */
export function MyResult({ lobby, playerId }: { lobby: LobbyView; playerId: string }) {
  const result = lobby.lastResult?.ranking.find((r) => r.playerId === playerId);
  const series = lobby.series;
  const standing = series?.standings.find((r) => r.playerId === playerId);
  const teamIndex = lobby.players.find((p) => p.id === playerId)?.team ?? null;
  const team = teamIndex !== null ? series?.teams?.[teamIndex] : undefined;
  const enChampionnat = hasChampionship(lobby.championship);
  // Un jeu sans score (contrôle, bilan) n’a rien à dire ici : pas de cadre vide.
  if (!result && !standing && !team && !(series?.champion && enChampionnat)) return null;
  return (
    <section className="my-result" aria-label="Votre résultat">
      {result && (
        <p className="my-result-line">
          <span role="img" aria-label={rankLabel(result.rank)}>
            {medal(result.rank)}
          </span>{' '}
          {rankLabel(result.rank)} de la partie, {points(result.points)}
        </p>
      )}
      {standing && hasChampionship(lobby.championship) && (
        <p className="my-result-line">
          Championnat : {rankLabel(standing.rank)}, {points(standing.points)}{' '}
          <span className="champ-tier">
            <span aria-hidden="true">{standing.tier.icon}</span> {standing.tier.label}
          </span>
        </p>
      )}
      {team && (
        <p className="my-result-line">
          <span className="team-chip" style={{ '--team': team.color } as CSSProperties}>
            <span aria-hidden="true">{team.icon}</span> Équipe {team.name}
          </span>{' '}
          {points(team.points)}, {rankLabel(team.rank)}
        </p>
      )}
      {/* Badges et champion ne valent que pour un vrai championnat : après une partie unique, ils redisent le rang. */}
      {standing && enChampionnat && <BadgeList badges={standing.badges} />}
      {series?.champion && enChampionnat && (
        <p className="champ-champion">{championText(series.champion, series.teams)}</p>
      )}
    </section>
  );
}
