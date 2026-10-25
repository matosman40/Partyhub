import { CODE_VIEW_MESSAGE } from '@partyhub/shared';

/**
 * Amorce du bundle de vues d'un jeu de code, générée à la construction et incluse dans le paquet
 * (donc relue et empreintée comme le reste). Elle rend les vues du jeu (Hôte, Joueur, Réglages)
 * dans l'iframe, et relaie les appels à la page par postMessage. Pas d'autre accès au monde.
 */
export function viewEntrySource(): string {
  return `import * as React from 'react';
import { createRoot } from 'react-dom/client';
import views from './client';

const MSG = ${JSON.stringify(CODE_VIEW_MESSAGE)};

type Result = { ok: boolean; error?: string; data?: string };
const pending = new Map<number, (result: Result) => void>();
let nextId = 1;

function post(message: Record<string, unknown>): void {
  window.parent.postMessage(message, '*');
}

function call(method: string, args: unknown[]): Promise<Result> {
  return new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    post({ ph: MSG.call, id, method, args });
  });
}

class Boundary extends React.Component<{ children?: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    post({ ph: MSG.error, message: error instanceof Error ? error.message : String(error) });
  }
  render() {
    if (this.state.failed) return React.createElement('p', { role: 'alert' }, 'La vue a rencontré une erreur.');
    return this.props.children;
  }
}

document.documentElement.style.height = '100%';
document.body.style.cssText = 'margin:0;height:100%;font-family:system-ui,sans-serif;color:#111;background:#fff;';
const root = createRoot(document.getElementById('root') as HTMLElement);

function render(role: string, props: Record<string, unknown>, flags: { onAction?: boolean }): void {
  const views_ = views as unknown as Record<string, React.ComponentType<Record<string, unknown>> | undefined>;
  const component = role === 'host' ? views_.Host : role === 'player' ? views_.Player : views_.Settings;
  if (!component) {
    post({ ph: MSG.error, message: 'Vue absente du jeu.' });
    return;
  }
  const extra: Record<string, unknown> = {};
  if (role === 'settings') {
    extra.onChange = (settings: unknown) => post({ ph: MSG.change, settings });
  } else if (role === 'host') {
    if (flags.onAction) extra.onAction = (type: string, payload?: unknown) => call('onAction', [type, payload]);
  } else {
    extra.send = (type: string, payload?: unknown) => call('send', [type, payload]);
    // Micro (vue joueur) : la page ouvre le micro et renvoie la voix, la vue n'y touche pas.
    extra.micCheck = () => call('micCheck', []);
    extra.voice = (ms: number) => call('voice', [ms]);
    extra.voiceStop = () => call('voiceStop', []);
  }
  root.render(React.createElement(Boundary, null, React.createElement(component, { ...props, ...extra })));
}

window.addEventListener('message', (event) => {
  if (event.source !== window.parent) return;
  const data = event.data as {
    ph?: string;
    id?: number;
    result?: Result;
    role?: string;
    props?: Record<string, unknown>;
    flags?: { onAction?: boolean };
  } | null;
  if (!data || typeof data !== 'object') return;
  if (data.ph === MSG.render) render(String(data.role), data.props ?? {}, data.flags ?? {});
  if (data.ph === MSG.reply && typeof data.id === 'number') {
    const resolve = pending.get(data.id);
    pending.delete(data.id);
    resolve?.(data.result ?? { ok: false, error: 'Réponse vide.' });
  }
});

post({ ph: MSG.ready });
`;
}
