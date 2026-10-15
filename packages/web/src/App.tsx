import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
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

function NotFound() {
  return (
    <main className="page center">
      <h1>Page introuvable</h1>
      <Link className="btn" to="/">
        Retour à l’accueil
      </Link>
    </main>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <ScreenBackdrop />
      <MusicPlayer />
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
    </BrowserRouter>
  );
}
