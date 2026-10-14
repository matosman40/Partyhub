/**
 * Moteur PartyHub tel que le voient les paquets. Un paquet déclare la version minimale du moteur
 * et la version de l'API qu'il utilise ; il ne contient jamais de copie du moteur.
 */
export const PARTYHUB_ENGINE = {
  /** Doit correspondre à la version publiée (package.json, CHANGELOG). Vérifié par les tests. */
  version: '0.6.3',
  /** Version de l'API des paquets. Un paquet demande exactement cette version. */
  api: 1,
  /** Modules de jeu disponibles pour les paquets déclaratifs. */
  modules: ['cards'] as const,
} as const;
