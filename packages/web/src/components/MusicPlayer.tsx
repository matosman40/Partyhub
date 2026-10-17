import { useEffect, useRef } from 'react';
import { isMuted, SoundToggle } from '@partyhub/games/client';
import { loadSoundSettings, useActiveMusicSlot, useMuted, usePublicSounds } from '../sounds.js';

/**
 * Lecteur de la musique de fond : une seule piste à la fois, celle de l’emplacement actif, en boucle.
 * Le navigateur peut refuser le démarrage avant tout geste : la lecture reprend au premier clic ou toucher.
 */
export function MusicPlayer() {
  const sounds = usePublicSounds();
  const slot = useActiveMusicSlot();
  const muted = useMuted();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const url = slot && sounds ? sounds.music[slot] : null;
  const volume = slot && sounds ? sounds.musicVolume[slot] / 100 : 0.5;

  useEffect(() => {
    void loadSoundSettings();
  }, []);

  useEffect(() => {
    if (!url) return;
    const audio = new Audio(url);
    audio.loop = true;
    audio.volume = volume;
    audioRef.current = audio;

    // Après un refus du navigateur, `paused` peut rester faux : on ne se fie pas à lui, on retente la lecture
    // à chaque geste jusqu’à réussir, puis on retire les écouteurs.
    const detach = () => {
      document.removeEventListener('pointerdown', resume);
      document.removeEventListener('keydown', resume);
    };
    function resume() {
      if (isMuted()) return;
      audio.play().then(detach, () => undefined);
    }
    const start = () => {
      if (isMuted()) return;
      audio.play().catch(() => {
        // Lecture refusée avant un geste : on attend le premier clic ou toucher.
        document.addEventListener('pointerdown', resume);
        document.addEventListener('keydown', resume);
      });
    };
    start();

    return () => {
      detach();
      audio.pause();
      audio.removeAttribute('src');
      audioRef.current = null;
    };
    // Le bouton muet et le volume sont gérés par les effets suivants, sans relancer la piste.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // Le volume se règle sans relancer la piste.
  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.volume = volume;
  }, [volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (muted) {
      audio.pause();
    } else {
      void audio.play().catch(() => undefined);
    }
  }, [muted]);

  // Le bouton muet n’apparaît que lorsqu’une piste peut jouer, pour la couper sur place.
  if (!url) return null;
  return (
    <div className="music-toggle">
      <SoundToggle />
    </div>
  );
}
