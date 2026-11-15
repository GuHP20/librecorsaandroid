/**
 * Corrections to circuits' DRS zones. The zones ship in each circuit's hosted `track_data.json` (the converters write
 * them: `scripts/tracks/build_track.py` finds them on the straights, `port_ac_track.py` takes a mod's
 * `drs_zones.ini`), so a zone that needs moving is moved here, where every car, the AI field and the HUD read it from.
 *
 * Distances are metres from the start line, measured on the lap length given: a circuit rebuilt to another length
 * keeps the zones of its new data (with a warning) until its correction is measured again.
 */
export interface DrsZoneShape {
  id: string;
  detection: number;
  start: number;
  end: number;
}

export interface DrsZoneFix {
  /** The circuit's lap length (m, `metadata.lengthMeters`) the corrections were measured on */
  lengthM: number;
  /** Per zone id: the edges that move (m from the start line) and why */
  zones: Record<string, { startM?: number; endM?: number; why: string }>;
}

/** A lap length that differs by more than this (m) is another build of the circuit */
const LENGTH_TOLERANCE_M = 1;

export const DRS_ZONE_FIXES: Readonly<Record<string, DrsZoneFix>> = {
  spielberg: {
    lengthM: 4314.25,
    zones: {
      // Ended at 861 m, ahead of the Turn 2 kink, 230 m short of the braking point for Remus (Turn 3, 1095 m on an
      // autopilot lap). The 2026 FIA zone runs from Turn 1 to Turn 3, the kink included
      ZONE_2: { endM: 1120, why: "Turn 1 to Turn 3 runs through the Turn 2 kink to the braking point for Remus" },
    },
  },
};

/** The circuit's zones with its corrections (`DRS_ZONE_FIXES`) made: new objects, ids and detection points kept */
export function correctedDrsZones<Z extends DrsZoneShape>(trackId: string, lengthM: number, zones: readonly Z[]): Z[] {
  const fix = DRS_ZONE_FIXES[trackId];
  if (!fix) return zones.map((z) => ({ ...z }));
  if (Math.abs(fix.lengthM - lengthM) > LENGTH_TOLERANCE_M) {
    console.warn(`DRS zone corrections for "${trackId}" were measured on a ${fix.lengthM} m lap, not ${lengthM} m: not made`);
    return zones.map((z) => ({ ...z }));
  }
  const frac = (m: number) => Math.round((((m / lengthM) % 1) + 1) % 1 * 1e4) / 1e4;
  return zones.map((z) => {
    const f = fix.zones[z.id];
    if (!f) return { ...z };
    return { ...z, start: f.startM !== undefined ? frac(f.startM) : z.start, end: f.endM !== undefined ? frac(f.endM) : z.end };
  });
}
