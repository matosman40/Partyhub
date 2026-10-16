import { Suspense, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ChatMessage, ObserverRoomView } from '@partyhub/shared';
import { DEVICE_KIND_ICONS, DEVICE_KIND_LABELS } from '@partyhub/shared';
import { createSocket, type AppSocket } from '../realtime.js';
import { viewsFor } from '../games.js';
import { AvatarsContext } from '@partyhub/games/client';
import { FitStage } from '../components/FitStage.js';
import { Boundary } from '../components/Boundary.js';
import { BackButton } from '../components/BackButton.js';
import { ChatPanel, EmoteBar, ReactionLayer } from '../components/Social.js';
import { NoticeDialog } from '../components/NoticeDialog.js';
import { PlayerAvatar } from '../components/PlayerAvatar.js';
import { PlayerSeat } from '../seat/PlayerSeat.js';
import { getDevice } from '../device/device.js';
import { useDevice } from '../device/useDevice.js';

/**
 * Spectateur : regarde le plateau sans jouer (aucune action de jeu, aucun secret de l'hôte).
 * Sur tablette, ordinateur ou TV, on peut aussi « jouer » à côté : la manette s'ouvre dans
 * une colonne, avec sa propre connexion, pendant que le plateau reste visible.
 */
export function ObserverPage() {
  const { code: rawCode = '' } = useParams();
  const code = rawCode.toUpperCase();
  const device = useDevice();

  const [socket] = useState<AppSocket>(() => createSocket());
  const [view, setView] = useState<ObserverRoomView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closed, setClosed] = useState<string | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [chatError, setChatError] = useState<string | null>(null);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const join = () => {
      socket.emit('observer:join', { code, device: getDevice() }, (res) => {
        setError(res.ok ? null : res.error);
      });
    };
    const onView = (v: ObserverRoomView) => setView(v);
    const onClosed = (p: { reason: string }) =>
      setClosed(
        p.reason === 'kicked'
          ? 'L’hôte a mis fin à votre présence dans la salle.'
          : p.reason === 'inactive'
            ? 'La salle a expiré après une longue inactivité.'
            : 'La salle a été fermée.',
      );
    const onChat = (m: ChatMessage) => setChat((list) => [...list.slice(-49), m]);

    socket.on('room:observer', onView);
    socket.on('room:closed', onClosed);
    socket.on('room:chat', onChat);
    socket.on('connect', join);
    socket.connect();

    return () => {
      socket.off('room:observer', onView);
      socket.off('room:closed', onClosed);
      socket.off('room:chat', onChat);
      socket.off('connect', join);
      socket.disconnect();
    };
  }, [socket, code]);

  if (closed) {
    return (
      <main className="page center fade-in">
        <h1>{closed}</h1>
        <Link className="btn primary" to="/join">
          Rejoindre une autre salle
        </Link>
      </main>
    );
  }

  if (!view) {
    return (
      <main className="page center">
        <p>{error ?? 'Connexion à la salle…'}</p>
      </main>
    );
  }

  const { lobby, game } = view;
  const views = viewsFor(lobby.game.id);
  const inLobby = lobby.status === 'waiting' || lobby.status === 'full';
  const avatars = Object.fromEntries(lobby.players.map((p) => [p.name, p.avatar]));
  const sideBySide = device.kind !== 'phone';

  function sendChat(text: string) {
    setChatError(null);
    socket.emit('observer:chat', { text }, (res) => {
      if (!res.ok) setChatError(res.error);
    });
  }

  function sendReaction(emoji: string) {
    setChatError(null);
    socket.emit('observer:reaction', { emoji }, (res) => {
      if (!res.ok) setChatError(res.error);
    });
  }

  const board = inLobby ? (
    <section className="card stack observer-waiting" aria-label="Salon">
      <h2>En attente de la partie</h2>
      <p className="muted">
        {lobby.game.name} · {lobby.players.length}/{lobby.maxPlayers} joueur(s)
      </p>
      <ul className="players">
        {lobby.players.map((p) => (
          <li key={p.id}>
            <PlayerAvatar avatar={p.avatar} name={p.name} size="sm" />
            <span className="name">{p.name}</span>
            {p.devices.length > 0 && (
              <span className="device-icons" aria-label={p.devices.map((d) => DEVICE_KIND_LABELS[d]).join(', ')}>
                {p.devices.map((d) => DEVICE_KIND_ICONS[d]).join(' ')}
              </span>
            )}
            {p.ready && <span className="badge ready">Prêt</span>}
          </li>
        ))}
        {lobby.players.length === 0 && <li className="muted">Aucun joueur pour l’instant.</li>}
      </ul>
    </section>
  ) : (
    <FitStage>
      {views && game && (
        <Suspense fallback={<p className="muted">Chargement du jeu…</p>}>
          <Boundary fallback={<p className="muted">Ce plateau ne peut pas s’afficher ici.</p>}>
            {/* Pas d'état d'hôte : le spectateur ne voit jamais les réponses secrètes ni les rôles cachés. */}
            <views.Host publicState={game.public} hostState={null} now={view.now} />
          </Boundary>
        </Suspense>
      )}
    </FitStage>
  );

  return (
    <AvatarsContext.Provider value={avatars}>
      <main className={`observer-page fade-in${sideBySide ? ' is-wide' : ''}`}>
        <ReactionLayer socket={socket} />

        <header className="tv-top">
          <div className="brand">
            <span aria-hidden="true">{lobby.game.icon}</span> {lobby.game.name}
          </div>
          <div className="room-code">
            Salle <strong>{lobby.code}</strong>
          </div>
          <div className="page-nav">
            <BackButton to="/">Quitter</BackButton>
            <span className="muted small" aria-live="polite">
              {lobby.observers.count} spectateur(s)
              {lobby.observers.devices.length > 0 && (
                <span className="device-icons">
                  {' '}
                  {lobby.observers.devices.map((d) => DEVICE_KIND_ICONS[d]).join(' ')}
                </span>
              )}
            </span>
            <button type="button" className="btn ghost" onClick={() => setNoticeOpen(true)}>
              Comment jouer
            </button>
          </div>
        </header>

        {error && (
          <p className="error" role="alert" onClick={() => setError(null)}>
            {error}
          </p>
        )}

        <div className={`observer-layout${playing ? ' with-seat' : ''}`}>
          <div className="observer-board">
            {board}
            <div className="observer-actions">
              <button
                type="button"
                className={`btn ${playing ? 'ghost' : 'primary'}`}
                aria-pressed={playing}
                onClick={() => setPlaying((v) => !v)}
              >
                {playing ? 'Arrêter de jouer' : 'Je joue aussi'}
              </button>
            </div>
          </div>

          <aside className="observer-side" aria-label="Discussion et manette">
            {playing && (
              <section className="stack" aria-label="Ma manette">
                <h2>Ma manette</h2>
                <PlayerSeat code={lobby.code} seatId="board" compact />
              </section>
            )}
            <section className="card stack">
              <h2>Discussion</h2>
              <ChatPanel messages={chat} onSend={sendChat} error={chatError} compact />
              <EmoteBar onPick={sendReaction} />
            </section>
          </aside>
        </div>

        {noticeOpen && <NoticeDialog game={lobby.game} onClose={() => setNoticeOpen(false)} />}
      </main>
    </AvatarsContext.Provider>
  );
}
