/**
 * The GPU memory behind the context-loss handling (src/lib/render/gpu-health.ts, issue #123): which renderer strings
 * count as a CPU rasteriser or an older Intel chip, what a remembered loss does to the next start (gentle loading,
 * Low once), that a loss in a hidden page is not remembered, that the memory runs out, and the bug form's GPU line.
 * Also the room side of a lost context: a client with no car to send keeps its room going but sends no state.
 *
 *   npx tsx scripts/verify-gpu-health.ts
 */
import {
  classifyRenderer,
  GPU_LOSS_KEY,
  GPU_NAME_KEY,
  gpuReportLine,
  LOSS_MEMORY_MS,
  lostRecently,
  noteRenderer,
  readLossMemory,
  recordContextLoss,
  resetGpuPageState,
  safeStartPlan,
  settleLoss,
  takeSafeStart,
  type KeyValueStore,
} from "../src/lib/render/gpu-health";
import { MultiplayerSyncManager, type NetworkVehiclePacket } from "../src/lib/sim/multiplayer-sync";

let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(86)} ${detail}`);
  if (!ok) failed++;
}

class MapStore implements KeyValueStore {
  readonly map = new Map<string, string>();
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}
/** Storage that throws on every call (Safari private mode used to) */
const brokenStore: KeyValueStore = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};

// --- Renderer strings ---
const cases: [string | null, ReturnType<typeof classifyRenderer>][] = [
  // The reporter's laptop, as Chrome on Linux shows it (ANGLE's wrapper taken off by rendererName)
  ["Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6", "weak"],
  ["Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11", "weak"],
  ["Intel(R) HD Graphics 520", "weak"],
  ["Intel HD Graphics 4000 OpenGL Engine", "weak"],
  ["Intel(R) Iris(TM) Plus Graphics 655", "weak"],
  ["Intel(R) Iris(R) Graphics 540", "weak"],
  ["Mesa DRI Intel(R) Haswell Mobile", "weak"],
  ["Intel(R) Iris(R) Xe Graphics", "ok"],
  ["Intel(R) Arc(TM) A770 Graphics", "ok"],
  ["Intel(R) Graphics (0x00007D55)", "ok"],
  ["Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver", "software"],
  ["llvmpipe (LLVM 15.0.7, 256 bits)", "software"],
  ["Microsoft Basic Render Driver", "software"],
  ["NVIDIA GeForce RTX 3060/PCIe/SSE2", "ok"],
  ["AMD Radeon RX 6600 (radeonsi, navi23, LLVM 15.0.7, DRM 3.49, 6.1.0)", "ok"],
  ["Apple M2", "ok"],
  ["Apple GPU", "unknown"],
  ["WebKit WebGL", "unknown"],
  ["", "unknown"],
  [null, "unknown"],
];
for (const [name, want] of cases) {
  const got = classifyRenderer(name);
  check(`classify "${(name ?? "null").slice(0, 60)}"`, got === want, `${got}${got === want ? "" : ` (want ${want})`}`);
}

// --- Remembered losses ---
const T0 = 1_800_000_000_000;
{
  const store = new MapStore();
  check("nothing remembered at first", readLossMemory(store, T0) === null);
  const plan0 = safeStartPlan(readLossMemory(store, T0), "ok");
  check("no loss, a capable GPU: normal start", !plan0.gentle && !plan0.switchToLow);
  check("no loss, an older Intel chip: gentle, preset kept", safeStartPlan(null, "weak").gentle && !safeStartPlan(null, "weak").switchToLow);
  check("no loss, a CPU rasteriser: gentle", safeStartPlan(null, "software").gentle);
  check("no loss, unknown GPU: normal start (no guessing)", !safeStartPlan(null, "unknown").gentle);

  // A loss the player saw
  const loss = recordContextLoss(store, T0, false);
  check("a seen loss is remembered", loss !== null && loss.count === 1 && !loss.settled);
  const next = takeSafeStart(store, T0 + 60_000);
  check("the next start goes gentle and switches to Low", next.gentle && next.switchToLow);
  const after = takeSafeStart(store, T0 + 120_000);
  check("…only once: the start after keeps the player's preset, still gentle", after.gentle && !after.switchToLow);

  // A second loss within the memory counts on and asks again
  const second = recordContextLoss(store, T0 + 3600_000, false);
  check("a second loss counts on and is unsettled again", second?.count === 2 && second.settled === false);
  settleLoss(store, T0 + 3600_000 + 1000);
  const chose = takeSafeStart(store, T0 + 3600_000 + 2000);
  check("the player chose on the notice: no Low switch, still gentle", chose.gentle && !chose.switchToLow);

  // The memory runs out
  const late = T0 + 3600_000 + LOSS_MEMORY_MS + 1;
  check("forgotten after LOSS_MEMORY_MS", readLossMemory(store, late) === null && !store.map.has(GPU_LOSS_KEY));
  const plan = takeSafeStart(store, late);
  check("…and the start is normal again", !plan.gentle && !plan.switchToLow);
}
{
  const store = new MapStore();
  const hidden = recordContextLoss(store, T0, true);
  check("a loss in a hidden page is not remembered", hidden === null && !store.map.has(GPU_LOSS_KEY));
  store.setItem(GPU_LOSS_KEY, "{not json");
  check("a corrupt entry reads as nothing", readLossMemory(store, T0) === null);
  store.setItem(GPU_LOSS_KEY, JSON.stringify({ atMs: T0 + 3600_000, count: 1, settled: false }));
  check("an entry from the future (clock set back) is dropped", readLossMemory(store, T0) === null && !store.map.has(GPU_LOSS_KEY));
}
{
  // Blocked storage never throws out of the module
  let threw = false;
  try {
    recordContextLoss(brokenStore, T0, false);
    takeSafeStart(brokenStore, T0);
    settleLoss(brokenStore, T0);
    noteRenderer("Intel(R) UHD Graphics 620", brokenStore);
    gpuReportLine(() => null, brokenStore);
  } catch {
    threw = true;
  }
  check("blocked storage: nothing throws", !threw);
  check("blocked storage: nothing remembered", readLossMemory(brokenStore, T0) === null);
  check("no storage at all: a normal start", !takeSafeStart(null, T0).gentle);
}

// --- The bug form's GPU line ---
{
  resetGpuPageState();
  const store = new MapStore();
  check("no session yet: the probe's answer", gpuReportLine(() => "Apple M2", store) === "Apple M2");
  check("no session and no WebGL", gpuReportLine(() => null, store) === "no WebGL");
  noteRenderer("Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6", store);
  check("the renderer is kept for later pages", store.map.get(GPU_NAME_KEY)?.includes("UHD Graphics 620") === true);
  check(
    "WebGL refused now: the start's renderer, and that WebGL is gone",
    gpuReportLine(() => null, store) === "Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6 · no WebGL now",
    gpuReportLine(() => null, store)
  );
  recordContextLoss(store, Date.now(), false);
  const line = gpuReportLine(() => null, store);
  check(
    "after a loss on this page: says so, and that WebGL is gone",
    line === "Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6 · WebGL context lost · no WebGL now",
    line
  );
  resetGpuPageState();
  const later = gpuReportLine(() => "Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6", store);
  check(
    "a new page reads the kept renderer and the earlier loss",
    later === "Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6 · WebGL context lost earlier",
    later
  );
  let threw = false;
  try {
    gpuReportLine(() => {
      throw new Error("probe failed");
    }, store);
  } catch {
    threw = true;
  }
  check("a probe that throws is taken as no WebGL", !threw);
}

{
  resetGpuPageState();
  const store = new MapStore();
  check("a refused context with no loss before it is not taken for a reset", !lostRecently(store));
  recordContextLoss(store, Date.now(), true);
  check("…after a loss on this page (even a hidden one) it is", lostRecently(store));
  resetGpuPageState();
  check("…and on a new page while a loss is remembered", (recordContextLoss(store, Date.now(), false), resetGpuPageState(), lostRecently(store)));
}

// --- The room with a lost context (multiplayer-sync update(now, null)) ---
{
  let t = 0;
  const host = new MultiplayerSyncManager({ clock: () => t });
  const posts: { state: number; control: number; lastStateMs: number; lastControlMs: number } = { state: 0, control: 0, lastStateMs: -1, lastControlMs: -1 };
  // The same-browser transport, watched: control messages are envelopes ({ ctl }), car states are bare packets
  (host as unknown as { channel: { postMessage(m: unknown): void; close(): void } }).channel = {
    postMessage: (m) => {
      if (m && typeof m === "object" && "ctl" in m) {
        posts.control++;
        posts.lastControlMs = t;
      } else {
        posts.state++;
        posts.lastStateMs = t;
      }
    },
    close: () => {},
  };
  host.hostLocal();
  const car: Omit<NetworkVehiclePacket, "peerId" | "timestampMs"> = {
    driverCode: "LCX",
    teamColorHex: "#ffffff",
    pos: [0, 0, 0],
    quat: [0, 0, 0, 1],
    linVel: [0, 0, 0],
    angVel: [0, 0, 0],
    steerAngle: 0,
    wheelRPMs: [0, 0, 0, 0],
    throttle: 0,
    brake: 0,
    trackS: 0,
    speedKmh: 0,
  };
  const LOST_AT = 2000;
  for (t = 0; t <= 12_000; t += 1000 / 60) host.update(t, t < LOST_AT ? car : null);
  check("before the loss the car's state goes out", posts.state > 30, `${posts.state} packets`);
  check("after it no state goes out", posts.lastStateMs < LOST_AT, `last at ${posts.lastStateMs.toFixed(0)} ms`);
  check("the host's room keeps running (its lobby still goes out)", posts.lastControlMs > LOST_AT + 6000, `last control at ${posts.lastControlMs.toFixed(0)} ms`);
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nAll GPU health checks passed.");
