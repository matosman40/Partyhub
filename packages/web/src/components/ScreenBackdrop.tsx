import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { backgroundFor, loadScreenBackgrounds, screenForPath, useScreenBackgrounds } from '../screenBackgrounds.js';

/**
 * Fond d’écran de la page affichée, choisi dans l’administration. Il passe sous le contenu ; la
 * classe `has-screen-bg` sur <html> retire le dégradé et le décor SVG des écrans qui en ont un.
 */
export function ScreenBackdrop() {
  const { pathname } = useLocation();
  const backgrounds = useScreenBackgrounds();
  const url = backgroundFor(backgrounds, screenForPath(pathname));

  useEffect(() => {
    void loadScreenBackgrounds();
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('has-screen-bg', url !== null);
    return () => root.classList.remove('has-screen-bg');
  }, [url]);

  if (!url) return null;
  return <div className="screen-backdrop" aria-hidden="true" style={{ backgroundImage: `url("${url}")` }} />;
}
