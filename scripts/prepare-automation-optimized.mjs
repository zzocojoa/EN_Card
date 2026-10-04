import { cp, readdir, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

// Selected 64-slot layouts only: both resolutions fit one Free asset deployment.
const root = '.automation-png/atlas-optimized';
let total = 0;
for (const size of [800, 720]) {
  const source = `${root}/${size}/64`;
  const files = await readdir(source);
  assert.ok(files.every((name) => /^(?:\d+-\d+-\d+\.bin|FONT-LICENSE\.txt)$/.test(name)));
  total += files.length;
  assert.ok(total <= 20000, 'Free static asset file limit exceeded');
  await mkdir(`${root}/assets/${size}`, { recursive: true });
  await cp(source, `${root}/assets/${size}`, { recursive: true });
}
console.log(`Prepared ${total} static files for 800/720, 64 slots per page.`);
