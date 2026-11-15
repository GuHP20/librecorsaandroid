import type { CarTelemetry, RaceStandingEntry } from "@/types/f1";

/**
 * Readings the third-party HUD layouts share (styles/*Hud.tsx from other projects): the cars around the player on the
 * road, the slice of the order a short leaderboard shows, the session's best lap, the ideal lap and the fuel's laps.
 * Pure, so scripts/verify-third-party-hud.ts can check them headlessly.
 */

/** A completed lap a layout lists */
export interface LapRecord {
  /** Lap number (1 = the first completed) */
  lap: number;
  ms: number;
  /** Sector times; null where the lap was not timed through that sector */
  sectorsMs: [number | null, number | null, number | null];
  /** The lap counted (not cut) */
  valid: boolean;
}

/** A car near the player on the road */
export interface RelativeCar {
  entry: RaceStandingEntry;
  /** Estimated time to it on the road (s): + ahead of the player, − behind; 0 for the player */
  gapS: number;
  /** Laps it is ahead of (+) or behind (−) the player in the race: a lapping or lapped car */
  lapsAhead: number;
}

/** A lap time to estimate road gaps with: the player's best, else the last, else a typical lap */
export function referenceLapS(t: Pick<CarTelemetry, "bestLapTimeMs" | "lastLapTimeMs">): number {
  const ms = t.bestLapTimeMs ?? t.lastLapTimeMs;
  return ms && ms > 0 ? ms / 1000 : 95;
}

/** `d` wrapped into (−L/2, L/2]: the shorter way round a lap of length L */
export function wrapLap(d: number, lengthM: number): number {
  if (!(lengthM > 0)) return d;
  let w = d % lengthM;
  if (w > lengthM / 2) w -= lengthM;
  if (w <= -lengthM / 2) w += lengthM;
  return w;
}

/**
 * The cars physically nearest the player, up to `perSide` ahead and behind, ordered from the furthest ahead to the
 * furthest behind with the player between. The gap is the road distance at the reference lap's average speed, so it
 * reads like a relative timing board's. Without track positions (a race state that doesn't carry them) it falls back
 * to the running order's gaps.
 */
export function relativeCars(t: CarTelemetry, lengthM: number, perSide = 3): RelativeCar[] {
  const standings = t.race?.standings;
  if (!standings?.length) return [];
  const me = standings.find((e) => e.isPlayer);
  if (!me) return [];
  const lapS = referenceLapS(t);
  const onRoad = me.trackS !== undefined && lengthM > 0;
  const others = standings
    .filter((e) => !e.isPlayer && !e.retired && !e.finished)
    .map((entry): RelativeCar => {
      if (onRoad && entry.trackS !== undefined) {
        const dS = wrapLap(entry.trackS - me.trackS!, lengthM);
        const raceGap = (entry.raceDistM ?? 0) - (me.raceDistM ?? 0);
        const lapsAhead = entry.raceDistM !== undefined && me.raceDistM !== undefined ? Math.round((raceGap - dS) / lengthM) : 0;
        return { entry, gapS: (dS / lengthM) * lapS, lapsAhead };
      }
      // Running order: the gap to the leader at the same race distance, in seconds
      return { entry, gapS: me.gapToLeaderS - entry.gapToLeaderS, lapsAhead: entry.lap - me.lap };
    });
  const ahead = others.filter((c) => c.gapS > 0).sort((a, b) => a.gapS - b.gapS).slice(0, perSide).reverse();
  const behind = others.filter((c) => c.gapS <= 0).sort((a, b) => b.gapS - a.gapS).slice(0, perSide);
  return [...ahead, { entry: me, gapS: 0, lapsAhead: 0 }, ...behind];
}

/**
 * The rows a leaderboard of at most `rows` lines shows: the whole order when it fits, else the leader and a run of
 * cars around the player (the player kept in view, the window held inside the field)
 */
export function leaderboardWindow<T extends { isPlayer: boolean }>(standings: readonly T[], rows: number): T[] {
  if (standings.length <= rows || rows < 3) return standings.slice(0, Math.max(rows, 0));
  const me = Math.max(0, standings.findIndex((e) => e.isPlayer));
  // The leader, then rows − 1 cars around the player
  const span = rows - 1;
  let start = Math.max(1, me - Math.floor((span - 1) / 2));
  start = Math.min(start, standings.length - span);
  return [standings[0], ...standings.slice(start, start + span)];
}

/** The fastest lap anyone has set this session (the player's best outside a race), null before one */
export function sessionBestLapMs(t: Pick<CarTelemetry, "bestLapTimeMs" | "race">): number | null {
  let best = t.bestLapTimeMs && t.bestLapTimeMs > 0 ? t.bestLapTimeMs : null;
  for (const e of t.race?.standings ?? []) {
    if (e.bestLapMs && e.bestLapMs > 0 && (best === null || e.bestLapMs < best)) best = e.bestLapMs;
  }
  return best;
}

/** The player's best sectors added up, once every sector has a best */
export function idealLapMs(t: Pick<CarTelemetry, "bestSectorTimesMs">): number | null {
  const b = t.bestSectorTimesMs;
  return b.every((s) => s !== null && s > 0) ? b.reduce<number>((sum, s) => sum + (s ?? 0), 0) : null;
}

/** The lap the live delta predicts: the best lap plus the delta, null without either */
export function predictedLapMs(bestLapMs: number | null, deltaS: number | null): number | null {
  return bestLapMs && deltaS !== null && Number.isFinite(deltaS) ? Math.max(0, bestLapMs + deltaS * 1000) : null;
}

/** Laps the fuel on board lasts at a measured use per lap; null until a lap has been measured */
export function fuelLapsLeft(fuelKg: number, perLapKg: number | null): number | null {
  if (perLapKg === null || !(perLapKg > 0.01) || !(fuelKg >= 0)) return null;
  return fuelKg / perLapKg;
}

/** A driver as a short label: the multiplayer name, else the three-letter code; the player is "You" */
export function driverLabel(e: Pick<RaceStandingEntry, "isPlayer" | "name" | "driverCode">, you = "You"): string {
  if (e.isPlayer) return you;
  return e.name?.trim() || e.driverCode;
}

/** A session clock as h:mm:ss (mm:ss under an hour) */
export function formatClock(totalS: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(totalS) ? totalS : 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${String(m).padStart(2, "0")}:${sec}`;
}

/**
 * The lap a just-completed lap leaves behind, from the frame before it ended (its first two sectors) and the frame
 * after (the lap time): sector 3 is what the lap time leaves over
 */
export function completedLap(
  lap: number,
  lapMs: number,
  prevSectorsMs: readonly [number, number, number],
  valid: boolean,
): LapRecord {
  const s1 = prevSectorsMs[0] > 0 ? prevSectorsMs[0] : null;
  const s2 = prevSectorsMs[1] > 0 ? prevSectorsMs[1] : null;
  const s3 = s1 !== null && s2 !== null && lapMs - s1 - s2 > 0 ? lapMs - s1 - s2 : null;
  return { lap, ms: lapMs, sectorsMs: [s1, s2, s3], valid };
}
