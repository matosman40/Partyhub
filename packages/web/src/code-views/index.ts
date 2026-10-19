import type { CodeViewRef } from '@partyhub/shared';
import type { GameClientViews, HostViewProps, PlayerViewProps, SettingsProps } from '@partyhub/games/client';
import { createElement } from 'react';
import { CodeFrame } from './CodeFrame.js';

/**
 * Vues d'un jeu de code, pour les écrans de la salle : réglages, écran principal et téléphone.
 * Chaque vue est un iframe (voir CodeFrame). Les fonctions (envoyer, changer) restent côté page :
 * elles sont passées au composant, qui les relaie aux messages de l'iframe.
 */
const cache = new Map<string, GameClientViews>();

export function codeViewsFor(codeView: CodeViewRef): GameClientViews {
  const known = cache.get(codeView.url);
  if (known) return known;
  const { url } = codeView;
  const views: GameClientViews = {
    Settings: (props: SettingsProps) => {
      const { settings, disabled, bounds, onChange } = props;
      return createElement(CodeFrame, {
        key: url,
        role: 'settings',
        url,
        data: { settings, disabled, bounds: bounds ?? null },
        onChange,
      });
    },
    Host: (props: HostViewProps) => {
      const { onAction, ...data } = props;
      return createElement(CodeFrame, { key: url, role: 'host', url, data, onAction });
    },
    Player: (props: PlayerViewProps) => {
      const { send, ...data } = props;
      return createElement(CodeFrame, { key: url, role: 'player', url, data, send });
    },
  };
  cache.set(url, views);
  return views;
}
