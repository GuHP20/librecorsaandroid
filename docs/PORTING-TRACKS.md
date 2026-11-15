# Porting circuits

The repository includes one circuit, RISE Motordrome. Every other circuit is hosted on librecorsa.org and is gitignored. This guide is how I convert an Assetto Corsa circuit mod for a local clone, and what the game reads if you want to build a circuit yourself.

The converter was written circuit by circuit, so expect to read it and adjust it for a new one.

## What you need

- Node.js, then `npm install` once (the game, the racing-line optimiser, the checks and the compressor).
- [uv](https://docs.astral.sh/uv/) for the Python scripts. The commands below pull the pinned packages from `scripts/tracks/requirements.txt`, so there is no virtualenv to set up. Other Pillow or OpenCV versions work, but they encode some textures to different bytes.
- The mod's track folder: the one with the `.kn5` models, `models*.ini` files, `data/` and the layout folders. You don't need the game itself to convert a mod.

## Converting a mod

### 1. Add the circuit

Every circuit has an entry in `AC_TRACKS` at the top of `scripts/tracks/port_ac_track.py`. Copy the closest existing one:

- a circuit with one layout: `oschersleben`
- several layouts in one folder: `okayama` and `okayama_piper`, or the `vir_*` entries
- a street circuit: `monaco` or `norisring`
- a hill climb (one timed run, no laps): `borgloh` or `goodwood`

The fields every entry needs:

- `folder`: the name of the mod's track folder
- `layout_dir`: the layout's subfolder (`''` when the folder holds a single layout)
- `models_ini` (the layout's `models_*.ini`) or `kn5_files` (a list of `.kn5` files, when the mod has no ini)
- `name`, `layout`, `country`, `city`, `description`
- `baseAltitudeM`: the circuit's height above sea level, for air density
- `pitboxes`
- `credit`: `title`, `author`, `url`, `short`, `license`, `licenseUrl`, shown in the game's credits
- `type` (`'street'` or `'hillclimb'`) and `pointToPoint: True` where they apply

The other keys fix things a particular mod needs: `physicsNodeOverrides` when the mod's surface names don't say what a surface is, `hideTextures`, `hideNodes` and `hideMaterials` to leave meshes out, `sectionSkip` and `sectionNames` for corner names, `closeBranches` and `openWalls` where several layouts share the asphalt. The comments next to each one in the existing entries say what it was for.

### 2. Point it at the folder

The converter looks for the track folder in this order:

1. `--src <folder>` on the command line (one folder at a time, for any of its layouts)
2. `scripts/tracks/sources.local.json`, a gitignored file mapping folder names (or circuit ids) to paths: `{ "oschersleben": "/path/to/oschersleben" }`
3. `$LIBRECORSA_AC_TRACKS/<folder>`, e.g. set to Assetto Corsa's `content/tracks` if you have the game

### 3. Run it

```bash
uv run --python 3.14 --no-project --with-requirements scripts/tracks/requirements.txt \
  python -P scripts/tracks/port_ac_track.py <id> --src path/to/<track folder>
```

`<id>` can be one circuit, several separated by commas, or `all`. It writes `public/tracks/<id>/track_data.json` and `public/tracks/<id>/<id>.glb`, adds the circuit to `public/tracks/index.json` and `scripts/tracks/tracks.json`, then runs the lap-time racing-line optimiser for the F1 and GT3 cars (`scripts/optimize-racing-line.ts`, a few minutes per circuit) and meshopt-compresses the GLB.

- `--no-line-opt` skips the optimiser and keeps the minimum-curvature line.
- `--no-glb` writes only the track data.
- `--no-compress` keeps the raw GLB.

From the mod it reads:

- the `.kn5` models: visual meshes, and the physics meshes by their surface names
- `ai/fast_lane.ai`: required, since the centreline and the road width are taken from it
- `ai/pit_lane.ai`: optional, the pit lane
- `data/`: `surfaces.ini`, `sections.ini`, `drs_zones.ini`, `cameras*.ini`, `groove.ini`, `crew.ini` and `lighting.ini`, each optional

## Listing it in the game

- A clone lists only the circuits in `REPO_TRACK_IDS` in `src/lib/hosted-content.ts`. Add your id there. Setting `NEXT_PUBLIC_HOSTED_CONTENT=1` instead lists every circuit, including hosted ones whose files you don't have.
- `npm run home-outlines` draws the circuit's map for the home page.
- The AI's per-circuit settings are optional: see the tuning files in `public/ai`.

## Checking it

```bash
npx tsx scripts/tracks/verify-tracks.ts <id>
npm run dev
```

`verify-tracks.ts` builds the track data through the game's own code, checks the grid sits on the road and the GLB has its collider nodes, and drives a lap in both F1 cars and the GT3. Then pick the circuit in the menu and drive it. Add `?colliders=1` to the address to see the physics surfaces drawn over the circuit.

If you converted with `--no-compress`, `npm run compress-tracks` compresses every listed circuit that isn't yet and checks the physics meshes come out bit-exact.

## Building a circuit yourself

There is no general tool for this yet. Here is what the game reads, and the two routes that exist today.

### What a circuit is

A GLB and a `track_data.json` in `public/tracks/<id>/`:

- **The GLB** needs `Track_Collider_Road`, a low-resolution drivable surface covering the road plus 1.6 m each side, and `Track_Collider_Wall` for the barriers. Drivable and off-road surfaces are meshes tagged with `userData.surface` (`road`, `kerb`, `sausage`, `runoff`, `pitlane`, `gravel` or `grass`) and optionally `userData.grip`. The converters name them `Track_Surface_Road`, `Track_Surface_Kerb`, `Track_Surface_Runoff`, `Track_Surface_Gravel` and `Track_Surface_Grass`. The full contract is the comment at the top of `src/lib/sim/f12026-car/TrackColliderQuery.ts`.
- **`track_data.json`** holds the circuit's metadata, DRS zones, cameras, turns, sectors, spawn grid, pit lane and a sample every few metres along the lap (position, width, banking, racing lines, kerbs, run-off and walls each side). `public/tracks/rwanda_official/track_data.json` is the reference schema, and `src/lib/track-data.ts` reads it.

### Route 1: build it as an Assetto Corsa track, then convert it

Model it in Blender, export the `.kn5` with Assetto Corsa's track editor (ksEditor, in the game's SDK), drive it in the game to record `ai/fast_lane.ai`, then convert it as above. You need a copy of Assetto Corsa for the editor and the AI lane. Most Assetto Corsa track-making guides apply, in particular keeping a fine, smooth physics road under a lighter visual mesh. I haven't tried this route end to end with a circuit made from scratch.

### Route 2: build it in Blender the way RISE Motordrome is built

`scripts/rwanda-official/` builds RISE Motordrome in Blender and writes the GLB and track data directly, with no Assetto Corsa. It is written for that one site (its terrain, traced centreline and design references), so read it as a worked example rather than a template. Its README explains the steps.

## Licences

- Only port circuits you have the right to use. A mod's terms come with it, and a game's own assets usually can't be redistributed at all.
- **Unlicensed or unauthorised mods are for local use only.** If a mod has no licence, or its author hasn't said you can use it, keep it on your own machine: don't commit it, upload it, host it or share it in any form.
- **Releasing a ported circuit needs permission.** Before you publish one on your fork, your own site or anywhere else, get the author's permission, or check that its licence allows redistribution, and keep a record of it.
- Keep ported content local by default. `public/tracks/` is gitignored apart from RISE Motordrome and `index.json`. Please don't open pull requests that add third-party circuits.
- If you share a ported circuit anywhere, credit its author the way `CREDITS.md` does: title, author, link, licence, and what you changed.
