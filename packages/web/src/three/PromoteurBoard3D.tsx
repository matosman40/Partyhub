import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  AvatarsContext,
  STACK_OFFSETS,
  cellOf,
  usePrefersReducedMotion,
  type AvatarData,
  type PlayerPub,
  type PromoteurPub,
  type TilePub,
} from '@partyhub/games/client';
import { FONT, avatarTexture, centreTexture, dieFaceTexture, hueOf, tileTexture } from './textures';

/**
 * Plateau du Promoteur en 3D (écran TV uniquement). Même données et même disposition
 * que la vue 2D : seule la présentation change. Les pions sautent d'une case à l'autre,
 * les dés roulent puis s'arrêtent sur la valeur décidée par le serveur.
 */

const CELL = 1;
const TILE = 0.92;
const TILE_H = 0.08;
const PAWN_R = 0.27;
const PAWN_H = 0.2;
const PAWN_BASE = TILE_H;
const STEP_S = 0.17;
const DIE = 0.6;
const ROLL_S = 0.9;

/** Position monde d'un pion : centre de la case, décalé s'il partage la case. */
function worldOf(index: number, slot: number): THREE.Vector3 {
  const { col, row } = cellOf(index);
  const [dx, dy] = STACK_OFFSETS[slot % STACK_OFFSETS.length] ?? [0, 0];
  return new THREE.Vector3((col - 3 + dx) * CELL, PAWN_BASE + PAWN_H / 2, (row - 3 + dy) * CELL);
}

/** Valeurs des faces d'un dé (faces opposées : somme 7). Ordre : +x, -x, +y, -y, +z, -z. */
const DIE_FACES: number[] = [1, 6, 2, 5, 3, 4];
const DIE_NORMALS: THREE.Vector3[] = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, -1, 0),
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(0, 0, -1),
];

/** Orientation qui pose la face de valeur `value` vers le haut. */
function restingQuaternion(value: number): THREE.Quaternion {
  const f = DIE_FACES.indexOf(value);
  const normal = DIE_NORMALS[f >= 0 ? f : 0] ?? new THREE.Vector3(0, 1, 0);
  return new THREE.Quaternion().setFromUnitVectors(normal, new THREE.Vector3(0, 1, 0));
}

/** Attend le chargement de la police avant de dessiner les textures (sinon, repli système). */
function useFontsReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    const fonts = document.fonts;
    const loaded = fonts ? fonts.load(`700 46px ${FONT}`).then(() => fonts.ready) : Promise.resolve();
    loaded
      .catch(() => undefined)
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);
  return ready;
}

function Tile({ tile, owner, pending }: { tile: TilePub; owner: PlayerPub | undefined; pending: boolean }) {
  const { col, row } = cellOf(tile.index);
  const topTex = useMemo(
    () => tileTexture(tile, owner, pending),
    // Les seules données qui changent l'aspect de la case.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tile.name, tile.price, tile.group, tile.houses, tile.owner, owner?.name, pending],
  );
  useEffect(() => () => topTex.dispose(), [topTex]);
  const side = useMemo(() => new THREE.MeshStandardMaterial({ color: '#1d1543', roughness: 0.75 }), []);
  const top = useMemo(() => new THREE.MeshStandardMaterial({ map: topTex, roughness: 0.42 }), [topTex]);
  useEffect(() => () => side.dispose(), [side]);
  useEffect(() => () => top.dispose(), [top]);
  return (
    <mesh
      position={[(col - 3) * CELL, TILE_H / 2, (row - 3) * CELL]}
      castShadow
      receiveShadow
      material={[side, side, top, side, side, side]}
    >
      <boxGeometry args={[TILE, TILE_H, TILE]} />
    </mesh>
  );
}

function Centre({ pub }: { pub: PromoteurPub }) {
  const key = `${pub.phase}|${pub.round}|${pub.currentName}|${pub.lastEvent}|${pub.ranking.map((r) => `${r.name}:${r.points}`).join(',')}`;
  const tex = useMemo(() => centreTexture(pub), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => tex.dispose(), [tex]);
  return (
    <mesh position={[0, TILE_H + 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[4.6, 4.6]} />
      <meshStandardMaterial map={tex} roughness={0.6} />
    </mesh>
  );
}

/** Un pion : cylindre à la couleur du joueur, avec son avatar (photo ou emoji) sur le dessus. */
function Pawn({
  player,
  index,
  slot,
  current,
  avatar,
  reduced,
}: {
  player: PlayerPub;
  index: number;
  slot: number;
  current: boolean;
  avatar: AvatarData | undefined;
  reduced: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  const target = useMemo(() => worldOf(index, slot), [index, slot]);
  const motion = useRef({ from: target.clone(), to: target.clone(), t: 1 });

  const info: AvatarData = avatar ?? {
    hue: hueOf(player.name),
    emoji: player.name.charAt(0).toUpperCase(),
    imageUrl: null,
  };
  const faceTex = useMemo(
    () => avatarTexture(info, player.name),
    [info.hue, info.emoji, info.imageUrl, player.name], // eslint-disable-line react-hooks/exhaustive-deps
  );
  useEffect(() => () => faceTex.dispose(), [faceTex]);
  const sideMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(`hsl(${info.hue} 80% 58%)`),
        roughness: 0.35,
        metalness: 0.1,
      }),
    [info.hue],
  );
  const topMat = useMemo(() => new THREE.MeshStandardMaterial({ map: faceTex, roughness: 0.5 }), [faceTex]);
  const bottomMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#0d0a1f' }), []);
  useEffect(
    () => () => {
      sideMat.dispose();
      topMat.dispose();
      bottomMat.dispose();
    },
    [sideMat, topMat, bottomMat],
  );

  // Quand la case change, le pion part de sa position courante vers la nouvelle case.
  // Avec « réduire les animations », il est posé directement sur sa case.
  useEffect(() => {
    const g = group.current;
    if (!g) return;
    motion.current.from.copy(g.position);
    motion.current.to.copy(target);
    motion.current.t = reduced ? 1 : 0;
    if (reduced) g.position.copy(target);
  }, [target, reduced]);

  useFrame((state, delta) => {
    const g = group.current;
    if (!g) return;
    const m = motion.current;
    if (m.t < 1) m.t = Math.min(1, m.t + delta / STEP_S);
    const e = m.t * m.t * (3 - 2 * m.t);
    g.position.lerpVectors(m.from, m.to, e);
    const hop = reduced ? 0 : Math.sin(Math.PI * m.t) * 0.32;
    const idle = current && m.t >= 1 && !reduced ? Math.sin(state.clock.elapsedTime * 3) * 0.035 : 0;
    g.position.y = target.y + hop + idle;
  });

  return (
    <group ref={group} castShadow>
      <mesh castShadow receiveShadow material={[sideMat, topMat, bottomMat]}>
        <cylinderGeometry args={[PAWN_R, PAWN_R, PAWN_H, 48]} />
      </mesh>
      {current && (
        <mesh position={[0, -PAWN_H / 2 + 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[PAWN_R + 0.04, PAWN_R + 0.1, 48]} />
          <meshBasicMaterial color="#ffd166" transparent opacity={0.85} />
        </mesh>
      )}
    </group>
  );
}

/** Un dé : tourne sur lui-même à chaque lancer, puis s'arrête face à la valeur du serveur. */
function Die({
  value,
  rollKey,
  x,
  z,
  visible,
  reduced,
}: {
  value: number;
  rollKey: string;
  x: number;
  z: number;
  visible: boolean;
  reduced: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  const roll = useRef({
    from: new THREE.Quaternion(),
    to: restingQuaternion(value),
    axis: new THREE.Vector3(0, 1, 0),
    t: 1,
  });
  const faces = useMemo(() => DIE_FACES.map((v) => dieFaceTexture(v)), []);
  const materials = useMemo(
    () => faces.map((map) => new THREE.MeshStandardMaterial({ map, roughness: 0.25 })),
    [faces],
  );
  useEffect(
    () => () => {
      faces.forEach((f) => f.dispose());
      materials.forEach((m) => m.dispose());
    },
    [faces, materials],
  );

  // Nouveau lancer : on repart de l'orientation actuelle vers la nouvelle valeur.
  useEffect(() => {
    const g = group.current;
    if (!g) return;
    roll.current.from.copy(g.quaternion);
    roll.current.to.copy(restingQuaternion(value));
    roll.current.axis.set(Math.random() - 0.5, Math.random() + 0.2, Math.random() - 0.5).normalize();
    roll.current.t = reduced ? 1 : 0;
  }, [rollKey, reduced]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((_, delta) => {
    const g = group.current;
    if (!g) return;
    const r = roll.current;
    if (r.t < 1) r.t = Math.min(1, r.t + delta / ROLL_S);
    const e = 1 - Math.pow(1 - r.t, 3);
    const base = new THREE.Quaternion().slerpQuaternions(r.from, r.to, e);
    // Tumble qui s'amortit : la rotation supplémentaire disparaît à l'arrivée.
    const spin = new THREE.Quaternion().setFromAxisAngle(r.axis, (1 - e) * Math.PI * 4);
    g.quaternion.copy(spin).multiply(base);
    g.position.y = DIE / 2 + TILE_H + Math.sin(Math.PI * r.t) * 0.7;
  });

  return (
    <group ref={group} position={[x, DIE / 2 + TILE_H, z]} visible={visible}>
      <mesh castShadow receiveShadow material={materials}>
        <boxGeometry args={[DIE, DIE, DIE]} />
      </mesh>
    </group>
  );
}

function Scene({
  pub,
  shown,
  avatars,
  reduced,
}: {
  pub: PromoteurPub;
  shown: Record<string, number>;
  avatars: Record<string, AvatarData>;
  reduced: boolean;
}) {
  const owners = new Map(pub.players.map((p) => [p.id, p]));
  const perTile = new Map<number, number>();
  const pawns = pub.players.map((p) => {
    const index = shown[p.id] ?? p.pos;
    const slot = perTile.get(index) ?? 0;
    perTile.set(index, slot + 1);
    return { player: p, index, slot };
  });
  const pendingIndex = pub.phase === 'decide' ? pub.pending?.index : undefined;

  return (
    <>
      <hemisphereLight args={['#e4dcff', '#140c2e', 0.85]} />
      <ambientLight intensity={0.25} />
      <directionalLight
        position={[4.5, 9, 5]}
        intensity={1.5}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-6}
        shadow-camera-right={6}
        shadow-camera-top={6}
        shadow-camera-bottom={-6}
        shadow-bias={-0.0005}
      />

      {/* Plateau : socle sombre, cases, panneau central. */}
      <mesh position={[0, -0.2, 0]} receiveShadow>
        <boxGeometry args={[7.7, 0.3, 7.7]} />
        <meshStandardMaterial color="#120c26" roughness={0.9} />
      </mesh>
      {pub.board.map((tile) => (
        <Tile
          key={tile.index}
          tile={tile}
          owner={tile.owner ? owners.get(tile.owner) : undefined}
          pending={pendingIndex === tile.index}
        />
      ))}
      <Centre pub={pub} />

      {pawns.map(({ player, index, slot }) => (
        <Pawn
          key={player.id}
          player={player}
          index={index}
          slot={slot}
          current={player.id === pub.current}
          avatar={avatars[player.name]}
          reduced={reduced}
        />
      ))}

      {/* Dés dans les coins vides du panneau central, loin du texte. */}
      <Die
        value={pub.dice?.[0] ?? 1}
        rollKey={pub.lastEvent}
        x={-1.55}
        z={-1.55}
        visible={!!pub.dice}
        reduced={reduced}
      />
      <Die
        value={pub.dice?.[1] ?? 1}
        rollKey={pub.lastEvent}
        x={1.55}
        z={-1.55}
        visible={!!pub.dice}
        reduced={reduced}
      />
    </>
  );
}

export interface PromoteurBoard3DProps {
  pub: PromoteurPub;
  /** Positions affichées des pions (avancent case par case, voir useSteppedPositions). */
  shown: Record<string, number>;
}

/** Scène 3D du plateau. Les positions affichées (`shown`) sont calculées par l'appelant. */
export default function PromoteurBoard3D({ pub, shown }: PromoteurBoard3DProps) {
  const avatars = useContext(AvatarsContext);
  const reduced = usePrefersReducedMotion();
  const fontsReady = useFontsReady();
  return (
    <div className="pm3d" data-reduced={reduced ? 'true' : undefined}>
      <Canvas
        camera={{ position: [0, 9.4, 7.8], fov: 36 }}
        shadows="percentage"
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        aria-label="Plateau du Promoteur en 3D"
        role="img"
      >
        {fontsReady && <Scene pub={pub} shown={shown} avatars={avatars} reduced={reduced} />}
      </Canvas>
    </div>
  );
}
