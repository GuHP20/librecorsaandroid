/**
 * Venues whose layouts share one visual model. Each layout's own GLB (`metadata.mesh.url`) holds the whole venue's
 * scenery again, though most of it is the same in every layout. scripts/split-venue-model.mjs splits a venue's GLBs
 * into one shared file and one small file per layout. The game loads the pair and puts the shared scenery under the
 * layout's own `Track_Model` (render/venue-model.ts), so after the first layout of a venue, a player downloads only
 * the next layout's file.
 *
 * The files live next to the layout's own: `/tracks/<venue>/<venue>.shared.<build>.glb` and
 * `/tracks/<layout>/<layout>.layout.<build>.glb`, where `<build>` is the shared file's hash. A new build gets new
 * names, so the old files can stay on R2 for an older deploy. The full GLBs and track_data.json don't change, so code
 * that predates this keeps loading them. Upload a build's files before deploying code that names it. When the pair
 * can't load (a local copy without them), the game loads the layout's own GLB instead.
 *
 * This list is the pointer: which hosted files the game loads for these layouts is decided here, in code, and never
 * in track_data.json on R2 (`metadata.mesh.url` stays the full GLB, the fallback and what an older deploy loads).
 * scene-builder.ts reads it through `venueModelFiles(track.id)`; scripts read it through glb-geometry.ts
 * (`trackModelFiles`). A re-split (other inputs, other texture formats) is a new build: run the splitter, upload its
 * files, then change `build` here.
 */

export interface VenueModel {
  /** The venue's folder under public/tracks (its first layout's id); the shared file lives there */
  venue: string;
  /** The split build (scripts/split-venue-model.mjs prints it): the first 8 hex digits of the shared file's sha256 */
  build: string;
  layouts: readonly string[];
}

export const VENUE_MODELS: readonly VenueModel[] = [
  { venue: "vir", build: "b79628d0", layouts: ["vir", "vir_grand_east", "vir_grand_west", "vir_north", "vir_patriot", "vir_patriot_reverse", "vir_south"] },
  { venue: "spielberg", build: "a96cb481", layouts: ["spielberg", "spielberg_inner", "spielberg_south"] },
  { venue: "sachsenring", build: "c4e8700f", layouts: ["sachsenring", "sachsenring_short"] },
  { venue: "okayama", build: "710efbb4", layouts: ["okayama", "okayama_drift", "okayama_piper"] },
];

/** A layout's two files (relative to the base path) */
export interface VenueModelFiles {
  venue: string;
  build: string;
  /** The layout's physics, its own scenery and what the game finds by name */
  layoutUrl: string;
  /** The scenery every layout of the venue shares */
  sharedUrl: string;
}

/** The split model of a circuit, if its venue has one */
export function venueModelFiles(trackId: string | undefined): VenueModelFiles | undefined {
  if (!trackId) return undefined;
  const v = VENUE_MODELS.find((m) => m.layouts.includes(trackId));
  if (!v) return undefined;
  return {
    venue: v.venue,
    build: v.build,
    layoutUrl: `/tracks/${trackId}/${trackId}.layout.${v.build}.glb`,
    sharedUrl: `/tracks/${v.venue}/${v.venue}.shared.${v.build}.glb`,
  };
}
