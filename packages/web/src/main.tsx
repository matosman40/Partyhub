import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { Boundary } from './components/Boundary.js';
import { CrashScreen } from './components/CrashScreen.js';
import { applyTheme, loadTheme } from './theme/index.js';
import { initDevice } from './device/device.js';
import '@fontsource/dela-gothic-one/latin-400.css';
import '@fontsource-variable/outfit';
import './styles.css';
import './styles/rami51.css';
import './styles/tarot.css';
import './styles/board.css';

applyTheme(loadTheme());
initDevice();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Boundary fallback={(error) => <CrashScreen error={error} />}>
      <App />
    </Boundary>
  </StrictMode>,
);
