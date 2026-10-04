import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// The plugin and runtime paths are explicit local dependencies, not downloads.
const [pluginRoot, runtimeNode] = process.argv.slice(2);
if (!pluginRoot || !runtimeNode)
  throw new Error(
    'Usage: node scripts/build-automation-performance-visual.mjs <Data plugin root> <bundled node executable>',
  );
const app = path.resolve('.automation-png/performance-report');
const snapshotPath = path.resolve('docs/performance/snapshot.json');
if (!fs.existsSync(app)) {
  execFileSync(
    runtimeNode,
    [
      path.join(pluginRoot, 'scripts/prepare-data-app.mjs'),
      '--surface',
      'report',
      '--blank',
      '--output',
      app,
      '--snapshot',
      snapshotPath,
    ],
    { stdio: 'inherit' },
  );
}
const dataPath = path.join(app, 'src/data.json');
const current = JSON.parse(fs.readFileSync(dataPath));
const snapshot = JSON.parse(fs.readFileSync(snapshotPath));
snapshot.id = current.id; // Preserve the fresh identity assigned by the preparer.
snapshot.report = { asOf: '2026-10-03' };
snapshot.buildStatus = process.env.PERFORMANCE_REPORT_COMPLETE === '1' ? 'complete' : 'updating';
for (const r of snapshot.queries.remote.rows) r.limit_ms = 10;
snapshot.queries.remote.source.metricDefinitions.push({
  label: 'CPU 기준',
  definition:
    'Workers Free HTTP/Cron 요청당10ms. 2026-10-03 공식 limits 확인. 계정의 현재 Free 자격을 재조회한 것은 아님.',
});
snapshot.queries.remote.source.evidenceFlow.push({
  title: '공식 한도',
  detail: 'https://developers.cloudflare.com/workers/platform/limits/#cpu-time (2026-10-03 확인)',
});
for (const q of Object.values(snapshot.queries))
  q.source.files = q.source.files.map((f) => ({
    path: f.path.startsWith('AI_PNG_')
      ? `docs/evidence/${f.path}`
      : f.path.startsWith('AI_CARD_')
        ? `docs/${f.path}`
        : f.path,
  }));
fs.writeFileSync(dataPath, JSON.stringify(snapshot, null, 2) + '\n');
for (const name of ['ReportContent.jsx', 'performance.css'])
  fs.copyFileSync(`docs/performance/${name}`, path.join(app, 'src/content/report', name));
execFileSync(
  runtimeNode,
  [path.join(pluginRoot, 'scripts/data-app.mjs'), 'build', '--project-dir', app, '--separate-data'],
  { stdio: 'inherit' },
);
if (snapshot.buildStatus === 'complete') {
  const target = path.join(app, '.data-app-offline/exports/ai-png-performance.html');
  execFileSync(
    runtimeNode,
    [
      path.join(pluginRoot, 'scripts/data-app.mjs'),
      'export-offline',
      '--project-dir',
      app,
      '--output',
      target,
    ],
    { stdio: 'inherit' },
  );
  fs.copyFileSync(target, 'docs/performance/ai-png-performance.html');
}
