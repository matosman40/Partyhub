import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { CatalogGame, GameCategory } from '@partyhub/shared';
import { api } from '../api.js';
import { ThemeToggle } from '../components/ThemeToggle.js';
import { DeviceChoice } from '../components/DeviceChoice.js';
import { NoticeDialog } from '../components/NoticeDialog.js';
import { CornerMenu, DrawerSection } from '../components/CornerMenu.js';
import { CATEGORY_LABEL, GameRow } from '../components/GameRow.js';
import { useMusicSlot } from '../sounds.js';

export function HomePage() {
  const navigate = useNavigate();
  useMusicSlot('accueil');
  const [games, setGames] = useState<CatalogGame[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<GameCategory | 'all'>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState<CatalogGame | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    api<{ games: CatalogGame[] }>('/api/catalog')
      .then((r) => setGames(r.games))
      .catch((e: Error) => setError(e.message));
  }, []);

  const categories = useMemo(() => {
    const present = new Set((games ?? []).map((g) => g.category));
    return (Object.keys(CATEGORY_LABEL) as GameCategory[]).filter((c) => present.has(c));
  }, [games]);

  const visible = (games ?? []).filter((g) => filter === 'all' || g.category === filter);

  async function createRoom(gameId: string, practice: boolean) {
    setBusy(`${practice ? 'try' : 'create'}:${gameId}`);
    setError(null);
    try {
      const room = await api<{ code: string; hostToken: string }>('/api/rooms', {
        method: 'POST',
        body: JSON.stringify({ gameId, practice }),
      });
      // Le jeton d'hôte reste dans cet onglet : il n'est jamais transmis aux joueurs.
      sessionStorage.setItem(`ph:host:${room.code}`, room.hostToken);
      navigate(`/tv/${room.code}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  return (
    <main className="page home fade-in">
      <CornerMenu open={menuOpen} onOpen={() => setMenuOpen(true)} onClose={() => setMenuOpen(false)}>
        <DrawerSection title="Aller à">
          <nav className="corner-links" aria-label="Navigation">
            <Link to="/join" onClick={() => setMenuOpen(false)}>
              Rejoindre une salle
            </Link>
            <Link to="/profil" onClick={() => setMenuOpen(false)}>
              Mon profil
            </Link>
            <Link to="/admin" onClick={() => setMenuOpen(false)}>
              Administration
            </Link>
            <Link to="/test-appareils" onClick={() => setMenuOpen(false)}>
              Tester micro, caméra, image
            </Link>
          </nav>
        </DrawerSection>
        <DrawerSection title="Préférences">
          <DeviceChoice />
          <ThemeToggle />
        </DrawerSection>
      </CornerMenu>

      <header className="hero">
        <h1 className="brand-title register-in" data-text="PartyHub">
          PartyHub
        </h1>
        <p>Choisissez un jeu, affichez la salle sur l’écran, et chacun rejoint depuis son téléphone.</p>
        <ul className="steps" aria-label="Le principe en trois temps">
          <li>
            <span aria-hidden="true">🖥️</span>
            Ouvrez la salle sur l’écran
          </li>
          <li>
            <span aria-hidden="true">📱</span>
            Rejoignez avec votre téléphone
          </li>
          <li>
            <span aria-hidden="true">🎉</span>
            Jouez ensemble
          </li>
        </ul>
      </header>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {games === null && !error && <p className="muted">Chargement du catalogue…</p>}
      {games?.length === 0 && <p className="notice">Aucun jeu n’est disponible pour le moment.</p>}

      {categories.length > 1 && (
        <nav className="filters" aria-label="Filtrer par catégorie">
          <button
            type="button"
            className={`chip${filter === 'all' ? ' active' : ''}`}
            aria-pressed={filter === 'all'}
            onClick={() => setFilter('all')}
          >
            Tous les jeux
          </button>
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              className={`chip${filter === c ? ' active' : ''}`}
              aria-pressed={filter === c}
              onClick={() => setFilter(c)}
            >
              {CATEGORY_LABEL[c]}
            </button>
          ))}
        </nav>
      )}

      <ul className="game-list" aria-label="Jeux disponibles">
        {visible.map((g) => (
          <GameRow
            key={g.id}
            game={g}
            open={openId === g.id}
            creating={busy === `create:${g.id}`}
            trying={busy === `try:${g.id}`}
            busy={busy !== null}
            onToggle={() => setOpenId(openId === g.id ? null : g.id)}
            onCreate={() => createRoom(g.id, false)}
            onTry={() => createRoom(g.id, true)}
            onNotice={() => setNotice(g)}
          />
        ))}
      </ul>

      {games && games.length > 0 && visible.length === 0 && <p className="muted">Aucun jeu dans cette catégorie.</p>}

      {notice && <NoticeDialog game={notice} onClose={() => setNotice(null)} />}
    </main>
  );
}
