// Rebuild an analytical snapshot from preserved evidence. No network or benchmarks.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const out = 'docs/performance';
fs.mkdirSync(out, { recursive: true });
const sources = new Map();
function read(name) {
  const file = `docs/evidence/${name}`;
  const bytes = fs.readFileSync(file);
  sources.set(file, { file, sha256: createHash('sha256').update(bytes).digest('hex') });
  const text = bytes.toString('utf8').replace(/^\uFEFF/, '');
  return name.endsWith('.jsonl') ? text.trim().split(/\r?\n/).map(JSON.parse) : JSON.parse(text);
}
const old = (name) => `AI_PNG_${name}_2026-10-02`;
const groups = [];
const trials = [];
const remoteRecords = [];
function group(trial, label, stage, size, expected, values, source, phase = 'pipeline') {
  assert.ok(values.every(Number.isFinite));
  assert.ok(values.length <= expected);
  groups.push({
    trial,
    label,
    stage,
    size,
    phase,
    metric: 'remote_invocation_cpu_ms',
    expected,
    captured: values.length,
    missing: expected - values.length,
    min_ms: values.length ? Math.min(...values) : null,
    max_ms: values.length ? Math.max(...values) : null,
    over_10ms: values.filter((x) => x > 10).length,
    source,
  });
}
function addTrial(id, label, png, source, note) {
  const rows = groups.filter((r) => r.trial === id);
  trials.push({
    id,
    label,
    png,
    expected: rows.reduce((s, r) => s + r.expected, 0),
    captured: rows.reduce((s, r) => s + r.captured, 0),
    missing: rows.reduce((s, r) => s + r.missing, 0),
    note,
    source,
  });
}
for (const [id, label, stem, png, removeFirst] of [
  ['svg', '01 SVG·압축 대체', 'REMOTE', 24, true],
  ['bands', '02 12구간 렌더', 'BANDS_REMOTE', 8, false],
  ['atlas', '03 사전 글자 조립', 'ATLAS_REMOTE', 8, true],
  ['chunks', '04 글자 준비 분리', 'ATLAS_CHUNKS_REMOTE', 8, false],
  ['pipeline', '05 수집·조립 분리', 'ATLAS_PIPELINE_REMOTE', 8, true],
]) {
  const source = old(stem) + '.jsonl';
  const raw = read(source);
  // These three files begin with the separately documented unauthenticated probe.
  const rows = removeFirst ? raw.slice(1) : raw;
  for (const r of rows) remoteRecords.push({ trial: id, ...r, source });
  const renderer = rows.filter((r) => r.script === 'en-card-png-feasibility');
  const probe = rows.filter((r) => r.script === 'en-card-png-probe');
  if (id === 'svg') {
    for (const encoder of ['wasm', 'native'])
      group(
        id,
        encoder === 'wasm' ? 'SVG 기본 Wasm' : 'SVG CompressionStream',
        'render',
        1080,
        12,
        renderer.filter((r) => r.encoder === encoder).map((r) => r.cpu_ms),
        source,
      );
    group(
      id,
      '인증·전달',
      'collector',
      1080,
      24,
      probe.map((r) => r.cpu_ms),
      source,
    );
  } else if (id === 'bands') {
    group(
      id,
      '구간 렌더',
      'render_band',
      1080,
      96,
      renderer.map((r) => r.cpu_ms),
      source,
    );
    group(
      id,
      '수집·PNG 합성',
      'collector_assembly',
      1080,
      8,
      probe.map((r) => r.cpu_ms),
      source,
    );
  } else if (id === 'atlas') {
    group(
      id,
      '글자 읽기·조립',
      'render',
      1080,
      8,
      renderer.map((r) => r.cpu_ms),
      source,
    );
    group(
      id,
      '인증·전달',
      'collector',
      1080,
      8,
      probe.map((r) => r.cpu_ms),
      source,
    );
  } else if (id === 'chunks') {
    const local = read(old('ATLAS_CHUNKS_LOCAL') + '.json');
    const responses = read(old('ATLAS_CHUNKS_RESPONSES') + '.json');
    const expected = responses.reduce(
      (n, r) =>
        n +
        local.results.filter((x) => x.fixture === r.fixture && x.phase.startsWith('glyph_chunk_'))
          .length,
      0,
    );
    assert.equal(expected, 58);
    group(
      id,
      '글자 준비',
      'glyphs',
      1080,
      expected,
      renderer.map((r) => r.cpu_ms),
      source,
    );
    group(
      id,
      '수집·조립',
      'collector_assembly',
      1080,
      8,
      probe.map((r) => r.cpu_ms),
      source,
    );
  } else {
    group(
      id,
      '글자 준비',
      'glyphs',
      1080,
      84,
      renderer.filter((r) => r.path.includes('/glyphs/')).map((r) => r.cpu_ms),
      source,
    );
    group(
      id,
      'PNG 조립',
      'assembly',
      1080,
      8,
      renderer.filter((r) => r.path.includes('/assemble/')).map((r) => r.cpu_ms),
      source,
    );
    group(
      id,
      '수집',
      'collector',
      1080,
      8,
      probe.map((r) => r.cpu_ms),
      source,
    );
  }
  addTrial(
    id,
    label,
    png,
    source,
    '서로 다른 시점·구조의 시험. 단계 경계와 예제 구성이 달라 인과적 개선율을 계산하지 않음.',
  );
}
for (const [id, label, file] of [
  ['optimized', '06 작은 페이지·800/720·RLE', 'AI_PNG_OPTIMIZED_SUMMARY_2026-10-02.json'],
  ['lean', '07 요청·묶음 조정', 'AI_PNG_LEAN_SUMMARY_2026-10-03.json'],
  ['diagnostic', '08 최초 조립·준비 진단', 'AI_PNG_DIAGNOSTIC_SUMMARY_2026-10-03.json'],
]) {
  const j = read(file);
  for (const [index, r] of j.cpu.entries()) {
    groups.push({
      trial: id,
      label: r.stage,
      stage: r.stage,
      size: r.size,
      phase: r.phase ?? 'pipeline',
      metric: 'remote_invocation_cpu_ms',
      expected: r.expected,
      captured: r.captured,
      missing: r.expected - r.captured,
      min_ms: r.min_ms,
      max_ms: r.max_ms,
      over_10ms: r.over_10ms,
      source: file,
      pointer: `/cpu/${index}`,
    });
  }
  addTrial(
    id,
    label,
    j.remote_png,
    file,
    id === 'diagnostic'
      ? '전체 PNG12개 + 준비 단독72개. 진단 계측 오버헤드 포함.'
      : '저장된 요약의 중복·비인증 제외 규칙을 사용.',
  );
  const t = trials.at(-1);
  assert.equal(t.expected, j.expected_generation_invocations ?? j.expected_invocations);
  assert.equal(t.captured, j.captured_generation_invocations ?? j.captured_invocations);
  assert.equal(t.missing, j.missing_invocations.length);
}
assert.equal(
  trials.reduce((s, r) => s + r.png, 0),
  88,
);
assert.equal(
  groups
    .filter((r) => r.trial === 'lean' && r.stage === 'glyphs')
    .reduce((s, r) => s + r.captured, 0),
  0,
);

const local = [];
function localRow(experiment, variant, fixture, phase, metric, value, n, source, extra = {}) {
  assert.ok(Number.isFinite(value));
  local.push({ experiment, variant, fixture, phase, metric, value, n, source, ...extra });
}
const variants = {
  baseline: '기존1080',
  pages64: '64슬롯',
  pages32: '32슬롯',
  compact: '본문 복사 감소',
  size800: '800 직접 생성',
  size720: '720 직접 생성',
  rle: 'RLE',
  combined800_64: '800 통합·64슬롯',
  combined800_32: '800 통합·32슬롯',
  combined720_64: '720 통합·64슬롯',
  combined720_32: '720 통합·32슬롯',
};
const optimizedFile = 'AI_PNG_OPTIMIZED_2026-10-02_LOCAL.json';
const optimized = read(optimizedFile);
const optimizedMeans = [];
for (const [variant, label] of Object.entries(variants)) {
  const rows = optimized.results.filter((r) => r.variant === variant);
  assert.equal(rows.length, 5);
  for (const r of rows) {
    for (const phase of ['preparation_total', 'assembly'])
      localRow(
        'optimized',
        variant,
        r.fixture,
        phase,
        'local_warm_wall_mean_ms',
        r[phase].wall_ms,
        r[phase].count,
        optimizedFile,
        { size: r.options.size, bytes: r.fetched_bytes },
      );
  }
  optimizedMeans.push({
    variant,
    label,
    preparation_ms: rows.reduce((s, r) => s + r.preparation_total.wall_ms, 0) / 5,
    assembly_ms: rows.reduce((s, r) => s + r.assembly.wall_ms, 0) / 5,
    fixtures: 5,
    source: optimizedFile,
  });
}
const compressionFile = 'AI_PNG_COMPRESSION_RESEARCH_2026-10-02.json';
const compression = read(compressionFile);
for (const r of compression.results)
  for (const [variant, values] of Object.entries(r.workerd))
    localRow(
      'compression',
      variant,
      r.fixture,
      'deflate',
      'local_warm_wall_mean_ms',
      values.mean_wall_ms,
      compression.rounds * compression.batch,
      compressionFile,
      { png_bytes: values.png_bytes, under_1_mib: values.under_1_mib },
    );
const leanFile = 'AI_PNG_LEAN_LOCAL_2026-10-03.json';
const lean = read(leanFile);
const leanMeans = [];
for (const [variant, r] of Object.entries(lean.measurements)) {
  const mean = r.wall_ms.reduce((a, b) => a + b, 0) / r.wall_ms.length;
  localRow(
    'lean',
    variant,
    'mixed_5x2',
    'collector',
    'local_mock_binding_wall_mean_ms',
    mean,
    r.requests,
    leanFile,
  );
  leanMeans.push({
    variant,
    label: {
      optimized: '기존3개',
      lean3: '직접 경로·3개',
      lean4: '직접 경로·4개',
      lean6: '직접 경로·6개',
      lean8: '직접 경로·8개',
    }[variant],
    wall_ms: mean,
    samples: r.non_idle_samples,
    n: r.requests,
    source: leanFile,
  });
}
const blit = [];
let exactPng = 0;
for (const [experiment, file] of [
  ['screening', 'AI_PNG_BLIT_LOCAL_2026-10-03.json'],
  ['isolation', 'AI_PNG_BLIT_ISOLATION_LOCAL_2026-10-03.json'],
  ['crc', 'AI_PNG_BLIT_CRC_LOCAL_2026-10-03.json'],
]) {
  const j = read(file);
  exactPng += j.rows.length * 25;
  for (const s of j.summaries) {
    const rows = j.rows.filter((r) => r.mode === s.mode),
      first = rows.map((r) => r.first_wall_ms).sort((a, b) => a - b),
      warm = rows.flatMap((r) => r.warm_wall_ms);
    const median = (first[first.length / 2 - 1] + first[first.length / 2]) / 2;
    const mean = warm.reduce((a, b) => a + b, 0) / warm.length;
    assert.ok(Math.abs(median - s.first_median_ms) < 1e-9);
    assert.ok(Math.abs(mean - s.warm_mean_ms) < 1e-9);
    blit.push({
      experiment,
      variant: s.mode,
      label: {
        scalar: '기존',
        extracted: '함수 분리',
        native: '함수 분리 + native CRC',
        packed: '4픽셀 묶음',
        spans: '실행 중 구간 복사',
      }[s.mode],
      first_median_ms: median,
      warm_mean_ms: mean,
      first_min_ms: first[0],
      first_max_ms: first.at(-1),
      fresh_instances: first.length,
      first_samples: Object.values(s.profiles.first).reduce((a, b) => a + b, 0),
      warm_samples: Object.values(s.profiles.warm).reduce((a, b) => a + b, 0),
      source: file,
    });
    for (const r of rows) {
      localRow(
        experiment,
        s.mode,
        r.fixture,
        'first',
        'local_profiled_host_wall_ms',
        r.first_wall_ms,
        1,
        file,
        { size: r.size, repeat: r.repeat },
      );
      localRow(
        experiment,
        s.mode,
        r.fixture,
        'warm',
        'local_profiled_host_wall_mean_ms',
        r.warm_wall_ms.reduce((a, b) => a + b, 0) / 20,
        20,
        file,
        { size: r.size, repeat: r.repeat },
      );
    }
  }
}
assert.equal(exactPng, 7500);
const reuseFile = old('ATLAS_ASSEMBLY_PROFILE') + '.json';
const reuse = read(reuseFile);
for (const r of reuse.results)
  for (const [phase, v] of Object.entries(r.phases))
    if (Number.isFinite(v.process_cpu_ms))
      localRow(
        'layout_reuse',
        phase,
        r.fixture,
        phase,
        'local_process_cpu_mean_ms',
        v.process_cpu_ms,
        v.count,
        reuseFile,
      );
const pagesFile = old('PAGE_LAYOUT_RESEARCH') + '.json';
const pages = read(pagesFile).results.flatMap((r) =>
  r.cards.map((c) => ({
    slots: r.page_size,
    files: r.estimated_asset_files_including_license,
    ...c,
    metric: 'calculated_bytes_not_cpu',
    source: pagesFile,
  })),
);

const attempts = [
  [
    'A01',
    'SVG + Wasm 렌더',
    '원격 실패',
    '기본 비용 확인; SVG 생성은 제외한 하한 시험',
    'AI_PNG_REMOTE_2026-10-02.jsonl',
  ],
  [
    'A02',
    'CompressionStream 대체 압축',
    '원격 실패',
    'RGBA 보존. 기본 방식과 모두10ms 초과',
    'AI_PNG_REMOTE_2026-10-02.jsonl',
  ],
  [
    'A03',
    'zlib level1 압축',
    '로컬·후속 통합',
    '압축률을 낮춘 손실 없는 후보',
    'AI_PNG_PROFILE_2026-10-02.json',
  ],
  [
    'A04',
    '12개 세로 구간 + 합성',
    '원격 실패',
    '일부 구간/합성 초과; 구간41개 로그 누락',
    'AI_PNG_BANDS_REMOTE_2026-10-02.jsonl',
  ],
  [
    'A05',
    'Wasm 초기화 위치 이동',
    '구간 시험에 포함',
    '독립 효과를 분리 측정하지 않음',
    'AI_CARD_AUTOMATION_FEASIBILITY.md',
  ],
  [
    'A06',
    '사전 글자 atlas + indexed PNG',
    '원격 실패',
    '폰트 path/raster 계산을 사전 처리로 이동',
    'AI_PNG_ATLAS_REMOTE_2026-10-02.jsonl',
  ],
  [
    'A07',
    '글자 준비 Worker 분리',
    '원격 실패',
    '준비는 대부분10ms 이내; 수집·조립8회 모두 초과',
    'AI_PNG_ATLAS_CHUNKS_REMOTE_2026-10-02.jsonl',
  ],
  [
    'A08',
    '조립 배치 중복 계산 제거',
    '로컬 혼합',
    '5예제에서 일관된 속도 개선 없음',
    'AI_PNG_ATLAS_ASSEMBLY_PROFILE_2026-10-02.json',
  ],
  [
    'A09',
    '수집·최종 조립 분리',
    '원격 실패',
    '확보한 조립3회 모두 초과;31개 생성 로그 누락',
    'AI_PNG_ATLAS_PIPELINE_REMOTE_2026-10-02.jsonl',
  ],
  [
    'A10',
    '64/32슬롯 작은 글자 페이지',
    '로컬·원격 통합',
    '읽기 바이트 감소; 조회·묶음 변경이 함께 포함',
    'AI_PNG_OPTIMIZED_2026-10-02_LOCAL.json',
  ],
  [
    'A11',
    '본문 단일 청크 재사용·복사 감소',
    '로컬·원격 통합',
    '실제 바이트 상한 검증 유지',
    'AI_PNG_OPTIMIZED_2026-10-02_LOCAL.json',
  ],
  [
    'A12',
    '800×800 직접 생성',
    '로컬·원격 통합',
    '픽셀45.1% 감소는 계산값이며 CPU 감소율 아님',
    'AI_PNG_OPTIMIZED_2026-10-02_LOCAL.json',
  ],
  [
    'A13',
    '720×720 직접 생성',
    '로컬·원격 통합',
    '픽셀55.6% 감소; 실제 카카오 작은 글자 품질 미검증',
    'AI_PNG_OPTIMIZED_2026-10-02_LOCAL.json',
  ],
  [
    'A14',
    'Z_RLE 압축 전략',
    '로컬 채택·원격 통합',
    '1080 압축 구간만0.025~0.154ms 감소',
    'AI_PNG_COMPRESSION_RESEARCH_2026-10-02.json',
  ],
  [
    'A15',
    'Z_HUFFMAN_ONLY',
    '로컬 제외',
    '기존보다 느림',
    'AI_PNG_COMPRESSION_RESEARCH_2026-10-02.json',
  ],
  [
    'A16',
    'Z_FIXED',
    '로컬 보류',
    '일관된 개선 없음',
    'AI_PNG_COMPRESSION_RESEARCH_2026-10-02.json',
  ],
  [
    'A17',
    'memLevel9',
    '로컬 보류',
    '일관된 개선 없음',
    'AI_PNG_COMPRESSION_RESEARCH_2026-10-02.json',
  ],
  [
    'A18',
    'level0 무압축',
    '로컬 제외',
    '1080 PNG1,168,304B로 앱1MiB 초과',
    'AI_PNG_COMPRESSION_RESEARCH_2026-10-02.json',
  ],
  [
    'A19',
    '페이지·복사·해상도·RLE 통합',
    '원격 실패',
    '720 조립9ms 한 표본만으로 전체 통과 불가',
    'AI_PNG_OPTIMIZED_SUMMARY_2026-10-02.json',
  ],
  [
    'A20',
    '요청 경로 중복 복사 제거',
    '개별 효과 미입증',
    '3개 묶음 대조에서 로컬 수집 시간이 길어짐',
    'AI_PNG_LEAN_LOCAL_2026-10-03.json',
  ],
  [
    'A21',
    '준비 묶음3→4/6/8 비교',
    '6개 선택·원격 실패',
    '기대 실행160→92; 준비 작업량·CPU와 교환',
    'AI_PNG_LEAN_SUMMARY_2026-10-03.json',
  ],
  [
    'A22',
    '4픽셀 묶음 쓰기',
    '로컬 제외',
    '함수 분리 대조보다 첫 경과 시간 길어짐',
    'AI_PNG_BLIT_ISOLATION_LOCAL_2026-10-03.json',
  ],
  [
    'A23',
    '실행 중 글자 구간 복사',
    '로컬 제외',
    '구간 준비·임시 할당 비용이 남음',
    'AI_PNG_BLIT_LOCAL_2026-10-03.json',
  ],
  [
    'A24',
    '픽셀 반복 함수 분리',
    '로컬 후보',
    '작은 중앙값 차이; 표본 감소는 실제 CPU 감소율 아님',
    'AI_PNG_BLIT_ISOLATION_LOCAL_2026-10-03.json',
  ],
  [
    'A25',
    'native CRC + 함수 분리',
    '로컬 후보·원격 미검증',
    '같은 마지막 실험 첫 중앙값13.82→12.74; 반복 시간 거의 같음',
    'AI_PNG_BLIT_CRC_LOCAL_2026-10-03.json',
  ],
].map(([id, method, status, result, source]) => ({ id, method, status, result, source }));
for (const r of attempts) if (r.source.endsWith('.json')) read(r.source);

const proposals = [
  {
    id: 'N1',
    priority: 1,
    title: '내부 fetch/Response를 바이너리 RPC로 비교',
    target: '수집',
    novelty: '요청 복사만 제거했던 A20과 달리 HTTP 메시지·본문 스트림 경계를 없애는 후보',
    mechanism:
      'WorkerEntrypoint의 제한된 메서드로 프레임 ArrayBuffer를 반환하고 수집한다. 직접 바이너리 반환과 기존 fetch를 같은 묶음 수로 대조한다.',
    evidence:
      '수집 프로파일에서 fetch·readCompactBody·read·Request가 큰 비중. atlas-pipeline.ts의 fetch/본문 읽기 경계가 남아 있음.',
    risk: 'RPC 직렬화·복사 비용이 생길 수 있다. 무복사나 CPU 한도 우회를 가정하지 않는다. 공개 메서드·Service Binding 권한과 버퍼4MiB 상한 유지.',
    test: '같은72개 준비 묶음·10카드로 첫/반복 수집 비교. 전송형 오류·초과·누락 거부, byte parity, 전체 호출 수 확인.',
    code: 'experiments/automation-png/atlas-pipeline.ts',
    reference: 'https://developers.cloudflare.com/workers/runtime-apis/rpc/',
    estimated_ms: null,
    status: '미구현 가설',
  },
  {
    id: 'N2',
    priority: 2,
    title: 'ATC 메타데이터를 고정 길이 바이너리 레코드로',
    target: '준비·조립',
    novelty:
      'ATG 페이지는 이미 바이너리다. 새 대상은 JSON을 쓰는 ATC 전송 프레임과 문자열 글자 키다.',
    mechanism:
      'weight/size/codepoint를 정수 ID로 나타내고 offset·width·height·advance를 버전 있는 레코드로 저장해 TextEncoder/Decoder·JSON.parse/stringify를 줄인다. key.split 감소는 정수 ID를 ATG 요청·배치 경로까지 전달할 때의 추가 효과다.',
    evidence:
      'atlas-chunks.ts의 packAtlasChunk/unpackAtlasChunk가 JSON을 왕복하고 각 레코드를 검증한다.',
    risk: '레코드 범위·중복 ID·버전·픽셀0..31 검사를 그대로 해야 한다. endian·배열 byteOffset 오류 주의.',
    test: '동적 한글·7색·비정렬 배열·중복/누락/잘린 레코드 거부, PNG byte parity. 첫 조립 포함 대조.',
    code: 'experiments/automation-png/atlas-chunks.ts',
    reference:
      'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/DataView',
    estimated_ms: null,
    status: '미구현 가설',
  },
  {
    id: 'N3',
    priority: 3,
    title: '여러 글자의 압축 해제를 작은 블록으로 묶기',
    target: '글자 준비',
    novelty: '페이지 슬롯·Worker 호출 묶음 조정과 달리 글자별 zlib 스트림의 압축 단위를 바꾼다.',
    mechanism:
      '페이지 안의4/8개 글자 픽셀을 하나의 압축 블록에 묶고 요청된 블록을 요청당 한 번만 해제한다. 블록별 오프셋으로 필요한 글자만 선택한다.',
    evidence: 'decodeAtlasPage는 필요한 key마다 inflateSync를 새로 호출하고 픽셀을 다시 합친다.',
    risk: '필요 없는 글자도 해제하므로 총 출력 바이트가 증가할 수 있다. 네이티브 호출 감소가 총 CPU 감소를 보장하지 않는다.',
    test: '단일글자·밀집한글·드문한글을 분리 비교; inflate 횟수·입출력 바이트·cold CPU·메모리 상한 및 손상 블록 거부.',
    code: 'experiments/automation-png/atlas-pages.ts',
    reference: 'https://nodejs.org/api/zlib.html#zlibinflatesyncbuffer-options',
    estimated_ms: null,
    status: '미구현 가설',
  },
  {
    id: 'N4',
    priority: 4,
    title: '글자 그리기만 작은 Wasm SIMD 함수로',
    target: '조립 그리기',
    novelty:
      '전체 SVG를 처리하던 resvg나 JS4픽셀 연산과 달리 검증된 glyph 복사·팔레트 합성만 옮긴다.',
    mechanism:
      '검증된 좌표와 알파 배열을 한 번 넘기고16바이트 SIMD 마스크로 투명값을 보존하며 합성한다. 압축·PNG 검증은 기존 경로 유지.',
    evidence:
      '첫 조립 paintText 표본 비중이 높았고 JS packed는 시간 개선 실패. Workers는 Wasm SIMD를 지원한다.',
    risk: 'Wasm 시작·메모리 복사로 이득이 사라질 수 있다. 캐시 적중만으로 합격하지 않으며 새 isolate의 모듈 시작·인스턴스 생성 비용과 각 요청의 입력/출력 복사 비용을 구분해 측정한다.',
    test: '첫 인스턴스의 모듈 시작·복사 포함 경과/CPU, 모든 픽셀 일치·겹침·경계. 같은800/720·전체호출 비교.',
    code: 'experiments/automation-png/atlas-blit.ts',
    reference: 'https://developers.cloudflare.com/workers/runtime-apis/webassembly/#simd',
    estimated_ms: null,
    status: '미구현 가설',
  },
  {
    id: 'N5',
    priority: 5,
    title: '동일한 연속 행에만 PNG Up 필터 비교',
    target: '최종 압축',
    novelty: '압축 level/strategy를 비교한 A14~18과 달리 압축 전 scanline 표현을 바꾸는 후보',
    mechanism:
      '동일 행에만 필터2(Up)를 써 차분을0으로 만들고 나머지는 기존None을 유지한다. 모든 필터 탐색을 수행하지 않는다.',
    evidence:
      '현재 scanline은 필터None을 사용한다. PNG 규격은 행별 필터 선택을 허용하나 indexed-color에는 보통None을 권한다.',
    risk: '여백은 이미0이며 추가 이득이 작을 수 있다. 행 비교 비용이 압축 절감보다 크면 즉시 제외한다. 손실 없는 픽셀 동일성 기준.',
    test: 'filter+deflate+pack 합계를 기존None과 대조; PNG 전체 바이트가 아닌 decoded 픽셀 일치. 동적 예제·decode 오류 검사.',
    code: 'experiments/automation-png/atlas.ts',
    reference: 'https://www.w3.org/TR/png-3/#12Filter-selection',
    estimated_ms: null,
    status: '미구현 가설',
  },
];
const generatedAt = new Date().toISOString();
const dataset = {
  schema_version: 1,
  generated_at_utc: generatedAt,
  measurement_period: '2026-10-02~2026-10-03 Asia/Seoul',
  scope: 'Preserved local experiments and remote Free trials. No new benchmark or remote requests.',
  rules: [
    'Remote CPU, local wall time, local process CPU, sampled profiles and calculated bytes are different metrics.',
    'Missing samples are null, never zero or pass. Observed extrema are not confidence intervals or population maxima.',
    'Do not compare trial-stage boundaries as an A/B effect. No numeric saving is predicted for proposals.',
  ],
  trials,
  remote_groups: groups,
  early_remote_records: remoteRecords,
  local_measurements: local,
  optimized_means: optimizedMeans,
  lean_means: leanMeans,
  blit_summaries: blit,
  page_calculations: pages,
  attempts,
  proposals,
  sources: [...sources.values()],
};
function save(name, value) {
  fs.writeFileSync(path.join(out, name), JSON.stringify(value, null, 2) + '\n');
}
function csv(name, rows) {
  const keys = [...new Set(rows.flatMap(Object.keys))];
  const esc = (x) => `"${String(x ?? '').replaceAll('"', '""')}"`;
  fs.writeFileSync(
    path.join(out, name),
    '\uFEFF' +
      [
        keys.map(esc).join(','),
        ...rows.map((r) =>
          keys
            .map((k) =>
              esc(typeof r[k] === 'object' && r[k] !== null ? JSON.stringify(r[k]) : r[k]),
            )
            .join(','),
        ),
      ].join('\r\n') +
      '\r\n',
  );
}
save('history.json', dataset);
csv('attempts.csv', attempts);
csv('remote_cpu.csv', groups);
csv('local_measurements.csv', local);
csv('proposals.csv', proposals);
const query = (rows, files, definition) => ({
  rows,
  source: {
    kind: 'local-files',
    label: 'EN_Card 보존 실험 자료',
    executedAt: generatedAt,
    files: files.map((file) => ({ path: file })),
    caveats: dataset.rules,
    metricDefinitions: [{ label: '측정 범위', definition }],
    evidenceFlow: [
      {
        title: '원자료 → 재집계',
        detail:
          'scripts/build-automation-performance-data.mjs. history.json의 파일 SHA256과 source/pointer를 사용. 네트워크 재측정 없음.',
      },
    ],
  },
  methods: [{ language: 'text', code: definition }],
});
const snapshot = {
  id: 'en-card-png-performance-20261003',
  surface: 'report',
  title: 'PNG 생성 시간 개선 실험',
  subtitle: '2026.10.02–10.03 · 원격 CPU와 로컬 비교를 구분한 기록',
  generatedAt,
  buildStatus: 'creating',
  status: 'reviewed',
  filters: [],
  queries: {
    remote: query(
      groups,
      dataset.sources.map((s) => s.file),
      '각 시험·단계·해상도별 수집 CPU의 최솟값/최댓값과 확보/기대 수. 누락 CPU는 null이며 단계별 범위가 다름.',
    ),
    coverage: query(
      trials,
      dataset.sources.map((s) => s.file),
      '기대 이벤트에서 확보 이벤트를 뺀 누락 수. 진단 시험은 단독 준비72개를 포함함.',
    ),
    optimized: query(
      optimizedMeans,
      [optimizedFile],
      '같은 로컬 비교에서5예제의 예열 후 경과 시간 평균을 동일 가중 평균. 준비는 하위 호출 합계, 조립과 별도 측정이며 합산하지 않음.',
    ),
    lean: query(
      leanMeans,
      [leanFile],
      '모의 하위 바인딩 수집250회 평균 경과 시간. 네트워크·하위 Worker CPU 제외.',
    ),
    blit: query(
      blit,
      [...new Set(blit.map((r) => r.source))],
      '각 독립 비교별 첫 조립 중앙값과 반복20회 평균. 첫 표본40/20개, 반복800/400개. 호스트 경과 시간이며 원격 CPU가 아님.',
    ),
    attempts: query(
      attempts,
      [...new Set(attempts.map((r) => r.source))],
      '시도25개를 기준·개별 후보·통합 변경으로 기록. 동일 원격 시험이 여러 변경에 연결되며 PNG 수를 중복 합산하지 않음.',
    ),
    proposals: query(
      proposals,
      [...new Set(proposals.map((r) => r.code))],
      '제안5개는 현재 코드와 공식 API/규격에서 도출한 미구현 가설. 예상 절감 ms는 모두 null.',
    ),
  },
};
save('snapshot.json', snapshot);
console.log(
  JSON.stringify({
    attempts: attempts.length,
    proposals: proposals.length,
    remote_groups: groups.length,
    remote_png: 88,
    local_measurements: local.length,
    blit_exact_png: exactPng,
    sources: sources.size,
  }),
);
