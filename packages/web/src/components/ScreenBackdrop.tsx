import { useEffect, type CSSProperties } from 'react';
import { useLocation } from 'react-router-dom';
import { menuImageUrl } from '../gameBackgrounds.js';
import { backgroundFor, loadScreenBackgrounds, screenForPath, useScreenBackgrounds } from '../screenBackgrounds.js';

/**
 * Fond d’écran de la page affichée, choisi dans l’administration. Il passe sous le contenu ; la
 * classe `has-screen-bg` sur <html> retire le dégradé et le décor SVG des écrans qui en ont un.
 */
export function ScreenBackdrop() {
  const { pathname } = useLocation();
  const backgrounds = useScreenBackgrounds();
  const screen = screenForPath(pathname);
  const url = backgroundFor(backgrounds, screen);
  // Sans fond choisi dans l'administration, l'accueil et « Rejoindre » ont leur illustration d'origine.
  const defaultUrl =
    url === null && screen === 'home'
      ? menuImageUrl('accueil')
      : url === null && screen === 'join'
        ? menuImageUrl('rejoindre-telephone')
        : null;

  useEffect(() => {
    void loadScreenBackgrounds();
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('has-screen-bg', url !== null);
    return () => root.classList.remove('has-screen-bg');
  }, [url]);

  if (!url && defaultUrl) {
    return (
      <div
        className="screen-backdrop is-default"
        aria-hidden="true"
        style={{ '--photo': `url("${defaultUrl}")` } as CSSProperties}
      />
    );
  }
  if (!url) return null;
  return <div className="screen-backdrop" aria-hidden="true" style={{ backgroundImage: `url("${url}")` }} />;
}
