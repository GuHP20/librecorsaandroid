/**
 * Physics surfaces named by what the circuit draws, where its converted physics got them wrong (per circuit, in code,
 * like the venue models: no hosted file changes).
 *
 * - Red Bull Ring: its physics counts the yellow kerbs and kerb cubes inside Castrol Edge (turn 1) and Remus (turn 2)
 *   as kerb and road, out to the grass: a car with all four wheels past the red and white kerb, on the yellow kerb and
 *   the cubes, stayed on the track (players' board laps went 8.4-8.9 m inside the line there). The yellow kerb and the
 *   cubes are sausages, past the track limits (the surface table's `sausage`, not part of the track); the South
 *   course's Castrol Edge too.
 *
 * Each rule takes the circuit's physics faces lying under the drawn meshes of its materials, where it applies, and
 * moves them to a `Track_Surface_<Kind>` node at their own heights: the ground the car drives on is unchanged, only
 * what it is called. Faces across the drawn edge are split (quartered down to `PIECE_M`) so the cut follows it.
 */
import * as THREE from "three";
import type { BuiltTrackData } from "@/lib/track-data";
import type { SurfaceTable, TrackSurfaceKind } from "./track-surfaces";

export interface DrawnSurfaceRule {
  /** Drawn materials (by name), or the circuit's own racing-surface materials (`metadata.mesh.roadMaterials`) */
  materials: readonly string[] | "roadMaterials";
  /** What the physics under them is */
  surface: TrackSurfaceKind;
  /** The physics surfaces the rule renames (all when absent) */
  from?: readonly TrackSurfaceKind[];
  /**
   * Where it applies: lap stretches [from, to] (m) on a side (-1 left, +1 right), or anywhere between the lap's
   * barriers (each side's barrier distance at that point of the lap, `wallLeftM` / `wallRightM`)
   */
  within: { stretches: readonly (readonly [number, number, -1 | 1])[] } | "barriers";
  /**
   * Drawn materials that lie on the rule's ground in places (a sand or grass patch drawn over the street mesh, a
   * millimetre apart): where one of them is within `COVER_M` of a point, the ground there is not the rule's
   */
  covers?: readonly string[];
  /** How fine a face across the drawn edge is cut (m; default `PIECE_M`) */
  pieceM?: number;
  note: string;
}

/** The Red Bull Ring's curb_yellow, curb_cubes (two) and curb_cubes_red: the same names in the venue pair and the full GLB */
const RED_BULL_RING_SAUSAGES = ["Material #12016", "Material #13667", "Material #19120", "Material #19526"];

export const DRAWN_SURFACE_RULES: Readonly<Record<string, readonly DrawnSurfaceRule[]>> = {
  spielberg: [
    {
      materials: RED_BULL_RING_SAUSAGES,
      surface: "sausage",
      within: {
        stretches: [
          [295, 360, 1],
          [1240, 1300, 1],
        ],
      },
      note: "the yellow kerbs and cubes inside Castrol Edge (turn 1) and Remus (turn 2)",
    },
  ],
  // The South course runs through the same Castrol Edge (and leaves before Remus)
  spielberg_south: [
    {
      materials: RED_BULL_RING_SAUSAGES,
      surface: "sausage",
      within: { stretches: [[295, 360, 1]] },
      note: "the yellow kerbs and cubes inside Castrol Edge (turn 1)",
    },
  ],
};

/** The physics nodes a rule may rename, by the surface each holds */
const SURFACE_NODES: Readonly<Record<string, TrackSurfaceKind>> = {
  Track_Surface_Road: "road",
  Track_Surface_Apron: "road",
  Track_Surface_Kerb: "kerb",
  Track_Surface_Runoff: "runoff",
  Track_Surface_Gravel: "gravel",
  Track_Surface_Grass: "grass",
};
/** A physics face this close (m) above or below the drawn ground lies under it */
const UNDER_DRAWN_M = 1;
/** A cover this close (m) above or below a point covers the rule's ground there */
const COVER_M = 0.3;
/** Faces across the drawn edge are quartered until their longest side is under this (m) */
const PIECE_M = 0.25;
const CELL_M = 4;

/** A mesh's drawn material name: the material itself in the game, the name the Node loader keeps in scripts */
function materialName(mesh: THREE.Mesh): string {
  const m = mesh.material;
  const name = Array.isArray(m) ? "" : (m?.name ?? "");
  return name || ((mesh.userData.materialName as string | undefined) ?? "");
}

const isPhysics = (o: THREE.Object3D, root: THREE.Object3D): boolean => {
  for (let p: THREE.Object3D | null = o; p && p !== root; p = p.parent) {
    if (/^Track_(Collider|Surface)_/.test(p.name) || p.userData?.collider || p.userData?.hidden) return true;
  }
  return false;
};

/** The surface of the physics node a mesh belongs to (itself or the nearest named ancestor), or null */
function nodeSurface(o: THREE.Object3D, root: THREE.Object3D): TrackSurfaceKind | null {
  for (let p: THREE.Object3D | null = o; p && p !== root; p = p.parent) if (SURFACE_NODES[p.name]) return SURFACE_NODES[p.name];
  return null;
}

type V3 = THREE.Vector3;
function forEachTri(mesh: THREE.Mesh, fn: (p: V3, q: V3, r: V3, i: number[]) => void): void {
  const g = mesh.geometry as THREE.BufferGeometry;
  const pos = g.getAttribute("position");
  if (!pos) return;
  const idx = g.getIndex();
  const n = idx ? idx.count : pos.count;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let k = 0; k + 2 < n; k += 3) {
    const i = [0, 1, 2].map((j) => (idx ? idx.getX(k + j) : k + j));
    fn(a.fromBufferAttribute(pos, i[0]).applyMatrix4(mesh.matrixWorld), b.fromBufferAttribute(pos, i[1]).applyMatrix4(mesh.matrixWorld), c.fromBufferAttribute(pos, i[2]).applyMatrix4(mesh.matrixWorld), i);
  }
}

/**
 * The upward faces of the drawn meshes with these materials, where `keep` takes their middle, on an XZ grid;
 * `covers(x, y, z, dy)` = one of them lies over (x, z) within `dy` of height y
 */
function drawnGround(root: THREE.Object3D, mats: ReadonlySet<string>, keep: (x: number, z: number) => boolean) {
  const tris: number[] = [];
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !mats.has(materialName(o)) || isPhysics(o, root)) return;
    forEachTri(o, (p, q, r) => {
      const ny = (q.z - p.z) * (r.x - p.x) - (q.x - p.x) * (r.z - p.z);
      const len = Math.hypot((q.y - p.y) * (r.z - p.z) - (q.z - p.z) * (r.y - p.y), ny, (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
      if (len < 1e-9 || Math.abs(ny) / len < 0.5) return;
      if (!keep((p.x + q.x + r.x) / 3, (p.z + q.z + r.z) / 3)) return;
      tris.push(p.x, p.y, p.z, q.x, q.y, q.z, r.x, r.y, r.z);
    });
  });
  const grid = new Map<number, number[]>();
  const key = (cx: number, cz: number) => cx * 73856093 + cz * 19349663;
  for (let t = 0; t < tris.length / 9; t++) {
    const o = t * 9;
    const x0 = Math.floor(Math.min(tris[o], tris[o + 3], tris[o + 6]) / CELL_M), x1 = Math.floor(Math.max(tris[o], tris[o + 3], tris[o + 6]) / CELL_M);
    const z0 = Math.floor(Math.min(tris[o + 2], tris[o + 5], tris[o + 8]) / CELL_M), z1 = Math.floor(Math.max(tris[o + 2], tris[o + 5], tris[o + 8]) / CELL_M);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) (grid.get(key(cx, cz)) ?? grid.set(key(cx, cz), []).get(key(cx, cz))!).push(t);
  }
  const covers = (x: number, y: number, z: number, dy: number): boolean => {
    const list = grid.get(key(Math.floor(x / CELL_M), Math.floor(z / CELL_M)));
    if (!list) return false;
    for (const t of list) {
      const o = t * 9;
      const v0x = tris[o + 3] - tris[o], v0z = tris[o + 5] - tris[o + 2], v1x = tris[o + 6] - tris[o], v1z = tris[o + 8] - tris[o + 2];
      const den = v0x * v1z - v1x * v0z;
      if (Math.abs(den) < 1e-12) continue;
      const px = x - tris[o], pz = z - tris[o + 2];
      const u = (px * v1z - v1x * pz) / den, v = (v0x * pz - px * v0z) / den;
      if (u < 0 || v < 0 || u + v > 1) continue;
      const h = tris[o + 1] + u * (tris[o + 4] - tris[o + 1]) + v * (tris[o + 7] - tris[o + 1]);
      if (Math.abs(h - y) <= dy) return true;
    }
    return false;
  };
  /** Some face's box overlaps the box x0..x1, z0..z1 at heights within y0..y1 (a cheap test before the exact ones) */
  const touches = (x0: number, z0: number, x1: number, z1: number, y0: number, y1: number): boolean => {
    for (let cx = Math.floor(x0 / CELL_M); cx <= Math.floor(x1 / CELL_M); cx++) {
      for (let cz = Math.floor(z0 / CELL_M); cz <= Math.floor(z1 / CELL_M); cz++) {
        for (const t of grid.get(key(cx, cz)) ?? []) {
          const o = t * 9;
          if (Math.max(tris[o], tris[o + 3], tris[o + 6]) < x0 || Math.min(tris[o], tris[o + 3], tris[o + 6]) > x1) continue;
          if (Math.max(tris[o + 2], tris[o + 5], tris[o + 8]) < z0 || Math.min(tris[o + 2], tris[o + 5], tris[o + 8]) > z1) continue;
          if (Math.max(tris[o + 1], tris[o + 4], tris[o + 7]) < y0 || Math.min(tris[o + 1], tris[o + 4], tris[o + 7]) > y1) continue;
          return true;
        }
      }
    }
    return false;
  };
  return { tris, covers, touches };
}

/**
 * Applies a circuit's rules to its fitted physics surfaces (TrackColliderQuery.fromTrackRoot's `prepare`). Returns the
 * area renamed (m², per surface); nothing changes on a circuit without rules.
 */
export function applyDrawnSurfaceRules(
  root: THREE.Object3D,
  track: BuiltTrackData,
  roadMaterials: readonly string[] = [],
  rules = DRAWN_SURFACE_RULES[track.id ?? ""],
  table?: SurfaceTable
): Record<string, number> {
  const done: Record<string, number> = {};
  if (!rules?.length) return done;
  root.updateMatrixWorld(true);
  for (const rule of rules) {
    const from = rule.from ? new Set(rule.from) : null;
    const within = rule.within;

    // Where the rule applies: within its stretches (judged once per drawn face, by its middle) or between the
    // barriers (judged per point, from its place on the lap)
    const stretchBoxes = within === "barriers" ? [] : within.stretches.map(([s0, s1]) => {
      const bx = new THREE.Box3();
      const len = (((s1 - s0) % track.totalLengthM) + track.totalLengthM) % track.totalLengthM;
      for (let d = 0; d <= len; d += 5) bx.expandByPoint(track.getSampleAtDistance(s0 + d).position);
      return bx.expandByScalar(40);
    });
    const inStretch = (x: number, z: number): boolean => {
      if (within === "barriers") return true;
      const k = stretchBoxes.findIndex((bx) => x >= bx.min.x && x <= bx.max.x && z >= bx.min.z && z <= bx.max.z);
      if (k < 0) return false;
      // (the stretch's middle as the projection's hint: a search along the lap from there, not round all of it)
      const [s0, s1] = within.stretches[k];
      const p = track.projectWorldToTrack(x, z, s0 + ((((s1 - s0) % track.totalLengthM) + track.totalLengthM) % track.totalLengthM) / 2);
      const side = p.lateralOffset >= 0 ? 1 : -1;
      return within.stretches.some(([s0, s1, sd]) => sd === side && (s0 <= s1 ? p.s >= s0 && p.s <= s1 : p.s >= s0 || p.s <= s1));
    };
    // Between the barriers: the strip from each sample's left barrier to its right one, as triangles on an XZ grid
    const strip: number[] = [];
    if (within === "barriers") {
      const S = track.samples;
      const wallL = (i: number) => S[i].wallLeftM ?? S[i].width / 2;
      const wallR = (i: number) => S[i].wallRightM ?? S[i].width / 2;
      const ends = S.map((q, i) => {
        const bl = Math.hypot(q.binormal.x, q.binormal.z) || 1;
        const bx = q.binormal.x / bl, bz = q.binormal.z / bl;
        const wl = wallL(i), wr = wallR(i);
        return [q.position.x - bx * wl, q.position.z - bz * wl, q.position.x + bx * wr, q.position.z + bz * wr];
      });
      for (let i = 0; i < S.length; i++) {
        const a = ends[i], b = ends[(i + 1) % S.length];
        strip.push(a[0], a[1], a[2], a[3], b[2], b[3], a[0], a[1], b[2], b[3], b[0], b[1]);
      }
    }
    const stripGrid = new Map<number, number[]>();
    for (let t = 0; t < strip.length / 6; t++) {
      const o = t * 6;
      const x0 = Math.floor(Math.min(strip[o], strip[o + 2], strip[o + 4]) / CELL_M), x1 = Math.floor(Math.max(strip[o], strip[o + 2], strip[o + 4]) / CELL_M);
      const z0 = Math.floor(Math.min(strip[o + 1], strip[o + 3], strip[o + 5]) / CELL_M), z1 = Math.floor(Math.max(strip[o + 1], strip[o + 3], strip[o + 5]) / CELL_M);
      for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) (stripGrid.get(cx * 73856093 + cz * 19349663) ?? stripGrid.set(cx * 73856093 + cz * 19349663, []).get(cx * 73856093 + cz * 19349663)!).push(t);
    }
    const betweenBarriers = (x: number, z: number): boolean => {
      for (const t of stripGrid.get(Math.floor(x / CELL_M) * 73856093 + Math.floor(z / CELL_M) * 19349663) ?? []) {
        const o = t * 6;
        const v0x = strip[o + 2] - strip[o], v0z = strip[o + 3] - strip[o + 1], v1x = strip[o + 4] - strip[o], v1z = strip[o + 5] - strip[o + 1];
        const den = v0x * v1z - v1x * v0z;
        if (Math.abs(den) < 1e-12) continue;
        const px = x - strip[o], pz = z - strip[o + 1];
        const u = (px * v1z - v1x * pz) / den, v = (v0x * pz - px * v0z) / den;
        if (u >= 0 && v >= 0 && u + v <= 1) return true;
      }
      return false;
    };

    // The drawn ground of the rule's materials (upward faces) within where it applies, and its covers near it
    const drawn = drawnGround(root, new Set(rule.materials === "roadMaterials" ? roadMaterials : rule.materials), (x, z) => inStretch(x, z));
    if (!drawn.tris.length) continue;
    const covers = rule.covers?.length ? drawnGround(root, new Set(rule.covers), () => true) : null;
    const underDrawn = (x: number, y: number, z: number): boolean =>
      drawn.covers(x, y, z, UNDER_DRAWN_M) && !(covers?.covers(x, y, z, COVER_M) ?? false);
    /** The face's box overlaps some drawn face's box: it may hold drawn ground no vote point lands on */
    const touchesFace = (f: number[][]): boolean =>
      drawn.touches(
        Math.min(f[0][0], f[1][0], f[2][0]),
        Math.min(f[0][2], f[1][2], f[2][2]),
        Math.max(f[0][0], f[1][0], f[2][0]),
        Math.max(f[0][2], f[1][2], f[2][2]),
        Math.min(f[0][1], f[1][1], f[2][1]) - UNDER_DRAWN_M,
        Math.max(f[0][1], f[1][1], f[2][1]) + UNDER_DRAWN_M
      );

    // Split each physics face by where the rule applies: its middle, corners and side middles (a tenth of the way in)
    // vote; a face they don't agree on is quartered until its pieces are under PIECE_M, then its middle decides
    type Corner = number[]; // x, y, z, u, v
    const mid = (p: Corner, q: Corner): Corner => p.map((v, k) => (v + q[k]) / 2);
    const longest = (f: Corner[]) => Math.max(...[0, 1, 2].map((k) => Math.hypot(f[(k + 1) % 3][0] - f[k][0], f[(k + 1) % 3][2] - f[k][2])));
    const areaXZ = (f: Corner[]) => Math.abs((f[1][0] - f[0][0]) * (f[2][2] - f[0][2]) - (f[2][0] - f[0][0]) * (f[1][2] - f[0][2])) / 2;
    const box = new THREE.Box3();
    for (let i = 0; i < drawn.tris.length; i += 3) box.expandByPoint(new THREE.Vector3(drawn.tris[i], drawn.tris[i + 1], drawn.tris[i + 2]));
    box.expandByScalar(UNDER_DRAWN_M);

    /** The renamed pieces, by the surface they were */
    const moved = new Map<TrackSurfaceKind, number[]>();
    const inside = (x: number, y: number, z: number) => underDrawn(x, y, z) && (within !== "barriers" || betweenBarriers(x, z));
    const vote = (g: Corner[]) => {
      const mx = (g[0][0] + g[1][0] + g[2][0]) / 3, my = (g[0][1] + g[1][1] + g[2][1]) / 3, mz = (g[0][2] + g[1][2] + g[2][2]) / 3;
      const middle = inside(mx, my, mz);
      let n = middle ? 1 : 0;
      for (let k = 0; k < 3; k++) {
        const a = g[k], b = g[(k + 1) % 3];
        if (inside(a[0] + 0.1 * (mx - a[0]), a[1] + 0.1 * (my - a[1]), a[2] + 0.1 * (mz - a[2]))) n++;
        const sx = (a[0] + b[0]) / 2, sy = (a[1] + b[1]) / 2, sz = (a[2] + b[2]) / 2;
        if (inside(sx + 0.1 * (mx - sx), sy + 0.1 * (my - sy), sz + 0.1 * (mz - sz))) n++;
      }
      return { all: n === 7, none: n === 0, middle };
    };
    const targets: THREE.Mesh[] = [];
    root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const kind = nodeSurface(o, root);
      if (kind && kind !== rule.surface && (!from || from.has(kind))) targets.push(o);
    });
    for (const mesh of targets) {
      const fromKind = nodeSurface(mesh, root) as TrackSurfaceKind;
      const out = moved.get(fromKind) ?? moved.set(fromKind, []).get(fromKind)!;
      const geom = mesh.geometry as THREE.BufferGeometry;
      const pos = geom.getAttribute("position");
      if (!pos) continue;
      const idx = geom.getIndex();
      const uv = geom.getAttribute("uv");
      const nTri = Math.floor((idx ? idx.count : pos.count) / 3);
      // The drawn footprint's box in the mesh's own space: faces clear of it are kept without reading them further
      const toLocal = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
      const lbox = box.clone().applyMatrix4(toLocal);
      const v = new THREE.Vector3();
      const W = new Float64Array(pos.count * 3);
      const done3 = new Uint8Array(pos.count);
      const world = (i: number) => {
        if (!done3[i]) {
          v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
          W[i * 3] = v.x;
          W[i * 3 + 1] = v.y;
          W[i * 3 + 2] = v.z;
          done3[i] = 1;
        }
        return i * 3;
      };
      const vi = (t: number, k: number) => (idx ? idx.getX(t * 3 + k) : t * 3 + k);
      const clear = (i: number) => {
        const x = pos.getX(i), z = pos.getZ(i);
        return x < lbox.min.x || x > lbox.max.x || z < lbox.min.z || z > lbox.max.z;
      };
      // Faces near the drawn ground (a corner or the middle under it, inside its box); the rest stay as they are
      const near = new Uint8Array(nTri);
      let any = false;
      for (let t = 0; t < nTri; t++) {
        if (clear(vi(t, 0)) && clear(vi(t, 1)) && clear(vi(t, 2))) continue;
        const a = world(vi(t, 0)), b = world(vi(t, 1)), c = world(vi(t, 2));
        if (touchesFace([[W[a], W[a + 1], W[a + 2]], [W[b], W[b + 1], W[b + 2]], [W[c], W[c + 1], W[c + 2]]])) {
          near[t] = 1;
          any = true;
        }
      }
      if (!any) continue;
      const corner = (i: number): Corner => {
        const o = world(i);
        return [W[o], W[o + 1], W[o + 2], uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0];
      };
      const kept: Corner[][] = [];
      let changed = false;
      for (let t = 0; t < nTri; t++) {
        const f: Corner[] = [corner(vi(t, 0)), corner(vi(t, 1)), corner(vi(t, 2))];
        if (!near[t]) {
          kept.push(f);
          continue;
        }
        let todo: Corner[][] = [f];
        for (let depth = 0; depth <= 12 && todo.length; depth++) {
          const next: Corner[][] = [];
          for (const g of todo) {
            const vt = vote(g);
            const last = depth === 12 || longest(g) < (rule.pieceM ?? PIECE_M);
            // (a face its votes miss may still hold a narrow drawn strip: split it while it touches one)
            if ((vt.none && (last || !touchesFace(g))) || (last && !vt.all && !vt.middle)) kept.push(g);
            else if (vt.all || last) {
              for (const c of g) out.push(c[0], c[1], c[2]);
              done[rule.surface] = (done[rule.surface] ?? 0) + areaXZ(g);
              changed = true;
            } else {
              const ab = mid(g[0], g[1]), bc = mid(g[1], g[2]), ca = mid(g[2], g[0]);
              next.push([g[0], ab, ca], [ab, g[1], bc], [ca, bc, g[2]], [ab, bc, ca]);
            }
          }
          todo = next;
        }
      }
      if (!changed) continue;
      // Rebuilt unindexed in the mesh's own space, keeping its texture coordinates (the kerb ripple reads them)
      const keptPos = new Float32Array(kept.length * 9);
      kept.forEach((f, i) => f.forEach((p, k) => {
        v.set(p[0], p[1], p[2]).applyMatrix4(toLocal);
        keptPos[i * 9 + k * 3] = v.x;
        keptPos[i * 9 + k * 3 + 1] = v.y;
        keptPos[i * 9 + k * 3 + 2] = v.z;
      }));
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(keptPos, 3));
      if (uv) {
        const uvs = new Float32Array(kept.length * 6);
        kept.forEach((f, i) => f.forEach((p, k) => {
          uvs[i * 6 + k * 2] = p[3];
          uvs[i * 6 + k * 2 + 1] = p[4];
        }));
        g.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
      }
      mesh.geometry = g;
    }
    for (const [fromKind, pieces] of moved) {
      if (!pieces.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pieces), 3));
      const node = new THREE.Mesh(g);
      const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
      node.name = `Track_Surface_${cap(rule.surface)}_Drawn_From_${cap(fromKind)}`;
      node.userData = { surface: rule.surface, hidden: true, rule: rule.note };
      // A raised kerb renamed keeps the most it may stand over the ground under it (the circuit's kerb `maxRiseM`)
      const rise = table?.[fromKind]?.maxRiseM;
      if (rise !== undefined && Number.isFinite(rise)) node.userData.maxRiseM = rise;
      root.add(node);
      root.updateMatrixWorld(true);
    }
  }
  return done;
}
