import { useState } from 'react';
import { Link } from 'react-router-dom';
import { hashText } from '@partyhub/shared';
import { CreateProfileForm } from './CreateProfileForm.js';
import { useDeviceProfiles } from './useProfile.js';
import { forgetDeviceProfile, switchDeviceProfile } from './session.js';

/**
 * Profil de cet appareil : le profil actif s’affiche, et on en choisit un autre d’un geste.
 * Un profil de plus se crée sur place, sans quitter la page.
 */
export function ProfileSwitcher({ onChange }: { onChange?: () => void }) {
  const { active, list } = useDeviceProfiles();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  if (!active) return null;

  const initial = active.name.trim().charAt(0).toUpperCase() || '?';
  const hue = hashText(active.id) % 360;

  return (
    <div className="profile-switcher">
      <button
        type="button"
        className="profile-chip"
        aria-expanded={open}
        aria-controls="profile-switcher-panel"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="profile-initial" style={{ background: `hsl(${hue} 85% 66%)` }} aria-hidden="true">
          {initial}
        </span>
        <span>
          Joueur : <strong>{active.name}</strong>
        </span>
        <span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div id="profile-switcher-panel" className="profile-panel" role="group" aria-label="Profils sur cet appareil">
          {list.length > 1 && (
            <ul className="profile-list">
              {list.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className={`chip${p.id === active.id ? ' active' : ''}`}
                    aria-pressed={p.id === active.id}
                    onClick={() => {
                      switchDeviceProfile(p.token);
                      setOpen(false);
                      onChange?.();
                    }}
                  >
                    {p.name}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {creating ? (
            <CreateProfileForm
              title="Nouveau profil"
              onCreated={() => {
                setCreating(false);
                setOpen(false);
                onChange?.();
              }}
            />
          ) : (
            <button type="button" className="link-btn" onClick={() => setCreating(true)}>
              + Nouveau profil sur cet appareil
            </button>
          )}

          <div className="profile-panel-links">
            <Link to="/profil" onClick={() => setOpen(false)}>
              Mon profil et mon personnage
            </Link>
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                if (
                  !window.confirm(
                    `Retirer « ${active.name} » de cet appareil ? Sans mot de passe, ce profil ne pourra plus être rouvert.`,
                  )
                )
                  return;
                forgetDeviceProfile(active.token);
                setOpen(false);
                onChange?.();
              }}
            >
              Retirer ce profil de cet appareil
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
