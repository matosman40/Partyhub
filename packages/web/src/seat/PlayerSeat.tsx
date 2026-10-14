import { Suspense, useEffect, useState, type FormEvent } from 'react';
import type { ChatMessage, PlayerRoomView } from '@partyhub/shared';
import { createSocket, type AppSocket } from '../realtime.js';
import { newId } from '../api.js';
import { viewsFor } from '../games.js';
import { AvatarsContext } from '@partyhub/games/client';
import { PlayerAvatar } from '../components/PlayerAvatar.js';
import { ChatPanel, EmoteBar } from '../components/Social.js';
import { NoticeDialog } from '../components/NoticeDialog.js';
import { Qr } from '../components/Qr.js';
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

export interface PlayerSeatProps {
  code: string;
  seatId: string;
  /** Jeton du profil connecté : le siège entre sous ce profil (pseudo et image imposés). */
  profileToken?: string | null;
  profileName?: string | null;
  /** Vue réduite (écran principal) : pas de liste des joueurs dans le salon. */
  compact?: boolean;
  hidden?: boolean;
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
  onIdentity,
  onProfileRejected,
}: PlayerSeatProps) {
  const [socket] = useState<AppSocket>(() => createSocket());
  const [joined, setJoined] = useState(false);
  const [view, setView] = useState<PlayerRoomView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [socialError, setSocialError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ended, setEnded] = useState<string | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [name, setName] = useState(() => readSeat(code, seatId)?.name ?? '');
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

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

  function sendReaction(emoji: string) {
    setSocialError(null);
    socket.emit('player:reaction', { emoji }, (res) => {
      if (!res.ok) setSocialError(res.error);
    });
  }

  const wrapper = (children: React.ReactNode) => (
    <section className="seat-panel" hidden={hidden} aria-label={`Joueur, siège ${seatId}`}>
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
      return wrapper(<p className="muted">Connexion à la salle…</p>);
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
            <input
              value={name}
              maxLength={16}
              autoComplete="nickname"
              onChange={(e) => setName(e.target.value)}
            />
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
  return wrapper(
    <AvatarsContext.Provider value={avatars}>
      <div className="seat-head">
        <PlayerAvatar avatar={you.avatar} name={you.name} size="md" highlight />
        <span className="name">{you.name}</span>
        <span className="muted small">Salle {lobby.code}</span>
      </div>

      <button type="button" className="link-btn small" aria-expanded={shareOpen} onClick={() => setShareOpen((v) => !v)}>
        {shareOpen ? 'Fermer le partage' : 'Jouer ce joueur sur un autre appareil'}
      </button>
      {shareOpen && <SeatShare code={code} seatId={seatId} />}

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
            <div>
              <p className="big">{lobby.game.name}</p>
              <p className="muted small">{lobby.game.description}</p>
            </div>
          </div>
          <button type="button" className="link-btn" onClick={() => setNoticeOpen(true)}>
            Comment jouer
          </button>
          <p>
            {lobby.players.length} joueur(s) · {lobby.readyCount} prêt(s)
          </p>
          <button type="button" className={`btn big ${you.ready ? 'ready' : 'primary'}`} onClick={toggleReady}>
            {you.ready ? 'Prêt ! Annuler' : 'Je suis prêt'}
          </button>
          <p className="muted">Patientez : l’hôte lance la partie depuis l’écran principal.</p>
          {!compact && (
            <ul className="chips" aria-label="Joueurs de la salle">
              {lobby.players.map((p) => (
                <li key={p.id} className={p.ready ? 'chip ready' : 'chip'}>
                  <PlayerAvatar avatar={p.avatar} name={p.name} size="sm" />
                  {p.name}
                </li>
              ))}
            </ul>
          )}
          <EmoteBar onPick={sendReaction} />
          <ChatPanel messages={chat} onSend={sendChat} error={socialError} compact />
          <button type="button" className="link-btn" onClick={leave}>
            Quitter la salle
          </button>
        </section>
      ) : (
        views &&
        game && (
          <section className="stack">
            <button type="button" className="link-btn small" onClick={() => setNoticeOpen(true)}>
              Comment jouer
            </button>
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
            <details className="card">
              <summary className="big small">Discussion</summary>
              <ChatPanel messages={chat} onSend={sendChat} error={socialError} compact />
            </details>
          </section>
        )
      )}

      {noticeOpen && <NoticeDialog game={lobby.game} onClose={() => setNoticeOpen(false)} />}
    </AvatarsContext.Provider>,
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
      <p>
        Ouvrez ce lien ou scannez le QR code sur un autre appareil : vous y jouerez avec la même place.
      </p>
      <Qr value={url} size={200} />
      <button type="button" className="btn small" onClick={copy}>
        {copied ? 'Lien copié' : 'Copier le lien'}
      </button>
      <p className="muted small">Ne partagez ce lien qu’avec une personne de confiance : il donne la main sur cette place.</p>
    </section>
  );
}
