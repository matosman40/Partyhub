import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { Boundary } from './components/Boundary.js';
import { CrashScreen } from './components/CrashScreen.js';
import { applyTheme, loadTheme } from './theme/index.js';
import { initDevice } from './device/device.js';
import { unlockOnFirstGesture } from '@partyhub/games/client';
import { registerOfflineShell } from './offline.js';
import { installClientLogging } from './log/clientLog.js';
import '@fontsource/dela-gothic-one/latin-400.css';
import '@fontsource-variable/outfit';
import './styles.css';
import './styles/rami51.css';
import './styles/tarot.css';
import './styles/board.css';
import './styles/plateau-fete.css';
import './styles/quiz-phrases.css';
import './styles/championship.css';
import './styles/catalog.css';
import './styles/game-sheet.css';
import './styles/game-gallery.css';

installClientLogging(__APP_VERSION__);
applyTheme(loadTheme());
initDevice();
// Le son se débloque au premier toucher ou clic, où qu’il soit : salon, téléphone ou vue de jeu.
unlockOnFirstGesture();
registerOfflineShell();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Boundary fallback={(error) => <CrashScreen error={error} />}>
      <App />
    </Boundary>
  </StrictMode>,
);
