import fs from 'node:fs';
import { generateSigningKeys } from '../packages/code-format.js';

/**
 * Commandes des jeux de code côté poste : génération des clés de signature.
 * La construction et le contrôle vivent dans code-games/build.ts, partagés avec l'éditeur de l'administration.
 */
export {
  buildCodePackage,
  checkCode,
  checkCodeBytes,
  isCodePackage,
  newCodeGame,
  packCode,
  type CodeCheckReport,
} from '../code-games/build.js';

/** Crée une paire de clés de signature : <préfixe>.key.pem (privée, lecture seule) et <préfixe>.pub.pem. */
export function keygen(prefix: string): string {
  const privatePath = `${prefix}.key.pem`;
  const publicPath = `${prefix}.pub.pem`;
  if (fs.existsSync(privatePath) || fs.existsSync(publicPath)) {
    throw new Error(`Des clés existent déjà sous « ${prefix} ».`);
  }
  const keys = generateSigningKeys();
  fs.writeFileSync(privatePath, keys.privatePem, { mode: 0o600 });
  fs.writeFileSync(publicPath, keys.publicPem);
  return keys.keyId;
}
