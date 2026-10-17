import { z } from 'zod';

/**
 * Capteurs du téléphone (gyroscope, accéléromètre, micro), relayés en direct à l’écran principal.
 *
 * Le relais ne garde rien : chaque échantillon remplace le précédent. Il ne passe pas par l’état de la partie
 * (trop fréquent pour une diffusion complète de la salle) et n’est accepté qu’en cours de partie.
 * Le serveur borne le débit par socket ; le téléphone envoie au plus SENSOR_SEND_HZ échantillons par seconde.
 */

/**
 * Débit maximal accepté par socket, en échantillons par seconde. Une marge au-dessus de l’envoi normal absorbe
 * les à-coups du réseau sans laisser un téléphone inonder l’écran.
 */
export const SENSOR_MAX_PER_SECOND = 40;
/**
 * Débit d’envoi du téléphone : un échantillon au plus toutes les trente-trois millisecondes. Une mesure attend
 * donc au plus ce délai avant de partir, contre cent millisecondes à dix échantillons par seconde.
 */
export const SENSOR_SEND_HZ = 30;

/**
 * Un échantillon :
 * - `x` et `y` : inclinaison du téléphone par rapport à sa pose de départ, de -1 (à gauche / en arrière)
 *   à 1 (à droite / en avant) ;
 * - `energy` : intensité de l’effort du moment, de 0 (repos) à 1 (effort maximal : secousses, souffle, tapotement).
 */
export interface SensorSample {
  x: number;
  y: number;
  energy: number;
}

/** Échantillon relayé à l’écran principal, avec l’identifiant du joueur. */
export interface SensorEvent extends SensorSample {
  playerId: string;
}

export const sensorSchema = z.object({
  x: z.number().min(-1).max(1),
  y: z.number().min(-1).max(1),
  energy: z.number().min(0).max(1),
});
