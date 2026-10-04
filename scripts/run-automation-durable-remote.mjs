// Bounded, explicitly authorized trial only. Never logs auth headers/card bodies.
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { strict as assert } from 'node:assert';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createTailParser } from './automation-tail-parser.mjs';

const root = resolve('.automation-png/durable/remote');
const ledger = JSON.parse(await readFile(`${root}/resources.json`, 'utf8'));
assert.equal(ledger.renderer_name, 'en-card-png-do-trial');
assert.equal(ledger.probe_name, 'en-card-png-do-probe');
assert.equal(ledger.free_plan_confirmed, true);
const origin = new URL(ledger.probe_url);
assert.equal(origin.protocol, 'https:');
assert.match(origin.hostname, /^en-card-png-do-probe\.[a-z0-9-]+\.workers\.dev$/);
assert.equal(origin.pathname, '/');
const token = (await readFile(`${root}/bench-token.txt`, 'utf8')).trim();
assert.match(token, /^[0-9a-f]{64}$/);
const out = `${root}/measurement`;
await mkdir(out, { recursive: true });
// Never silently append a repeated measurement or overwrite an earlier trial.
await writeFile(`${out}/attempts.jsonl`, '', { flag: 'wx' });
await writeFile(`${out}/invocations.jsonl`, '', { flag: 'wx' });
const inputs = JSON.parse(await readFile('.automation-png/durable/inputs.json', 'utf8'));
assert.equal(inputs.length, 5);
const records = [],
  calls = [],
  tails = [],
  tailStats = {};
let nextCall = 0;
let failure = null;
let rendersAttempted = 0;
const run = async (path, { input, authorization = true, expected = 200 } = {}) => {
  const call = `do-call-${String(++nextCall).padStart(3, '0')}`;
  const entry = {
    call,
    path,
    method: input === undefined ? 'GET' : 'POST',
    started: new Date().toISOString(),
    expected,
  };
  calls.push(entry);
  appendFileSync(`${out}/attempts.jsonl`, JSON.stringify({ ...entry, event: 'attempt' }) + '\n');
  const response = await fetch(new URL(path, origin), {
    method: entry.method,
    redirect: 'error',
    signal: AbortSignal.timeout(60000),
    headers: {
      ...(authorization ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
      'X-Lab-Call': call,
    },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
  });
  appendFileSync(
    `${out}/attempts.jsonl`,
    JSON.stringify({
      call,
      event: 'response',
      status: response.status,
      at: new Date().toISOString(),
    }) + '\n',
  );
  assert.equal(response.status, expected, `${call} status`);
  return response;
};

try {
  for (const [script, config] of [
    [ledger.renderer_name, 'renderer.jsonc'],
    [ledger.probe_name, 'probe.jsonc'],
  ]) {
    const stats = (tailStats[script] = {
      bytes: 0,
      invalid_json: 0,
      buffer_discards: 0,
      discarded_characters: 0,
      pending_characters: 0,
      events: 0,
      stderr_bytes: 0,
      ready: false,
    });
    const parser = createTailParser((event) => {
      if (!event.eventTimestamp) return;
      const request = event.event?.request;
      const headers = request?.headers ?? {};
      const call = Object.entries(headers).find(([key]) => key.toLowerCase() === 'x-lab-call')?.[1];
      const path = request?.url ? new URL(request.url).pathname : null;
      const row = {
        script,
        at: event.eventTimestamp,
        call: typeof call === 'string' && /^do-call-\d{3}$/.test(call) ? call : null,
        path:
          path && /^\/durable\/[0-4]\/(render|image(?:\/[a-z0-9_-]{1,48})?)$/.test(path)
            ? path
            : 'other',
        cpu_ms: typeof event.cpuTime === 'number' ? event.cpuTime : null,
        wall_ms: typeof event.wallTime === 'number' ? event.wallTime : null,
        outcome: typeof event.outcome === 'string' ? event.outcome : null,
        version: event.scriptVersion?.id ?? null,
        event_keys: Object.keys(event.event ?? {}).filter((key) => /^[a-zA-Z]{1,32}$/.test(key)),
      };
      stats.events++;
      if (row.call) stats.ready = true;
      appendFileSync(`${out}/invocations.jsonl`, JSON.stringify(row) + '\n');
    }, stats);
    const child = spawn(
      process.execPath,
      [
        'node_modules/wrangler/bin/wrangler.js',
        'tail',
        script,
        '--config',
        `${root}/${config}`,
        '--format',
        'json',
      ],
      {
        env: { ...process.env, WRANGLER_WRITE_LOGS: 'false', WRANGLER_SEND_METRICS: 'false' },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    child.stdout.on('data', (chunk) => {
      stats.bytes += chunk.length;
      const text = chunk.toString();
      if (/Connected to|Successfully created tail/i.test(text)) stats.ready = true;
      parser.push(text);
    });
    child.stderr.on('data', (chunk) => {
      stats.stderr_bytes += chunk.length;
    });
    child.on('error', () => {
      stats.process_error = true;
    });
    child.on('exit', (code) => {
      stats.exit_code = code;
    });
    tails.push(child);
  }
  // Wrangler JSON mode has no connection banner. A bounded invalid request
  // confirms both actual event streams without consuming a render reservation.
  for (let i = 0; i < 3 && !Object.values(tailStats).every((s) => s.ready); i++) {
    await delay(5000);
    await (await run('/durable/3/render', { input: {}, expected: 400 })).arrayBuffer();
    for (let wait = 0; wait < 10 && !Object.values(tailStats).every((s) => s.ready); wait++)
      await delay(1000);
  }
  assert(
    Object.values(tailStats).every((s) => s.ready),
    'Both tails must be connected before measuring',
  );
  await (
    await run('/durable/0/render', { input: inputs[0], authorization: false, expected: 401 })
  ).arrayBuffer();
  for (let slot = 0; slot < 4; slot++) {
    for (const [index, input] of inputs.entries()) {
      assert(++rendersAttempted <= 20);
      const result = await (await run(`/durable/${slot}/render`, { input })).json();
      assert.equal(result.reused, false);
      assert.equal(result.width, 1080);
      assert.equal(result.height, 1080);
      const imageResponse = await run(`/durable/${slot}/image/${input.job}`);
      assert.equal(imageResponse.headers.get('Content-Type'), 'image/png');
      const bytes = Buffer.from(await imageResponse.arrayBuffer());
      const expected = await readFile(`.automation-png/durable/expected/${input.job}.png`);
      assert(bytes.equals(expected), `PNG mismatch ${slot}/${input.job}`);
      await writeFile(`${out}/${slot}-${input.job}.png`, bytes);
      records.push({
        slot,
        name: input.job,
        first_for_object: index === 0,
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        ...result,
      });
      await writeFile(`${out}/responses.json`, JSON.stringify(records, null, 2));
      console.log(
        JSON.stringify({
          slot,
          name: input.job,
          stored: true,
          png_equal: true,
          bytes: bytes.length,
        }),
      );
      await delay(800);
    }
  }
  const first = records[0];
  const replay = await (await run('/durable/0/render', { input: inputs[0] })).json();
  assert.equal(replay.reused, true);
  assert.equal(replay.asset.id, first.asset.id);
  await (
    await run('/durable/0/render', { input: { ...inputs[0], number: 99 }, expected: 409 })
  ).arrayBuffer();
  await (await run('/durable/4/render', { input: inputs[0], expected: 404 })).arrayBuffer();
  await (await run('/durable/0/render', { input: {}, expected: 400 })).arrayBuffer();
  await delay(10000);
} catch (error) {
  failure =
    error instanceof Error ? error.message.replace(/Bearer\s+\S+/g, '[redacted]') : 'Trial failed';
} finally {
  for (const child of tails) child.kill();
  const summary = {
    finished: new Date().toISOString(),
    render_attempts: rendersAttempted,
    verified_pngs: records.length,
    requests: calls.length,
    failure,
    tail_stats: tailStats,
    cpu_qualified: false,
    note: 'Qualification requires reconciling every attempted invocation with provider CPU logs. Handler timings are wall-clock diagnostics, not CPU measurements.',
  };
  await writeFile(`${out}/run.json`, JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary));
}
if (failure) process.exitCode = 1;
