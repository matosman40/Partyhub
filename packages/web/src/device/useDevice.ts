import { useSyncExternalStore } from 'react';
import type { DeviceInfo } from '@partyhub/shared';
import { getDevice, subscribeDevice } from './device.js';

/** Type d'appareil courant, mis à jour quand la fenêtre change de taille ou d'orientation. */
export function useDevice(): DeviceInfo {
  return useSyncExternalStore(subscribeDevice, getDevice, getDevice);
}
