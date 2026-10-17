import { useEffect, useState, type ReactNode } from 'react';
import type { SensorEvent } from '@partyhub/shared';
import { SensorsContext, type SensorReading } from '@partyhub/games/client';
import type { AppSocket } from '../realtime.js';
import { createSampleBatcher } from './sensorBatch.js';

/**
 * Relaie à la vue du jeu les capteurs des téléphones (inclinaison, effort) reçus pendant la partie.
 * L'état vit ici, et non dans la page : seuls les jeux qui affichent les capteurs se mettent à jour.
 * Un téléphone envoie jusqu'à trente échantillons par seconde : sans regroupement, douze téléphones feraient plus
 * de trois cent cinquante mises à jour par seconde. Le regroupement se fait à l'image (voir `sensorBatch.ts`) :
 * l'écran se met à jour au plus au rythme où il peut peindre, et chaque mesure part dès l'image suivante.
 * Rien n'est gardé après la partie : le serveur ne conserve pas les capteurs.
 */
export function RoomSensors({ socket, children }: { socket: AppSocket; children: ReactNode }) {
  const [readings, setReadings] = useState<Record<string, SensorReading>>({});

  useEffect(() => {
    const batcher = createSampleBatcher({
      onFlush: (batch) => setReadings((prev) => ({ ...prev, ...batch })),
    });
    const onSensor = (e: SensorEvent) => batcher.push(e, performance.now());
    socket.on('room:sensor', onSensor);
    return () => {
      socket.off('room:sensor', onSensor);
      batcher.dispose();
    };
  }, [socket]);

  return <SensorsContext.Provider value={readings}>{children}</SensorsContext.Provider>;
}
