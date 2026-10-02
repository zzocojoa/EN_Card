import { readFile, readdir, mkdir, writeFile, access, unlink } from 'node:fs/promises';
import { resolve, dirname, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({ options: { target: { type: 'string' } }, strict: true });
if (!values.target)
  throw new Error('Usage: node scripts/export-haru.mjs --target <하루단어 checkout>');
const target = resolve(values.target);
const hosting = JSON.parse(await readFile(join(target, '.openai/hosting.json'), 'utf8'));
if (hosting.project_id !== 'appgprj_6ab0a3cbaaa08191a05b0bcdf62df225')
  throw new Error('하루단어 사이트 식별자가 다릅니다.');
const output = join(target, 'public/card-studio');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function files(folder) {
  const entries = await readdir(folder, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) throw new Error('Symbolic links are not exportable');
    const path = join(folder, entry.name);
    result.push(...(entry.isDirectory() ? await files(path) : [path]));
  }
  return result.sort();
}
let previousFiles = [];
try {
  await access(output);
  const previous = JSON.parse(await readFile(join(output, 'source.json'), 'utf8'));
  if (previous.format !== 'en-card-studio-v1') throw new Error('관리되지 않은 출력 폴더입니다.');
  previousFiles = Object.keys(previous.files);
  for (const [path, hash] of Object.entries(previous.files)) {
    const full = resolve(output, path);
    if (!full.startsWith(output + '/') && !full.startsWith(output + '\\'))
      throw new Error('Invalid export path');
    if (sha(await readFile(full)) !== hash)
      throw new Error(`수동 변경이 있어 덮어쓸 수 없습니다: ${path}`);
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  // An existing directory without the provenance file must not be overwritten.
  try {
    await access(output);
    throw new Error('기존 폴더에 source.json이 없습니다.');
  } catch (missing) {
    if (missing.code !== 'ENOENT') throw missing;
  }
}
const build = spawnSync(
  process.execPath,
  [
    join(root, 'node_modules/vite/bin/vite.js'),
    'build',
    '--base',
    '/card-studio/',
    '--outDir',
    'dist-haru',
  ],
  {
    cwd: root,
    env: { ...process.env, VITE_HARU_STUDIO: 'true' },
    stdio: 'inherit',
  },
);
if (build.status !== 0) process.exit(build.status ?? 1);
const sourceFiles = [
  join(root, 'index.html'),
  ...(await files(join(root, 'src/web'))),
  ...(await files(join(root, 'src/shared'))),
];
const source = createHash('sha256');
for (const path of sourceFiles) {
  source.update(relative(root, path).replaceAll('\\', '/'));
  source.update(await readFile(path));
}
const hashes = {};
for (const path of await files(join(root, 'dist-haru'))) {
  const name = relative(join(root, 'dist-haru'), path).replaceAll('\\', '/');
  if (name === '_headers') continue;
  const destination = join(output, name);
  await mkdir(dirname(destination), { recursive: true });
  const raw = await readFile(path);
  const bytes = /\.(html|css|js|txt)$/.test(name)
    ? Buffer.from(raw.toString('utf8').replace(/\r+\n/g, '\n').replace(/\r/g, '\n'))
    : raw;
  await writeFile(destination, bytes);
  hashes[name] = sha(bytes);
}
for (const name of previousFiles) {
  if (!(name in hashes)) await unlink(resolve(output, name));
}
// The host Site owns security headers. EN_Card's standalone DENY policy must not
// be shipped as a nested static resource of its same-origin embedded workspace.
await unlink(join(output, '_headers')).catch((error) => {
  if (error.code !== 'ENOENT') throw error;
});
await writeFile(
  join(output, 'source.json'),
  JSON.stringify(
    { format: 'en-card-studio-v1', sourceSha256: source.digest('hex'), files: hashes },
    null,
    2,
  ) + '\n',
);
console.log(JSON.stringify({ target: output, files: Object.keys(hashes).length }));
