import { useState } from 'react';
import { DEVICE_KIND_LABELS, type DeviceKind } from '@partyhub/shared';
import { DEVICE_CHOICES, readDeviceChoice, setDeviceChoice, type DeviceChoice } from '../device/device.js';
import { useDevice } from '../device/useDevice.js';

const LABELS: Record<DeviceChoice, string> = {
  auto: 'Automatique',
  phone: DEVICE_KIND_LABELS.phone,
  tablet: DEVICE_KIND_LABELS.tablet,
  tv: DEVICE_KIND_LABELS.tv,
  desktop: DEVICE_KIND_LABELS.desktop,
};

/**
 * Affichage de cet appareil : la détection peut se tromper (tablette prise pour un ordinateur,
 * téléviseur navigateur…). Le choix est gardé sur l'appareil et s'applique à toutes les pages.
 */
export function DeviceChoice() {
  const [choice, setChoice] = useState<DeviceChoice>(() => readDeviceChoice());
  const detected = useDevice();

  function change(next: DeviceChoice) {
    setChoice(next);
    setDeviceChoice(next);
  }

  const current: DeviceKind = choice === 'auto' ? detected.kind : choice;
  return (
    <label className="device-choice">
      <span className="muted small">Affichage</span>
      <select value={choice} onChange={(e) => change(e.target.value as DeviceChoice)} aria-label="Type d’appareil">
        {DEVICE_CHOICES.map((c) => (
          <option key={c} value={c}>
            {c === 'auto' ? `${LABELS.auto} (${DEVICE_KIND_LABELS[current].toLowerCase()})` : LABELS[c]}
          </option>
        ))}
      </select>
    </label>
  );
}
