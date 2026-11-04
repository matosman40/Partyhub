import type { DeviceKind } from '@partyhub/shared';
import { Icon, type IconName } from './Icon.js';

export const DEVICE_ICON_NAMES: Record<DeviceKind, IconName> = {
  phone: 'phone',
  tablet: 'phone',
  tv: 'tv',
  desktop: 'players',
  unknown: 'info',
};

export function DeviceIcons({ devices, size = 16 }: { devices: DeviceKind[]; size?: number }) {
  return (
    <>
      {devices.map((kind, index) => (
        <Icon key={`${kind}-${index}`} name={DEVICE_ICON_NAMES[kind]} size={size} />
      ))}
    </>
  );
}
