/**
 * Where each car's rev lights sit: the dash, the HUD styles and the wheel's shift cue all call the shift at the same
 * rpm.
 */

/**
 * Rev-light range per car: first LED and all-lit rpm (the Formula cars by default; the GT3's 7500 rpm shift point,
 * the Liana's 6500, the 496R's dash LEDs from 8000 to 9400)
 */
export function revRangeFor(carId: string | undefined): [number, number] {
  if (carId === "liana") return [5200, 6500];
  if (carId === "mtr-496r") return [8000, 9400];
  // The LC-LMDH up to the engine speed its regulated power curve is set on (the lights' last stage) [claim]
  if (carId === "lc-lmdh") return [6900, 8150];
  // The classic Nissans up to their shift lights or shift points [spec digital_instruments.ini, drivetrain.ini]
  if (carId === "nissan-r33-jgtc") return [5000, 6700];
  if (carId === "nissan-r32-jtcc") return [6300, 7500];
  return carId === "amg-gt3" ? [6200, 7500] : [10_800, 14_600];
}

/** A rev light's colour band: the HUD and the car's own wheel paint the same LED in the same band */
export type RevLedBand = "green" | "yellow" | "red" | "shift";

/** The band of LED `i` of `count` (15 lights: 5 green, 5 yellow, 3 red, 2 shift) */
export function revLedBand(i: number, count: number): RevLedBand {
  if (i < count / 3) return "green";
  if (i < (2 * count) / 3) return "yellow";
  if (i < (13 * count) / 15) return "red";
  return "shift";
}

/**
 * How many of `count` rev lights are lit at `rpm`, and whether the car is at its shift point (every light on): one
 * reading for the HUD, the car's wheel and the pad's lights, so they never disagree on where the shift is
 */
export function revLeds(rpm: number, [start, full]: readonly [number, number], count: number): { lit: number; atShift: boolean } {
  const r = Number.isFinite(rpm) ? rpm : 0;
  const lit = Math.max(0, Math.min(count, Math.round(((r - start) / (full - start)) * count)));
  return { lit, atShift: r >= full };
}
