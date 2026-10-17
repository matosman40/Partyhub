import { useCallback, useEffect, useRef, useState } from 'react';
import type { LobbyView } from '@partyhub/shared';
import { loadLivePhotos } from '../catalog/photos.js';
import {
  CAPTURE_DELAYS_MS,
  CAPTURE_MAX_BYTES,
  FINAL_CAPTURE_DELAY_MS,
  grabFrame,
  isThisTab,
  uploadGamePhoto,
} from './gamePhotos.js';

export type PhotoCaptureStatus = 'off' | 'asking' | 'on';

export interface GamePhotoCapture {
  status: PhotoCaptureStatus;
  /** Ce que l'hôte doit savoir : partage refusé, mauvais onglet, partage arrêté. */
  note: string | null;
  /** Demande le partage de cet onglet (à appeler depuis un clic). */
  start: () => Promise<void>;
  stop: () => void;
}

/**
 * Captures prévues pour une partie : annulées dès que la salle change de jeu, revient au salon ou que le serveur
 * refuse. La capture de l'écran des résultats remplace les dernières captures prévues pendant la partie.
 */
interface Run {
  gameId: string;
  cancelled: boolean;
  timers: number[];
  finalPlanned: boolean;
}

/**
 * Captures automatiques de la première partie de chaque jeu, sur l'écran de la salle.
 * L'hôte autorise le partage une fois ; ensuite, pour chaque jeu encore sans captures, trois images
 * sont prises pendant la partie réelle (jamais pendant une partie d'essai).
 */
export function useGamePhotoCapture({
  code,
  hostToken,
  lobby,
}: {
  code: string;
  hostToken: string | null;
  lobby: LobbyView | null;
}): GamePhotoCapture {
  const [status, setStatus] = useState<PhotoCaptureStatus>('off');
  const [note, setNote] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const runRef = useRef<Run | null>(null);

  const endRun = useCallback((run: Run) => {
    run.cancelled = true;
    for (const timer of run.timers) window.clearTimeout(timer);
    if (runRef.current === run) runRef.current = null;
  }, []);

  /** Arrête le partage et les captures prévues, puis dit pourquoi à l'hôte. */
  const finish = useCallback(
    (message: string | null) => {
      if (runRef.current) endRun(runRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setStatus('off');
      setNote(message);
    },
    [endRun],
  );

  const shoot = useCallback(
    async (run: Run) => {
      const video = videoRef.current;
      if (run.cancelled || !streamRef.current || !video || hostToken === null) return;
      const blob = await grabFrame(video);
      if (run.cancelled || !blob || blob.size > CAPTURE_MAX_BYTES) return;
      // Le serveur refuse quand le jeu a déjà ses captures ou que la partie est finie : inutile d'insister.
      if ((await uploadGamePhoto(code, hostToken, blob)) === 'closed') endRun(run);
    },
    [code, hostToken, endRun],
  );

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setNote('Ce navigateur ne peut pas photographier l’écran. Utilisez Chrome ou Edge sur ordinateur.');
      return;
    }
    setStatus('asking');
    setNote(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'browser' },
        audio: false,
        preferCurrentTab: true,
        selfBrowserSurface: 'include',
      } as DisplayMediaStreamOptions);
    } catch {
      setStatus('off');
      setNote('Partage refusé : aucune capture ne sera prise.');
      return;
    }
    const track = stream.getVideoTracks()[0];
    if (!track || !isThisTab(track.getSettings())) {
      stream.getTracks().forEach((t) => t.stop());
      setStatus('off');
      setNote('Choisissez cet onglet, pas tout l’écran ni une autre fenêtre.');
      return;
    }
    track.addEventListener('ended', () => {
      if (streamRef.current === stream) finish('Le partage d’écran s’est arrêté : aucune capture ne sera prise.');
    });
    const video = videoRef.current ?? document.createElement('video');
    videoRef.current = video;
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play().catch(() => undefined);
    streamRef.current = stream;
    setStatus('on');
  }, [finish]);

  // Une partie réelle (jamais un essai) : deux captures pendant la partie, une sur l'écran des résultats,
  // pour un jeu encore sans captures.
  const realRoom = lobby !== null && !lobby.practice;
  const roomStatus = lobby?.status ?? null;
  const gameId = lobby?.game.id ?? null;
  useEffect(() => {
    const current = runRef.current;
    if (status !== 'on' || !realRoom || gameId === null || hostToken === null) {
      if (current) endRun(current);
      return;
    }
    if (roomStatus === 'in_game') {
      if (current?.gameId === gameId) return;
      if (current) endRun(current);
      const run: Run = { gameId, cancelled: false, timers: [], finalPlanned: false };
      runRef.current = run;
      void loadLivePhotos().then((index) => {
        if (run.cancelled || run.finalPlanned) return;
        // Le jeu a déjà ses captures (première partie faite) : rien à prendre.
        if ((index.games[gameId]?.length ?? 0) > 0) {
          endRun(run);
          return;
        }
        run.timers = CAPTURE_DELAYS_MS.map((delay) => window.setTimeout(() => void shoot(run), delay));
      });
      return;
    }
    if (roomStatus === 'ended') {
      // Fin de partie : la capture des résultats remplace les captures restantes de cette partie.
      if (current?.gameId !== gameId || current.finalPlanned) return;
      current.finalPlanned = true;
      for (const timer of current.timers) window.clearTimeout(timer);
      current.timers = [window.setTimeout(() => void shoot(current), FINAL_CAPTURE_DELAY_MS)];
      return;
    }
    // Salon ou salle complète : aucune partie en cours.
    if (current) endRun(current);
  }, [status, realRoom, roomStatus, gameId, hostToken, shoot, endRun]);

  // Quitter la page libère l'écran partagé et annule les captures prévues.
  useEffect(
    () => () => {
      if (runRef.current) endRun(runRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    },
    [endRun],
  );

  const stop = useCallback(() => finish(null), [finish]);
  return { status, note, start, stop };
}
