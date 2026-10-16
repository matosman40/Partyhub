import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AdminPage } from './pages/AdminPage.js';
import { HomePage } from './pages/HomePage.js';
import { JoinPage } from './pages/JoinPage.js';
import { ObserverPage } from './pages/ObserverPage.js';
import { PlayerPage } from './pages/PlayerPage.js';
import { ProfilePage } from './pages/ProfilePage.js';
import { DeviceTestPage } from './pages/DeviceTestPage.js';
import { TvPage } from './pages/TvPage.js';
import { ScreenBackdrop } from './components/ScreenBackdrop.js';
import { MusicPlayer } from './components/MusicPlayer.js';
import { Boundary } from './components/Boundary.js';
import { BackButton } from './components/BackButton.js';
import { CrashScreen } from './components/CrashScreen.js';

function NotFound() {
  return (
    <main className="page center">
      <h1>Page introuvable</h1>
      <BackButton to="/">Retour à l’accueil</BackButton>
    </main>
  );
}

/**
 * Les pages sont protégées une par une : une erreur dans une page affiche l'écran « n'a pas pu
 * s'afficher » au lieu d'un écran noir. La clé par chemin remet la protection à zéro à chaque page.
 */
function RoutedPages() {
  const location = useLocation();
  return (
    <Boundary key={location.pathname} fallback={(error) => <CrashScreen error={error} />}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/tv/:code" element={<TvPage />} />
        <Route path="/join" element={<JoinPage />} />
        <Route path="/j/:code" element={<PlayerPage />} />
        <Route path="/spectate/:code" element={<ObserverPage />} />
        <Route path="/profil" element={<ProfilePage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/test-appareils" element={<DeviceTestPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
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
      <RoutedPages />
    </BrowserRouter>
  );
}
