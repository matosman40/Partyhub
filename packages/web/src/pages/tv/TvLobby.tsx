import { PLATEAU_TEST_ID, type CharacterMood, type HostRoomView } from '@partyhub/shared';
import type { LobbyPosition } from '@partyhub/shared';
import { Qr } from '../../components/Qr.js';
import { GameLogo } from '../../components/GameLogo.js';
import { LobbyHeads, LobbyPlateau } from '../../components/LobbyPlateau.js';
import { TestModeBadge } from '../../components/TestModeBadge.js';
import type { LobbyEmote } from '../../components/useLobbyMoods.js';

/** Code affiché pour qu'un téléphone devienne l'hôte de la salle (valable quelques minutes, une fois). */
export interface HandoffCode {
  code: string;
  expiresAt: number;
}

/**
 * Salon de l'écran hôte (TV, ordinateur, tablette ou téléphone de l'hôte) : le code pour rejoindre,
 * les joueurs, et le bouton de lancement toujours visible. Le plateau de test garde son décor.
 */
export function TvLobby({
  lobby,
  joinUrl,
  canStart,
  poses,
  emotes,
  positions,
  onStart,
  handoff,
  onHandoff,
  onAddBot,
}: {
  lobby: HostRoomView['lobby'];
  joinUrl: string;
  canStart: boolean;
  poses: Record<string, CharacterMood>;
  emotes: Record<string, LobbyEmote>;
  positions: Record<string, LobbyPosition>;
  onStart: () => void;
  handoff: HandoffCode | null;
  onHandoff: () => void;
  /** Ajoute un robot (utile pour essayer seul ou compléter une salle). Absent : pas de bouton. */
  onAddBot?: () => void;
}) {
  const connected = lobby.players.filter((p) => p.connected).length;
  const isTest = lobby.game.id === PLATEAU_TEST_ID;
  return (
    <section className="stage-lobby" aria-label="Salon de la partie">
      <GameLogo gameId={lobby.game.id} name={lobby.game.name} className="stage-logo" />

      {lobby.practice && (
        <p className="stage-note">Entraînement : les robots jouent avec vous. Rien n’est enregistré.</p>
      )}

      <div className="stage-lobby-main">
        <div className="stage-join">
          <div className="stage-qr">
            <Qr value={joinUrl} size={240} />
          </div>
          <div className="stage-code">
            <p className="stage-label">Rejoignez avec votre téléphone</p>
            <p className="stage-code-big">{lobby.code}</p>
            <p className="stage-hint">ou ouvrez {joinUrl.replace(/^https?:\/\//, '')}</p>
          </div>
        </div>

        <TestModeBadge />
        <div className="stage-people">
          {isTest ? (
            <LobbyPlateau
              players={lobby.players}
              poses={poses}
              emotes={emotes}
              positions={positions}
              label="Plateau de test"
            />
          ) : (
            <>
              <p className="stage-label">
                {connected} joueur(s) connecté(s)
                {lobby.game.minPlayers > 1 ? ` · minimum ${lobby.game.minPlayers}` : ''}
              </p>
              <LobbyHeads players={lobby.players} emotes={emotes} size="lg" />
            </>
          )}
        </div>
      </div>

      {!isTest && (
        <div className="stage-start">
          <button type="button" className="stage-launch" disabled={!canStart} onClick={onStart}>
            Lancer la partie
          </button>
          {!canStart && (
            <p className="stage-hint">Il faut au moins {lobby.game.minPlayers} joueur(s) connecté(s) pour lancer.</p>
          )}
          {onAddBot && lobby.players.length < lobby.maxPlayers && (
            <button type="button" className="link-btn" onClick={onAddBot}>
              Ajouter un robot
            </button>
          )}
        </div>
      )}

      {!isTest && (
        <div className="stage-handoff">
          {handoff ? (
            <>
              <p className="stage-label">
                Sur votre téléphone : ouvrez la salle, touchez « Je suis l’hôte », puis entrez
              </p>
              <p className="stage-handoff-code">
                {handoff.code.slice(0, 3)} {handoff.code.slice(3)}
              </p>
              <p className="stage-hint">
                Valable jusqu’à{' '}
                {new Date(handoff.expiresAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}, une
                seule fois.
              </p>
              <button type="button" className="link-btn" onClick={onHandoff}>
                Nouveau code
              </button>
            </>
          ) : (
            <button type="button" className="link-btn" onClick={onHandoff}>
              Lancer depuis mon téléphone (je suis l’hôte)
            </button>
          )}
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
