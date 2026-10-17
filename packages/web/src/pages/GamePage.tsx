import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import type { CatalogGame } from '@partyhub/shared';
import { api } from '../api.js';
import { BackButton } from '../components/BackButton.js';
import { GameSheet } from '../components/GameSheet.js';
import { launchGame } from '../catalog/launch.js';
import { readRecent } from '../catalog/recentGames.js';
import { loadPhotoIndex, photosFor, type PhotoIndex } from '../catalog/photos.js';
import { useMusicSlot } from '../sounds.js';

const SAME_CATEGORY_LIMIT = 6;

/** Fiche d'un jeu (`/jeux/:gameId`) : charge le catalogue, puis affiche la fiche du jeu demandé. */
export function GamePage() {
  const { gameId = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  useMusicSlot('accueil');
  const [games, setGames] = useState<CatalogGame[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recentIds] = useState<string[]>(() => readRecent());
  const [photoIndex, setPhotoIndex] = useState<PhotoIndex>({ games: {} });

  useEffect(() => {
    let alive = true;
    loadPhotoIndex().then((index) => {
      if (alive) setPhotoIndex(index);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    setGames(null);
    api<{ games: CatalogGame[] }>('/api/catalog')
      .then((r) => setGames(r.games))
      .catch((e: Error) => setLoadError(e.message));
  }, [gameId]);

  const game = useMemo(() => games?.find((g) => g.id === gameId) ?? null, [games, gameId]);

  const sameCategory = useMemo(() => {
    if (!game || !games) return [];
    return games.filter((g) => g.category === game.category && g.id !== game.id).slice(0, SAME_CATEGORY_LIMIT);
  }, [games, game]);

  // Retour : l'historique ramène à la liste avec ses filtres ; une fiche ouverte directement revient à l'accueil.
  function goBack() {
    if (location.key !== 'default') navigate(-1);
    else navigate('/');
  }

  async function launch(practice: boolean) {
    if (!game) return;
    setBusy(practice ? 'try' : 'create');
    setError(null);
    try {
      const code = await launchGame(game.id, practice);
      navigate(`/tv/${code}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  if (loadError) {
    return (
      <main className="page center">
        <p className="error" role="alert">
          {loadError}
        </p>
        <BackButton to="/">Tous les jeux</BackButton>
      </main>
    );
  }

  if (games === null) {
    return (
      <main className="page center">
        <p className="muted">Chargement de la fiche…</p>
      </main>
    );
  }

  if (!game) {
    return (
      <main className="page center">
        <h1>Jeu introuvable</h1>
        <p className="muted">Ce jeu n’existe pas ou n’est plus proposé.</p>
        <BackButton to="/">Tous les jeux</BackButton>
      </main>
    );
  }

  return (
    <main className="page game-page fade-in">
      <div className="sheet-nav">
        <BackButton onClick={goBack}>Tous les jeux</BackButton>
      </div>
      <GameSheet
        game={game}
        recent={recentIds.includes(game.id)}
        sameCategory={sameCategory}
        photos={photosFor(photoIndex, game.id)}
        creating={busy === 'create'}
        trying={busy === 'try'}
        error={error}
        onCreate={() => launch(false)}
        onTry={() => launch(true)}
      />
    </main>
  );
}
