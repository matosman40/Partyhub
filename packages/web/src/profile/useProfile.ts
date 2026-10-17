import { useEffect, useState } from 'react';
import { activeDeviceProfile, PROFILE_CHANGED, readDeviceProfiles, type DeviceProfile } from './session.js';

/** Profil actif de cet appareil et liste des profils : suivent les changements, sans recharger la page. */
export function useDeviceProfiles(): { active: DeviceProfile | null; list: DeviceProfile[] } {
  const [state, setState] = useState(() => ({ active: activeDeviceProfile(), list: readDeviceProfiles() }));
  useEffect(() => {
    const refresh = () => setState({ active: activeDeviceProfile(), list: readDeviceProfiles() });
    window.addEventListener(PROFILE_CHANGED, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(PROFILE_CHANGED, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);
  return state;
}

/** Profil actif seulement (null tant qu'aucun profil n'est créé sur cet appareil). */
export function useActiveProfile(): DeviceProfile | null {
  return useDeviceProfiles().active;
}
