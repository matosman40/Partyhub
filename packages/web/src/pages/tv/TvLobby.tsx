import type { HostRoomView } from '@partyhub/shared';
import { Qr } from '../../components/Qr.js';
import { PlayerAvatar } from '../../components/PlayerAvatar.js';
import { GameLogo } from '../../components/GameLogo.js';

/**
 * Salon : le logo du jeu en grand, le code pour rejoindre, les personnages des joueurs
 * et un seul bouton. Les réglages, la gestion des joueurs et la discussion sont dans le menu.
 */
export function TvLobby({
  lobby,
  joinUrl,
  canStart,
  onStart,
}: {
  lobby: HostRoomView['lobby'];
  joinUrl: string;
  canStart: boolean;
  onStart: () => void;
}) {
  const connected = lobby.players.filter((p) => p.connected).length;
  return (
    <section className="stage-lobby" aria-label="Salon de la partie">
      <GameLogo gameId={lobby.game.id} name={lobby.game.name} className="stage-logo" />

      {lobby.practice && (
        <p className="stage-note">Entraînement : les robots jouent avec vous. Rien n’est enregistré.</p>
      )}

      <div className="stage-join">
        <div className="stage-qr">
          <Qr value={joinUrl} size={360} />
        </div>
        <div className="stage-code">
          <p className="stage-label">Rejoignez avec votre téléphone</p>
          <p className="stage-code-big">{lobby.code}</p>
          <p className="stage-hint">ou ouvrez {joinUrl.replace(/^https?:\/\//, '')}</p>
        </div>
      </div>

      <ol className="stage-players" aria-label={`Joueurs : ${connected} connecté(s)`}>
        {lobby.players.map((p) => (
          <li key={p.id} className={`stage-player${p.connected ? '' : ' is-away'}`}>
            <PlayerAvatar avatar={p.avatar} name={p.name} size="lg" />
            <span className="stage-player-name">{p.name}</span>
            {p.bot && <span className="stage-player-tag">robot</span>}
            {p.ready && <span className="stage-player-tag is-ready">prêt</span>}
          </li>
        ))}
        {lobby.players.length === 0 && <li className="stage-empty">En attente des premiers joueurs…</li>}
      </ol>

      <div className="stage-start">
        <button type="button" className="title-option" disabled={!canStart} onClick={onStart}>
          <span className="title-cursor" aria-hidden="true">
            ▸
          </span>
          Lancer la partie
        </button>
        {!canStart && <p className="stage-hint">Il faut au moins {lobby.game.minPlayers} joueur(s) connecté(s).</p>}
      </div>
    </section>
  );
}
