import { useState } from 'react';
import { BackButton } from '../components/BackButton.js';
import { detectPlatform, type Platform } from '../certificate/platform.js';

/** Fichier servi par Caddy : le certificat racine de l'autorité interne. */
export const CERTIFICATE_URL = '/certificat/racine.crt';
export const CERTIFICATE_FILE_NAME = 'partyhub-autorite-locale.crt';

const INSTALL_STEPS: Record<Platform, { title: string; steps: string[] }> = {
  ios: {
    title: 'iPhone et iPad',
    steps: [
      'Ouvrez le fichier téléchargé : Réglages affiche « Profil téléchargé ».',
      'Touchez Installer et saisissez le code de l’appareil.',
      'Allez dans Réglages → Général → Informations → Réglages des certificats.',
      'Activez la confiance totale pour « Caddy Local Authority ». Sans cette dernière étape, Safari affiche encore l’avertissement.',
    ],
  },
  android: {
    title: 'Android',
    steps: [
      'Paramètres → Sécurité (ou « Sécurité et confidentialité ») → Chiffrement et identifiants.',
      'Touchez Installer un certificat, puis Certificat CA, et choisissez le fichier téléchargé.',
      'Rechargez cette page dans Chrome. Les libellés varient selon la marque.',
    ],
  },
  windows: {
    title: 'Windows',
    steps: [
      'Double-cliquez sur le fichier, puis Installer le certificat.',
      'Choisissez Ordinateur local, puis « Placer tous les certificats dans le magasin suivant ».',
      'Sélectionnez Autorités de certification racines de confiance, puis Terminer.',
    ],
  },
  mac: {
    title: 'Mac',
    steps: [
      'Double-cliquez sur le fichier : il s’ouvre dans Trousseau d’accès.',
      'Ouvrez le certificat, développez « Se fier », puis choisissez « Toujours approuver ».',
      'Saisissez le mot de passe de l’ordinateur pour enregistrer.',
    ],
  },
  linux: {
    title: 'Linux',
    steps: [
      'Chrome ou Chromium : Paramètres → Confidentialité et sécurité → Gérer les certificats → Autorités → Importer.',
      'Cochez « Approuver ce certificat pour identifier des sites web ».',
      'Firefox : Paramètres → Vie privée et sécurité → Certificats → Autorités → Importer.',
    ],
  },
  autre: {
    title: 'Autre appareil',
    steps: [
      'Téléchargez le fichier, puis cherchez « installer un certificat CA » dans les réglages de sécurité.',
      'Choisissez le fichier téléchargé, puis rechargez cette page.',
    ],
  },
};

const ORDER: Platform[] = ['ios', 'android', 'windows', 'mac', 'linux'];

/**
 * Page d'installation du certificat, accessible même avant qu'il ne soit reconnu : Caddy le sert
 * directement, sans passer par l'application. Les instructions de l'appareil détecté sont ouvertes.
 */
export function CertificatePage({ platform: forced }: { platform?: Platform }) {
  const [detected] = useState<Platform>(
    () =>
      forced ??
      (typeof navigator === 'undefined' ? 'autre' : detectPlatform(navigator.userAgent, navigator.maxTouchPoints ?? 0)),
  );
  const current = INSTALL_STEPS[detected];
  const others = ORDER.filter((p) => p !== detected);

  return (
    <main className="page certificate fade-in" style={{ maxWidth: 680 }}>
      <p className="page-nav">
        <BackButton to="/">Retour à l’accueil</BackButton>
      </p>

      <h1>Installer le certificat</h1>
      <p className="muted">
        PartyHub utilise une connexion sécurisée sur le réseau local. Le navigateur ne connaît pas encore son certificat
        : installez-le une seule fois sur cet appareil. Ensuite, le micro et la caméra fonctionnent et l’avertissement
        disparaît.
      </p>

      <section className="card stack" aria-labelledby="cert-download">
        <h2 id="cert-download">1. Télécharger le certificat</h2>
        <a className="btn primary big" href={CERTIFICATE_URL} download={CERTIFICATE_FILE_NAME}>
          Télécharger le certificat
        </a>
        <p className="muted small">Fichier {CERTIFICATE_FILE_NAME}. Il est public : il ne contient aucun secret.</p>
      </section>

      <section className="card stack" aria-labelledby="cert-install">
        <h2 id="cert-install">2. Installer sur cet appareil : {current.title}</h2>
        <ol className="cert-steps">
          {current.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className="muted small">
          Une fois installé, rechargez la page d’accueil de PartyHub. Si l’avertissement persiste, fermez complètement
          le navigateur puis rouvrez-le.
        </p>
      </section>

      <details className="card">
        <summary>Installer sur un autre appareil</summary>
        <div className="stack">
          {others.map((p) => (
            <div key={p}>
              <h3>{INSTALL_STEPS[p].title}</h3>
              <ol className="cert-steps">
                {INSTALL_STEPS[p].steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </details>

      <p className="muted small">
        Avant l’installation, le navigateur affiche un avertissement sur cette page : c’est normal. Choisissez « Avancé
        », puis « Continuer », pour arriver ici et télécharger le fichier.
      </p>
    </main>
  );
}
