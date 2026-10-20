import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { HomePage } from './pages/HomePage.js';
import { GamePage } from './pages/GamePage.js';
import { JoinPage } from './pages/JoinPage.js';
import { ScreenBackdrop } from './components/ScreenBackdrop.js';
import { MusicPlayer } from './components/MusicPlayer.js';
import { Boundary } from './components/Boundary.js';
import { BackButton } from './components/BackButton.js';
import { SearchProvider } from './nav/SearchProvider.js';
import { CrashScreen } from './components/CrashScreen.js';
import { ProfileGate } from './profile/ProfileGate.js';

/*
 * Pages ouvertes seulement quand on en a besoin : un téléphone qui crée son profil ou rejoint une salle ne
 * télécharge pas le code de l’écran principal, de l’administration ni des pages secondaires.
 */
const TvPage = lazy(() => import('./pages/TvPage.js').then((m) => ({ default: m.TvPage })));
const PlayerPage = lazy(() => import('./pages/PlayerPage.js').then((m) => ({ default: m.PlayerPage })));
const ObserverPage = lazy(() => import('./pages/ObserverPage.js').then((m) => ({ default: m.ObserverPage })));
const ProfilePage = lazy(() => import('./pages/ProfilePage.js').then((m) => ({ default: m.ProfilePage })));
const AdminPage = lazy(() => import('./pages/AdminPage.js').then((m) => ({ default: m.AdminPage })));
const StorePage = lazy(() => import('./pages/StorePage.js').then((m) => ({ default: m.StorePage })));
const DeviceTestPage = lazy(() => import('./pages/DeviceTestPage.js').then((m) => ({ default: m.DeviceTestPage })));
const CertificatePage = lazy(() => import('./pages/CertificatePage.js').then((m) => ({ default: m.CertificatePage })));

function NotFound() {
  return (
    <main className="page center">
      <h1>Page introuvable</h1>
      <BackButton to="/">Retour à l’accueil</BackButton>
    </main>
  );
}

/**
 * Les pages sont protégées une par une : une erreur dans une page affiche l’écran « n’a pas pu
 * s’afficher » au lieu d’un écran noir. La clé par chemin remet la protection à zéro à chaque page.
 */
function RoutedPages() {
  const location = useLocation();
  return (
    <Boundary key={location.pathname} fallback={(error) => <CrashScreen error={error} />}>
      <Suspense
        fallback={
          <main className="page center">
            <p className="muted">Chargement…</p>
          </main>
        }
      >
        <Routes>
          {/* Accueil, saisie du code et téléphone : il faut un profil avant de continuer. */}
          <Route
            path="/"
            element={
              <ProfileGate>
                <HomePage />
              </ProfileGate>
            }
          />
          {/* Fiche d’un jeu : même règle que l’accueil, il faut un profil. */}
          <Route
            path="/jeux/:gameId"
            element={
              <ProfileGate>
                <GamePage />
              </ProfileGate>
            }
          />
          <Route path="/tv/:code" element={<TvPage />} />
          <Route
            path="/join"
            element={
              <ProfileGate>
                <JoinPage />
              </ProfileGate>
            }
          />
          <Route
            path="/j/:code"
            element={
              <ProfileGate>
                <PlayerPage />
              </ProfileGate>
            }
          />
          <Route path="/spectate/:code" element={<ObserverPage />} />
          <Route path="/profil" element={<ProfilePage />} />
          <Route path="/magasin" element={<StorePage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/test-appareils" element={<DeviceTestPage />} />
          <Route path="/certificat" element={<CertificatePage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </Boundary>
  );
}

export function App() {
  return (
    <BrowserRouter>
      {/* Décor et lecteur de musique : une erreur ici ne doit jamais bloquer la page. */}
      <Boundary fallback={null}>
        <ScreenBackdrop />
      </Boundary>
      <Boundary fallback={null}>
        <MusicPlayer />
      </Boundary>
      <SearchProvider>
        <RoutedPages />
      </SearchProvider>
    </BrowserRouter>
  );
}
