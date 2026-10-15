import { PLATEAU_TEST_ID, type CharacterMood, type HostRoomView } from '@partyhub/shared';
import { Qr } from '../../components/Qr.js';
import { GameLogo } from '../../components/GameLogo.js';
import { LobbyPlateau } from '../../components/LobbyPlateau.js';
import type { LobbyEmote } from '../../components/useLobbyMoods.js';
import type { LobbyPosition } from '@partyhub/shared';

/**
 * Salon : le logo du jeu en grand, le code pour rejoindre, le plateau des personnages (déplacés
 * depuis leur téléphone, avec leurs émotions) et un seul bouton. Le plateau de test n'a pas de
 * partie : il n'affiche pas de bouton de lancement. Les réglages, la gestion des joueurs et la
 * discussion sont dans le menu.
 */
export function TvLobby({
  lobby,
  joinUrl,
  canStart,
  poses,
  emotes,
  positions,
  onStart,
}: {
  lobby: HostRoomView['lobby'];
  joinUrl: string;
  canStart: boolean;
  poses: Record<string, CharacterMood>;
  emotes: Record<string, LobbyEmote>;
  positions: Record<string, LobbyPosition>;
  onStart: () => void;
}) {
  const connected = lobby.players.filter((p) => p.connected).length;
  const isTest = lobby.game.id === PLATEAU_TEST_ID;
  return (
    <section className="stage-lobby is-wide" aria-label="Salon de la partie">
      <GameLogo gameId={lobby.game.id} name={lobby.game.name} className="stage-logo" />

      {lobby.practice && (
        <p className="stage-note">Entraînement : les robots jouent avec vous. Rien n’est enregistré.</p>
      )}

      <div className="stage-lobby-row">
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
        <LobbyPlateau
          players={lobby.players}
          poses={poses}
          emotes={emotes}
          positions={positions}
          label={isTest ? 'Plateau de test' : 'Salon : les personnages des joueurs'}
        />
      </div>

      <p className="sr-only">{connected} joueur(s) connecté(s)</p>

      {!isTest && (
        <div className="stage-start">
          <button type="button" className="title-option" disabled={!canStart} onClick={onStart}>
            <span className="title-cursor" aria-hidden="true">
              ▸
            </span>
            Lancer la partie
          </button>
          {!canStart && <p className="stage-hint">Il faut au moins {lobby.game.minPlayers} joueur(s) connecté(s).</p>}
        </div>
      )}
      {isTest && (
        <p className="stage-hint">
          Essayez les déplacements : touchez le plateau, ou envoyez une émotion depuis votre téléphone.
        </p>
      )}
    </section>
  );
}
