import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { applyTheme, loadTheme } from './theme/index.js';
import '@fontsource/dela-gothic-one/latin-400.css';
import '@fontsource-variable/outfit';
import './styles.css';
import './styles/rami51.css';
import './styles/poker.css';
import './styles/tarot.css';

applyTheme(loadTheme());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
