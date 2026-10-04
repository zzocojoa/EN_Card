// Compare render algorithms in fresh local isolates. No remote requests.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

execFileSync(
  process.execPath,
  ['experiments/automation-png/research-assembly-workerd.mjs', '--prepare-only'],
  { stdio: 'inherit' },
);
const { inputs } = await import('../../.automation-png/assembly-profile-inputs.mjs');
const isolateLoop = process.argv.includes('--isolate-loop');
const nativeCrc = process.argv.includes('--native-crc');
assert.ok(!(isolateLoop && nativeCrc), 'Choose one comparison at a time');
const modes = nativeCrc
  ? ['scalar', 'extracted', 'native']
  : isolateLoop
    ? ['scalar', 'extracted', 'packed']
    : ['scalar', 'packed', 'spans'];
const rounds = isolateLoop || nativeCrc ? 4 : 2;
const scripts = {};
for (const mode of modes) {
  const compiled = await build({
    entryPoints: [
      `experiments/automation-png/${mode === 'scalar' ? 'atlas-lean-worker' : 'atlas-blit-worker'}.ts`,
    ],
    define: { BLIT_MODE: JSON.stringify(mode) },
    bundle: true,
    write: false,
    platform: 'neutral',
    format: 'esm',
    external: ['node:*'],
    mainFields: ['module', 'main'],
    loader: { '.bin': 'binary', '.data': 'text' },
  });
  scripts[mode] = compiled.outputFiles[0].text;
}
function collect(profile) {
  const counts = {},
    nodes = new Map(profile.nodes.map((n) => [n.id, n]));
  for (const id of profile.samples ?? []) {
    const frame = nodes.get(id).callFrame;
    const name = (frame.functionName || '(anonymous)') + ' @ ' + frame.url;
    if (name.startsWith('(idle)') || name.startsWith('(root)')) continue;
    counts[name] = (counts[name] ?? 0) + 1;
  }
  return counts;
}
async function measure(script, input) {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      host: '127.0.0.1',
      port: 0,
      inspectorHost: '127.0.0.1',
      inspectorPort: 0,
      cf: false,
      telemetry: { enabled: false },
      modules: true,
      script,
      compatibilityDate: '2026-09-01',
    }),
  );
  let ws;
  try {
    await mf.ready;
    const listing = new URL('/json/list', await mf.getInspectorURL());
    listing.protocol = 'http:';
    const target = (await (await fetch(listing)).json()).find((t) => t.webSocketDebuggerUrl);
    assert.ok(target);
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = () => reject(new Error('Local inspector unavailable'));
    });
    let id = 0;
    const pending = new Map();
    ws.onmessage = (event) => {
      const r = JSON.parse(event.data),
        p = pending.get(r.id);
      if (!p) return;
      pending.delete(r.id);
      clearTimeout(p.timeout);
      r.error ? p.reject(new Error(r.error.message)) : p.resolve(r.result);
    };
    const cdp = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const seq = ++id;
        const timeout = setTimeout(() => {
          pending.delete(seq);
          reject(new Error('Local profiler timeout'));
        }, 15000);
        pending.set(seq, { resolve, reject, timeout });
        ws.send(JSON.stringify({ id: seq, method, params }));
      });
    const run = async () => {
      const start = performance.now();
      const response = await mf.dispatchFetch(
        `http://localhost/lean/${input.size}/pipeline/assemble/${input.fixture}`,
        { method: 'POST', body: input.bundle },
      );
      assert.equal(response.status, 200);
      assert.ok(Buffer.from(await response.arrayBuffer()).equals(input.png));
      return performance.now() - start;
    };
    await cdp('Profiler.enable');
    await cdp('Profiler.setSamplingInterval', { interval: 100 });
    await cdp('Profiler.start');
    const first_wall_ms = await run();
    const first_profile = collect((await cdp('Profiler.stop')).profile);
    const subsequent_wall_ms = [];
    for (let i = 0; i < 4; i++) subsequent_wall_ms.push(await run());
    await cdp('Profiler.start');
    const warm_wall_ms = [];
    for (let i = 0; i < 20; i++) warm_wall_ms.push(await run());
    const warm_profile = collect((await cdp('Profiler.stop')).profile);
    return { first_wall_ms, subsequent_wall_ms, warm_wall_ms, first_profile, warm_profile };
  } finally {
    ws?.close();
    await mf.dispose();
  }
}
const rows = [];
for (let repeat = 0; repeat < rounds; repeat++) {
  const order = repeat % 2 ? [...inputs].reverse() : inputs;
  for (const [index, input] of order.entries()) {
    const rotated = modes.map((_, i) => modes[(i + index + repeat) % modes.length]);
    if (repeat % 2) rotated.reverse();
    for (const mode of rotated) {
      const result = await measure(scripts[mode], input);
      const row = { mode, repeat, size: input.size, fixture: input.fixture, ...result };
      rows.push(row);
      console.log(
        JSON.stringify({
          mode,
          repeat,
          size: input.size,
          fixture: input.fixture,
          first_wall_ms: result.first_wall_ms,
          warm_mean_ms: result.warm_wall_ms.reduce((a, b) => a + b, 0) / 20,
        }),
      );
    }
  }
}
const summaries = modes.map((mode) => {
  const matching = rows.filter((r) => r.mode === mode);
  const first = matching.map((r) => r.first_wall_ms).sort((a, b) => a - b);
  const warm = matching.flatMap((r) => r.warm_wall_ms);
  const profiles = { first: {}, warm: {} };
  for (const phase of ['first', 'warm'])
    for (const row of matching)
      for (const [name, count] of Object.entries(row[`${phase}_profile`]))
        profiles[phase][name] = (profiles[phase][name] ?? 0) + count;
  return {
    mode,
    fresh_instances: matching.length,
    first_min_ms: first[0],
    first_max_ms: first.at(-1),
    first_median_ms: (first[first.length / 2 - 1] + first[first.length / 2]) / 2,
    first_mean_ms: first.reduce((a, b) => a + b, 0) / first.length,
    warm_mean_ms: warm.reduce((a, b) => a + b, 0) / warm.length,
    profiles,
  };
});
await writeFile(
  `docs/evidence/AI_PNG_BLIT_${nativeCrc ? 'CRC_' : isolateLoop ? 'ISOLATION_' : ''}LOCAL_2026-10-03.json`,
  JSON.stringify(
    {
      measured_at_utc: new Date().toISOString(),
      qualification: 'local_comparison_only',
      scope: `${rows.length} fresh local workerd instances: ${modes.length} variants x 10 size/fixture cases x ${rounds} rounds; candidate order rotated/reversed. Each first assembly +4 subsequent +20 warm. ${rows.length * 25} exact PNG comparisons. Same validated real bundles and compression. Native variant is extracted painter plus native CRC; extracted versus native isolates the CRC change. All PNG structure/CRC checks remain. Module startup and glyph preparation excluded. Host wall time includes dispatch/body/parity checks; 100us sampled CPU profiles are not remote request CPU. No cross-request glyph cache.`,
      summaries,
      rows,
    },
    null,
    2,
  ) + '\n',
);
for (const { profiles, ...summary } of summaries)
  console.log(
    JSON.stringify({
      ...summary,
      first_non_idle_samples: Object.values(profiles.first).reduce((a, b) => a + b, 0),
      warm_non_idle_samples: Object.values(profiles.warm).reduce((a, b) => a + b, 0),
    }),
  );
