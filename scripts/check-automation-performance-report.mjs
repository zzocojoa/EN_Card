import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const d = JSON.parse(fs.readFileSync('docs/performance/history.json'));
assert.equal(d.proposals.length, 5);
assert.ok(d.proposals.every((r) => r.estimated_ms === null && r.status === '미구현 가설'));
assert.equal(new Set(d.attempts.map((r) => r.id)).size, 25);
assert.equal(
  d.trials.reduce((s, r) => s + r.png, 0),
  88,
);
assert.equal(d.remote_groups.length, 34);
for (const r of d.remote_groups) {
  assert.equal(r.expected - r.captured, r.missing);
  assert.ok(r.over_10ms <= r.captured);
  if (!r.captured) {
    assert.equal(r.min_ms, null);
    assert.equal(r.max_ms, null);
  }
}
for (const r of d.sources)
  assert.equal(createHash('sha256').update(fs.readFileSync(r.file)).digest('hex'), r.sha256);
const errors = [];
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
page.on('pageerror', (e) => errors.push(e.message));
const checks = [];
try {
  await page.goto('http://127.0.0.1:4175/');
  await page.getByRole('heading', { name: '01 · 실제 원격 CPU' }).waitFor();
  await page.waitForTimeout(400);
  assert.equal(await page.locator('svg.recharts-surface').count(), 5);
  for (const id of [
    'remote-cpu',
    'coverage-chart',
    'optimized-chart',
    'lean-chart',
    'blit-chart',
  ]) {
    const sizes = await page
      .locator(`[data-component-id="${id}"] svg.recharts-surface`)
      .evaluateAll((es) =>
        es.map((e) => ({
          w: e.getBoundingClientRect().width,
          h: e.getBoundingClientRect().height,
          marks: e.querySelectorAll('.recharts-bar-rectangle').length,
        })),
      );
    assert.ok(sizes.length && sizes.every((r) => r.w > 100 && r.h > 100 && r.marks > 0), id);
  }
  checks.push('5 chart SVGs have visible dimensions and painted bar marks');
  await page.getByLabel('시험 선택', { exact: true }).selectOption('lean');
  await page.waitForTimeout(200);
  const lean = await page.locator('[data-component-id="remote-details"]').innerText();
  assert.ok(lean.includes('미확보') && lean.includes('0/36') && lean.includes('판정 불가'));
  assert.equal(
    await page.locator('[data-component-id="remote-cpu"] .recharts-bar-rectangle').count(),
    4,
  );
  checks.push('Missing glyph CPU has null cells and no fabricated zero bars');
  await page.getByLabel('시험 선택', { exact: true }).selectOption('svg');
  await page.waitForTimeout(200);
  assert.equal(
    await page.locator('[data-component-id="remote-cpu"] .recharts-bar-rectangle').count(),
    3,
  );
  assert.ok((await page.locator('[data-component-id="remote-cpu"]').innerText()).includes('Wasm'));
  assert.ok(
    (await page.locator('[data-component-id="remote-cpu"]').innerText()).includes('Stream'),
  );
  checks.push('SVG encoder groups remain distinct');
  await page.getByLabel('시험 선택', { exact: true }).selectOption('all');
  await page.waitForTimeout(200);
  assert.equal(
    await page.locator('[data-component-id="remote-cpu"] .recharts-bar-rectangle').count(),
    32,
  );
  assert.ok(
    (await page.locator('[data-component-id="remote-details"]').innerText()).includes('34 results'),
  );
  await page.getByLabel('시험 선택', { exact: true }).selectOption('diagnostic');
  await page.getByLabel('측정 단계', { exact: true }).selectOption('preparation_ms');
  await page.waitForTimeout(200);
  assert.ok(
    (await page.locator('[data-component-id="optimized-chart"]').innerText()).includes('4.2'),
  );
  await page.getByLabel('측정 단계', { exact: true }).selectOption('assembly_ms');
  for (const name of ['screening', 'isolation', 'crc']) {
    await page.getByLabel('독립 비교 선택', { exact: true }).selectOption(name);
    await page.waitForTimeout(150);
    assert.equal(
      await page.locator('[data-component-id="blit-chart"] .recharts-bar-rectangle').count(),
      6,
    );
  }
  checks.push('Trial All/reset, preparation/assembly and all three independent comparisons render');
  await page
    .getByRole('button', { name: '단계별 확보 CPU 최대값 · ms actions', exact: true })
    .click();
  await page.getByRole('menuitem', { name: 'View data source', exact: true }).click();
  await page.waitForTimeout(200);
  assert.ok((await page.locator('body').innerText()).includes('Evidence flow'));
  await page.keyboard.press('Escape');
  checks.push('Native source inspection opens');
  const search = page.locator('[data-component-id="attempt-table"] input');
  await search.fill('native CRC');
  assert.ok(
    (await page.locator('[data-component-id="attempt-table"]').innerText()).includes('A25'),
  );
  await search.fill('');
  checks.push('Attempt search narrows and resets');
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 950 });
    await page.waitForTimeout(300);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    assert.equal(await page.locator('#next-five [data-component-id]').count(), 5);
    await page.screenshot({
      path: `.automation-png/performance-verified-${width}.png`,
      fullPage: true,
    });
  }
  checks.push('1280px/390px layouts: no horizontal page overflow; all five proposals present');
  const appRoot = '.automation-png/performance-report';
  const appData = JSON.parse(fs.readFileSync(`${appRoot}/src/data.json`));
  assert.equal(appData.buildStatus, 'complete');
  assert.ok(appData.queries.remote.rows.every((r) => r.limit_ms === 10));
  const manifest = JSON.parse(fs.readFileSync(`${appRoot}/dist/data-app-build.json`));
  for (const file of [manifest.html, manifest.snapshot]) {
    assert.equal(
      createHash('sha256')
        .update(fs.readFileSync(`${appRoot}/dist/${file.path}`))
        .digest('hex'),
      file.sha256,
    );
  }
  const offlinePath = 'docs/performance/ai-png-performance.html';
  const offline = await browser.newPage();
  const externalRequests = [];
  offline.on('pageerror', (e) => errors.push(e.message));
  offline.on('request', (r) => {
    if (/^https?:/.test(r.url())) externalRequests.push(r.url());
  });
  await offline.goto(pathToFileURL(path.resolve(offlinePath)).href);
  await offline.getByRole('heading', { name: '01 · 실제 원격 CPU' }).waitFor();
  assert.equal(await offline.locator('svg.recharts-surface').count(), 5);
  await offline.getByLabel('시험 선택', { exact: true }).selectOption('lean');
  assert.ok(
    (await offline.locator('[data-component-id="remote-details"]').innerText()).includes('미확보'),
  );
  assert.deepEqual(externalRequests, []);
  await offline.close();
  checks.push(
    'Complete build and manifest hashes verified; single HTML renders all charts and filters without HTTP requests',
  );
  assert.deepEqual(errors, []);
  const result = {
    checked_at_utc: new Date().toISOString(),
    result: 'passed',
    previous_goal_turn: 'progress: local candidate implementation and measured evidence completed',
    requirements: {
      additional_methods: 5,
      prior_attempts: 25,
      remote_groups: 34,
      local_measurement_rows: d.local_measurements.length,
      visualization: '5 interactive charts + source-backed tables and proposals',
    },
    checks,
    source_hashes_checked: d.sources.length,
    artifact: {
      file: offlinePath,
      bytes: fs.statSync(offlinePath).size,
      sha256: createHash('sha256').update(fs.readFileSync(offlinePath)).digest('hex'),
      app_id: appData.id,
      snapshot_sha256: manifest.snapshot.sha256,
    },
    uncaught_browser_errors: errors,
    new_remote_requests: 0,
    scope:
      'Artifact data and browser verification. No new CPU benchmark, provider account check, AI or Kakao test.',
  };
  fs.writeFileSync('docs/performance/verification.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
