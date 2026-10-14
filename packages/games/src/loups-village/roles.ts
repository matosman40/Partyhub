/**
 * Rôles des Loups du village : définitions pures, partagées avec l'affichage.
 */

export type Role = 'villageois' | 'loup' | 'voyante' | 'gardienne';
export type Team = 'village' | 'loups';

export const ROLE_INFO: Record<Role, { label: string; icon: string; team: Team; text: string }> = {
  villageois: {
    label: 'Villageois',
    icon: '🧑‍🌾',
    team: 'village',
    text: 'Vous n’avez aucun pouvoir. Trouvez les loups grâce aux débats et aux votes.',
  },
  loup: {
    label: 'Loup',
    icon: '🐺',
    team: 'loups',
    text: 'Chaque nuit, dévorez un villageois avec vos alliés. Restez discret le jour.',
  },
  voyante: {
    label: 'Voyante',
    icon: '🔮',
    team: 'village',
    text: 'Chaque nuit, découvrez si un joueur est un loup. Partagez l’information avec prudence.',
  },
  gardienne: {
    label: 'Gardienne',
    icon: '🛡️',
    team: 'village',
    text: 'Chaque nuit, protégez un joueur contre les loups. Pas deux nuits de suite le même.',
  },
};

export const TEAM_LABEL: Record<Team, string> = {
  village: 'le village',
  loups: 'les loups',
};

/** Répartition des rôles selon le nombre de joueurs. */
export function compositionFor(count: number): Role[] {
  const wolves = Math.max(1, Math.round(count / 4));
  const roles: Role[] = Array.from({ length: wolves }, () => 'loup' as Role);
  if (count >= 4) roles.push('voyante');
  if (count >= 7) roles.push('gardienne');
  while (roles.length < count) roles.push('villageois');
  return roles;
}
