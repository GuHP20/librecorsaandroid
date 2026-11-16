// Runs the scripts/verify-*.ts suites and stops at the first failure.
// Usage: node scripts/run-verify.mjs            (every suite except the slow verify-driver-laps, several at once)
//        node scripts/run-verify.mjs --record   (the same, then writes each suite's time to verify-timings.json)
//        node scripts/run-verify.mjs driver-laps [args...]   (one named suite on its own, extra args passed through)
//
// A full run starts several suites at once: as many as it takes for the longest one to set the run's length, and no
// more than the machine has cores (VERIFY_JOBS sets the number; VERIFY_JOBS=1 runs them one after another). They
// start longest first, by the times in verify-timings.json, so the slowest suite never starts last; a suite with no
// recorded time starts first. Each suite's output is held back and printed whole when it ends, and a failure stops
// the suites still running.
import { spawn, spawnSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const SLOW = new Set(["verify-driver-laps.ts"]);
const TIMINGS = join(scriptsDir, "verify-timings.json");

const args = process.argv.slice(2);
const record = args[0] === "--record";
const [only, ...passArgs] = record ? [] : args;

// tsx runs these as CommonJS, so three.js prints its require("three") deprecation notice
// on every run; it says nothing about the sim, so hide just that warning.
const nodeOptions = [process.env.NODE_OPTIONS, "--disable-warning=THREE_CJS_DEPRECATED"]
  .filter(Boolean)
  .join(" ");
// The suites check the whole car and circuit registry; ones that load a hosted-only file skip it when a clone
// doesn't have it (scripts/lib/hosted-files.ts, src/lib/hosted-content.ts)
const env = { NEXT_PUBLIC_HOSTED_CONTENT: "1", ...process.env, NODE_OPTIONS: nodeOptions };
const suiteArgs = (suite) => ["--import", "tsx", join(scriptsDir, suite)];
const secondsSince = (started) => ((Date.now() - started) / 1000).toFixed(1);

if (only) {
  const suite = `verify-${only}.ts`;
  console.log(`\n=== ${suite} ===`);
  const started = Date.now();
  const result = spawnSync(process.execPath, [...suiteArgs(suite), ...passArgs], { stdio: "inherit", env });
  const seconds = secondsSince(started);
  if (result.status !== 0) {
    console.error(`\n${suite} failed (exit ${result.status ?? result.signal}) after ${seconds}s`);
    process.exit(result.status || 1);
  }
  console.log(`--- ${suite} passed in ${seconds}s`);
  console.log(`\nAll 1 verify suite(s) passed.`);
} else {
  runAll();
}

function runAll() {
  let timings = {};
  try {
    timings = JSON.parse(readFileSync(TIMINGS, "utf8"));
  } catch {
    // No times recorded: the suites start in name order
  }
  const recorded = (suite) => (typeof timings[suite] === "number" ? timings[suite] : Infinity);
  const suites = readdirSync(scriptsDir)
    .filter((f) => /^verify-.*\.ts$/.test(f) && !SLOW.has(f))
    .sort((a, b) => recorded(b) - recorded(a) || a.localeCompare(b));

  // Once the longest suite is what sets the run's length, more at once only slows every suite down (on a 14-core
  // Mac, 14 at once took 411 s and 4 at once 323 s), so by default stop at the first count where that happens
  const known = suites.map(recorded).filter(Number.isFinite);
  const runLength = (count) => {
    const lanes = new Array(count).fill(0);
    for (const t of known) lanes[lanes.indexOf(Math.min(...lanes))] += t;
    return Math.max(...lanes);
  };
  const cores = availableParallelism();
  let enough = known.length ? 1 : cores;
  while (enough < cores && runLength(enough) > Math.max(...known)) enough++;
  const wanted = Number.parseInt(process.env.VERIFY_JOBS ?? "", 10);
  const jobs = Math.max(1, Math.min(suites.length, wanted > 0 ? wanted : enough));
  console.log(`Running ${suites.length} verify suites, ${jobs} at a time, longest first.`);

  const startedAll = Date.now();
  const running = new Set();
  const times = {};
  let next = 0;
  let failed = false;
  let finished = false;

  const start = () => {
    const suite = suites[next++];
    const started = Date.now();
    const output = [];
    // A suite's output only shows when it ends, so this line is what shows one that never does
    console.log(`started ${suite}`);
    const child = spawn(process.execPath, suiteArgs(suite), { stdio: ["ignore", "pipe", "pipe"], env });
    running.add(child);
    child.stdout.on("data", (chunk) => output.push(chunk));
    child.stderr.on("data", (chunk) => output.push(chunk));
    child.on("error", (error) => output.push(Buffer.from(`${error.stack ?? error}\n`)));
    child.on("close", (code, signal) => {
      running.delete(child);
      if (failed) return;
      const seconds = secondsSince(started);
      process.stdout.write(`\n=== ${suite} ===\n`);
      process.stdout.write(Buffer.concat(output));
      if (code !== 0) {
        failed = true;
        for (const other of running) other.kill();
        console.error(`\n${suite} failed (exit ${code ?? signal}) after ${seconds}s`);
        process.exitCode = code || 1;
        return;
      }
      times[suite] = Number(seconds);
      console.log(`--- ${suite} passed in ${seconds}s`);
      if (next < suites.length) start();
      else if (running.size === 0) finish();
    });
  };

  const finish = () => {
    finished = true;
    console.log(`\nAll ${suites.length} verify suite(s) passed in ${secondsSince(startedAll)}s, ${jobs} at a time.`);
    if (record) {
      const sorted = Object.fromEntries(Object.entries(times).sort(([a, x], [b, y]) => y - x || a.localeCompare(b)));
      writeFileSync(TIMINGS, `${JSON.stringify(sorted, null, 2)}\n`);
      console.log(`Wrote the times to ${TIMINGS}`);
    }
  };

  // A run that ends without every suite passing or one failing (a child that never reported back) is a failure
  process.on("exit", () => {
    if (!finished && !failed) {
      console.error(`\nThe verify run stopped after ${next} of ${suites.length} suites were started.`);
      process.exitCode = 1;
    }
  });

  if (suites.length === 0) finish();
  for (let i = 0; i < jobs; i++) start();
}
