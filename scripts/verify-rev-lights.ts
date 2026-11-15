/**
 * verify-rev-lights.ts: the HUD's shift lights and the car's own wheel LEDs light the same LEDs in the same colour
 * bands at the same rpm (src/lib/sim/rev-range.ts). Before, the 2026 car's wheel ran its 15 LEDs from 10,000 rpm to the
 * classic engine's 12,500 rpm limiter while the HUD ran them from 10,800 to 14,600 rpm, so the wheel turned blue some
 * 2,500 rpm before the HUD did (GitHub discussion #127).
 */
import assert from "node:assert/strict";
import { revLedBand, revLeds, revRangeFor } from "../src/lib/sim/rev-range";

let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failed++;
    console.log(`FAIL  ${name}\n      ${(error as Error).message}`);
  }
}

const COUNT = 15;
const CARS = [undefined, "lc26", "f12026", "amg-gt3", "liana", "mtr-496r", "lc-lmdh", "nissan-r33-jgtc", "nissan-r32-jtcc"];

check("15 lights keep the HUD's bands: 5 green, 5 yellow, 3 red, 2 shift", () => {
  const bands = Array.from({ length: COUNT }, (_, i) => revLedBand(i, COUNT));
  const old = Array.from({ length: COUNT }, (_, i) => (i < 5 ? "green" : i < 10 ? "yellow" : i < 13 ? "red" : "shift"));
  assert.deepEqual(bands, old);
});

check("lit count and shift point match the HUD's own formula for every car", () => {
  for (const car of CARS) {
    const [start, full] = revRangeFor(car);
    for (let rpm = start - 1500; rpm <= full + 1500; rpm += 25) {
      const { lit, atShift } = revLeds(rpm, [start, full], COUNT);
      const hudLit = Math.round(((rpm - start) / (full - start)) * COUNT);
      assert.equal(lit, Math.max(0, Math.min(COUNT, hudLit)), `${car ?? "formula"} at ${rpm} rpm`);
      assert.equal(atShift, rpm >= full, `${car ?? "formula"} shift at ${rpm} rpm`);
    }
  }
});

check("the 2026 car's first blue light comes at the same rpm on the wheel and the HUD", () => {
  const range = revRangeFor(undefined);
  const firstShift = Array.from({ length: COUNT }, (_, i) => i).find((i) => revLedBand(i, COUNT) === "shift")!;
  let rpm = range[0];
  while (revLeds(rpm, range, COUNT).lit <= firstShift) rpm += 10;
  // The old wheel range lit that LED some 2,500 rpm earlier
  const old: [number, number] = [10_000, 12_500];
  let oldRpm = old[0];
  while (Math.round(((oldRpm - old[0]) / (old[1] - old[0])) * COUNT) <= 10) oldRpm += 10;
  assert.ok(rpm > 14_000 && rpm < range[1], `first shift light at ${rpm} rpm`);
  assert.ok(rpm - oldRpm > 2_000, `old wheel blue at ${oldRpm} rpm, now ${rpm}`);
});

check("a non-finite rpm lights nothing", () => {
  assert.deepEqual(revLeds(Number.NaN, revRangeFor(undefined), COUNT), { lit: 0, atShift: false });
});

if (failed) {
  console.log(`\n${failed} rev light check(s) failed.`);
  process.exit(1);
}
console.log("\nAll rev light checks passed.");
