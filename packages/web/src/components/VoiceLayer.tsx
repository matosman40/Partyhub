import { useEffect, useRef, useState } from 'react';
import type { VoiceEvent } from '@partyhub/shared';
import { isMuted } from '@partyhub/games/client';
import type { AppSocket } from '../realtime.js';
import { PlayerAvatar } from './PlayerAvatar.js';
import { VOICE_GAP_MS, VOICE_MUTED_HOLD_MS, enqueueVoice, voiceUrl } from './voiceQueue.js';

/**
 * Voix des joueurs, jouées sur l'écran principal, une à la fois, dans l'ordre d'arrivée.
 * Un bandeau indique qui parle. Si le navigateur bloque le son (aucun geste sur la page),
 * le bandeau propose d'activer le son : le tap sur ce bouton relance la voix.
 */
export function VoiceLayer({ socket }: { socket: AppSocket }) {
  const [playing, setPlaying] = useState<VoiceEvent | null>(null);
  const [blocked, setBlocked] = useState(false);
  const retryRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let queue: VoiceEvent[] = [];
    let busy = false;
    let stopped = false;
    let timer: number | undefined;
    let audio: HTMLAudioElement | null = null;

    const wait = (ms: number, then: () => void) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(then, ms);
    };

    function next() {
      if (stopped) return;
      const item = queue.shift();
      setBlocked(false);
      retryRef.current = null;
      if (!item) {
        busy = false;
        setPlaying(null);
        return;
      }
      busy = true;
      setPlaying(item);
      if (isMuted()) {
        wait(VOICE_MUTED_HOLD_MS, next);
        return;
      }
      const el = new Audio(voiceUrl(item.voiceId));
      audio = el;
      // Une voix ne termine qu'une fois : le premier signal (fin, erreur) passe au suivant.
      const finish = () => {
        if (audio !== el) return;
        audio = null;
        wait(VOICE_GAP_MS, next);
      };
      el.onended = finish;
      el.onerror = finish;
      const start = () => {
        const attempt = el.play();
        if (!attempt) return;
        attempt.then(
          () => setBlocked(false),
          (err: unknown) => {
            if (stopped || audio !== el) return;
            if (err instanceof DOMException && err.name === 'NotAllowedError') {
              setBlocked(true);
              retryRef.current = start;
            } else {
              finish();
            }
          },
        );
      };
      start();
    }

    const onVoice = (voice: VoiceEvent) => {
      if (stopped) return;
      queue = enqueueVoice(queue, voice);
      if (!busy) next();
    };

    socket.on('room:voice', onVoice);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      audio?.pause();
      audio = null;
      retryRef.current = null;
      socket.off('room:voice', onVoice);
    };
  }, [socket]);

  if (!playing) return null;
  return <VoiceBanner voice={playing} blocked={blocked} onRetry={() => retryRef.current?.()} />;
}

/** Bandeau de la voix en cours : qui parle, ce qu’il dit, et l’onde tant que le son joue. */
export function VoiceBanner({
  voice,
  blocked,
  onRetry,
}: {
  voice: Pick<VoiceEvent, 'from' | 'name' | 'avatar'>;
  blocked: boolean;
  onRetry: () => void;
}) {
  return (
    <div className={`voice-banner${blocked ? ' is-blocked' : ''}`} role="status" aria-live="polite">
      <PlayerAvatar avatar={voice.avatar} name={voice.from} size="sm" />
      <p className="voice-text">
        <strong>{voice.from}</strong>
        <span>« {voice.name} »</span>
      </p>
      {blocked ? (
        <button type="button" className="btn small primary" onClick={onRetry}>
          Activer le son
        </button>
      ) : (
        <span className="voice-wave" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </span>
      )}
    </div>
  );
}
