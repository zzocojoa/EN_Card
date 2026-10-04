import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createTailParser, classifyTailEncoder } from '../scripts/automation-tail-parser.mjs';

test('single glyph diagnostics are distinguishable from PNG pipelines and legacy WASM', () => {
  for (const size of [800, 720]) {
    assert.equal(
      classifyTailEncoder(new URL(`https://lab/diagnostic/glyphs/${size}/coverage/12`)),
      'atlas_diagnostic',
    );
    assert.equal(
      classifyTailEncoder(new URL(`https://lab/lean/${size}/pipeline/glyphs/coverage/12`)),
      'atlas_lean',
    );
    assert.equal(
      classifyTailEncoder(new URL(`https://lab/probe/expression/atlas_lean${size}`)),
      'atlas_lean',
    );
  }
  assert.equal(classifyTailEncoder(new URL('https://lab/probe/expression/wasm')), 'wasm');
});

function setup(limit) {
  const events = [],
    stats = { buffer_discards: 0, discarded_characters: 0, invalid_json: 0 };
  return { events, stats, parser: createTailParser((e) => events.push(e), stats, limit) };
}
test('fragmented and adjacent events preserve quoted braces, escapes and nested data', () => {
  const t = setup(),
    expected = [{ eventTimestamp: 1, logs: [{ value: 'braces {} \\"' }] }, { eventTimestamp: 2 }];
  const data = 'startup text\n' + expected.map((v) => JSON.stringify(v, null, 2)).join('\n');
  for (const c of data) t.parser.push(c);
  assert.deepEqual(t.events, expected);
  assert.equal(t.parser.pendingCharacters(), 0);
  assert.equal(t.stats.pending_characters, 0);
  assert.equal(t.stats.invalid_json, 0);
});
test('balanced malformed JSON is counted and the next event is retained', () => {
  const t = setup();
  t.parser.push('{ invalid }\n{"eventTimestamp":3}');
  assert.equal(t.stats.invalid_json, 1);
  assert.deepEqual(t.events, [{ eventTimestamp: 3 }]);
});
test('pending fragments and over-limit discards are visible at shutdown', () => {
  const t = setup(50);
  t.parser.push('{"eventTimestamp":');
  assert.equal(t.parser.pendingCharacters(), 18);
  assert.equal(t.stats.pending_characters, 18);
  t.parser.push('a'.repeat(40));
  assert.equal(t.stats.buffer_discards, 1);
  assert.equal(t.stats.discarded_characters, 58);
  assert.equal(t.parser.pendingCharacters(), 0);
  assert.equal(t.stats.pending_characters, 0);
  t.parser.push('{"eventTimestamp":4}');
  assert.equal(t.events.length, 1);
});
