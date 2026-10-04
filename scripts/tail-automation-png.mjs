import { spawn } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { createTailParser, classifyTailEncoder } from './automation-tail-parser.mjs';

const leanMode = process.argv.includes('--atlas-lean');
const diagnosticMode = process.argv.includes('--atlas-diagnostic');
if (diagnosticMode && process.argv.includes('--compare-post'))
  throw new Error('Diagnostic trial requires one unfiltered tail per Worker.');
const optimizedMode = process.argv.includes('--atlas-optimized');
const chunksMode = process.argv.includes('--atlas-chunks');
const pipelineMode = leanMode || optimizedMode || process.argv.includes('--atlas-pipeline');
const atlasMode = pipelineMode || chunksMode || process.argv.includes('--atlas');
const output = diagnosticMode
  ? '.automation-png/remote-atlas_diagnostic-invocations.jsonl'
  : leanMode
    ? '.automation-png/remote-atlas_lean-invocations.jsonl'
    : optimizedMode
      ? '.automation-png/remote-atlas_optimized-invocations.jsonl'
      : pipelineMode
        ? '.automation-png/remote-atlas_pipeline-invocations.jsonl'
        : chunksMode
          ? '.automation-png/remote-atlas_chunks-invocations.jsonl'
          : atlasMode
            ? '.automation-png/remote-atlas-invocations.jsonl'
            : process.argv.includes('--bands')
              ? '.automation-png/remote-band-invocations.jsonl'
              : '.automation-png/remote-invocations.jsonl';

const targets = [
  [
    'en-card-png-feasibility',
    diagnosticMode
      ? 'experiments/automation-png/wrangler.atlas-diagnostic.jsonc'
      : leanMode
        ? 'experiments/automation-png/wrangler.atlas-lean.jsonc'
        : optimizedMode
          ? 'experiments/automation-png/wrangler.atlas-optimized.jsonc'
          : pipelineMode
            ? 'experiments/automation-png/wrangler.atlas-pipeline.jsonc'
            : atlasMode
              ? 'experiments/automation-png/wrangler.atlas.jsonc'
              : 'experiments/automation-png/wrangler.jsonc',
  ],
  [
    'en-card-png-probe',
    diagnosticMode
      ? 'experiments/automation-png/wrangler.atlas-diagnostic-probe.jsonc'
      : leanMode
        ? 'experiments/automation-png/wrangler.atlas-lean-probe.jsonc'
        : optimizedMode
          ? 'experiments/automation-png/wrangler.atlas-optimized-probe.jsonc'
          : pipelineMode
            ? 'experiments/automation-png/wrangler.atlas-pipeline-probe.jsonc'
            : chunksMode
              ? 'experiments/automation-png/wrangler.atlas-probe.jsonc'
              : 'experiments/automation-png/wrangler.probe.jsonc',
  ],
];
if (diagnosticMode) writeFileSync(output, '', { flag: 'wx' });
// A separate server-filtered stream tests whether the full renderer stream loses
// assembly events. It does not alter hot code or store request headers/bodies.
if (leanMode && process.argv.includes('--compare-post'))
  targets.push([
    'en-card-png-feasibility',
    'experiments/automation-png/wrangler.atlas-lean.jsonc',
    'POST',
  ]);
const diagnostics = {};
const finalizeBuffers = [];
const diagnosticPath = output.replace('-invocations.jsonl', '-tail-diagnostics.json');
const saveDiagnostics = () =>
  writeFileSync(
    diagnosticPath,
    JSON.stringify(
      {
        updated_at_utc: new Date().toISOString(),
        scope:
          'Sanitized local tail process counters. Zero local drops does not prove provider delivered every invocation.',
        targets: diagnostics,
      },
      null,
      2,
    ) + '\n',
  );
const children = targets.map(([script, config, method]) => {
  const channel = method ? `${script}-${method}` : script;
  const stats = (diagnostics[channel] = {
    stdout_bytes: 0,
    stderr_bytes: 0,
    parsed_events: 0,
    invalid_json: 0,
    buffer_discards: 0,
    discarded_characters: 0,
    pending_characters: 0,
    warning_chunks: 0,
    sampling_notice_chunks: 0,
    connected: false,
    process_error: false,
    exit_code: null,
  });
  const child = spawn(
    process.execPath,
    [
      'node_modules/wrangler/bin/wrangler.js',
      'tail',
      script,
      '--config',
      config,
      '--format',
      'json',
      ...(method ? ['--method', method] : []),
    ],
    {
      env: { ...process.env, WRANGLER_WRITE_LOGS: 'false', WRANGLER_SEND_METRICS: 'false' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const parser = createTailParser((event) => {
    if (!event.eventTimestamp) return;
    stats.connected = true;
    stats.parsed_events++;
    try {
      const url = event.event?.request?.url ? new URL(event.event.request.url) : null;
      const path = url?.pathname;
      const headers = event.event?.request?.headers ?? {};
      const labCall = Object.entries(headers).find(
        ([name]) => name.toLowerCase() === 'x-lab-call',
      )?.[1];
      const row = {
        at: event.eventTimestamp,
        script,
        channel,
        path:
          path &&
          (/^\/diagnostic\/glyphs\/(800|720)\/(expression|comparison|long|long_comparison|coverage)\/\d{1,2}$/.test(
            path,
          ) ||
            /^\/(?:optimized\/(?:800|720)\/|lean\/(?:800|720)\/)?(render|probe|band|glyphs|pipeline\/(?:glyphs|assemble))\/(expression|comparison|long|long_comparison|coverage)(\/(wasm|native|fast|bands|atlas|atlas_chunks|atlas_pipeline|atlas_optimized(?:800|720)|atlas_lean(?:800|720)|\d{1,2}))?$/.test(
              path,
            ))
            ? path
            : 'other',
        encoder: classifyTailEncoder(url),
        cpu_ms: event.cpuTime,
        wall_ms: event.wallTime,
        outcome: event.outcome,
        exceptions: event.exceptions?.length ?? 0,
        version: event.scriptVersion?.id,
        ...(diagnosticMode
          ? {
              call: typeof labCall === 'string' && /^[a-f0-9]{32}$/.test(labCall) ? labCall : null,
              provider_truncated: event.truncated === true,
            }
          : {}),
      };
      const safe = JSON.stringify(row);
      appendFileSync(output, safe + '\n');
      console.log(safe);
    } catch {
      stats.invalid_json++;
      console.error('Invalid tail event; raw content discarded.');
    }
  }, stats);
  finalizeBuffers.push(() => {
    stats.pending_characters = parser.pendingCharacters();
  });
  child.stdout.on('data', (data) => {
    stats.stdout_bytes += data.length;
    const chunk = data.toString();
    if (/Connected to|Successfully created tail/.test(chunk)) stats.connected = true;
    if (/sampl|dropped|exceed.*log/i.test(chunk)) stats.sampling_notice_chunks++;
    parser.push(chunk);
    saveDiagnostics();
  });
  child.stderr.on('data', (data) => {
    // Classify diagnostics without retaining raw text, headers or secrets.
    stats.stderr_bytes += data.length;
    if (/warn/i.test(data.toString())) stats.warning_chunks++;
    if (/sampl|dropped|exceed.*log/i.test(data.toString())) stats.sampling_notice_chunks++;
    saveDiagnostics();
  });
  child.on('error', () => {
    stats.process_error = true;
    saveDiagnostics();
    console.error(`Tail process failed: ${script}`);
  });
  child.on('exit', (code) => {
    stats.exit_code = code;
    stats.pending_characters = parser.pendingCharacters();
    saveDiagnostics();
    if (code) console.error(`Tail exited: ${script} (${code})`);
  });
  return child;
});
const stop = () => {
  for (const finalize of finalizeBuffers) finalize();
  saveDiagnostics();
  for (const child of children) child.kill();
  process.exit();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setTimeout(stop, (diagnosticMode ? 15 : 6) * 60000);
console.log('Temporary PNG Workers tail starting; only sanitized invocation metadata is retained.');
