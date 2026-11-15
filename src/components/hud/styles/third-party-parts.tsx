"use client";

import { useEffect, useRef, useState } from "react";
import type { CarTelemetry } from "@/types/f1";
import { revLedBand, revLeds, type RevLedBand } from "@/lib/sim/rev-range";
import { HUD_GREEN, HUD_RED, HUD_SHIFT, HUD_YELLOW } from "../hud-format";
import { completedLap, type LapRecord } from "../third-party-data";
import { useHudModeRef } from "../hud-mode";

/**
 * Hooks and small pieces the third-party HUD layouts share: the laps driven this run, the fuel used per lap, the
 * session clock and the rev lights. Each layout draws them in its own look; the readings are the game's one set.
 */

/** Rev light band colours: the HUD's and the car wheel's one set of bands, from the colour tokens */
export const REV_BAND_COLOR: Record<RevLedBand, string> = {
  green: HUD_GREEN,
  yellow: HUD_YELLOW,
  red: HUD_RED,
  shift: HUD_SHIFT,
};

/**
 * `count` rev lights at the car's rpm, lit by the one rule the HUD, the wheel and the pad share (`revLeds`): which are
 * on, and each light's colour (every light in the shift colour at the shift point)
 */
export function revLights(rpm: number, revRange: readonly [number, number], count: number) {
  const { lit, atShift } = revLeds(rpm, revRange, count);
  return {
    lit,
    atShift,
    on: (i: number) => atShift || i < lit,
    color: (i: number) => (atShift ? HUD_SHIFT : REV_BAND_COLOR[revLedBand(i, count)]),
  };
}

/**
 * The laps completed this run, newest first (at most `max`). A restart (new run id) clears them; a lap is recorded
 * when the lap counter steps up and the lap time arrives with it.
 */
export function useLapHistory(t: CarTelemetry, max = 12): LapRecord[] {
  const runId = t.runId ?? 0;
  const [laps, setLaps] = useState<LapRecord[]>([]);
  const prev = useRef({ runId, lapCount: t.lapCount, sectors: [...t.sectorTimesMs] as [number, number, number] });
  useEffect(() => {
    const p = prev.current;
    if (p.runId !== runId) {
      prev.current = { runId, lapCount: t.lapCount, sectors: [...t.sectorTimesMs] as [number, number, number] };
      setLaps([]);
      return;
    }
    if (t.lapCount > p.lapCount && t.lastLapTimeMs && t.lastLapTimeMs > 0) {
      // The counter names the lap being driven: the one just finished is the count before it stepped up
      const rec = completedLap(p.lapCount, t.lastLapTimeMs, p.sectors, t.lastLapValid !== false);
      setLaps((l) => [rec, ...l].slice(0, max));
    }
    prev.current = { runId, lapCount: t.lapCount, sectors: [...t.sectorTimesMs] as [number, number, number] };
  }, [runId, t.lapCount, t.lastLapTimeMs, t.lastLapValid, t.sectorTimesMs, max]);
  return laps;
}

/**
 * Fuel used per lap (kg), averaged over the last three full laps; null until a lap has been run from line to line.
 * A restart or a refuel (the fuel going up) starts the count again.
 */
export function useFuelPerLap(t: CarTelemetry): number | null {
  const runId = t.runId ?? 0;
  const [perLap, setPerLap] = useState<number | null>(null);
  const state = useRef<{ runId: number; lapCount: number; startKg: number | null; used: number[]; lastKg: number }>({
    runId,
    lapCount: t.lapCount,
    startKg: null,
    used: [],
    lastKg: t.fuelKg,
  });
  useEffect(() => {
    const s = state.current;
    if (s.runId !== runId || t.fuelKg > s.lastKg + 0.5) {
      state.current = { runId, lapCount: t.lapCount, startKg: null, used: [], lastKg: t.fuelKg };
      setPerLap(null);
      return;
    }
    s.lastKg = t.fuelKg;
    if (t.lapCount !== s.lapCount) {
      // The first line crossing starts the count: the lap out of the grid or the pits is not a full lap
      if (s.startKg !== null && t.lapCount === s.lapCount + 1) {
        const used = s.startKg - t.fuelKg;
        if (used > 0.01) {
          s.used = [...s.used, used].slice(-3);
          setPerLap(s.used.reduce((a, b) => a + b, 0) / s.used.length);
        }
      }
      s.startKg = t.fuelKg;
      s.lapCount = t.lapCount;
    }
  }, [runId, t.lapCount, t.fuelKg]);
  return t.fuelKg > 0 ? perLap : null;
}

/**
 * Seconds on track this run, ticking once a second: a restart starts again from zero, and the clock stops while the
 * game is paused or in a replay (the HUD hidden), as the session's own time does
 */
export function useSessionClock(t: CarTelemetry): number {
  const runId = t.runId ?? 0;
  const mode = useHudModeRef();
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    setSeconds(0);
    const id = window.setInterval(() => {
      if (mode.current !== "hidden") setSeconds((s) => s + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [runId, mode]);
  return seconds;
}
