/**
 * Particules : un tampon de taille fixe réutilisé d'une image à l'autre (aucune allocation dans la boucle).
 * Unités : pixels sources du décor (une tuile = 16) ; la durée est en pas de 1/60 s.
 */
export class Particles {
  readonly capacity: number;
  private readonly x: Float32Array;
  private readonly y: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly life: Uint16Array;
  private readonly color: Uint8Array;
  private readonly size: Uint8Array;
  private readonly gravity: Float32Array;
  private head = 0;
  /** Nombre de particules vivantes (pour les tests). */
  alive = 0;

  constructor(capacity = 320) {
    this.capacity = capacity;
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vy = new Float32Array(capacity);
    this.life = new Uint16Array(capacity);
    this.color = new Uint8Array(capacity);
    this.size = new Uint8Array(capacity);
    this.gravity = new Float32Array(capacity);
  }

  /** Ajoute une particule ; quand le tampon est plein, la plus ancienne est remplacée. */
  spawn(x: number, y: number, vx: number, vy: number, life: number, color: number, size = 1, gravity = 0.06): void {
    const i = this.head;
    this.head = (this.head + 1) % this.capacity;
    if (this.life[i] === 0) this.alive++;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.life[i] = Math.max(1, Math.round(life));
    this.color[i] = color;
    this.size[i] = size;
    this.gravity[i] = gravity;
  }

  /** Un pas de simulation. */
  update(): void {
    let alive = 0;
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] === 0) continue;
      this.life[i]!--;
      this.vy[i]! += this.gravity[i]!;
      this.x[i]! += this.vx[i]!;
      this.y[i]! += this.vy[i]!;
      if (this.life[i]! > 0) alive++;
    }
    this.alive = alive;
  }

  /** Parcourt les particules vivantes. */
  each(fn: (x: number, y: number, color: number, size: number, life: number) => void): void {
    for (let i = 0; i < this.capacity; i++) {
      const life = this.life[i]!;
      if (life > 0) fn(this.x[i]!, this.y[i]!, this.color[i]!, this.size[i]!, life);
    }
  }

  clear(): void {
    this.life.fill(0);
    this.alive = 0;
  }
}
