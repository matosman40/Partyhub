import { useEffect, useState } from 'react';
import { testModeLabel, type TestMode } from '@partyhub/shared';
import { api } from '../api.js';

/** Réglage du mode test, lu une fois à l'ouverture. Absent tant qu'il n'est pas arrivé ou en cas d'échec. */
export function useTestMode(): TestMode | null {
  const [mode, setMode] = useState<TestMode | null>(null);
  useEffect(() => {
    let cancelled = false;
    api<{ mode: TestMode }>('/api/test-mode')
      .then((res) => {
        if (!cancelled) setMode(res.mode);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return mode;
}

/** Texte du bandeau, ou null quand le mode test est éteint. */
export function testModeNotice(mode: TestMode | null): string | null {
  if (!mode?.enabled) return null;
  return `Mode test : cadence ${testModeLabel(mode.factor)} pour les émotions et les voix.`;
}

/** Bandeau discret : les joueurs qui essaient savent que les cadences ne sont pas les réglages habituels. */
export function TestModeBadge() {
  const text = testModeNotice(useTestMode());
  if (!text) return null;
  return (
    <p className="test-mode-badge notice small" role="status">
      {text}
    </p>
  );
}
