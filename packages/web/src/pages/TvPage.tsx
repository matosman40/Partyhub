import { Suspense, lazy, useEffect, useState, type CSSProperties } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { ChatMessage, HostRoomView } from '@partyhub/shared';
import { DEVICE_KIND_ICONS, DEVICE_KIND_LABELS } from '@partyhub/shared';
import { getSocket } from '../realtime.js';
import { viewsFor } from '../games.js';
import { PlayerAvatar } from '../components/PlayerAvatar.js';
import { GameLogo } from '../components/GameLogo.js';
import { GameScene } from '../components/GameScene.js';
import { logoFor } from '../components/gameLogos.js';
import { useArrivalMoods } from '../components/useArrivalMoods.js';
import { ChatPanel, EmoteBar, ReactionLayer } from '../components/Social.js';
import { NoticeDialog } from '../components/NoticeDialog.js';
import { PlayerSeat } from '../seat/PlayerSeat.js';
import { FitStage } from '../components/FitStage.js';
import { Boundary } from '../components/Boundary.js';
import { read3DPreference, supportsWebGL, write3DPreference } from '../three/prefs.js';
import { AvatarsContext, MoodsContext, useWakeLock, type PromoteurPub } from '@partyhub/games/client';
import { TvLobby } from './tv/TvLobby.js';
import { CornerMenu, DrawerSection } from '../components/CornerMenu.js';
import { useActivity } from './tv/useActivity.js';

/** Plateau 3D du Promoteur : chargé seulement quand il est affiché (Three.js reste hors du premier chargement). */
const PromoteurStage = lazy(() => import('../three/PromoteurStage.js'));

/**
 * Écran principal (TV ou ordinateur) : salon avec QR code, puis affichage de la partie.
 * Le socket s'authentifie avec le jeton d'hôte gardé dans cet onglet.
 * L'hôte peut aussi jouer depuis cet écran (« Je joue aussi ») et ajouter des robots.
 */
export function TvPage() {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const hostToken = sessionStorage.getItem(`ph:host:${code}`);

  const [view, setView] = useState<HostRoomView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closed, setClosed] = useState<string | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [chatError, setChatError] = useState<string | null>(null);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [board3d, setBoard3d] = useState(read3DPreference);
  const [board3dFailed, setBoard3dFailed] = useState(false);
  // Personnages qui viennent d'arriver saluent ; un jeu qui fournit ses propres humeurs les remplace.
  const arrivals = useArrivalMoods(view ? view.lobby.players.map((p) => p.name) : []);
  // Menu discret et commandes de partie : elles reviennent au moindre mouvement, puis s'effacent.
  const [menuOpen, setMenuOpen] = useState(false);
  const [barFocused, setBarFocused] = useState(false);
  const active = useActivity(menuOpen || barFocused);

  // Mise en page « console » : l'écran tient exactement dans la fenêtre (voir styles.css).
  useEffect(() => {
    document.documentElement.classList.add('is-tv');
    return () => document.documentElement.classList.remove('is-tv');
  }, []);

  // L'écran de la salle reste allumé pendant toute la session (si le navigateur le permet).
  useWakeLock(hostToken !== null && !closed);

  useEffect(() => {
    if (!hostToken) return;
    const socket = getSocket();

    const authenticate = () => {
      socket.emit('host:connect', { code, hostToken }, (res) => {
        if (res.ok) setError(null);
        else setError(res.error);
      });
    };
    const onView = (v: HostRoomView) => setView(v);
    const onClosed = (p: { reason: string }) =>
      setClosed(p.reason === 'inactive' ? 'La salle a expiré après une longue inactivité.' : 'La salle a été fermée.');
    const onChat = (m: ChatMessage) => setChat((list) => [...list.slice(-49), m]);
    const onConnect = () => authenticate();

    socket.on('room:host', onView);
    socket.on('room:closed', onClosed);
    socket.on('room:chat', onChat);
    socket.on('connect', onConnect);
    if (socket.connected) authenticate();

    return () => {
      socket.off('room:host', onView);
      socket.off('room:closed', onClosed);
      socket.off('room:chat', onChat);
      socket.off('connect', onConnect);
    };
  }, [code, hostToken]);

  if (!hostToken) {
    return (
      <main className="page center fade-in">
        <h1>Salle indisponible sur cet appareil</h1>
        <p>Cette salle a été créée depuis un autre écran. Créez une nouvelle partie depuis l’accueil.</p>
        <Link className="btn primary" to="/">
          Accueil
        </Link>
      </main>
    );
  }

  if (closed) {
    return (
      <main className="page center fade-in">
        <h1>{closed}</h1>
        <Link className="btn primary" to="/">
          Retour au catalogue
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
  const canStart = lobby.players.filter((p) => p.connected).length >= lobby.game.minPlayers;
  const joinUrl = `${window.location.origin}/j/${lobby.code}`;
  const spectateUrl = `${window.location.origin}/spectate/${lobby.code}`;
  const socket = getSocket();
  // Avatars de la salle par pseudo : les jeux affichent photo ou emoji sans rien transmettre de plus.
  const avatars = Object.fromEntries(lobby.players.map((p) => [p.name, p.avatar]));
  // Plateau du Promoteur : vue 3D par défaut quand le navigateur sait l'afficher, 2D sinon ou en cas d'erreur.
  const can3d = lobby.game.id === 'promoteur' && !board3dFailed && supportsWebGL();
  const use3d = can3d && board3d;
  const flat = (
    <FitStage>
      {views && game && (
        <Suspense fallback={<p className="muted">Chargement du jeu…</p>}>
          <views.Host publicState={game.public} hostState={game.host} now={view.now} />
        </Suspense>
      )}
    </FitStage>
  );
  const sky = logoFor(lobby.game.id, lobby.game.name).sky;
  const skyStyle = { '--sky-a': sky[0], '--sky-b': sky[1] } as CSSProperties;

  function emitAck(event: 'host:start' | 'host:next' | 'host:end' | 'host:replay') {
    const done = (res: { ok: true } | { ok: false; error: string }) => setError(res.ok ? null : res.error);
    if (event === 'host:start') socket.emit('host:start', done);
    else if (event === 'host:next') socket.emit('host:next', done);
    else if (event === 'host:end') socket.emit('host:end', done);
    else socket.emit('host:replay', done);
  }

  function configure(gameSettings: Record<string, unknown>) {
    socket.emit('host:configure', { gameSettings }, (res) => {
      if (!res.ok) setError(res.error);
    });
  }

  function kick(playerId: string) {
    socket.emit('host:kick', { playerId }, (res) => {
      if (!res.ok) setError(res.error);
    });
  }

  function addBot() {
    socket.emit('host:addBot', (res) => {
      if (!res.ok) setError(res.error);
    });
  }

  function removeBot(playerId: string) {
    socket.emit('host:removeBot', { playerId }, (res) => {
      if (!res.ok) setError(res.error);
    });
  }

  function sendChat(text: string) {
    setChatError(null);
    socket.emit('host:chat', { text }, (res) => {
      if (!res.ok) setChatError(res.error);
    });
  }

  function sendReaction(emoji: string) {
    setChatError(null);
    socket.emit('host:reaction', { emoji }, (res) => {
      if (!res.ok) setChatError(res.error);
    });
  }

  function toggle3d() {
    const next = !board3d;
    setBoard3d(next);
    write3DPreference(next);
  }

  function backToCatalog() {
    socket.emit('host:close', () => {
      sessionStorage.removeItem(`ph:host:${code}`);
      navigate('/');
    });
  }

  function closeMenu() {
    setMenuOpen(false);
  }

  const menu = (
    <>
      <DrawerSection title="Salle">
        <p className="corner-line">
          Code <strong>{lobby.code}</strong>
        </p>
        <p className="corner-line muted small">Joueurs : {joinUrl}</p>
        <p className="corner-line muted small">Spectateurs : {spectateUrl}</p>
      </DrawerSection>

      {inLobby && (
        <DrawerSection title={`Joueurs (${lobby.players.length}/${lobby.maxPlayers})`}>
          <p className="muted small">
            {lobby.readyCount} prêt(s) · minimum {lobby.game.minPlayers}
            {lobby.observers.count > 0 && <> · {lobby.observers.count} spectateur(s)</>}
          </p>
          <ul className="corner-players">
            {lobby.players.map((p) => (
              <li key={p.id}>
                <PlayerAvatar avatar={p.avatar} name={p.name} size="sm" />
                <span className="corner-name">{p.name}</span>
                {p.devices.length > 0 && (
                  <span className="device-icons" title={p.devices.map((d) => DEVICE_KIND_LABELS[d]).join(', ')}>
                    {p.devices.map((d) => DEVICE_KIND_ICONS[d]).join(' ')}
                  </span>
                )}
                {p.bot ? (
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => removeBot(p.id)}
                    aria-label={`Retirer le robot ${p.name}`}
                  >
                    Retirer
                  </button>
                ) : (
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => kick(p.id)}
                    aria-label={`Retirer ${p.name}`}
                  >
                    Retirer
                  </button>
                )}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="btn small"
            onClick={addBot}
            disabled={lobby.players.length >= lobby.maxPlayers}
          >
            Ajouter un robot
          </button>
        </DrawerSection>
      )}

      {inLobby && views && (
        <DrawerSection title="Réglages du jeu">
          <Suspense fallback={<p className="muted">Chargement des réglages…</p>}>
            <views.Settings
              settings={lobby.gameSettings}
              disabled={false}
              onChange={configure}
              bounds={lobby.game.settingsBounds}
            />
          </Suspense>
        </DrawerSection>
      )}

      {can3d && game && (
        <DrawerSection title="Affichage">
          <button type="button" className="btn ghost small" onClick={toggle3d} aria-pressed={board3d}>
            {board3d ? 'Passer en vue 2D' : 'Passer en vue 3D'}
          </button>
        </DrawerSection>
      )}

      <DrawerSection title="Discussion">
        <ChatPanel messages={chat} onSend={sendChat} error={chatError} />
        <EmoteBar onPick={sendReaction} />
      </DrawerSection>

      <DrawerSection title="Jouer depuis cet écran">
        <p className="muted small">Prenez une manette sur cet écran pour jouer avec les autres.</p>
        <PlayerSeat code={lobby.code} seatId="tv" compact />
      </DrawerSection>

      <div className="corner-actions">
        <button
          type="button"
          className="btn ghost small"
          onClick={() => {
            closeMenu();
            setNoticeOpen(true);
          }}
        >
          Comment jouer
        </button>
        <button type="button" className="btn ghost small" onClick={backToCatalog}>
          Retour au catalogue
        </button>
      </div>
    </>
  );

  return (
    <AvatarsContext.Provider value={avatars}>
      <MoodsContext.Provider value={arrivals}>
        <main className={`stage ${inLobby ? 'is-lobby' : 'is-game'}`} style={skyStyle}>
          <GameScene
            gameId={lobby.game.id}
            name={lobby.game.name}
            className={`stage-scene${inLobby ? '' : ' is-quiet'}`}
          />
          <ReactionLayer socket={socket} />

          {error && (
            <p className="stage-toast" role="alert" onClick={() => setError(null)}>
              {error}
            </p>
          )}

          {inLobby ? (
            <TvLobby lobby={lobby} joinUrl={joinUrl} canStart={canStart} onStart={() => emitAck('host:start')} />
          ) : (
            <>
              <div className={`stage-mini${active ? ' is-visible' : ''}`} aria-hidden={!active}>
                <GameLogo gameId={lobby.game.id} name={lobby.game.name} className="stage-mini-logo" />
                <span>Salle {lobby.code}</span>
              </div>

              <div className="stage-game">
                {use3d && game?.public ? (
                  <Boundary fallback={flat} onError={() => setBoard3dFailed(true)}>
                    <Suspense fallback={flat}>
                      <PromoteurStage pub={game.public as PromoteurPub} now={view.now} flat={flat} />
                    </Suspense>
                  </Boundary>
                ) : (
                  flat
                )}
              </div>

              <div
                className={`stage-bar${active ? ' is-visible' : ''}`}
                onFocus={() => setBarFocused(true)}
                onBlur={() => setBarFocused(false)}
              >
                {lobby.status === 'in_game' && (
                  <>
                    <button type="button" className="btn primary" onClick={() => emitAck('host:next')}>
                      Étape suivante
                    </button>
                    <button type="button" className="btn ghost" onClick={() => emitAck('host:end')}>
                      Arrêter la partie
                    </button>
                  </>
                )}
                {lobby.status === 'ended' && (
                  <>
                    <button type="button" className="btn primary" onClick={() => emitAck('host:replay')}>
                      Rejouer avec les mêmes joueurs
                    </button>
                    <button type="button" className="btn ghost" onClick={backToCatalog}>
                      Retour au catalogue
                    </button>
                  </>
                )}
              </div>
            </>
          )}

          <CornerMenu open={menuOpen} visible={active} onOpen={() => setMenuOpen(true)} onClose={closeMenu}>
            {menu}
          </CornerMenu>

          {noticeOpen && <NoticeDialog game={lobby.game} onClose={() => setNoticeOpen(false)} />}
        </main>
      </MoodsContext.Provider>
    </AvatarsContext.Provider>
  );
}
