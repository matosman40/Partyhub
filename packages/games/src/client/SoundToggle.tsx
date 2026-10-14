import { useState } from 'react';
import { isAudioUnlocked, isMuted, play, setMuted, unlockAudio } from './audio.js';

/**
 * Bouton son : le premier clic débloque l'audio du navigateur, les suivants
 * coupent ou rétablissent le son. Le choix est gardé sur l'appareil.
 */
export function SoundToggle() {
  const [muted, setMutedState] = useState(isMuted());
  const [unlocked, setUnlocked] = useState(isAudioUnlocked());

  function toggle() {
    if (!isAudioUnlocked()) {
      unlockAudio();
      setUnlocked(true);
      setMuted(false);
      setMutedState(false);
      play('click');
      return;
    }
    const next = !muted;
    setMuted(next);
    setMutedState(next);
    if (!next) play('click');
  }

  const label = !unlocked ? 'Activer le son' : muted ? 'Son coupé' : 'Son activé';
  const icon = !unlocked || muted ? '🔇' : '🔊';
  return (
    <button type="button" className="btn ghost small sound-toggle" onClick={toggle} aria-pressed={unlocked && !muted}>
      <span aria-hidden="true">{icon}</span> {label}
    </button>
  );
}
