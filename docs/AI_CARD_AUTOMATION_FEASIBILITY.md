# AI 카드 자동화: 1단계 무료 실행 검증

최신 로컬 후속은 [2026-10-03 조립 함수 분리·native CRC 비교](AI_CARD_AUTOMATION_BLIT.md)다. 실제 CPU는 [최초 조립·준비 진단](AI_CARD_AUTOMATION_DIAGNOSTIC.md)을 따른다. 누적88 PNG, 무료 조건 불충족이며 아래 수치는 해당 과거 시험 시점 기준이다.

2026-10-02 / 브랜치 `codex/ai-card-automation` / 실험 시작 `8e4bf67`, 현재 기반 `ad875e8`(기존 하루단어 통합 포함)

**판정: PNG 생성은 통과, 실제 Workers Free CPU 10ms 기준은 불충족. 전체 자동화 미완료.**

[구현 계획](AI_CARD_AUTOMATION_PLAN.md) 3절의 선행 조건을 검사했다. 예제 네 가지를 기본·대체 압축 방식으로 각각 세 번씩 변환한 24회 모두 PNG는 정상이다. 그러나 SVG 생성 비용을 제외한 렌더만으로 CPU **35~258ms**가 필요했다. 최적화 후에도 기준을 넘었으므로 계획에 따라 무인 활성화와 2~5단계 구현을 보류한다. 이것은 해당 구현·표본의 실패이며, 가능한 모든 무료 구조가 불가능하다는 증명은 아니다.

AI 작성·교차 검토·일별 실행 테이블·자동 예약·자동화 UI는 아직 구현하지 않았다. 운영 배포·DB·예약·카카오 연결은 변경하지 않았다. 로컬 `src/worker/png.ts`에 실험용 명시적 크기 인자를 추가했으나 기존 운영 호출의 기본1080 검증은 유지한다.

후속 작업에서 저압축·12구간 처리·사전 글자 조립·수집 분리를 거쳐, 작은 페이지·복사 감소·800/720·RLE까지 구현하고 **누적 66장**을 생성했다. 최신 10 PNG는 정상이나 수집 CPU 800 8~22ms·720 6~27ms로 무료 기준을 충족하지 못했다. 기대 생성 이벤트 160개 중 100개를 확보했고 누락60개를 성공으로 집계하지 않는다. 두 임시 Worker와 시험 Secret·수집기를 정리했다. 최신 결과는 [최적화 구현·실측](AI_CARD_AUTOMATION_OPTIMIZATION.md)에 있으며 아래는 과거 시점별 결과다.

## 구현과 로컬 재현

- `experiments/automation-png/svg.ts`: 기존 Canvas의 `layoutCard`와 OFL Noto Sans KR 폰트의 가변 굵기를 재사용한다. 폰트 글리프를 SVG path로 만들고 지원하지 않는 문자는 거부한다. 카드의 태그·URL을 SVG 코드로 넣지 않는다.
- `fonts.ts`: 기존 WOFF2를 빌드 시 TTF로 해제한다. `fontkit`의 WOFF2 가변 굵기 처리에서 발생한 오류를 TTF 변환으로 해결했다. 폰트 파일·라이선스는 유지한다.
- `raster.ts`: `@resvg/resvg-wasm@2.6.2`로 1080×1080 PNG를 만들고 기존 PNG 구조·CRC·용량 검사를 적용한다. 성공·실패 경로에서 Wasm 객체를 해제한다.
- `native-png.ts`: 최적화 실험으로 Wasm 압축을 런타임 `CompressionStream('deflate')`로 바꿨다. RGBA 픽셀 동일성을 검사했다. 파일은 작아졌지만 무료 CPU 기준은 넘었다.
- `benchmark.ts`: 초기화, 폰트 캐시 최초/반복, SVG/PNG 비용을 구분한다. 반복 20회 평균으로 Windows CPU 카운터의 낮은 해상도를 보완한다. 로컬 결과를 원격 통과로 판정하지 않는다.
- `worker.ts`: 미리 만든 고정 SVG 네 가지만 변환하는 비공개 시험 Worker다. 임의 SVG·외부 URL·DB·KV·AI·발송을 연결하지 않는다. 전체 자동화의 서버 렌더러가 아닌, 비용의 하한을 확인하는 실험이다.
- `probe.ts`: Secret 인증 후 고정 예제·인코더의 POST만 전달하는 시험 입구다. Secret 미설정은 503, 잘못된 인증은 401로 거부한다.
- `scripts/tail-automation-png.mjs`: 두 시험 Worker의 CPU·wall time·outcome·버전 등 허용된 메타데이터만 저장한다. 인증 헤더·응답 본문·원문 로그를 보존하지 않는다.

```sh
npm ci
npm run bench:automation:png
npm run bench:automation:worker:dry-run
npm run bench:automation:probe:dry-run
npm run bench:automation:worker
# 별도 터미널에서 로컬 서버가 준비된 후
npm run check:automation:worker
```

`bench:automation:png`는 Git 제외 `.automation-png/`에 PNG·SVG·`report.json`을 만든다. 마지막 검사는 `127.0.0.1:8792`에만 요청하고 `worker-check.json`을 만든다. 두 dry-run 명령은 원격 배포를 하지 않는다. 실험 의존성은 devDependencies에 정확한 버전으로 고정했으며 웹·운영 Worker에서 실험 코드를 import하지 않는다.

## 실제 Workers Free 측정

사용자는 임시 무료 시험 Worker 두 개의 배포·최대 40회 생성·측정·정리를 승인했다. 18:31 KST 전후 Cloudflare Dashboard에서 현재 Workers 플랜 **무료 / US$0**와 요청 사용량 **1,333/100,000**을 확인했다. 기존 세 Worker와 이름이 겹치지 않는 것을 확인한 후 아래 두 자원만 만들었다. 계정·구독·권한 확대는 수행하지 않았다.

| 시험 자원                 | 역할                      | 측정 버전                              |
| ------------------------- | ------------------------- | -------------------------------------- |
| `en-card-png-feasibility` | 공개 주소 없는 PNG 렌더러 | `fd639f9b-690d-4183-a14e-235c0e692968` |
| `en-card-png-probe`       | Secret 인증 시험 입구     | `b9627b49-4098-4ac9-94b3-62a7354f311d` |

실제 렌더 호출은 18:34 KST에 **24회** 수행했다. 예제 네 가지 × 인코더 두 가지 × 세 번이다. 아래 값은 `wrangler tail`의 **렌더러 invocation CPU**이며 입구 Worker의 0~1ms나 네트워크 대기 시간을 사용한 수치가 아니다.

| 예제      | Wasm PNG CPU, 호출 순서(ms) | native 압축 PNG CPU, 호출 순서(ms) |
| --------- | --------------------------- | ---------------------------------- |
| 표현형    | 166, 164, 221               | 46, 43, 142                        |
| 비교형    | 196, 170, 86                | 36, 78, 35                         |
| 긴 표현형 | 73, 49, 258                 | 92, 48, 97                         |
| 긴 비교형 | 72, 59, 91                  | 54, 56, 102                        |

- 24/24 응답 HTTP 200, outcome `ok`, 예외 0. 받은 PNG의 SHA-256은 각 인코더의 로컬 workerd 결과와 모두 일치했다.
- **10ms 이내는 0/24회**다. 기본 방식 49~258ms, 대체 압축 방식 35~142ms. HTTP 성공과 무료 CPU 적합성을 구별한다. Cloudflare는 일시 초과에 여유를 줄 수 있으므로 성공 응답만으로 상시 실행 가능성을 판단하지 않는다.
- 첫 관측과 반복 요청은 구분했지만 isolate 식별자를 측정하지 않았다. 동일 isolate의 확정된 cold/warm 비교라고 주장하지 않는다.
- SVG 생성·KV 저장·예약 처리를 제외한 하한 경로부터 초과했으므로 전체 연결 경로와 원격 최고 메모리 측정은 진행하지 않았다. 배포 시 startup 29ms도 요청 CPU로 합산하지 않는다.
- 인증 없는 입구는 401, 비공개 렌더러의 공개 주소는 404였다. 이 검사는 PNG 생성 24회에 포함하지 않는다.

근거: [원격 invocation 원자료](evidence/AI_PNG_REMOTE_2026-10-02.jsonl), [PNG 응답·해시](evidence/AI_PNG_REMOTE_RESPONSES_2026-10-02.json), [로컬 workerd 대조값](evidence/AI_PNG_WORKER_2026-10-02.json).

원자료는 24개 렌더러·24개 입구·1개 비인증 입구 이벤트, 합계 49개다. 당시 수집기의 입구 `encoder` 필드는 URL query만 읽어 `/probe/.../native`를 `wasm`으로 잘못 적었다. 후속 수집기는 경로도 읽도록 수정했다. 원자료는 변경하지 않았고, CPU 표에는 처음부터 정확했던 **렌더러 이벤트만** 사용했다. 응답 자료는 클라이언트 시계, invocation 자료는 제공사 시계이므로 밀리초 값만으로 이벤트를 조인하지 않는다.

### 시험 정리 완료

측정 후 두 시험 Worker를 이름과 별도 설정 파일을 지정해 삭제했고, Windows DPAPI로 보관했던 로컬 시험 Secret 파일도 삭제했다. Dashboard에서 원래의 `en-card`, `en-card-delivery`, `worker-royal-haze-2380` 세 개만 남은 것을 확인했다. 임시 tail·로컬 시험 서버도 종료했다. D1·KV·Cron·운영 Worker·기존 Secret·카카오 발송은 변경하지 않았다.

원격 재현 스크립트는 `experiments/automation-png/run-remote.ps1`에 남긴다. PowerShell 7, 승인된 임시 자원과 새 시험 Secret의 Windows DPAPI 파일이 필요하며, 현재 정리된 상태에서는 실행할 수 없다. 원격 자원 생성은 위 로컬 재현 명령에 포함되지 않는다.

## 로컬 측정과 이미지 검증

Windows x64 / Node 22.22.2 / Intel i5-12400F. 정확한 시각과 개별 측정은 [Node 원자료](evidence/AI_PNG_LOCAL_2026-10-02.json)를 따른다. 아래는 사전 작성 SVG의 **20회 PNG 변환 평균**이다. Cloudflare CPU가 아니며, native 비동기 압축은 보조 스레드를 포함하는 프로세스 CPU로 비교한다. Windows의 개별 0ms는 비용이 없다는 뜻이 아니다.

| 예제      | Wasm 호출 스레드 CPU 평균 | Wasm 프로세스 CPU 평균 | native 프로세스 CPU 평균 | Wasm/native PNG 바이트 |
| --------- | ------------------------: | ---------------------: | -----------------------: | ---------------------: |
| 표현형    |                   26.60ms |                38.30ms |                  42.20ms |        45,915 / 30,479 |
| 비교형    |                   24.15ms |                28.10ms |                  32.80ms |        41,524 / 27,891 |
| 긴 표현형 |                   28.15ms |                31.25ms |                  47.65ms |        69,474 / 45,937 |
| 긴 비교형 |                   28.90ms |                28.95ms |                  42.15ms |        72,668 / 48,078 |

모든 PNG는 1MiB보다 작다. 네 예제의 실제 이미지를 열어 한영 표시·줄바꿈·하단 여백을 확인했다. 자동 검사로 PNG 구조·압축 해제·픽셀 동일성·넘치는 내용·누락 글리프 거부를 확인했다. Canvas와 SVG의 픽셀 단위 동일성을 주장하지 않는다.

Node RSS/heap/external/ArrayBuffer는 측정 시점 스냅샷이며 최고 메모리나 Worker isolate 메모리가 아니다. Wasm 초기화는 프로세스당 한 번이다. `font_cache=cold`는 새 Worker 시작을 뜻하지 않으며 폰트 변환·파일 읽기는 렌더 측정에서 제외했다.

## 추가 최적화와 분할 실측 — 19:00~19:30 KST

원래 무인 제작 목표를 유지하면서 로컬에서 비용을 나눠 측정했다. Node 단계별 검사에서 기본 PNG 압축이 호출 스레드 약 19~22ms를 차지했다. [Workers의 node:zlib 지원](https://developers.cloudflare.com/workers/runtime-apis/nodejs/zlib/)과 [Node 압축 옵션](https://nodejs.org/api/zlib.html)을 확인해 `level: 1` 압축을 추가했다. 파일은 다소 커져도 원본 RGBA 픽셀은 보존한다.

- `fast-png.ts`: 낮은 압축률로 PNG를 생성한다. 예제 크기는 54,964~82,966바이트다. 로컬 전체 변환도 10ms를 넘는 경우가 있어 이 변경만으로 통과로 판정하지 않았다.
- `bands.ts`·`band-png.ts`: 1080 이미지를 높이 90의 12구간으로 처리한다. 각 구간은 필요한 글리프만 렌더하고 독립된 non-final DEFLATE 블록을 만든다. 합성은 블록과 결합 Adler-32를 하나의 PNG zlib 스트림으로 묶는다. 완성된 zlib 스트림 여러 개를 단순 연결하는 방식이 아니다.
- 최초 viewport 이동 방식은 글자 가장자리 픽셀 차이를 발견해 폐기했다. `svg.ts`에 폰트에서 얻은 글리프 경계를 기록하고, 전역 좌표와 1080 표면을 유지하면서 구간 밖 글리프만 제외해 네 예제 모두 전체 픽셀 일치를 확인했다.
- `worker.ts`의 Wasm 초기화는 isolate 시작 단계로 옮겼다. PNG 생성은 `/band/{고정 예제}/{0~11}`로 분리한다. 인증 입구는 12개 결과의 순서·체크섬을 확인하고 합성한다. 외부 SVG·URL·카드 데이터를 받는 운영 API가 아니다.
- `profile.ts`·`check-automation-bands.mjs`: 단계별 로컬 CPU와 실제 로컬 서비스 바인딩을 검사한다. 벤치마크 실행 중 드러난 esbuild의 JS/binary 버전 불일치는 기존 Wrangler와 같은 `0.28.1`로 정확히 고정해 해결했다. `npm ls esbuild`, API 기반 벤치마크와 제품 빌드를 다시 통과했다. 잠긴 이전 npm 임시 폴더 정리 경고는 남았으며 사용자 프로세스를 강제 종료하지 않았다.

로컬 50회 평균 호출 스레드 CPU는 구간별 **3.42~6.86ms**, 합성 **0.32~0.62ms**였다. 이 수치는 사전 생성 SVG를 사용하며 Cloudflare CPU가 아니다. [로컬 단계별 자료](evidence/AI_PNG_PROFILE_2026-10-02.json)와 [로컬 Worker 8개 PNG 자료](evidence/AI_PNG_BANDS_WORKER_2026-10-02.json)를 보존한다.

### 승인 범위 안의 추가 8장

19:22 KST 전후 현재 계정이 Free·US$0임을 재확인했고, 요청 집계는 1,483/100,000이었다. 기존 세 Worker와 이름 충돌이 없었다. 이미 승인된 **시험 Worker 두 개·총 최대 40장** 범위 안에서 같은 시험 이름 두 개를 다시 만들고 분할 PNG를 네 예제×두 번, **8장** 생성했다. 첫 24장과 합쳐 **32장**이며, 이번 8장은 내부 구간 처리 96회를 사용한다. 기존 운영·D1·KV·Cron·AI·발송을 연결하지 않았다.

| 구성               | 버전                                   | 결과                                                   |
| ------------------ | -------------------------------------- | ------------------------------------------------------ |
| 비공개 구간 렌더러 | `b4694cf9-298c-4a58-822e-de8c28ed9c47` | startup 20ms. 수집된 55회 CPU 6~72ms, 41회가 10ms 초과 |
| 인증·PNG 합성 입구 | `4e12410e-2400-4abb-a607-d5299d1a1da8` | 배포 startup 13ms. 8회 CPU 6~17ms, 6회가 10ms 초과     |

8/8 PNG는 HTTP 200이며 로컬 workerd PNG와 해시가 같다. 수집된 invocation의 outcome은 모두 ok·예외 0이다. **무료 CPU 기준은 여전히 실패**다. startup 수치는 invocation CPU로 바꿔 해석하지 않는다.

수집기는 예상 96개 구간 중 **55개**의 invocation 이벤트를 확보했다. 표현형의 0~10 구간은 두 묶음, 나머지 세 예제는 각각 한 묶음이며, 11번 구간은 없다. 41개의 미수집 원인은 확정하지 않았으며 무작위 표본이나 전체 호출 CPU로 해석하지 않는다. 미수집이 있어도 관측된 다수의 기준 초과를 통과로 바꿀 수는 없다. [원격 구간 원자료](evidence/AI_PNG_BANDS_REMOTE_2026-10-02.jsonl)와 [8개 응답·해시](evidence/AI_PNG_BANDS_RESPONSES_2026-10-02.json)를 별도로 보존했다.

측정 후 두 시험 Worker와 DPAPI 시험 Secret을 다시 삭제했고, Dashboard `Showing 1–3 of 3` 및 원래 세 자원을 확인했다. tail·로컬 서버 두 개도 종료했다. 후속 독립 리뷰에서 결과 파일만 확인하는 재실행 방어는 첫 응답 유실과 동시 실행을 막지 못함을 발견해 수정했다. 원격 호출 전에 `FileMode.CreateNew`로 단독 시도 기록을 만들고 각 `started`를 디스크에 flush한 후 호출한다. 오류는 `unknown`으로 남기며, 결과가 없는 `started`도 시도 횟수에 포함한다. 표식은 오류·중단 때 삭제하지 않고 재실행을 거부한다. 과거 원격 자료를 소급해 새 ledger로 위장하지 않았다.

### 후속 로컬 검증

- PNG 16개 테스트와 인증·중간 실패 중단 테스트 1개, 합계 **17개 통과**. 원본/저압축/분할의 전체 픽셀 비교, 구간 누락·역순·범위 오류와 잘못된 응답 메타데이터 거부를 확인했다.
- 테스트 작성 중 callback 인자 누락과 Buffer 타입 오류를 고쳐 재실행했다. 픽셀 비교가 실패했던 viewport 이동 구현도 수정 후 통과했다.
- 실제 로컬 Worker 두 개의 서비스 바인딩으로 fast/bands **8개 PNG**의 모든 픽셀 일치와 인증 없는 요청 401을 확인했다.
- `pwsh -File scripts/check-automation-trial-ledger.ps1`: 응답 유실·로컬 저장 실패·진행 중 중첩 실행·빈 중단 표식·이전 결과의 **5가지 오프라인 검증 통과**. 네트워크 함수는 모의 구현으로 대체했으며 추가 원격 생성은 없다. 기존 시험 결과나 시도 기록을 삭제해 예산을 초기화하면 안 된다.
- 타입·제품 빌드·두 운영 Worker dry-run·두 시험 Worker dry-run·무료 구성 검사를 통과했다. 테스트·성능·보안 전문 검토와 새 endpoint 후속 보안 검토에서 남은 구체적 결함은 발견되지 않았다. 기존 전체 테스트 미완료·E2E 미실시는 그대로다.

로컬 재현은 먼저 `npm run bench:automation:png`, 이어 `npm run bench:automation:png -- --profile`이다. 분할 바인딩 검사는 렌더러를 `npm run bench:automation:worker`로 실행하고 별도 터미널에서 아래 명령을 사용한다. 아래 토큰은 공개된 로컬 합성 테스트 값이며 운영 Secret으로 사용하지 않는다.

```sh
npx wrangler dev --config experiments/automation-png/wrangler.probe.jsonc --local --port 8793 --var BENCH_TOKEN:local-synthetic-token-not-for-deployment
# 서버 두 개가 준비된 뒤 별도 터미널
node scripts/check-automation-bands.mjs
```

이후 글리프를 빌드 시 준비하는 구조를 구현·측정했다. 다음 절의 결과로 갱신하며 PNG 처리 개선이 AI·예약 전체 경로의 완료를 대신하지 않는다.

## 사전 생성 글자 조립과 후속 분리 후보 — 20:00~20:40 KST

`atlas*.ts`는 기존 OFL 폰트의 글자 픽셀을 빌드 시 준비하고, 런타임에는 필요한 글자만 읽어 1080×1080 indexed PNG로 조립한다. 예제에서 쓰인 글자만 준비하는 최초 121자 실험은 가능성 검사용이며, 원격 시험은 현대 한글 11,172자를 포함한 **11,478자·34가지 크기/굵기** 자료를 사용했다. 지원하지 않는 문자(현재 폰트에 없는 `※` 포함)는 거부한다. 모든 Unicode를 지원한다는 뜻은 아니다.

- `atlas-full-build.ts`·`atlas-build.ts`: ATG1 페이지 476개, 약 101.9MB, 가장 큰 파일 551,424바이트. 라이선스를 포함해 정적 파일 477개를 만들었다. 전체 글자 자료를 메모리에 펼치지 않고 각 페이지의 필요한 글자만 압축 해제한다.
- `atlas-common-build.ts`: 공통 Latin·문장부호·고정 화면 문구만 별도 번들에 넣는다. 예제의 한국어 내용을 특별 취급하지 않는다. 성능 리뷰에서 유효한 비교형 카드가 50페이지 제한에 걸리는 사례를 발견했고, 공통 자료로 33페이지까지 줄인 뒤 회귀 테스트를 추가했다.
- `atlas.ts`·`atlas-pages.ts`: 같은 카드 배치 함수를 쓰되 글자별 폭·정수 좌표·31단계 투명도를 사용한다. 글자 간 커닝·합자 처리는 기존 벡터 방식과 다르며 기존 Canvas/벡터 결과와 픽셀 동일성을 주장하지 않는다. 두 결과 이미지를 직접 열어 글자·배치·잘림을 확인했다. 전체 문자 조합의 시각 검증은 미실시다.
- 정적 글자 파일은 [Static Assets](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)로 보관하며 별도 유료 저장 상품을 사용하지 않는다. 비공개 Worker가 [Assets 바인딩](https://developers.cloudflare.com/workers/static-assets/binding/)으로 읽는다. `run_worker_first: true`와 고정 경로만 허용해 파일 직접 공개를 막는다.

### 승인된 마지막 8장: 누적 40/40장

20:18 KST 전후 Dashboard의 Workers Free·US$0와 요청 집계 1,694/100,000을 재확인했다. 같은 시험 Worker 두 개로 표현형 2장·비교형 1장·긴 표현형 1장·긴 비교형 2장·다양한 글자 비교형 2장, 합계 8장을 생성했다. 모두 HTTP 200·로컬 PNG 해시 일치였으나 **CPU 17~54ms, 10ms 이내 0/8회**였다.

| 예제               | renderer CPU(ms), 호출 순서 |
| ------------------ | --------------------------- |
| 표현형             | 40, 26                      |
| 비교형             | 17                          |
| 긴 표현형          | 24                          |
| 긴 비교형          | 25, 31                      |
| 다양한 글자 비교형 | 36, 54                      |

비공개 renderer 버전은 `60e4ee45-d7ab-4291-9e4a-1b822f1876d7`, 인증 입구는 `4409bf35-3415-4081-a9ae-f74f297d06ee`다. renderer 8개·입구 9개(비인증 1개 포함)의 이벤트를 모두 확보했다. 배포 startup 54ms는 요청 CPU와 별도이며 입구 CPU 0~1ms를 renderer 수치로 대신하지 않는다. 비인증 입구 401·렌더러 공개 접근 404를 확인했다.

근거: [글자 자료 빌드](evidence/AI_PNG_ATLAS_BUILD_2026-10-02.json), [로컬 조립](evidence/AI_PNG_ATLAS_LOCAL_2026-10-02.json), [로컬 바인딩](evidence/AI_PNG_ATLAS_WORKER_2026-10-02.json), [원격 CPU](evidence/AI_PNG_ATLAS_REMOTE_2026-10-02.jsonl), [응답·해시](evidence/AI_PNG_ATLAS_RESPONSES_2026-10-02.json), [사전 시도 기록](evidence/AI_PNG_ATLAS_ATTEMPTS_2026-10-02.jsonl).

두 시험 Worker와 DPAPI Secret을 삭제했다. Dashboard에서 기존 `en-card`, `en-card-delivery`, `worker-royal-haze-2380` 세 개만 남은 것을 확인했다. 원격 수집기도 종료했다. 기존 DB·KV·예약·AI·카카오에는 변경이 없다. 승인된 40회는 모두 소진됐다.

### 다음 후보: 3페이지씩 준비하고 PNG 조립 분리 — 로컬만 검증

`atlas-chunks.ts`, `atlas-probe.ts` 및 `/glyphs/{예제}/{순번}`은 글자 자료를 최대 3페이지씩 준비하고 인증 입구에서 최종 PNG를 만든다. 응답의 순서·개수·기대 글자·범위·투명도를 검증한다. 최대 29개 준비 호출로 제한해 [서비스 바인딩의 Worker 호출 깊이 32](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/) 안에 여유를 남긴다. 시험 입력은 고정 예제뿐이며 임의 카드 API는 아직 아니다.

로컬 50회 평균은 준비 묶음의 호출 스레드 CPU **0~0.64ms**, 조립 **2.18~3.44ms**다. Windows의 0은 계측 해상도 한계이며 비용이 없다는 뜻이 아니다. 이 벤치마크는 파일을 사전 읽고 네트워크·startup을 제외하므로 Cloudflare 통과 근거가 아니다. [로컬 비용 자료](evidence/AI_PNG_ATLAS_CHUNKS_LOCAL_2026-10-02.json).

로컬 서비스 바인딩에서 다섯 예제 모두 앞선 조립 방식과 PNG 바이트가 일치했고 비인증 401·글자 파일 직접 접근 404였다. 두 Worker 패키징 dry-run도 통과했다. [로컬 Worker 결과](evidence/AI_PNG_ATLAS_CHUNKS_WORKER_2026-10-02.json). `fetched_bytes: null`은 해당 응답에서 측정하지 않았다는 뜻이다.

```sh
# 로컬 글자 자료 준비; 원격 배포 없음
npm run bench:automation:png -- --atlas-full
npm run bench:automation:png -- --atlas-common
npm run bench:automation:png -- --atlas-pages
npm run bench:automation:png -- --atlas-chunks
npx wrangler dev --config experiments/automation-png/wrangler.atlas.jsonc --local --port 8792
# 별도 터미널. 아래 값은 공개된 로컬 시험값이며 원격 Secret으로 쓰지 않음
npx wrangler dev --config experiments/automation-png/wrangler.atlas-probe.jsonc --local --port 8793 --var BENCH_TOKEN:local-synthetic-token-not-for-deployment
# 서버 준비 후 별도 터미널
node scripts/check-automation-atlas.mjs --chunks
```

당시 원격 후보는 완성 PNG 최대 8장(누적 48장), 내부 글자 준비 호출 58회·정적 페이지 읽기 164회로 준비했고 새 승인을 요청했다. 이후 승인·실행 결과는 다음 절을 따른다. 기존 기록 삭제·불명 요청 재시도로 횟수를 초기화하지 않는다.

### 추가 승인 후 분리 방식 실제 시험 — 21:30~21:34 KST

사용자가 **‘다음 단계 진행 승인’**으로 추가 8장 시험·정리를 허용했다. Dashboard에서 Workers 현재 플랜 Free·US$0, 당시 요청 1,858/100,000 및 기존 세 자원만 있는 것을 확인하고 같은 시험 Worker 두 개를 배포했다. 비인증 입구 401·렌더러 공개 접근 404를 확인한 후 8장만 생성했다.

| 예제               | 최종 조립 CPU(ms), 호출 순서 |
| ------------------ | ---------------------------- |
| 표현형             | 19, 17                       |
| 비교형             | 15                           |
| 긴 표현형          | 14                           |
| 긴 비교형          | 13, 28                       |
| 다양한 글자 비교형 | 13, 26                       |

글자 준비 Worker `14f4e893-2329-4826-bc64-f7c73ce55e24`는 **58회 CPU 1~11ms, 57회 10ms 이내**였다. 긴 비교형 0번 구간 한 번이 11ms였다. 조립 Worker `d3f0aa9c-08e1-449b-84e3-84466a4bd3d5`는 **8회 모두 10ms 초과**했다. startup 55ms·49ms는 요청 CPU와 별도다. 58+8개 생성 경로 이벤트를 확보했고 비인증 요청 이벤트는 수집되지 않았다.

8/8 HTTP 200·로컬 PNG SHA256 일치, 생성 이벤트 outcome ok·예외 0이다. 사전 원장에는 started 8·completed 8·unknown 0이 남았다. **PNG 성공과 무료 CPU 실패를 구별한다.** 각 서비스의 실측을 기록한 것이며 [서비스 바인딩 요금의 CPU 합산 설명](https://developers.cloudflare.com/workers/platform/pricing/#service-bindings)을 호출별 무료 한도 적합성으로 바꿔 해석하지 않는다.

근거: [호출 CPU](evidence/AI_PNG_ATLAS_CHUNKS_REMOTE_2026-10-02.jsonl), [응답·해시](evidence/AI_PNG_ATLAS_CHUNKS_RESPONSES_2026-10-02.json), [시도 원장](evidence/AI_PNG_ATLAS_CHUNKS_ATTEMPTS_2026-10-02.jsonl).

시험 후 두 Worker·DPAPI Secret·수집기를 삭제/종료했고 Dashboard에 기존 세 자원만 남았음을 확인했다. 누적 **48/48장**이며 추가 승인분은 소진됐다. 기존 운영·D1·KV·예약·AI·카카오에는 변경이 없다. 최종 조립 비용을 줄일 다음 구조는 로컬에서만 검토하며 새 원격 호출은 하지 않는다.

### 조립 중복 계산 제거와 로컬 비용 분해 — 21:46 KST

성능 후속 리뷰에서 조립 입구의 `planCardAtlas`와 `atlasPng`가 같은 카드 검증·배치를 두 번 계산하는 것을 확인했다. 계획에 검증된 카드·배치·번호를 보관하고 `atlasPngPrepared`에서 재사용하도록 고쳤다. 글자 준비, 그리기, 압축, PNG 검증의 경계도 분리해 로컬 진단을 추가했다. 생성된 5개 예제 PNG는 기존 결과와 바이트 단위로 일치했다.

| 예제               | 중복 계산 포함 / 제거 후 로컬 프로세스 CPU 평균(ms) |
| ------------------ | --------------------------------------------------- |
| 표현형             | 2.34 / 2.66                                         |
| 비교형             | 2.49 / 2.51                                         |
| 긴 표현형          | 2.97 / 3.13                                         |
| 긴 비교형          | 3.28 / 2.81                                         |
| 다양한 글자 비교형 | 3.91 / 3.13                                         |

100회 평균이며 startup·파일 읽기·네트워크를 제외했다. 측정 순서, JIT·GC, Windows CPU 계측 해상도의 영향을 분리하지 못했으므로 **일관된 속도 개선으로 판단하지 않는다.** PNG 압축 단계는 로컬 평균 0.94~1.40ms였지만 이것을 원격 CPU 초과의 확정 원인으로 해석할 수 없다. 단계별 측정은 준비된 입력을 사용하므로 합산값도 전체 요청 시간으로 쓰지 않는다. [단계별 로컬 원자료](evidence/AI_PNG_ATLAS_ASSEMBLY_PROFILE_2026-10-02.json).

```sh
# 앞선 atlas-full / atlas-common 자료가 준비된 로컬에서 실행
npm run bench:automation:png -- --atlas-assembly-profile
npx vitest run tests/automation-atlas.test.ts tests/automation-png.test.ts tests/automation-probe.test.ts tests/studio-bridge.test.ts
```

수정 후 관련 테스트 37개·타입 검사·시험 입구 패키징 dry-run·기존 운영 무료 구성 검사를 통과했다. 이 수정의 원격 배포·추가 PNG 생성은 하지 않았다. 다음 후보로 세로 구간별 indexed PNG 압축을 검토할 수 있지만 글자 자료 조회 수, 경계를 걸치는 글자, 압축 스트림 결합, 전체 호출 수와 실제 CPU를 다시 입증해야 한다. 현재 검증된 후보가 아니며 별도 시험을 바로 반복할 근거로 삼지 않는다.

### 수집과 최종 조립을 별도 실행으로 분리 — 22:04 KST

후속 `atlas-pipeline.ts`는 인증 입구가 글자 프레임을 모아 같은 비공개 Worker의 별도 `POST /pipeline/assemble/{예제}`로 전달한다. 기존 방식에서 한 실행이 맡았던 수집·응답 검증·PNG 압축 부담을 나누는 후보이며, 총 계산량 감소를 입증한 것은 아니다. 글자 준비는 호출당 최대 2페이지로 줄였다. 기존 `atlas_chunks`의 3페이지 방식과 측정 기록은 유지한다.

- 입구는 고정 예제 5개만 받는다. 프레임 순서·개수·크기를 검사하고, 조립 실행에서 기대 글자·메타데이터·픽셀 값을 모두 검증한 후 PNG를 만든다.
- `Content-Length`가 없거나 작게 지정되어도 스트림 실제 바이트로 제한한다. 프레임 1MiB·전체 본문 4MiB·조립 글자 픽셀 2MiB를 초과하면 중단한다. 메모리 peak 실측을 대신하는 값은 아니다.
- 글자 준비 최대 29회 + 조립 1회 + 입구 1회 = 31회로 제한해 [서비스 바인딩의 한 요청당 Worker 실행 32회 한도](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/#limits)에 기존 호출자 1회 여유를 둔다. 실제 통합 시 전체 경로를 다시 검증해야 한다.

| 예제               | 페이지 / 글자 준비 호출 | 전체 Worker 실행 | 로컬 조립 / 수집 CPU 평균(ms) |
| ------------------ | ----------------------- | ---------------- | ----------------------------- |
| 표현형             | 22 / 11                 | 13               | 2.82 / 0.94                   |
| 비교형             | 14 / 7                  | 9                | 2.50 / 0.62                   |
| 긴 표현형          | 14 / 7                  | 9                | 4.06 / 0.94                   |
| 긴 비교형          | 13 / 7                  | 9                | 6.24 / 2.18                   |
| 다양한 글자 비교형 | 33 / 17                 | 19               | 4.70 / 1.24                   |

프로세스 CPU 50회 평균이고 준비·조립은 독립 측정, 수집은 모의 Response 생성·실제 제한 읽기를 포함한다. 자산 읽기·startup·네트워크를 제외했으므로 Cloudflare CPU가 아니다. [로컬 비용](evidence/AI_PNG_ATLAS_PIPELINE_LOCAL_2026-10-02.json), [로컬 두 Worker 연결](evidence/AI_PNG_ATLAS_PIPELINE_WORKER_2026-10-02.json). 로컬 PNG 5개는 모두 기존 결과와 바이트 단위로 같았다. 비인증 401·글자 자산 직접 경로 404도 확인했다.

관련 Vitest 45개, 오프라인 원장 8시나리오, 타입·두 시험 dry-run·무료 구성·diff 검사를 통과했다. 보안·성능·유지보수 전문 리뷰와 독립 adversarial 리뷰에서 구체적 결함이 없었고, 테스트 전문 리뷰는 신규 8개를 별도 실행해 통과했다. 전체 AI 자동화 완료나 무료 통과를 의미하지 않는다.

```sh
npm run bench:automation:png -- --atlas-pipeline
npx wrangler dev --config experiments/automation-png/wrangler.atlas-pipeline.jsonc --local --port 8792
# 별도 터미널, 공개 로컬 시험값
npx wrangler dev --config experiments/automation-png/wrangler.atlas-pipeline-probe.jsonc --local --port 8793 --var BENCH_TOKEN:local-synthetic-token-not-for-deployment
node scripts/check-automation-atlas.mjs --pipeline
```

### pipeline 원격 실측·정리 — 22:08~22:12 KST

사용자의 후속 **‘진행 승인’**에 따라 앞선 시험과 같은 임시 Worker 두 개·최대 PNG 8장으로 범위를 제한해 진행한다고 알린 후 실행했다. Dashboard의 현재 Workers Free·US$0, 요청 2,008/100,000, 기존 세 Worker를 확인했다. 기존 운영·DB·KV·예약·AI·카카오를 연결하지 않았다.

| 역할                | 실제 배포 버전                                          | 배포 startup        |
| ------------------- | ------------------------------------------------------- | ------------------- |
| 글자 준비·별도 조립 | `2679aecc-b0cc-49f7-8ab7-fc1fa14f832f`                  | 55ms                |
| 인증·자료 수집      | `11b218da-4429-4c9b-90e8-f28cae3b4187` (Secret 설정 후) | 최초 코드 배포 59ms |

표현형 2·비교형 1·긴 표현형 1·긴 비교형 2·다양한 글자 비교형 2, 합계 **8장 모두 HTTP 200·로컬 PNG 해시 일치**다. 사전 원장은 started 8·completed 8·unknown 0이며 자동 재호출은 없었다. 비인증 401·렌더러 공개 주소 404도 확인했다.

| 단계      | 예상 / 확보 이벤트 | 확보한 CPU                                  | 10ms 초과 |
| --------- | ------------------ | ------------------------------------------- | --------- |
| 글자 준비 | 84 / 58            | 3~28ms                                      | 11/58     |
| PNG 조립  | 8 / 3              | 비교형 16ms, 긴 표현형 35ms, 긴 비교형 29ms | 3/3       |
| 인증·수집 | 8 / 8              | 12, 5, 9, 18, 9, 10, 8, 10ms (호출 순서)    | 2/8       |

생성 경로 100회 중 **69개 이벤트**와 비인증 1개, 총 70개를 확보했다. 원격 수집기에서 예외 원문·헤더는 보존하지 않았다. 미수집은 글자 준비 26개·조립 5개이며, 다양한 글자 예제의 11~16번 준비가 모두 빠지는 등 균일한 표본이 아니다. 누락 원인을 확정하지 않았으며 전체 CPU 검증 또는 개선률을 주장하지 않는다. 확보된 생성 이벤트는 outcome ok·예외 0이지만 **PNG 성공과 무료 CPU 기준 실패는 별개**다. startup도 요청 CPU로 합산하지 않는다.

근거: [원격 CPU](evidence/AI_PNG_ATLAS_PIPELINE_REMOTE_2026-10-02.jsonl), [응답·해시](evidence/AI_PNG_ATLAS_PIPELINE_RESPONSES_2026-10-02.json), [시도 원장](evidence/AI_PNG_ATLAS_PIPELINE_ATTEMPTS_2026-10-02.jsonl).

두 config의 정확한 시험 이름을 지정해 Worker를 삭제했고 DPAPI Secret·수집기도 삭제/종료했다. Dashboard에서 기존 세 Worker만 남았음을 확인했다. 누적 **56장**이며 이 후보에 새 원격 시도를 추가하지 않았다. 수집·조립 분리만으로 무료 조건이 해결된다는 가설은 이번 표본에서 성립하지 않았다. 계획의 2~5단계 활성화로 넘어가지 않는다.

## 공식 조건과 미확인 항목

2026-10-02 다음 공식 문서를 확인했다.

- [Workers 실행 한도](https://developers.cloudflare.com/workers/platform/limits/#cpu-time): Free HTTP·Cron CPU 10ms, isolate 메모리 128MB, 일시 초과에 대한 유연성. 네트워크 대기 시간과 CPU는 다르다.
- [Gemini 3.1 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite) 및 [가격](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.1-flash-lite): 지정 모델·무료 tier 항목을 확인했다. 사용자 프로젝트의 billing tier·잔여 쿼터는 미확인이다.
- [Groq 구조화 출력](https://console.groq.com/docs/structured-outputs) 및 [한도](https://console.groq.com/docs/rate-limits): `openai/gpt-oss-120b` 계약·한도 문서를 확인했다. 실제 조직과 하루단어의 공유 사용량은 미확인이다.
- [resvg WASM API](https://github.com/thx/resvg-js/blob/main/wasm/index.d.ts), [fontkit](https://github.com/foliojs/fontkit), [wawoff2](https://github.com/fontello/wawoff2): 구현 API·폰트 변환을 확인했다.

`npm run check:free`는 기존 운영 설정에서 통과했다. 이 정적 검사는 시험 Worker CPU나 계정 전체 청구를 검증하지 않는다. 이번 원격 실행은 확인된 Workers Free에서만 진행했다. AI 공급사 무료 자격·공유 예산과 전체 무인 경로는 미확인이다. 유료 서비스·실제 AI 호출·카카오 발송은 추가하지 않았다.

## 검토·남은 단계와 대안

### 기존 하루단어 연결과 AI 사용량 확인 — 20:50 KST

하루단어의 실제 로컬 저장소는 `C:/Users/user/Documents/ChatGPT/하루단어`이며 확인한 HEAD는 `939f9149eb41047c5fe9d5bf578dbeae98db1e7f`, 브랜치는 `codex/accuracy-cause-remedies`다. 이 저장소의 작업 트리는 변경하지 않았다. 등록 프로젝트 목록, `AGENTS.md`, `README.md`, `PROJECT_HANDOFF.md`와 아래 실제 코드를 대조했다. 문서의 과거 운영·무료 확인은 현재 계정 자격 증명으로 사용하지 않는다.

| 확인한 코드                                                  | 현재 동작과 자동화 구현 시 필요한 연결                                                                                                                                              |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 하루단어 `app/cards/page.tsx`                                | 본인 로그인 후 `/card-studio/index.html` iframe 표시. 카드 UI 원본은 EN_Card이며 생성 번들을 직접 수정하지 않음                                                                     |
| 하루단어 `lib/server/card-studio.ts`                         | 본인 ID·Origin·메서드·경로를 검사한 뒤 서버 bridge Secret으로 EN_Card 호출. 브라우저 쿠키·Authorization을 그대로 넘기지 않음                                                        |
| EN_Card `src/worker/studio-bridge.ts`                        | 서버 Secret·허용 사용자·Origin 검사 및 카카오 연결용 일회 티켓. 무인 작업이 브라우저 로그인 쿠키에 의존할 필요 없음                                                                 |
| EN_Card `src/web/environment.ts`                             | 기존 API `/api/...`를 통합 화면에서 `/api/card-studio/api/...`로 변환. 계획의 새 `/api/card-studio/automation`은 기존 목록에 없으므로 정확한 경로 별도 매핑·양쪽 allowlist가 필요함 |
| 하루단어 `lib/learning/feedback-identity.ts`                 | 계획과 같은 Gemini 3.1 Flash-Lite·Groq GPT-OSS 120B 식별자                                                                                                                          |
| 하루단어 `lib/feedback-fallback.ts`                          | Google 실패 시 Groq 결과 하나로 기존 학습 피드백 성공 처리. 두 모델의 작성·독립 검토를 요구하는 카드 계약으로 그대로 재사용할 수 없음                                               |
| 하루단어 `db/feedback.ts`, `drizzle/0001_ai_daily_usage.sql` | 사용자·KST 날짜별 학습 요청 횟수 기록. 제공자별 실제 호출·토큰·프로젝트 쿼터가 아니며, fallback 두 호출도 학습 시도 하나이므로 공유 무료 잔량을 증명하지 못함                       |

하루단어 AI 설정 이름은 `google_api`, `groq_api`, `groq_ai_enabled`다. **비밀값을 읽거나 복사하지 않았고 실제 AI를 호출하지 않았다.** 해당 키가 속한 Google 프로젝트/Groq 조직, 현재 무료 tier와 모델별 잔여 쿼터는 미확인이다. 신규 카드 호출 예산은 기존 학습을 포함한 제공자 프로젝트·조직 한도를 따로 확인해야 한다. 학습 카운터를 총 실제 호출 수로 사용하거나 기존 학습 기능에 임의 제한을 추가하지 않는다.

현재 자동화 브랜치에는 이미 병합된 하루단어 연결 코드가 없었다. `git fetch origin master` 후 `ad875e8`로 fast-forward하여 통합 기반을 반영했다. 기존 설정·잠금 파일은 줄바꿈을 제외한 내용이 같고, 진행·검증 문서의 두 기록을 모두 보존해 충돌을 해소했다. 원격 운영 배포나 하루단어 소스 변경은 하지 않았다. 실험 코드가 사용하는 카드 스키마·배치·폰트·PNG 검증 코드는 이 기본 브랜치 갱신으로 바뀌지 않았다.

요청한 `review`로 코드·계획 대조, 테스트/유지보수/성능/보안 검토와 독립 adversarial 검토를 수행했다. 실험 코드에서 남은 수정 대상은 발견되지 않았다. 무료 기준 실패와 전체 기능 미구현은 해결된 것으로 처리하지 않는다. 별도 Codex CLI는 설정 모델을 지원하지 않아 실행에 실패했고 Claude 도구는 사용할 수 없었다. 상세 범위·한계는 [리뷰 기록](AI_CARD_AUTOMATION_REVIEW.md), [검증 기록](VERIFICATION.md)을 따른다.

| 계획 단계                            | 상태                                                                              |
| ------------------------------------ | --------------------------------------------------------------------------------- |
| 1: 서버 PNG·무료 계정·전체 경로 성능 | PNG 생성·Free 계정 확인 완료, CPU 기준 실패. 전체 경로·원격 메모리·AI 계정 미검증 |
| 2: 두 AI 작성·검토·수정              | 선행 조건 미충족으로 미구현                                                       |
| 3: 날짜별 무인 실행·KV·예약          | 미구현                                                                            |
| 4: 하루단어 자동화 UI·연결 API       | 미구현. 실제 저장소와 기존 본인 인증·카드 bridge 경로는 코드로 확인               |
| 5: 통합·PC 종료·실제 수신            | 미실시                                                                            |

다음 미완료 작업은 무료 한도에 맞는 PNG 처리 경로 확보다. 현재 방식의 작은 조정만으로 통과한다고 약속할 근거는 없다.

사용자의 근본 원인 조사 요청에 따라 [CPU 절감 조사](AI_CARD_AUTOMATION_CPU_RESEARCH.md)를 추가했다. 로컬 workerd에서 큰 글자 페이지의 본문 읽기·복사와 최종 화면 압축이 주요 표본을 차지했다. 페이지 재배치의 읽기 감소 계산, 손실 없는 압축 옵션 비교와 다음 검증 순서를 기록했다. 신규 원격 생성·배포는 없으며 무료 CPU 통과 여부는 달라지지 않았다.

| 선택지                           | 유지되는 조건                       | 달라지는 점·확인할 것                                                                                                                       |
| -------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 기존 브라우저에서 미리 제작·예약 | 무료 구성, 준비 후 PC 종료 발송     | 매일 새 카드의 무인 생성 요구는 충족하지 못함. 현재 제품으로 가능                                                                           |
| 무료 서버 렌더 구조 재설계       | 무료·PC 종료·새 카드 무인 생성 목표 | 글리프 사전 처리·작업 분할 등을 새 실험으로 검증해야 함. 1080 PNG 품질·전체 CPU·저장 예산·복구 설계를 다시 입증해야 하며 현재 가능성 미확인 |

유료 플랜·유료 이미지 API·PC 상시 실행으로 요구를 대체하지 않았다. 이 결과 문서와 실험 코드가 전체 자동화 완료를 뜻하지 않는다.
