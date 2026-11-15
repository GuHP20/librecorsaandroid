/**
 * Physics surfaces named by what a circuit draws (src/lib/sim/drawn-surfaces.ts).
 *
 * 1. A straight with a 10 m road band, grass bands past it, a kerb on the left, barriers at 10 m and a drawn street
 *    12 m either side: grass under the drawn street between the barriers becomes road, grass past the barriers and
 *    under a drawn sand patch stays grass, and kerb under drawn cubes becomes a sausage only in the rule's stretch,
 *    with the kerb's texture coordinates kept. A circuit without rules is left as it is.
 * 2. Norisring: the street out to the barriers is the track (s 760, the Schoeller S and the inside lane into the Grundig
 *    hairpin), the gravel inside the hairpin and the car park past its outside kerb are not. Red Bull Ring (and its South course): a car past the red and white kerb inside Castrol Edge and
 *    Remus is off the track, one on the kerb is not.
 *
 *   npx tsx scripts/verify-drawn-surfaces.ts
 */
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { applyDrawnSurfaceRules, type DrawnSurfaceRule } from '../src/lib/sim/drawn-surfaces';
import { createGroundHit, TrackColliderQuery } from '../src/lib/sim/f12026-car/TrackColliderQuery';
import { DEFAULT_SURFACE_TABLE } from '../src/lib/sim/track-surfaces';
import { trackColliders } from '../src/lib/sim/track-colliders';
import { getActiveSurfaceTable, getActiveTrackData, getActiveTrackMetadata, setActiveTrack, type RawTrackJson } from '../src/lib/track-data';
import { createFlatTestTrack } from './lib/flat-track';
import { loadGlbGeometry, trackModelFiles } from './lib/glb-geometry';
import { hasFile, noteSkip } from './lib/hosted-files';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(96)} ${detail}`);
  if (!ok) failures.push(name);
};

// ---- 1. The fixture. The flat track runs along +Z; a lateral offset `lat` (+ right) is at x = -lat
/** A flat strip from lat a to lat b (m) along s 0..200 (in 2 m rows), as one mesh */
function strip(name: string, a: number, b: number, opts: { y?: number; s0?: number; s1?: number; material?: string; userData?: Record<string, unknown>; uv?: boolean } = {}): THREE.Mesh {
  const { y = 0, s0 = 0, s1 = 200 } = opts;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const rows = Math.round((s1 - s0) / 2);
  for (let i = 0; i <= rows; i++) {
    const s = s0 + ((s1 - s0) * i) / rows;
    for (const lat of [a, b]) {
      pos.push(-lat, y, s);
      uv.push(s / 6, lat === a ? 0 : 1);
    }
  }
  for (let i = 0; i < rows; i++) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (opts.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ name: opts.material ?? '' }));
  m.name = name;
  m.userData = opts.userData ?? {};
  return m;
}

function fixture(): THREE.Group {
  const root = new THREE.Group();
  root.add(strip('Track_Collider_Road', -20, 20, { userData: { collider: 'road', hidden: true } }));
  root.add(strip('Track_Surface_Road', -5, 5, { userData: { surface: 'road', grip: 1, hidden: true } }));
  root.add(strip('Track_Surface_Kerb', -6.5, -5, { userData: { surface: 'kerb', uvScaleM: 6, hidden: true }, uv: true }));
  const grass = strip('Track_Surface_Grass', 5, 20, { userData: { surface: 'grass', hidden: true } });
  const left = strip('', -20, -6.5);
  grass.geometry = mergeTwo(grass.geometry as THREE.BufferGeometry, left.geometry as THREE.BufferGeometry);
  root.add(grass);
  // What is drawn: the street 12 m either side, a sand patch on it (right, s 50-80) and kerb cubes on the left kerb at
  // s 100-120 and 150-160
  const model = new THREE.Group();
  model.name = 'Track_Model';
  model.add(strip('street', -12, 12, { y: 0.005, material: 'road2' }));
  model.add(strip('sand', 7, 12, { y: 0.006, s0: 50, s1: 80, material: 'sanda' }));
  model.add(strip('cubes1', -6.4, -5.6, { y: 0.02, s0: 100, s1: 120, material: 'cubes' }));
  model.add(strip('cubes2', -6.4, -5.6, { y: 0.02, s0: 150, s1: 160, material: 'cubes' }));
  root.add(model);
  root.updateMatrixWorld(true);
  return root;
}
function mergeTwo(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  const pa = a.getAttribute('position').array as Float32Array, pb = b.getAttribute('position').array as Float32Array;
  const ia = Array.from(a.getIndex()!.array), ib = Array.from(b.getIndex()!.array).map((i) => i + pa.length / 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...pa, ...pb], 3));
  g.setIndex([...ia, ...ib]);
  return g;
}

{
  const track = createFlatTestTrack(200, 10, 100);
  // Barriers 10 m either side
  for (const q of track.samples) Object.assign(q, { wallLeftM: 10, wallRightM: 10 });
  const RULES: DrawnSurfaceRule[] = [
    { materials: 'roadMaterials', surface: 'road', from: ['runoff', 'gravel', 'grass'], within: 'barriers', covers: ['sanda'], pieceM: 0.5, note: 'street' },
    { materials: ['cubes'], surface: 'sausage', within: { stretches: [[95, 125, -1]] }, note: 'cubes' },
  ];
  const hit = createGroundHit();
  const at = (q: TrackColliderQuery, s: number, lat: number) => (q.query(-lat, s, 1, hit) ? hit.surface : 'none');
  const plain = TrackColliderQuery.fromTrackRoot(fixture(), DEFAULT_SURFACE_TABLE, { conformSurfaces: true });
  const root = fixture();
  let renamed: Record<string, number> = {};
  const q = TrackColliderQuery.fromTrackRoot(root, DEFAULT_SURFACE_TABLE, { conformSurfaces: true, prepare: (r) => (renamed = applyDrawnSurfaceRules(r, track, ['road2'], RULES)) });

  check('without the rules, the drawn street past the road band is grass', at(plain, 30, 8) === 'grass' && at(plain, 30, -8) === 'grass', `${at(plain, 30, 8)} ${at(plain, 30, -8)}`);
  check('with them, it is road between the barriers on both sides', [7, 8, 9.6].every((l) => at(q, 30, l) === 'road') && [-7, -9.6].every((l) => at(q, 30, l) === 'road'),
    [7, 8, 9.6, -7, -9.6].map((l) => at(q, 30, l)).join(' '));
  check('past the barriers it stays grass, drawn street or not', at(q, 30, 10.6) === 'grass' && at(q, 30, -11) === 'grass', `${at(q, 30, 10.6)} ${at(q, 30, -11)}`);
  check('under the drawn sand patch it stays grass', at(q, 65, 9) === 'grass' && at(q, 65, 8) === 'grass', `${at(q, 65, 9)} ${at(q, 65, 8)}`);
  check('the road band and the kerb are as they were', at(q, 30, 0) === 'road' && at(q, 30, -5.8) === 'kerb', `${at(q, 30, 0)} ${at(q, 30, -5.8)}`);
  check('kerb under the drawn cubes is a sausage within the rule stretch, off the track', at(q, 110, -6) === 'sausage' && !hit.props.validTrack, at(q, 110, -6));
  check('and a kerb outside it, cubes or not', at(q, 155, -6) === 'kerb', at(q, 155, -6));
  const kerb = root.getObjectByName('Track_Surface_Kerb') as THREE.Mesh;
  check('the split kerb keeps its texture coordinates (its ripple)', !!(kerb.geometry as THREE.BufferGeometry).getAttribute('uv'));
  check('the renamed areas: about 2 × 4.5 × 200 m of street and 0.8 × 20 m of cubes', Math.abs((renamed.road ?? 0) - 1600) < 60 && Math.abs((renamed.sausage ?? 0) - 16) < 3,
    JSON.stringify(Object.fromEntries(Object.entries(renamed).map(([k, v]) => [k, Math.round(v)]))));
  const other = fixture();
  const geo = (other.getObjectByName('Track_Surface_Grass') as THREE.Mesh).geometry;
  check('a circuit without rules is left as it is', Object.keys(applyDrawnSurfaceRules(other, { ...track, id: 'no_rules_here' }, ['road2'])).length === 0 && (other.getObjectByName('Track_Surface_Grass') as THREE.Mesh).geometry === geo);
}

// ---- 2. The hosted circuits
/** All four wheels (±1.8 m along, ±0.8 m across) of a car centred at lap distance s, lateral lat: off the track? */
function carOff(ground: TrackColliderQuery, s: number, lat: number): boolean {
  const track = getActiveTrackData(1200);
  const hit = createGroundHit();
  return [-1.8, 1.8].every((dl) => [-0.8, 0.8].every((dw) => {
    const q = track.getSampleAtDistance(s + dl);
    const b = q.binormal, bl = Math.hypot(b.x, b.z) || 1;
    const x = q.position.x + (b.x / bl) * (lat + dw), z = q.position.z + (b.z / bl) * (lat + dw);
    return !(ground.query(x, z, q.position.y + 2, hit) && hit.props.validTrack);
  }));
}
function load(id: string): { before: TrackColliderQuery; after: TrackColliderQuery } | null {
  const path = `public/tracks/${id}/track_data.json`;
  if (!hasFile(path)) {
    noteSkip(id, path);
    return null;
  }
  setActiveTrack(id, JSON.parse(readFileSync(path, 'utf8')) as RawTrackJson);
  const files = trackModelFiles(getActiveTrackData(1200));
  if (!hasFile(files.path) || (files.shared && !hasFile(files.shared))) {
    noteSkip(id, files.path);
    return null;
  }
  const before = TrackColliderQuery.fromTrackRoot(loadGlbGeometry(files.path, files.shared), getActiveSurfaceTable(), { conformSurfaces: getActiveTrackMetadata().mesh?.conformSurfaces === true });
  return { before, after: trackColliders(loadGlbGeometry(files.path, files.shared)).ground! };
}

const nori = load('norisring');
if (nori) {
  const street: [number, number][] = [[760, 9], [760, -9], [900, -10.5], [940, 8.5], [1600, 9.5]];
  check('Norisring: a car on the street between the barriers was off the track before', street.every(([s, l]) => carOff(nori.before, s, l)));
  check('and is on it now', street.every(([s, l]) => !carOff(nori.after, s, l)), street.filter(([s, l]) => carOff(nori.after, s, l)).map(([s, l]) => `${s}/${l}`).join(' '));
  check('Norisring: a car in the gravel inside the Grundig hairpin is still off the track', carOff(nori.after, 485, -15) && carOff(nori.after, 430, -10));
  check('Norisring: the inside lane into the Grundig hairpin is on the track now (off before)', carOff(nori.before, 440, -8) && !carOff(nori.after, 440, -8));
  // (the hairpin's outside kerb ends 11.1 m out; the barrier opens to 35 m round the car park behind it)
  check("Norisring: the car park past the Grundig hairpin's outside kerb is still off the track", carOff(nori.after, 480, 16) && carOff(nori.after, 480, 20));
}
const rbr = load('spielberg');
if (rbr) {
  // (the car's centre 9 m inside Castrol Edge and 7.5 m inside Remus: its outer wheels past the red and white kerb)
  check('Red Bull Ring: past the red and white kerb inside Castrol Edge and Remus, on the track before', !carOff(rbr.before, 330, 9) && !carOff(rbr.before, 1270, 7.5));
  check('and off it now', carOff(rbr.after, 330, 9) && carOff(rbr.after, 1270, 7.5));
  check('Red Bull Ring: a car with its wheels on the kerb, and on the road, is on the track', !carOff(rbr.after, 330, 7.5) && !carOff(rbr.after, 1267.5, 6) && !carOff(rbr.after, 1267.5, 2));
}
const south = load('spielberg_south');
if (south) {
  check('Red Bull Ring South: past the red and white kerb inside Castrol Edge is off the track (on before)', !carOff(south.before, 330, 9) && carOff(south.after, 330, 9));
  check('and on the kerb it is on the track', !carOff(south.after, 330, 7.5));
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nAll drawn-surface checks passed');
process.exit(0);
