import { Suspense, useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  PLATEAU_TEST_ID,
  type ChatMessage,
  type LobbyMoodChoice,
  type LobbyPosition,
  type PlayerRoomView,
} from '@partyhub/shared';
import { createSocket, type AppSocket } from '../realtime.js';
import { newId } from '../api.js';
import { viewsFor } from '../games.js';
import { AvatarsContext } from '@partyhub/games/client';
import { PlayerAvatar } from '../components/PlayerAvatar.js';
import { ChatPanel, EmoteBar } from '../components/Social.js';
import { VoiceBar } from './VoiceBar.js';
import { ConnectingNotice } from '../components/ConnectingNotice.js';
import { LobbyHeads, LobbyMoodBar, LobbyPlateau } from '../components/LobbyPlateau.js';
import { TestModeBadge } from '../components/TestModeBadge.js';
import { poseOf, useLobbyMoods } from '../components/useLobbyMoods.js';
import { useLobbyPositions } from '../components/useLobbyPositions.js';
import { NoticeDialog } from '../components/NoticeDialog.js';
import { Qr } from '../components/Qr.js';
import { CornerMenu, DrawerSection } from '../components/CornerMenu.js';
import { getDevice } from '../device/device.js';
import { SHARED_PLACE_PARAM } from './share.js';

/**
 * Un siège : un joueur avec sa propre connexion, son jeton et sa place dans la salle.
 * Un téléphone peut tenir plusieurs sièges (plusieurs joueurs sur le même appareil),
 * et l'écran principal peut en tenir un pour l'hôte qui joue aussi.
 * Le siège se reconnecte tout seul après une coupure grâce au jeton gardé sur l'appareil.
 */

export interface Stored {
  token: string;
  name: string;
}

export const seatStorageKey = (code: string, seatId: string) =>
  seatId === 'main' ? `ph:player:${code}` : `ph:player:${code}:${seatId}`;

export function readSeat(code: string, seatId: string): Stored | null {
  try {
    const raw = localStorage.getItem(seatStorageKey(code, seatId));
    return raw ? (JSON.parse(raw) as Stored) : null;
  } catch {
    return null;
  }
}

/** Enregistre la place (jeton et pseudo) sur cet appareil. */
export function writeSeat(code: string, seatId: string, value: Stored): void {
  try {
    localStorage.setItem(seatStorageKey(code, seatId), JSON.stringify(value));
  } catch {
    // Stockage indisponible : la reconnexion automatique sera désactivée.
  }
}

export function removeSeat(code: string, seatId: string): void {
  try {
    localStorage.removeItem(seatStorageKey(code, seatId));
  } catch {
    /* sans effet */
  }
}

/** Jeton d'hôte gardé par cet onglet pour la salle (transféré depuis l'écran hôte), sans erreur si absent. */
function readHostToken(code: string): string | null {
  try {
    return sessionStorage.getItem(`ph:host:${code}`);
  } catch {
    return null;
  }
}

export interface PlayerSeatProps {
  code: string;
  seatId: string;
  /** Jeton du profil connecté : le siège entre sous ce profil (pseudo et image imposés). */
  profileToken?: string | null;
  profileName?: string | null;
  /** Vue réduite (écran principal) : pas de liste des joueurs dans le salon. */
  compact?: boolean;
  hidden?: boolean;
  /** Options de l'appareil (changer de salle, ajouter un joueur…), rangées dans le tiroir. */
  deviceMenu?: ReactNode;
  onIdentity?: (seatId: string, name: string | null) => void;
  onProfileRejected?: () => void;
}

export function PlayerSeat({
  code,
  seatId,
  profileToken = null,
  profileName = null,
  compact = false,
  hidden = false,
  deviceMenu,
  onIdentity,
  onProfileRejected,
}: PlayerSeatProps) {
  const [socket] = useState<AppSocket>(() => createSocket());
  const emotes = useLobbyMoods(socket);
  const positions = useLobbyPositions(socket);
  const poses = Object.fromEntries(Object.entries(emotes).map(([id, e]) => [id, poseOf(e)]));
  const [joined, setJoined] = useState(false);
  const [view, setView] = useState<PlayerRoomView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [socialError, setSocialError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ended, setEnded] = useState<string | null>(null);
  // Jeton d'hôte de cet appareil (transféré par l'écran hôte) : le siège reste joueur, et ouvre
  // en plus une connexion d'hôte pour lancer la partie depuis ce téléphone.
  const [hostToken, setHostToken] = useState<string | null>(() => readHostToken(code));
  const [hostSocket, setHostSocket] = useState<AppSocket | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);
  const [claimCode, setClaimCode] = useState('');
  const [claimError, setClaimError] = useState<string | null>(null);

  useEffect(() => {
    if (!hostToken || compact) return;
    const hs = createSocket();
    hs.connect();
    setHostSocket(hs);
    hs.emit('host:connect', { code, hostToken }, (res) => setIsHost(res.ok));
    return () => {
      hs.disconnect();
      setHostSocket(null);
      setIsHost(false);
    };
  }, [code, hostToken, compact]);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [name, setName] = useState(() => readSeat(code, seatId)?.name ?? '');
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  useEffect(() => {
    const rejoin = () => {
      const stored = readSeat(code, seatId);
      if (!stored) return;
      socket.emit('player:join', { code, name: stored.name, token: stored.token, device: getDevice() }, (res) => {
        if (res.ok) {
          setJoined(true);
          setError(null);
          setEnded(null);
          onIdentity?.(seatId, stored.name);
        } else {
          // Jeton non reconnu : le siège repart d'un formulaire vierge.
          removeSeat(code, seatId);
          setJoined(false);
          setView(null);
          setError(res.error);
          onIdentity?.(seatId, null);
        }
      });
    };

    const onView = (v: PlayerRoomView) => setView(v);
    const onClosed = (p: { reason: string }) => {
      removeSeat(code, seatId);
      setJoined(false);
      setView(null);
      setEnded(
        p.reason === 'kicked'
          ? 'L’hôte vous a retiré de la salle.'
          : p.reason === 'inactive'
            ? 'La salle a expiré.'
            : 'La salle a été fermée.',
      );
      onIdentity?.(seatId, null);
    };
    const onChat = (m: ChatMessage) => setChat((list) => [...list.slice(-49), m]);

    socket.on('room:player', onView);
    socket.on('room:closed', onClosed);
    socket.on('room:chat', onChat);
    socket.on('connect', rejoin);
    socket.connect();

    return () => {
      socket.off('room:player', onView);
      socket.off('room:closed', onClosed);
      socket.off('room:chat', onChat);
      socket.off('connect', rejoin);
      socket.disconnect();
    };
    // Le siège ne dépend que de la salle et de son identifiant ; les callbacks parents sont stables.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, code, seatId]);

  function join(e?: FormEvent) {
    e?.preventDefault();
    const pseudo = profileToken ? (profileName ?? '') : name.trim();
    if (!profileToken && !pseudo) {
      setError('Entrez un pseudo.');
      return;
    }
    setBusy(true);
    setError(null);
    socket.emit(
      'player:join',
      { code, name: pseudo || 'Joueur', profileToken: profileToken ?? undefined, device: getDevice() },
      (res) => {
        setBusy(false);
        if (!res.ok) {
          if (profileToken) onProfileRejected?.();
          setError(res.error);
          return;
        }
        const finalName = pseudo || profileName || 'Joueur';
        writeSeat(code, seatId, { token: res.token, name: finalName });
        setJoined(true);
        setEnded(null);
        onIdentity?.(seatId, finalName);
      },
    );
  }

  function toggleReady() {
    if (!view) return;
    socket.emit('player:ready', { ready: !view.you.ready }, (res) => {
      if (!res.ok) setError(res.error);
    });
  }

  function leave() {
    socket.emit('player:leave', (res) => {
      if (!res.ok) {
        setError(res.error);
        return;
      }
      removeSeat(code, seatId);
      setJoined(false);
      setView(null);
      onIdentity?.(seatId, null);
    });
  }

  const send = (type: string, payload?: unknown) =>
    new Promise<{ ok: boolean; error?: string }>((resolve) => {
      socket.emit('player:action', { commandId: newId(), type, payload }, (res) =>
        resolve(res.ok ? { ok: true } : { ok: false, error: res.error }),
      );
    });

  function sendChat(text: string) {
    setSocialError(null);
    socket.emit('player:chat', { text }, (res) => {
      if (!res.ok) setSocialError(res.error);
    });
  }

  function sendLobbyMove(position: LobbyPosition) {
    // Les refus de déplacement (débit, fin du salon) ne sont pas affichés : la place revient d'elle-même.
    socket.emit('player:lobby-move', position, () => undefined);
  }

  function sendLobbyMood(choice: LobbyMoodChoice) {
    setSocialError(null);
    socket.emit('player:lobby-mood', choice, (res) => {
      if (!res.ok) setSocialError(res.error);
    });
  }

  function sendReaction(emoji: string) {
    setSocialError(null);
    socket.emit('player:reaction', { emoji }, (res) => {
      if (!res.ok) setSocialError(res.error);
    });
  }

  const wrapper = (children: ReactNode, drawer?: ReactNode) => (
    <section className="seat-panel" hidden={hidden} aria-label={`Joueur, siège ${seatId}`}>
      <CornerMenu open={menuOpen} onOpen={() => setMenuOpen(true)} onClose={closeMenu}>
        {drawer}
        {deviceMenu}
      </CornerMenu>
      {children}
    </section>
  );

  if (ended) {
    return wrapper(
      <div className="card stack">
        <h2>Oups</h2>
        <p>{ended}</p>
      </div>,
    );
  }

  if (!joined || !view) {
    if (joined && !view) {
      return wrapper(<ConnectingNotice />);
    }
    return wrapper(
      <form className="card join-card" onSubmit={join}>
        <h2>{profileToken ? 'Entrer avec mon profil' : `Entrer dans la salle ${code}`}</h2>
        {profileToken ? (
          <p>
            Vous entrez comme <strong>{profileName ?? 'joueur'}</strong>. Votre image et vos statistiques suivent.
          </p>
        ) : (
          <label className="field big-field">
            <span>Votre pseudo</span>
            <input value={name} maxLength={16} autoComplete="nickname" onChange={(e) => setName(e.target.value)} />
          </label>
        )}
        <button type="submit" className="btn primary big" disabled={busy}>
          {busy ? 'Connexion…' : 'Entrer dans la salle'}
        </button>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {!profileToken && <p className="muted small">Aucun compte nécessaire.</p>}
      </form>,
    );
  }

  const { lobby, you, game } = view;
  const inLobby = lobby.status === 'waiting' || lobby.status === 'full';
  const views = viewsFor(lobby.game.id);

  const avatars = Object.fromEntries(lobby.players.map((p) => [p.name, p.avatar]));
  const drawer = (
    <>
      <DrawerSection title="Ce joueur">
        <button
          type="button"
          className="link-btn"
          onClick={() => {
            closeMenu();
            setNoticeOpen(true);
          }}
        >
          Comment jouer
        </button>
        <button type="button" className="link-btn" aria-expanded={shareOpen} onClick={() => setShareOpen((v) => !v)}>
          {shareOpen ? 'Fermer le partage' : 'Jouer ce joueur sur un autre appareil'}
        </button>
        {shareOpen && <SeatShare code={code} seatId={seatId} />}
        <button
          type="button"
          className="link-btn"
          onClick={() => {
            closeMenu();
            leave();
          }}
        >
          Quitter la salle
        </button>
      </DrawerSection>
      <DrawerSection title="Discussion">
        <ChatPanel messages={chat} onSend={sendChat} error={socialError} compact />
      </DrawerSection>
    </>
  );

  /** L'hôte a ouvert « Lancer depuis mon téléphone » sur l'écran : le code donne accès aux commandes d'hôte. */
  function claimHost(e: FormEvent) {
    e.preventDefault();
    setClaimError(null);
    socket.emit('host:claim', { code, handoffCode: claimCode.trim() }, (res) => {
      if (!res.ok) {
        setClaimError(res.error);
        return;
      }
      try {
        sessionStorage.setItem(`ph:host:${code}`, res.hostToken);
      } catch {
        /* sans effet : le jeton reste valable pour cet onglet */
      }
      setClaimOpen(false);
      setClaimCode('');
      setHostToken(res.hostToken);
    });
  }

  function startAsHost() {
    if (!hostSocket) return;
    hostSocket.emit('host:start', (res) => setError(res.ok ? null : res.error));
  }

  /** Commande d'hôte depuis ce téléphone (même règles que l'écran TV : elles passent par la connexion d'hôte). */
  function hostCommand(event: 'host:next' | 'host:end' | 'host:replay' | 'host:addBot') {
    if (!hostSocket) return;
    const done = (res: { ok: true } | { ok: false; error: string }) => setError(res.ok ? null : res.error);
    if (event === 'host:next') hostSocket.emit('host:next', done);
    else if (event === 'host:end') hostSocket.emit('host:end', done);
    else if (event === 'host:replay') hostSocket.emit('host:replay', done);
    else hostSocket.emit('host:addBot', done);
  }

  return wrapper(
    <AvatarsContext.Provider value={avatars}>
      <div className="seat-head">
        <PlayerAvatar avatar={you.avatar} name={you.name} size="md" highlight />
        <span className="name">{you.name}</span>
        <span className="muted small">Salle {lobby.code}</span>
      </div>

      {error && (
        <p className="error" role="alert" onClick={() => setError(null)}>
          {error}
        </p>
      )}

      {inLobby ? (
        <section className="stack">
          <div className="lobby-game">
            <span className="lobby-icon" aria-hidden="true">
              {lobby.game.icon}
            </span>
            <p className="big">{lobby.game.name}</p>
          </div>
          <p className="muted small">
            {lobby.players.length} joueur(s) · {lobby.readyCount} prêt(s)
          </p>
          <button type="button" className={`btn big ${you.ready ? 'ready' : 'primary'}`} onClick={toggleReady}>
            {you.ready ? 'Prêt ! Annuler' : 'Je suis prêt'}
          </button>
          {isHost && lobby.game.id !== PLATEAU_TEST_ID ? (
            <div className="stack host-start">
              <p className="muted small">Vous êtes l’hôte de la salle.</p>
              <button
                type="button"
                className="btn primary big"
                disabled={lobby.players.filter((p) => p.connected).length < lobby.game.minPlayers}
                onClick={startAsHost}
              >
                Lancer la partie
              </button>
              {lobby.players.filter((p) => p.connected).length < lobby.game.minPlayers && (
                <p className="muted small">Il faut au moins {lobby.game.minPlayers} joueur(s) connecté(s).</p>
              )}
              <button
                type="button"
                className="btn small"
                onClick={() => hostCommand('host:addBot')}
                disabled={lobby.players.length >= lobby.maxPlayers}
              >
                Ajouter un robot
              </button>
            </div>
          ) : (
            <p className="muted small">En attente de l’hôte : il lance la partie depuis son écran.</p>
          )}
          {!compact &&
            !isHost &&
            lobby.game.id !== PLATEAU_TEST_ID &&
            (claimOpen ? (
              <form className="stack claim-host" onSubmit={claimHost}>
                <p className="muted small">Entrez le code à 6 chiffres affiché sur l’écran de la salle.</p>
                <label className="field">
                  <span>Code hôte</span>
                  <input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={claimCode}
                    onChange={(e) => setClaimCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  />
                </label>
                {claimError && (
                  <p className="error" role="alert">
                    {claimError}
                  </p>
                )}
                <button type="submit" className="btn primary" disabled={!/^\d{6}$/.test(claimCode)}>
                  Je suis l’hôte
                </button>
                <button type="button" className="link-btn" onClick={() => setClaimOpen(false)}>
                  Annuler
                </button>
              </form>
            ) : (
              <button type="button" className="link-btn" onClick={() => setClaimOpen(true)}>
                Je suis l’hôte de cette salle
              </button>
            ))}
          {lobby.game.id === PLATEAU_TEST_ID ? (
            !compact && (
              <LobbyPlateau
                players={lobby.players}
                poses={poses}
                emotes={emotes}
                positions={positions}
                me={you.id}
                onMove={sendLobbyMove}
                label="Salon : déplacez votre personnage"
              />
            )
          ) : (
            <LobbyHeads players={lobby.players} me={you.id} emotes={emotes} />
          )}
          {!compact && <TestModeBadge />}
          {!compact && <LobbyMoodBar onPick={sendLobbyMood} />}
          <EmoteBar onPick={sendReaction} />
          {!compact && you.profile && <VoiceBar socket={socket} />}
        </section>
      ) : (
        views &&
        game && (
          <section className="stack">
            {isHost && (lobby.status === 'in_game' || lobby.status === 'ended') && (
              <div className="host-bar" role="group" aria-label="Commandes de l’hôte">
                {lobby.status === 'in_game' ? (
                  <>
                    <button type="button" className="btn primary small" onClick={() => hostCommand('host:next')}>
                      Étape suivante
                    </button>
                    <button type="button" className="btn ghost small" onClick={() => hostCommand('host:end')}>
                      Arrêter la partie
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn primary small" onClick={() => hostCommand('host:replay')}>
                    Rejouer avec les mêmes joueurs
                  </button>
                )}
              </div>
            )}
            <Suspense fallback={<p className="muted">Chargement du jeu…</p>}>
              <views.Player
                publicState={game.public}
                playerState={game.player}
                playerId={you.id}
                now={view.now}
                send={send}
              />
            </Suspense>
            <EmoteBar onPick={sendReaction} />
            {!compact && you.profile && <VoiceBar socket={socket} />}
          </section>
        )
      )}

      {noticeOpen && <NoticeDialog game={lobby.game} onClose={() => setNoticeOpen(false)} />}
    </AvatarsContext.Provider>,
    drawer,
  );
}

/**
 * Lien et QR code pour ouvrir la même place sur un deuxième appareil (tablette, téléphone d'un proche).
 * Le jeton est dans le fragment de l'adresse (#place=…) : il n'est jamais envoyé au serveur.
 */
function SeatShare({ code, seatId }: { code: string; seatId: string }) {
  const token = readSeat(code, seatId)?.token ?? null;
  const [copied, setCopied] = useState(false);
  if (!token) return null;
  const url = `${window.location.origin}/j/${code}#${SHARED_PLACE_PARAM}=${token}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="card stack seat-share" aria-label="Partager cette place">
      <p>Ouvrez ce lien ou scannez le QR code sur un autre appareil : vous y jouerez avec la même place.</p>
      <Qr value={url} size={200} />
      <button type="button" className="btn small" onClick={copy}>
        {copied ? 'Lien copié' : 'Copier le lien'}
      </button>
      <p className="muted small">
        Ne partagez ce lien qu’avec une personne de confiance : il donne la main sur cette place.
      </p>
    </section>
  );
}
