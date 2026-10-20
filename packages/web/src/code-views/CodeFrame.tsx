import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  CODE_MEDIA_MAX_BYTES,
  CODE_VIEW_MESSAGE,
  isCodeMediaUrl,
  type CodeViewMethod,
  type CodeViewRole,
} from '@partyhub/shared';
import { usePublicSounds } from '../sounds.js';

/**
 * Vue d'un jeu de code : elle tourne dans un iframe sandboxé (`allow-scripts` seulement : ni même origine,
 * ni accès au stockage ou aux cookies de la page). L'iframe charge le document de vues servi par le serveur,
 * qui a sa propre politique (aucun réseau). La page lui envoie les états et réglages par `postMessage`. Les
 * appels de la vue (envoyer une action, changer les réglages) remontent par les mêmes messages, et la page
 * les transmet au serveur.
 */

type Result = { ok: boolean; error?: string };
type Action = (type: string, payload?: unknown) => Promise<Result>;

interface CodeFrameProps {
  role: CodeViewRole;
  /** Adresse du document de vues (contient l'empreinte du bundle). */
  url: string;
  /** Props sérialisables : états, réglages, identifiant, horloge. */
  data: Record<string, unknown>;
  send?: Action;
  onAction?: Action;
  onChange?: (settings: Record<string, unknown>) => void;
}

/** Au-delà de ce délai sans signe de vie, la vue est signalée (document absent ou script en erreur). */
const READY_TIMEOUT_MS = 10_000;

export function CodeFrame({ role, url, data, send, onAction, onChange }: CodeFrameProps): ReactNode {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [slow, setSlow] = useState(false);
  const [viewError, setViewError] = useState<string | null>(null);
  // Les écouteurs lisent toujours les dernières valeurs, sans être recréés à chaque rendu.
  const latest = useRef({ data, send, onAction, onChange, role });
  latest.current = { data, send, onAction, onChange, role };
  const readyRef = useRef(false);

  useEffect(() => {
    if (ready) return;
    const timer = window.setTimeout(() => setSlow(true), READY_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [ready]);

  useEffect(() => {
    const post = (message: Record<string, unknown>) => frameRef.current?.contentWindow?.postMessage(message, '*');
    const renderNow = () => {
      const current = latest.current;
      post({
        ph: CODE_VIEW_MESSAGE.render,
        role: current.role,
        props: current.data,
        flags: { onAction: Boolean(current.onAction) },
      });
    };
    const reply = (id: number, result: Result) => post({ ph: CODE_VIEW_MESSAGE.reply, id, result });

    // Médias de l'installation pour la vue : seules les adresses de `isCodeMediaUrl` sont servies, et seulement
    // à cette vue. Les octets voyagent (transfert, sans copie) vers l'iframe.
    async function serveMedia(id: number, url: unknown): Promise<void> {
      const answer = (body: Record<string, unknown>, transfer: Transferable[] = []) =>
        frameRef.current?.contentWindow?.postMessage({ ph: CODE_VIEW_MESSAGE.mediaReply, id, ...body }, '*', transfer);
      if (typeof url !== 'string' || !isCodeMediaUrl(url)) {
        answer({ ok: false, error: 'Média non autorisé.' });
        return;
      }
      try {
        const res = await fetch(url, { credentials: 'same-origin' });
        if (!res.ok) {
          answer({ ok: false, error: `Média indisponible (${res.status}).` });
          return;
        }
        const data = await res.arrayBuffer();
        if (data.byteLength > CODE_MEDIA_MAX_BYTES) {
          answer({ ok: false, error: 'Média trop volumineux.' });
          return;
        }
        answer({ ok: true, type: res.headers.get('content-type') ?? 'application/octet-stream', data }, [data]);
      } catch {
        answer({ ok: false, error: 'Média injoignable.' });
      }
    }

    function onMessage(event: MessageEvent) {
      const frame = frameRef.current;
      // Seul l'iframe de cette vue peut parler à la page.
      if (!frame || event.source !== frame.contentWindow) return;
      const message = event.data as {
        ph?: string;
        id?: number;
        method?: CodeViewMethod;
        args?: unknown[];
        settings?: Record<string, unknown>;
        message?: string;
        url?: unknown;
      } | null;
      if (!message || typeof message !== 'object') return;
      switch (message.ph) {
        case CODE_VIEW_MESSAGE.ready:
          readyRef.current = true;
          setReady(true);
          renderNow();
          return;
        case CODE_VIEW_MESSAGE.media:
          void serveMedia(typeof message.id === 'number' ? message.id : 0, message.url);
          return;
        case CODE_VIEW_MESSAGE.call: {
          const id = typeof message.id === 'number' ? message.id : 0;
          const current = latest.current;
          const handler =
            message.method === 'onAction' ? current.onAction : message.method === 'send' ? current.send : undefined;
          const args = Array.isArray(message.args) ? message.args : [];
          if (!handler) {
            reply(id, { ok: false, error: 'Action indisponible ici.' });
            return;
          }
          handler(String(args[0] ?? ''), args[1]).then(
            (result) => reply(id, result),
            (err: unknown) => reply(id, { ok: false, error: err instanceof Error ? err.message : 'Échec.' }),
          );
          return;
        }
        case CODE_VIEW_MESSAGE.change:
          if (message.settings && typeof message.settings === 'object') latest.current.onChange?.(message.settings);
          return;
        case CODE_VIEW_MESSAGE.error:
          setViewError(typeof message.message === 'string' ? message.message : 'La vue a rencontré une erreur.');
          return;
        default:
      }
    }

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // Une nouvelle donnée (état, réglage, horloge) est envoyée dès que la vue est prête.
  const dataKey = JSON.stringify(data);
  useEffect(() => {
    if (!readyRef.current) return;
    frameRef.current?.contentWindow?.postMessage(
      { ph: CODE_VIEW_MESSAGE.render, role, props: data, flags: { onAction: Boolean(onAction) } },
      '*',
    );
    // dataKey résume `data` : on ne renvoie que lorsque les données changent réellement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey, role, ready, Boolean(onAction)]);

  // Bruitages de l'installation : la vue les règle dès qu'elle est prête, puis à chaque changement de réglage.
  const sounds = usePublicSounds();
  useEffect(() => {
    if (!readyRef.current) return;
    frameRef.current?.contentWindow?.postMessage({ ph: CODE_VIEW_MESSAGE.sounds, sfx: sounds?.sfx ?? {} }, '*');
  }, [sounds, ready]);

  if (viewError) {
    return (
      <p className="error" role="alert">
        {viewError}
      </p>
    );
  }
  return (
    <div style={{ width: '100%', height: '100%', minHeight: '60vh' }}>
      {slow && !ready && (
        <p className="error" role="alert">
          La vue du jeu ne s’est pas chargée. Rechargez la page.
        </p>
      )}
      <iframe
        ref={frameRef}
        title={role === 'host' ? 'Écran du jeu' : role === 'player' ? 'Écran du téléphone' : 'Réglages du jeu'}
        sandbox="allow-scripts"
        // Capteurs et médias demandés par les jeux (gyroscope, caméra, micro) : le navigateur demande toujours
        // l'autorisation. L'autoplay et le DRM servent seulement aux cadres YouTube des extraits (karaoké).
        // Rien d'autre n'est ouvert : pas de réseau, pas de stockage (voir la politique de la vue).
        allow="accelerometer; autoplay; encrypted-media; gyroscope; camera; microphone"
        src={url}
        style={{ width: '100%', height: '100%', minHeight: '60vh', border: 0, display: 'block' }}
      />
    </div>
  );
}
