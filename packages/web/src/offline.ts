/**
 * Mode hors ligne : le service worker (sw/service-worker.js) garde la coque de l'application. Il n'agit qu'en
 * production, et seulement sur une adresse sécurisée (HTTPS ou localhost), comme l'exige le navigateur.
 */
export function registerOfflineShell(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener(
    'load',
    () => {
      // updateViaCache « none » : le navigateur vérifie toujours le fichier auprès du serveur.
      navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => undefined);
    },
    { once: true },
  );
}
