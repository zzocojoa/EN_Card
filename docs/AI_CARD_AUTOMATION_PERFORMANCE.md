# PNG 성능 개선 이력·추가 후보 5개

최신 추가 후속: 사용자 제안의 [중간 픽셀 복사 제거](AI_CARD_AUTOMATION_REFERENCE.md)를 구현·로컬 비교했다. 복사는 줄었지만 전체 시간의 일관된 이득이 없어 기본 미적용이다. 새 원격 CPU 측정은 없으며 아래 조사 스냅샷과 원격 누적88 PNG는 그대로 보존한다.

후속: **N1 RPC·N2 ATC 바이너리화·N3 작은 압축 블록을 구현·로컬 검증했으나 기본 경로에 채택하지 않았다.** [N3 최신 결과](AI_CARD_AUTOMATION_BLOCKS.md), [N2 결과](AI_CARD_AUTOMATION_BINARY.md), [N1 결과](AI_CARD_AUTOMATION_RPC.md)를 따른다. 아래 데이터·시각화는 이 후보들 구현 전인 2026-10-03 11:13 KST 조사 스냅샷으로 보존한다. 후보5개가 모두 미구현이라는 표기는 당시 상태다.

2026-10-03 / `codex/ai-card-automation`

**기존 시도25개를 데이터화하고 추가 개선안5개와 인터랙티브 시각화를 만들었다.** 이번 작업은 보존된 결과 재집계·설계 조사이며 새 성능 시험·원격 배포가 아니다. 전체 AI 자동화 구현 완료와 구분한다.

## 결과물

- 시각화: `docs/performance/ai-png-performance.html`. 원격 CPU, 로그 확보율, 페이지·해상도·압축, 요청 묶음, 첫/반복 조립, 기존 시도 검색, 추가5개 제안을 담는다.
- 통합 데이터: [history.json](performance/history.json). 원자료 SHA256, 측정 단위, 시험 조건, 누락, 출처를 보존한다.
- 표 데이터: [기존25시도](performance/attempts.csv), [원격CPU 34집계](performance/remote_cpu.csv), [로컬785행](performance/local_measurements.csv), [추가5후보](performance/proposals.csv).
- 생성기: [데이터 재집계](../scripts/build-automation-performance-data.mjs), [시각화 빌드](../scripts/build-automation-performance-visual.mjs). 원자료는 `docs/evidence/`에서 읽기만 한다.

## 수치의 올바른 해석

| 종류                  | 값의 의미                         | 하면 안 되는 해석                                 |
| --------------------- | --------------------------------- | ------------------------------------------------- |
| 원격 `cpu_ms`         | 해당 Worker 호출에 기록된 실제CPU | 서로 다른 구조의 최대값 차이를 순수 개선율로 계산 |
| 로컬 `wall_ms`        | 명시된 구간의 경과 시간           | Cloudflare CPU ms로 환산                          |
| 로컬 `process_cpu_ms` | 로컬 프로세스 CPU 평균            | Worker 호출당 CPU로 사용                          |
| 프로파일 표본 수      | 샘플링에 잡힌 실행 경로           | 표본 감소율을 CPU 감소율로 사용                   |
| 읽기 바이트·픽셀 수   | 실측/계산 데이터 크기             | 같은 비율의 전체CPU 절감을 가정                   |

모든 원격 시험8묶음에서 생성한 PNG는 누적88개다. 마지막 시험의 단독 글자 준비72개는 PNG 개수에 넣지 않는다. 원격 미확보 단계는 `min_ms/max_ms=null`, `captured=0`이며 CPU0ms나 통과가 아니다. 차트는 **확보한 표본의 최대값**을 표시하고 기대/확보 수를 함께 보여준다. 분포 전체·신뢰구간·p95를 주장하지 않는다.

최신 로컬 CRC 비교40인스턴스/후보에서 기존→함수 분리+native CRC의 첫 중앙값은13.8231→12.7408ms, 반복 평균은4.2955→4.2887ms다. **CRC만의 차이는 함수 분리13.32045→native12.7408ms**다. 서로 다른 세 비교의 숫자를 섞지 않았다. [기존 로컬 보고서](AI_CARD_AUTOMATION_BLIT.md)

## 추가 개선안 5개

아래는 **미구현 가설**이며 절감 ms는 모두 미측정이다. 우선순위는 현재 병목·변경 위험에 대한 판단이지 성공 확률의 수치 예측이 아니다.

### 1. 내부 fetch/Response를 바이너리 RPC로 비교

수집기의 HTTP 메시지·본문 스트림 처리 대신, 제한된 `WorkerEntrypoint` 메서드로 바이너리 프레임을 전달한다. 이미 했던 Request 복사 제거보다 전송 경계 자체를 줄이는 실험이다. 현재 [atlas-pipeline.ts](../experiments/automation-png/atlas-pipeline.ts)와 [수집 프로파일](evidence/AI_PNG_OPTIMIZED_COLLECTOR_PROFILE_2026-10-02.json)이 근거다.

Workers RPC는 Service Binding으로 호출하고 구조화 복제 가능한 자료를 전달할 수 있다. 그러나 직렬화·복사 비용이 없어지는 것은 아니다. 앱의4MiB 상한·권한·버전·프레임 검증을 유지하고 같은 묶음 수에서 수집 CPU를 대조한다. 제공사 RPC 메시지 한도와 앱 상한도 구분한다. [공식 RPC 문서](https://developers.cloudflare.com/workers/runtime-apis/rpc/)

### 2. ATC JSON 메타데이터를 고정 길이 바이너리로

현재 [packAtlasChunk/unpackAtlasChunk](../experiments/automation-png/atlas-chunks.ts)는 글자 메타데이터를 JSON으로 인코딩·해독한다. 페이지 저장 형식 ATG는 이미 바이너리이므로 **새 대상은 전송 프레임 ATC**다. 정수 글자 ID와 고정 길이 레코드로 TextEncoder/Decoder·JSON 왕복을 줄인다.

`key.split` 감소는 정수 ID를 ATG 요청·배치까지 전달할 때의 추가 효과이며 ATC 변경만으로 줄었다고 주장하지 않는다. 범위·버전·중복ID·픽셀 알파 검사를 유지하고, 비정렬 배열과 손상 레코드를 검사한다. [DataView 공식 설명](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/DataView)

### 3. 글자별 압축을 작은 블록 단위로 묶기

[decodeAtlasPage](../experiments/automation-png/atlas-pages.ts)는 요청한 글자마다 `inflateSync`를 호출한다. 글자4/8개를 하나의 압축 블록으로 만들고 요청 내에서 해당 블록을 한 번만 해제하는 후보를 비교한다. 페이지 슬롯 수와 Worker 호출 묶음을 바꾼 기존 시도와 달리 **zlib 스트림의 단위**를 바꾼다.

필요 없는 글자까지 해제하는 손해가 있다. 희소/밀집 한글을 나누고 inflate 횟수·출력 바이트·첫 요청CPU·메모리를 함께 측정해야 한다. 단지 호출 횟수가 줄었다고 채택하지 않는다. 해제 결과 길이·상한·오프셋 검증은 유지한다. [Node inflateSync](https://nodejs.org/api/zlib.html#zlibinflatesyncbuffer-options)

### 4. 그리기만 작은 Wasm SIMD 함수로

전체 SVG를 처리했던 resvg와 달리, 검증된 글자 픽셀의 복사·팔레트 합성만 작은 함수로 옮긴다. [기존 JS painter](../experiments/automation-png/atlas-blit.ts)와 비교하며 PNG 압축·검증은 유지한다. Workers는 Wasm SIMD를 지원한다. [공식 지원 범위](https://developers.cloudflare.com/workers/runtime-apis/webassembly/#simd)

새 isolate의 모듈 시작·인스턴스 생성과 요청별 입력/출력 복사를 따로 측정한다. 기존 JS4픽셀 묶음도 경과 시간 개선에 실패했으므로 SIMD라는 이름만으로 이득을 가정하지 않는다. 투명·겹침·색상·경계의 전체 픽셀 일치를 요구한다.

### 5. 동일한 연속 행에만 PNG Up 필터 비교

현재 [atlas.ts](../experiments/automation-png/atlas.ts)는 필터None을 사용한다. 연속한 동일 행만 Up(필터2)으로 바꿔 차분을0으로 만드는 후보를 비교한다. 이미 시험한 압축 level/strategy와 달리 압축 전 scanline 표현의 변경이다.

**우선순위는 낮다.** PNG 규격도 indexed-color에서는 보통None을 권하며, 현재 여백은 이미0이다. 행 비교가 더 비싸면 제외한다. filter+deflate+pack 합계와 decoded 픽셀 일치를 확인하며, 필터가 바뀌므로 전체 PNG 바이트 일치는 요구하지 않는다. [PNG 필터 선택 규격](https://www.w3.org/TR/png-3/#12Filter-selection)

## 데이터 계약과 재현

`history.json`의 `trials`는 실제 원격 시험 묶음, `remote_groups`는 시험·단계·해상도·진단 유형별 집계다. `attempts`는 변경 방법이며 여러 방법이 같은 시험을 공유한다. 따라서 attempts 행의 수나 연결된 PNG를 합산하지 않는다. `local_measurements`는 `experiment`·`metric`·`phase`가 같은 범위에서 비교한다. 원자료가 이미 평균인 행의 `n`은 평균에 포함된 실행 수다. `page_calculations`는 바이트 계산이며 ms 측정이 아니다.

- 빈 CSV 셀은 JSON의null을 뜻한다. 문자열CSV는 UTF-8 BOM, 쉼표·따옴표 escaping을 사용한다.
- `source`와 선택적 `pointer`로 원자료를 찾고 `sources[].sha256`으로 재집계 입력을 확인한다.
- 초기 세 원격 파일의 첫 비인증 시험 행은 별도 제외했다. 후속3시험은 기존 요약기의 중복·비인증 제외 규칙을 따른다. 원자료를 수정하지 않았다.
- 프로파일·PNG 성공 검사는 과거 해당 실행의 결과다. 이번에7,500개 PNG를 다시 생성했다고 기록하지 않는다.
- HTML에는 API 키·세션·실제 사용자 카드·원격 호출 기능이 없다. 표본은 고정 예제의 성능 메타데이터다.

저장소 루트 PowerShell에서 데이터만 재집계:

```powershell
node scripts/build-automation-performance-data.mjs
```

현재 설치된 Data 플러그인과 번들 Node로 시각화 재빌드:

```powershell
$dataPlugin = 'C:/Users/user/.codex/plugins/cache/openai-curated-remote/data-analytics/1.0.11'
$dataNode = 'C:/Users/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
$env:PERFORMANCE_REPORT_COMPLETE = '1'
node scripts/build-automation-performance-visual.mjs $dataPlugin $dataNode
Remove-Item Env:PERFORMANCE_REPORT_COMPLETE
```

설치 경로가 달라지면 해당 두 경로를 현재 런타임 경로로 바꾼다. npm 의존성이나 유료 서비스를 추가하지 않는다. 앱 원본은 Git 제외 `.automation-png/performance-report`이며 재집계 데이터·작성 JSX/CSS·생성기로 재생성할 수 있다. 새 앱은 새 ID를 받고 기존 앱 재빌드는 ID를 보존한다.

로컬 미리보기:

```powershell
python -m http.server 4175 --bind 127.0.0.1 --directory .automation-png/performance-report/dist
```

서버 실행 후 `http://127.0.0.1:4175/`를 연다. 공유·보관용 단일HTML도 같은 빌드에서 내보낸다. 이 로컬 주소는 PC에서 서버가 실행되는 동안만 열린다.

## 검증 결과

2026-10-03 11:13 KST 최종 확인:

- 원자료 19개 SHA256과 재집계 결과를 대조했다. 원격은 34집계·기대858·확보615·누락243개이며 로컬785행·CSV4개·시각화7질의가 일치했다. 누락243개는 모든 과거 시험 합계이고, 마지막 진단만의 누락은39개다.
- 차트5개의 실제 SVG와 막대, 시험 전체/선택, 준비/조립, 독립 비교3개, 기존 시도 검색과 초기화, 원자료 보기를 Chromium에서 확인했다.
- 1280px·390px 화면에서 페이지 가로 넘침이 없고 추가5개 제안이 모두 표시됐다. 단일HTML은 HTTP 요청 없이 열렸고 차트·필터가 동작했다. 브라우저 예외는0개였다.
- 성능 검토에서 ATC 전송 변경의 직접 효과와 Wasm 초기화 비용의 측정 범위를 명확히 했다. 독립 데이터 검토·적대적 검토에서 미수정 결함은 발견하지 못했다. 이후 본문 폭·여백만 보완하고 화면·HTML 검증을 다시 통과했다. 모두 같은 모델의 검토이며 별도 모델 검토로 주장하지 않는다.

[검증 결과 JSON](performance/verification.json)에 실행 시각, HTML/Snapshot 해시, 검증 범위를 기록했다. 미리보기 서버를 실행한 상태에서 다음 명령으로 다시 확인한다.

```powershell
node scripts/check-automation-performance-report.mjs
```

이번 확인은 자료의 정확성과 브라우저 동작 검증이다. 기존 제품 전체 테스트나 새 성능 벤치마크·실제 발송 검증을 대신하지 않는다.

## 무료 조건과 남은 검증

Workers Free의 HTTP/Cron CPU10ms 조건을 공식 문서에서 다시 확인했다. 계정의 현재 플랜·잔여 쿼터는 이번에 재조회하지 않았고 유료 자원·추가 배포·AI·카카오 호출은 없었다. [현재 CPU 한도](https://developers.cloudflare.com/workers/platform/limits/#cpu-time)

추가5개 후보의 실제 절감 ms, 첫/반복 원격CPU, 메모리·추가호출 비용은 모두 미검증이다. 기존 전체 무료조건 실패·로그누락 및 AI 자동화2~5단계 미완료는 유지한다. 이번 요청의 완료 기준은 조사5개·기존 데이터화·시각화 제공이며 후보 구현·원격통과를 대신 주장하지 않는다.
