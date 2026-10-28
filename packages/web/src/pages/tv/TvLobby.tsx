import { Suspense, lazy } from 'react';
import { PLATEAU_TEST_ID, type HostRoomView } from '@partyhub/shared';
import { Qr } from '../../components/Qr.js';
import { GameLogo } from '../../components/GameLogo.js';
import { LobbyHeads } from '../../components/LobbyPlateau.js';
import { apparencesGrille } from '../../components/LobbyGrille.js';
import { TestModeBadge } from '../../components/TestModeBadge.js';
import type { LobbyEmote } from '../../components/useLobbyMoods.js';

/** Le plateau 3D charge Three.js : il n’est chargé que sur le salon de test. */
const GrilleBoard3D = lazy(() => import('../../three/GrilleBoard3D.js'));

/** Code affiché pour qu’un téléphone devienne l’hôte de la salle (valable quelques minutes, une fois). */
export interface HandoffCode {
  code: string;
  expiresAt: number;
}

/**
 * Salon de l’écran hôte (TV, ordinateur, tablette ou téléphone de l’hôte) : le code pour rejoindre,
 * les joueurs, et le bouton de lancement toujours visible. Le salon de test est un plateau 3D plein écran.
 */
export function TvLobby({
  lobby,
  joinUrl,
  canStart,
  emotes,
  onStart,
  handoff,
  onHandoff,
  onAddBot,
}: {
  lobby: HostRoomView['lobby'];
  joinUrl: string;
  canStart: boolean;
  emotes: Record<string, LobbyEmote>;
  onStart: () => void;
  handoff: HandoffCode | null;
  onHandoff: () => void;
  /** Ajoute un robot (utile pour essayer seul ou compléter une salle). Absent : pas de bouton. */
  onAddBot?: () => void;
}) {
  const connected = lobby.players.filter((p) => p.connected).length;
  if (lobby.game.id === PLATEAU_TEST_ID && lobby.grille) {
    // Le plateau de test prend tout l’écran de la TV ; le code pour rejoindre reste dans un coin.
    return (
      <section className="tv-monde" aria-label="Plateau de test">
        <Suspense fallback={<p className="muted tv-monde-chargement">Chargement du plateau…</p>}>
          <GrilleBoard3D etat={lobby.grille} apparences={apparencesGrille(lobby.players)} label="Plateau de test" />
        </Suspense>
        <div className="tv-monde-info">
          <Qr value={joinUrl} size={132} />
          <div>
            <p className="stage-label">Rejoignez avec votre téléphone</p>
            <p className="tv-monde-code">{lobby.code}</p>
            <TestModeBadge />
          </div>
        </div>
      </section>
    );
  }
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
          <p className="stage-label">
            {connected} joueur(s) connecté(s)
            {lobby.game.minPlayers > 1 ? ` · minimum ${lobby.game.minPlayers}` : ''}
          </p>
          <LobbyHeads players={lobby.players} emotes={emotes} size="lg" />
        </div>
      </div>

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
    </section>
  );
}
