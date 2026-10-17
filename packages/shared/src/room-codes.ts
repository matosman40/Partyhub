/**
 * Codes de salle : des chiffres seulement, faciles à taper sur un téléphone et à lire sur un écran de TV.
 * L’administrateur choisit la longueur, de ROOM_CODE_MIN_LENGTH à ROOM_CODE_MAX_LENGTH chiffres. Une salle
 * garde le code qu’elle a reçu à sa création, même si la longueur change ensuite.
 */
export const ROOM_CODE_ALPHABET = '0123456789';
export const ROOM_CODE_DEFAULT_LENGTH = 4;
export const ROOM_CODE_MIN_LENGTH = 4;
export const ROOM_CODE_MAX_LENGTH = 6;

/** Un code valide a de ROOM_CODE_MIN_LENGTH à ROOM_CODE_MAX_LENGTH chiffres. */
export const ROOM_CODE_PATTERN = new RegExp(`^[0-9]{${ROOM_CODE_MIN_LENGTH},${ROOM_CODE_MAX_LENGTH}}$`);

export function normalizeRoomCode(input: string): string {
  return input.trim();
}

export function isValidRoomCode(code: string): boolean {
  return ROOM_CODE_PATTERN.test(code);
}
