import React, { useState } from 'react';
import {
  DataComponent,
  DataTable,
  EvidenceChart,
  RichNarrative,
  useDataApp,
} from '../../data-app-public.jsx';
import './performance.css';

const blue = '#3167b1',
  amber = '#c98c34';
const names = {
  glyphs: '준비',
  assembly: '조립',
  collector: '수집',
  render: '전체 렌더',
  render_band: '구간 렌더',
  collector_assembly: '수집·조립',
  diagnostic_entry: '입구',
};
const number = (value) => (value === null ? '미확보' : value.toFixed(2));
const spec = (field, labels = {}) => ({
  type: 'horizontalBar',
  x: 'label',
  y: field,
  stackable: false,
  valueDecimals: 2,
  colors: { [field]: blue },
  legend: { labels },
});
function Narrative({ id, children }) {
  return <RichNarrative id={id} value={children} />;
}

export function ReportContent() {
  const { reviewedRows } = useDataApp();
  const trials = reviewedRows('coverage'),
    remote = reviewedRows('remote');
  const optimized = reviewedRows('optimized'),
    lean = reviewedRows('lean'),
    blit = reviewedRows('blit');
  const attempts = reviewedRows('attempts'),
    proposals = reviewedRows('proposals');
  const [trial, setTrial] = useState('diagnostic');
  const [comparison, setComparison] = useState('crc');
  const [phase, setPhase] = useState('assembly_ms');
  const selected = remote.filter((r) => trial === 'all' || r.trial === trial);
  const remoteDisplay = selected.map((r) => ({
    ...r,
    label: `${trial === 'all' ? trials.find((t) => t.id === r.trial)?.label.slice(0, 2) + ' · ' : ''}${r.size} ${r.phase === 'single_glyph' ? '단독 ' : ''}${r.trial === 'svg' && r.stage === 'render' ? (r.label.includes('Wasm') ? 'Wasm' : 'Stream') : (names[r.stage] ?? r.stage)} ${r.captured}/${r.expected}`,
    '확보 표본 최대 CPU(ms)': r.max_ms,
  }));
  const known = remoteDisplay.filter((r) => r.captured > 0);
  const comparisonRows = blit.filter((r) => r.experiment === comparison);
  const comparisonDisplay = comparisonRows.map((r) => ({
    ...r,
    '첫 중앙값(ms)': r.first_median_ms,
    '반복 평균(ms)': r.warm_mean_ms,
  }));
  const coverage = trials.map((r) => ({ ...r, 확보: r.captured, 누락: r.missing }));
  const optDisplay = optimized.map((r) => ({ ...r, '평균 경과 시간(ms)': r[phase] }));
  const leanDisplay = lean.map((r) => ({
    ...r,
    label: r.variant === 'optimized' ? '기존 3개' : `${r.variant.slice(-1)}개 · 직접 경로`,
    '평균 경과 시간(ms)': r.wall_ms,
  }));
  return (
    <article className="png-report">
      <header className="png-intro">
        <p className="png-kicker">하루단어 · 성능 실험 기록 / 2026.10.02–10.03</p>
        <h1>
          PNG 생성,
          <br />
          어디서 시간을 줄일까
        </h1>
        <Narrative id="intro-text">
          {
            '25개 기존 시도와 추가 후보 5개를 정리했습니다. **실제 원격 CPU, 로컬 경과 시간, 계산상 바이트 감소는 서로 다른 지표**입니다. 아래 비교는 그 경계를 유지합니다.'
          }
        </Narrative>
      </header>
      <DataComponent
        id="trial-counts"
        queryId="coverage"
        kind="metrics"
        title="실제 시험 규모"
        sourceRows={trials}
        displayRows={trials}
      >
        <div className="png-metrics" data-reviewed-rows>
          <div>
            <strong>{trials.length}</strong>
            <span>원격 시험 묶음</span>
          </div>
          <div>
            <strong>{trials.reduce((s, r) => s + r.png, 0)}</strong>
            <span>실제 생성 PNG</span>
          </div>
          <div>
            <strong>미충족</strong>
            <span>전체 무료 CPU 기준</span>
          </div>
        </div>
      </DataComponent>
      <Narrative id="summary-text">
        {
          '가장 최근 후보인 **함수 분리 + native CRC**는 같은 로컬 비교에서 첫 조립 중앙값이 **13.82 → 12.74ms**였습니다. 반복 평균은 **4.30 → 4.29ms**로 거의 같았습니다. 새 후보의 원격 CPU는 아직 측정하지 않았습니다. 과거 원격 로그의 누락은 성공으로 세지 않았습니다.'
        }
      </Narrative>

      <section className="png-section" id="remote-evidence">
        <h2>01 · 실제 원격 CPU</h2>
        <Narrative id="remote-context">
          {
            '막대는 **확보한 표본 중 최대 CPU**입니다. 전체 호출의 최대치나 신뢰구간이 아닙니다. 시험마다 단계 경계·예제·해상도가 달라 시험 간 막대 차이를 순수 개선율로 읽으면 안 됩니다. 괄호는 확보/기대 이벤트 수입니다.'
          }
        </Narrative>
        <label className="png-control">
          시험 선택{' '}
          <select aria-label="시험 선택" value={trial} onChange={(e) => setTrial(e.target.value)}>
            <option value="all">모든 시험</option>
            {trials.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <EvidenceChart
          id="remote-cpu"
          queryId="remote"
          title="단계별 확보 CPU 최대값 · ms"
          rows={known}
          sourceRows={selected}
          height={Math.max(320, known.length * 46 + 70)}
          spec={{
            ...spec('확보 표본 최대 CPU(ms)'),
            annotations: [
              {
                id: 'free-limit',
                kind: 'benchmark',
                measure: '확보 표본 최대 CPU(ms)',
                field: 'limit_ms',
                label: 'Workers Free CPU 10ms 기준',
              },
            ],
          }}
        />
        {selected.some((r) => !r.captured) && (
          <p className="png-note">
            미확보 단계는 막대에서 제외했습니다. 아래 표의 ‘미확보’를 확인하세요.
          </p>
        )}
        <DataComponent
          id="remote-details"
          queryId="remote"
          kind="table"
          title="원격 표본 범위와 누락"
          sourceRows={selected}
          displayRows={remoteDisplay}
        >
          <DataTable
            rows={remoteDisplay}
            label="원격 CPU 상세"
            searchable={false}
            compactNumbers={false}
            columns={[
              { field: 'label', label: '단계 (확보/기대)' },
              { field: 'min_ms', label: '최소 ms', renderCell: number },
              { field: 'max_ms', label: '최대 ms', renderCell: number },
              { field: 'missing', label: '누락' },
              {
                field: 'over_10ms',
                label: '확보 중 10ms 초과',
                renderCell: (v, r) => (r.captured ? `${v}/${r.captured}` : '판정 불가'),
              },
            ]}
          />
        </DataComponent>
      </section>

      <section className="png-section" id="coverage-evidence">
        <h2>02 · 로그 확보 범위</h2>
        <Narrative id="coverage-context">
          {
            'PNG 생성 성공과 CPU 로그 확보는 별개입니다. 마지막 진단은 PNG 12개 외에 글자 준비 단독 진단 72개가 포함되어 이벤트 수가 더 많습니다. 누락은 무작위 표본이라고 가정하지 않습니다.'
          }
        </Narrative>
        <EvidenceChart
          id="coverage-chart"
          queryId="coverage"
          title="시험별 확보·누락 이벤트 수"
          rows={coverage}
          sourceRows={trials}
          height={430}
          spec={{
            type: 'horizontalStackedBar',
            x: 'label',
            y: '확보',
            fields: ['확보', '누락'],
            valueDecimals: 0,
            colors: { 확보: blue, 누락: amber },
          }}
        />
      </section>

      <section className="png-section" id="local-evidence">
        <h2>03 · 작은 페이지·해상도·압축 비교</h2>
        <Narrative id="optimized-context">
          {
            '동일 로컬 비교의 5예제 평균입니다. 자산을 메모리에 준비하고 예열한 뒤 측정했으며 **네트워크·첫 인스턴스·원격 CPU는 포함하지 않습니다**. 페이지 후보는 호출 묶음 변경도 포함합니다. 준비와 조립은 별도로 측정하여 합산하지 않습니다.'
          }
        </Narrative>
        <label className="png-control">
          측정 단계{' '}
          <select aria-label="측정 단계" value={phase} onChange={(e) => setPhase(e.target.value)}>
            <option value="assembly_ms">PNG 조립</option>
            <option value="preparation_ms">글자 준비 전체</option>
          </select>
        </label>
        <EvidenceChart
          id="optimized-chart"
          queryId="optimized"
          title="후보별 로컬 평균 경과 시간 · ms"
          rows={optDisplay}
          sourceRows={optimized}
          height={540}
          spec={spec('평균 경과 시간(ms)')}
        />
        <EvidenceChart
          id="lean-chart"
          queryId="lean"
          title="수집 경로의 로컬 평균 경과 시간 · ms"
          rows={leanDisplay}
          sourceRows={lean}
          height={340}
          spec={spec('평균 경과 시간(ms)')}
        />
        <Narrative id="lean-context">
          {
            '수집 비교는 후보당250회, **모의 하위 바인딩**을 사용했습니다. 경로 복사 제거만으로는 빨라지지 않았고, 6개 묶음의 개선에는 호출 수 감소가 포함됩니다. 이 수치를 실제 준비·조립 비용과 더하지 않습니다.'
          }
        </Narrative>
      </section>

      <section className="png-section" id="first-assembly">
        <h2>04 · 첫 조립과 반복 조립</h2>
        <label className="png-control">
          독립 비교 선택{' '}
          <select
            aria-label="독립 비교 선택"
            value={comparison}
            onChange={(e) => setComparison(e.target.value)}
          >
            <option value="screening">1차 · 픽셀 묶음/구간 복사</option>
            <option value="isolation">2차 · 함수 분리 대조</option>
            <option value="crc">3차 · native CRC 추가</option>
          </select>
        </label>
        <EvidenceChart
          id="blit-chart"
          queryId="blit"
          title="같은 실험의 첫 중앙값·반복 평균 · ms"
          rows={comparisonDisplay}
          sourceRows={comparisonRows}
          height={350}
          spec={{
            type: 'horizontalBar',
            x: 'label',
            y: '첫 중앙값(ms)',
            fields: ['첫 중앙값(ms)', '반복 평균(ms)'],
            stackable: false,
            valueDecimals: 2,
            colors: { '첫 중앙값(ms)': blue, '반복 평균(ms)': amber },
          }}
        />
        <DataComponent
          id="blit-details"
          queryId="blit"
          kind="table"
          title="첫 실행 표본의 범위"
          sourceRows={comparisonRows}
          displayRows={comparisonRows}
        >
          <DataTable
            rows={comparisonRows}
            label="첫 조립 통계"
            searchable={false}
            columns={[
              { field: 'label', label: '후보' },
              { field: 'fresh_instances', label: '새 인스턴스' },
              { field: 'first_min_ms', label: '최소 ms', renderCell: number },
              { field: 'first_max_ms', label: '최대 ms', renderCell: number },
            ]}
          />
        </DataComponent>
        <Narrative id="blit-context">
          {
            '첫 조립은 인스턴스당1회, 반복은20회입니다. 호스트의 요청 전달·응답 읽기·바이트 비교와 프로파일러 비용이 포함됩니다. 모듈 시작·글자 준비는 제외됩니다. 세 실험 합계 **300개 새 인스턴스·7,500개 PNG**가 기준 바이트와 같았습니다. native의 CRC만의 차이는 **함수 분리** 후보와 비교해야 합니다.'
          }
        </Narrative>
      </section>

      <section className="png-section" id="attempt-catalog">
        <h2>05 · 지금까지 시도한 25가지</h2>
        <Narrative id="catalog-context">
          {
            '개별 방법과 통합 시험은 같은 원격 실행을 공유할 수 있습니다. 이 표의 행 수로 생성 횟수나 절감 시간을 합산하지 않습니다. 느려진 후보와 효과가 분리되지 않은 변경도 남겼습니다.'
          }
        </Narrative>
        <DataComponent
          id="attempt-table"
          queryId="attempts"
          kind="table"
          title="방법·결과 검색"
          sourceRows={attempts}
          displayRows={attempts}
        >
          <DataTable
            rows={attempts}
            label="기존 시도25가지"
            compactNumbers={false}
            columns={[
              { field: 'id', label: 'ID' },
              { field: 'method', label: '방법' },
              { field: 'status', label: '판정' },
              { field: 'result', label: '근거·한계' },
            ]}
          />
        </DataComponent>
      </section>

      <section className="png-section" id="next-five">
        <h2>06 · 추가 개선 후보 5가지</h2>
        <Narrative id="proposal-context">
          {
            '아래 순서는 검증 우선순위입니다. **모두 미구현 가설이며 예상 절감 ms를 임의로 넣지 않았습니다.** 현재 코드에서 줄일 작업, 기존 시도와의 차이, 실패 가능성, 채택 검증을 함께 기록했습니다.'
          }
        </Narrative>
        {proposals.map((r) => (
          <DataComponent
            key={r.id}
            id={`proposal-${r.id}`}
            queryId="proposals"
            kind="text"
            title={`${r.priority}. ${r.title}`}
            sourceRows={[r]}
            displayRows={[r]}
          >
            <div className="png-proposal" data-reviewed-rows>
              <p className="png-tag">
                {r.target} · {r.status}
              </p>
              <p>{r.mechanism}</p>
              <dl>
                <dt>기존과 다른 점</dt>
                <dd>{r.novelty}</dd>
                <dt>판단 근거</dt>
                <dd>{r.evidence}</dd>
                <dt>손해가 될 수 있는 부분</dt>
                <dd>{r.risk}</dd>
                <dt>채택 전 확인</dt>
                <dd>{r.test}</dd>
              </dl>
              <a href={r.reference} target="_blank" rel="noreferrer">
                공식 API·규격 근거 ↗
              </a>
            </div>
          </DataComponent>
        ))}
      </section>
      <Narrative id="closing-method">
        {
          '**다음 검증 순서:** 한 번에 한 변경만 적용 → 새 인스턴스와 반복을 분리 → 바이트/픽셀·오류 거부 확인 → 준비·수집·조립의 실제 CPU와 누락 로그 확인. 원격 측정 없이 무료 한도 통과를 선언하지 않습니다. 이 자료 작성 중 새 배포·AI·카카오 호출은 없었습니다.'
        }
      </Narrative>
    </article>
  );
}
