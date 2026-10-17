import { useEffect, useRef, useState } from 'react';
import type { MediaKind } from '@partyhub/shared';

/**
 * Lecteur de l’écran principal. Il ne sert qu’à l’hôte : les téléphones ne reçoivent
 * jamais l’adresse du média. Trois sources : fichier audio, fichier vidéo de la
 * médiathèque, ou vidéo YouTube (API officielle du lecteur, chargée à la demande).
 */

export interface HostMedia {
  key: number;
  source: { type: 'youtube'; videoId: string } | { type: 'asset'; assetId: string; mediaKind: 'audio' | 'video' };
  startSec: number;
  durationSec: number;
}

interface MediaStageProps {
  media: HostMedia | null;
  /** Vrai pendant la phase de réponse : l’extrait joue. Faux à la révélation : il s’arrête. */
  active: boolean;
  kind: MediaKind;
}

/* ---------- API YouTube (une seule fois par page) ---------- */

interface YouTubePlayer {
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  playVideo(): void;
  pauseVideo(): void;
  destroy(): void;
  getPlayerState(): number;
}

interface YouTubeNamespace {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string;
      width?: string | number;
      height?: string | number;
      playerVars?: Record<string, string | number>;
      events?: { onReady?: () => void; onError?: () => void; onStateChange?: (e: { data: number }) => void };
    },
  ) => YouTubePlayer;
}

declare global {
  interface Window {
    YT?: YouTubeNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let youtubeApi: Promise<YouTubeNamespace> | null = null;

function loadYouTubeApi(): Promise<YouTubeNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!youtubeApi) {
    youtubeApi = new Promise((resolve, reject) => {
      const previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        previous?.();
        if (window.YT) resolve(window.YT);
      };
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.onerror = () => {
        youtubeApi = null;
        reject(new Error('API YouTube injoignable'));
      };
      document.head.appendChild(script);
    });
  }
  return youtubeApi;
}

/* ---------- Lecteur ---------- */

const PLAYING = 1;

export function MediaStage({ media, active, kind }: MediaStageProps) {
  const [error, setError] = useState<string | null>(null);
  const [needsTap, setNeedsTap] = useState(false);
  const [replay, setReplay] = useState(0);
  const mediaEl = useRef<HTMLAudioElement | HTMLVideoElement | null>(null);
  const ytHost = useRef<HTMLDivElement | null>(null);
  const yt = useRef<YouTubePlayer | null>(null);
  const stopTimer = useRef<number | undefined>(undefined);

  const key = media ? `${media.key}:${replay}` : 'none';
  const isYouTube = media?.source.type === 'youtube';

  // Lancement de l’extrait, et arrêt à la fin de sa durée.
  useEffect(() => {
    setError(null);
    setNeedsTap(false);
    if (!media) return;
    let cancelled = false;

    const scheduleStop = () => {
      window.clearTimeout(stopTimer.current);
      stopTimer.current = window.setTimeout(() => stopPlayback(), media.durationSec * 1000);
    };

    const stopPlayback = () => {
      const el = mediaEl.current;
      if (el) el.pause();
      yt.current?.pauseVideo();
    };

    if (media.source.type === 'asset') {
      const el = mediaEl.current;
      if (!el) return;
      const onReady = () => {
        el.currentTime = media.startSec;
        el.play().then(
          () => scheduleStop(),
          () => setNeedsTap(true),
        );
      };
      if (el.readyState >= 1) onReady();
      else el.addEventListener('loadedmetadata', onReady, { once: true });
      return () => {
        cancelled = true;
        window.clearTimeout(stopTimer.current);
        el.removeEventListener('loadedmetadata', onReady);
      };
    }

    // YouTube
    const host = ytHost.current;
    if (!host) return;
    const holder = document.createElement('div');
    host.appendChild(holder);
    loadYouTubeApi()
      .then((YT) => {
        if (cancelled) return;
        yt.current = new YT.Player(holder, {
          videoId: media.source.type === 'youtube' ? media.source.videoId : '',
          width: '100%',
          height: '100%',
          playerVars: {
            start: media.startSec,
            controls: 0,
            playsinline: 1,
            rel: 0,
            modestbranding: 1,
            iv_load_policy: 3,
            disablekb: 1,
          },
          events: {
            onReady: () => {
              yt.current?.seekTo(media.startSec, true);
              yt.current?.playVideo();
              scheduleStop();
            },
            onStateChange: (e) => {
              if (e.data === PLAYING) setNeedsTap(false);
            },
            onError: () => setError('Cette vidéo ne peut pas être lue (privée, supprimée ou non autorisée).'),
          },
        });
      })
      .catch(() => setError('Le lecteur YouTube ne répond pas. Vérifiez la connexion, ou passez à l’étape suivante.'));

    return () => {
      cancelled = true;
      window.clearTimeout(stopTimer.current);
      try {
        yt.current?.destroy();
      } catch {
        // Le lecteur peut déjà être détruit.
      }
      yt.current = null;
      holder.remove();
    };
    // Une nouvelle clé = un nouvel extrait (ou un rejeu demandé par l’hôte).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Révélation : l’extrait s’arrête.
  useEffect(() => {
    if (active) return;
    window.clearTimeout(stopTimer.current);
    mediaEl.current?.pause();
    yt.current?.pauseVideo();
  }, [active]);

  if (!media) {
    return <div className="mq-stage mq-stage-empty" aria-hidden="true" />;
  }

  // Image à l’écran pour un film ou une vidéo ; visuel sonore pour une chanson ou un fichier audio.
  const showsPicture = media?.source.type === 'asset' ? media.source.mediaKind === 'video' : kind !== 'musique';
  const visual = showsPicture ? 'video' : 'sound';

  return (
    <div className={`mq-stage is-${visual}`} data-kind={kind}>
      {visual === 'video' && media.source.type === 'asset' && (
        <video
          key={key}
          ref={(el) => {
            mediaEl.current = el;
          }}
          className="mq-media"
          src={`/api/assets/${media.source.assetId}`}
          playsInline
          preload="auto"
          onError={() => setError('Le fichier vidéo ne peut pas être lu.')}
        />
      )}
      {visual === 'sound' && media.source.type === 'asset' && (
        <audio
          key={key}
          ref={(el) => {
            mediaEl.current = el;
          }}
          src={`/api/assets/${media.source.assetId}`}
          preload="auto"
          onError={() => setError('Le fichier audio ne peut pas être lu.')}
        />
      )}
      {isYouTube && (
        <div
          className={visual === 'video' ? 'mq-yt' : 'mq-yt is-hidden'}
          ref={ytHost}
          aria-hidden={visual !== 'video'}
        />
      )}
      {visual === 'sound' && (
        <div className={`mq-sound ${active ? 'is-playing' : ''}`} aria-hidden="true">
          <span className="mq-note">?</span>
          <span className="mq-bars">
            {Array.from({ length: 12 }, (_, i) => (
              <i key={i} style={{ animationDelay: `${(i % 6) * 0.11}s` }} />
            ))}
          </span>
        </div>
      )}
      {visual === 'video' && isYouTube && <div className="mq-yt-cover" aria-hidden="true" />}
      {needsTap && (
        <button
          type="button"
          className="btn primary mq-tap"
          onClick={() => {
            setNeedsTap(false);
            const el = mediaEl.current;
            if (el) void el.play();
            yt.current?.playVideo();
          }}
        >
          Lancer l’extrait
        </button>
      )}
      {error && (
        <p className="mq-error" role="alert">
          {error}
        </p>
      )}
      {active && (
        <button type="button" className="link-btn mq-replay" onClick={() => setReplay((n) => n + 1)}>
          Rejouer l’extrait
        </button>
      )}
    </div>
  );
}
