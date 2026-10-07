import { strict as assert } from 'node:assert';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const renderer = 'en-card-png-do-trial',
  probe = 'en-card-png-do-probe';
const trialVersions = {
  [renderer]: 'b41a4a9a-f7e0-4ea6-ab01-230be4adf4bc',
  [probe]: 'ad17f2ab-d969-40b7-b7d1-ccc912353fa7',
};
const trialCases = ['expression', 'comparison', 'long', 'long_comparison', 'coverage'];
const stats = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: values.length,
    min: sorted[0],
    max: sorted.at(-1),
    median:
      (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2,
  };
};

export function summarizeDurableTrial({ attempts, invocations, responses, run }) {
  assert.equal(run.failure, null);
  assert.equal(run.render_attempts, 20);
  assert.equal(run.verified_pngs, 20);
  assert.equal(responses.length, 20);
  const calls = attempts.filter((row) => row.event === 'attempt');
  assert.equal(calls.length, run.requests);
  assert.equal(new Set(calls.map((row) => row.call)).size, calls.length);
  assert.equal(attempts.length, calls.length * 2);
  for (const call of calls) {
    const replies = attempts.filter((row) => row.event === 'response' && row.call === call.call);
    assert.equal(replies.length, 1);
    assert.equal(replies[0].status, call.expected);
  }
  for (const row of invocations) {
    assert([renderer, probe].includes(row.script));
    assert.equal(row.version, trialVersions[row.script], 'Wrong trial deployment version');
    assert(calls.some((call) => call.call === row.call));
    assert.equal(row.outcome, 'ok');
    assert(Number.isFinite(row.cpu_ms) && row.cpu_ms >= 0);
    assert(Number.isFinite(row.wall_ms) && row.wall_ms >= 0);
    assert.equal(
      invocations.filter((other) => other.call === row.call && other.script === row.script).length,
      1,
    );
  }
  const event = (call, script) => {
    const match = invocations.find((row) => row.call === call.call && row.script === script);
    assert(match, `Missing image path CPU: ${script}/${call.call}`);
    assert.equal(match.path, call.path);
    assert(match.cpu_ms <= (script === probe ? 10 : 30000), `CPU over limit: ${call.call}`);
    return match;
  };
  // Final successful POST is the deliberate replay; it must not count as a new PNG.
  const posts = calls.filter((call) => call.method === 'POST' && call.expected === 200);
  assert.equal(posts.length, 21);
  const imageCalls = calls.filter((call) => call.method === 'GET' && call.expected === 200);
  assert.equal(imageCalls.length, 20);
  const measured = responses.map((response, index) => {
    assert.equal(response.slot, Math.floor(index / trialCases.length));
    assert.equal(response.name, trialCases[index % trialCases.length]);
    assert.equal(response.first_for_object, index % trialCases.length === 0);
    const post = posts[index];
    const get = imageCalls[index];
    assert.equal(post.path, `/durable/${response.slot}/render`);
    assert.equal(get.path, `/durable/${response.slot}/image/${response.name}`);
    assert.equal(response.reused, false);
    assert.equal(response.width, 1080);
    assert.equal(response.height, 1080);
    assert.equal(response.bytes, response.asset.bytes);
    const doEvent = event(post, renderer),
      gateway = event(post, probe);
    event(get, renderer);
    event(get, probe);
    return {
      slot: response.slot,
      name: response.name,
      first_for_object: response.first_for_object,
      bytes: response.bytes,
      sha256: response.sha256,
      call: post.call,
      do_cpu_ms: doEvent.cpu_ms,
      do_wall_ms: doEvent.wall_ms,
      gateway_cpu_ms: gateway.cpu_ms,
      gateway_wall_ms: gateway.wall_ms,
    };
  });
  assert.equal(new Set(responses.map((r) => r.asset.id)).size, 20);
  assert.equal(new Set(responses.map((r) => r.card_id)).size, 20);
  assert.equal(measured.filter((r) => r.first_for_object).length, 4);
  const expectedEvents = calls.flatMap((call) =>
    [probe, ...([401, 404].includes(call.expected) ? [] : [renderer])].map((script) => ({
      call: call.call,
      script,
      expected_status: call.expected,
    })),
  );
  const missing = expectedEvents.filter(
    (item) => !invocations.some((row) => row.call === item.call && row.script === item.script),
  );
  assert.equal(invocations.length + missing.length, expectedEvents.length);
  return {
    scope: '20 bounded JSON-to-PNG-to-D1/KV renders and 20 PNG reads; not AI/scheduler integration',
    image_path_cpu_pass: true,
    image_path_expected_events: 80,
    image_path_observed_events: 80,
    all_trial_events_complete: missing.length === 0,
    expected_events: expectedEvents.length,
    observed_events: invocations.length,
    missing,
    do_render_cpu_ms: stats(measured.map((r) => r.do_cpu_ms)),
    do_first_render_cpu_ms: stats(
      measured.filter((r) => r.first_for_object).map((r) => r.do_cpu_ms),
    ),
    do_following_render_cpu_ms: stats(
      measured.filter((r) => !r.first_for_object).map((r) => r.do_cpu_ms),
    ),
    gateway_render_cpu_ms: stats(measured.map((r) => r.gateway_cpu_ms)),
    gateway_render_wall_ms: stats(measured.map((r) => r.gateway_wall_ms)),
    total_png_bytes: measured.reduce((sum, r) => sum + r.bytes, 0),
    measured,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = '.automation-png/durable/remote';
  const read = async (path) => JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
  const lines = async (path) =>
    (await readFile(path, 'utf8')).trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
  const raw = {
    attempts: await lines(`${root}/measurement/attempts.jsonl`),
    invocations: await lines(`${root}/measurement/invocations.jsonl`),
    responses: await read(`${root}/measurement/responses.json`),
    run: await read(`${root}/measurement/run.json`),
  };
  const summary = summarizeDurableTrial(raw);
  for (const row of raw.responses) {
    const png = await readFile(`${root}/measurement/${row.slot}-${row.name}.png`);
    assert(png.equals(await readFile(`.automation-png/durable/expected/${row.name}.png`)));
    assert.equal(createHash('sha256').update(png).digest('hex'), row.sha256);
  }
  const db = await read(`${root}/database-after.json`);
  assert(db.every((r) => r.success));
  assert.deepEqual(db[0].results, [{ state: 'ready', n: 20, bytes: summary.total_png_bytes }]);
  assert.deepEqual(db[1].results, [{ cards: 20 }]);
  assert.deepEqual(db[2].results, [{ schedules: 0 }]);
  assert.deepEqual(db[3].results, [{ deliveries: 0 }]);
  assert.deepEqual(db[5].results, []);
  const keys = await read(`${root}/kv-after-remote.json`);
  assert.equal(keys.length, 20);
  assert(raw.responses.every((r) => keys.some((k) => k.name === r.asset.id)));
  const resources = await read(`${root}/resources.json`);
  const paths = [
    'experiments/automation-png/durable-worker.ts',
    'experiments/automation-png/durable-probe.ts',
    'experiments/automation-png/durable-contract.ts',
    'experiments/automation-png/durable-route.ts',
    'experiments/automation-png/svg.ts',
    'experiments/automation-png/raster.ts',
    'src/worker/storage.ts',
    'src/worker/png.ts',
    'src/shared/card-layout.ts',
    'package-lock.json',
  ];
  const sourceHashes = {};
  for (const path of paths)
    sourceHashes[path] = createHash('sha256')
      .update(await readFile(path))
      .digest('hex');
  const evidence = {
    recorded_at: new Date().toISOString(),
    summary,
    account: {
      free_plan_confirmed: resources.free_plan_confirmed,
      confirmed_at: resources.free_plan_confirmed_at,
      source: resources.free_plan_source,
    },
    cleanup: await read(`${root}/cleanup-result.json`),
    build: await read('.automation-png/durable/build.json'),
    database: db.map((r) => r.results),
    kv_keys: keys.length,
    source_sha256: sourceHashes,
    source_hash_scope:
      'Current source snapshot when this report was generated; not an attestation of the uploaded bundle. Invocation versions are checked against the recorded trial deployment IDs.',
    ...raw,
  };
  await writeFile(
    'docs/evidence/AI_PNG_DURABLE_2026-10-03.json',
    JSON.stringify(evidence, null, 2) + '\n',
  );
  console.log(JSON.stringify(summary, null, 2));
}
