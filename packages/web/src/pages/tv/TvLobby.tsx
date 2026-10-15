import type { CharacterMood, HostRoomView } from '@partyhub/shared';
import { Qr } from '../../components/Qr.js';
import { GameLogo } from '../../components/GameLogo.js';
import { LobbyArena } from '../../components/LobbyArena.js';

/**
 * Salon : le logo du jeu en grand, le code pour rejoindre, les personnages des joueurs
 * (déplacés depuis leur téléphone, avec leurs émotions) et un seul bouton. Les réglages,
 * la gestion des joueurs et la discussion sont dans le menu.
 */
export function TvLobby({
  lobby,
  joinUrl,
  canStart,
  moods,
  onStart,
}: {
  lobby: HostRoomView['lobby'];
  joinUrl: string;
  canStart: boolean;
  moods: Record<string, CharacterMood>;
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

      <p className="sr-only">{connected} joueur(s) connecté(s)</p>
      <LobbyArena players={lobby.players} moods={moods} />

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
