# ATC 메타데이터 바이너리화 구현·로컬 비교

후속 N3 작은 압축 블록도 구현·비교했다. 최신 결과는 [N3 보고서](AI_CARD_AUTOMATION_BLOCKS.md)를 따르며, 아래는 N2 당시의 측정과 판단이다.

2026-10-03 / `codex/ai-card-automation` / 기반 `ad875e8`

**N2를 구현·검증했으나 기본 경로에는 채택하지 않는다.** 메타데이터는67.9% 줄었지만, 전체 생성의 반복 평균은41.110→44.076ms, 첫 조립 중앙값은17.432→21.581ms로 늘었다. 일부 지표의 감소만으로 일관된 속도 개선을 주장할 수 없다.

N2는 글자 준비 Worker가 조립 Worker로 보내는 메타데이터를 비교하는 실험이다. N1의 RPC를 섞지 않고 두 후보 모두 기존 fetch를 사용한다. 모든 시간은 로컬 경과 시간이다. 원격 배포·호출·계정 설정·AI·카카오·운영 DB 변경은 없다. 원격 PNG 누적88개와 무료 CPU 미충족 상태는 그대로다.

## 구현과 입력 검증

- [atlas-binary.ts](../experiments/automation-png/atlas-binary.ts): ATC2 바이너리 인코더·해독기. 기존 ATC1 JSON은 유지한다.
- [atlas-chunks.ts](../experiments/automation-png/atlas-chunks.ts), [atlas-pipeline.ts](../experiments/automation-png/atlas-pipeline.ts): 명시적인 codec 선택을 추가했다. 선택하지 않으면 기존 JSON 경로다. 준비·수집·묶음·조립이 같은 codec을 사용하며, 잘못된 형식이나 혼용을 거부한다.
- `atlas-binary-runtime.ts`, `atlas-binary-worker.ts`, `atlas-binary-probe.ts`: 고정 예제·800/720 후보와 비공개 렌더러·Secret 인증 입구. 운영 소스·기본 배포 설정은 이번 단계에서 변경하지 않았다.
- [research-binary-workerd.mjs](../experiments/automation-png/research-binary-workerd.mjs): 실제 로컬 fetch Service Binding·Static Assets로 준비/조립/전체를 분리 측정한다.

ATC2는 기존과 같은 12바이트 헤더에 `ATC2` 식별자·메타데이터 바이트 수·프레임 순서·개수를 쓴다. 이어 아래 32바이트 레코드들과 기존 5비트 알파 바이트를 넣는다. 모두 big endian이며 예약 필드는0이다.

| 레코드 오프셋 | 타입            | 의미                              |
| ------------: | --------------- | --------------------------------- |
|         0 / 2 | uint16 / uint16 | 글자 굵기 / 논리 크기             |
|             4 | uint32          | Unicode code point                |
|             8 | float64         | 소수점까지 보존한 글자 폭 advance |
|       16 / 18 | int16 / int16   | 왼쪽 / 위쪽 위치                  |
|       20 / 22 | uint16 / uint16 | 픽셀 너비 / 높이                  |
|            24 | uint32          | 알파 배열 오프셋                  |
|            28 | uint32          | 예약0                             |

생산자는 고정 폭 필드가 잘리기 전에 범위를 검사한다. 수신측은 요청한 글자 집합·중복·예약 필드·유한한 advance·너비/높이·픽셀 범위·모든 알파0~31을 확인한다. 비정렬 `Uint8Array.subarray`도 원래 `byteOffset`을 사용한다. 프레임1MiB·메타데이터256KiB·묶음4MiB·최대29프레임 제한을 유지한다. ATB1 바깥 묶음 형식과 연속 버퍼 복사, PNG 전체 검증도 유지한다.

글자 페이지 ATG1과 레이아웃의 문자열 식별자는 그대로다. 이번 단계는 ATC의 JSON stringify/parse·UTF-8 인코딩/해독을 제거한 비교이며, 모든 문자열 처리나 복사를 제거한 것이 아니다. 바이너리 생산자의 식별자 분해·검증 비용도 측정에 포함한다.

## 비교 조건과 해석

두 후보 모두 800/720·64슬롯·호출당6페이지·scalar 그리기·JS CRC·Z_RLE다. 예제5종×해상도2종의 글자 준비72호출과 조립10호출을 유지한다. 각 입력은 이전에 보존한 PNG와 바이트가 같아야 통과한다.

| 입력 합계, 예제10개 | ATC1 JSON | ATC2 바이너리 |  감소 |
| ------------------- | --------: | ------------: | ----: |
| 메타데이터          |  45,285 B |      14,528 B | 67.9% |
| ATB 묶음 전체       | 303,458 B |     272,701 B | 10.1% |

두 라운드에서 같은 입력의 형식 실행 순서와 입력 순서를 반전한다. 각 모집단·형식은 새 workerd20개, 인스턴스마다 첫1회·안정화2회·반복10회다. 프로파일러는 연결하지 않는다. 호스트 요청 시작부터 전체 응답 읽기까지 측정하고 바이트 비교는 타이머 밖에서 수행한다. `mf.ready`와 `getWorker`까지의 준비는 별도 `setup_wall_ms`다. 첫 요청을 전체 플랫폼 cold start 시간으로 해석하지 않는다.

- 준비: 카드 한 장의 모든 준비 요청을 순서대로 호출한다. 표본 하나가 여러 Worker 호출의 합계이며 각 요청의 호스트 경계를 포함한다.
- 조립: 사전 준비한 묶음으로 실제 PNG를 계산하는 단일 HTTP 요청이다.
- 전체: 인증 입구에서 실제 Service Binding·Static Assets·조립을 거쳐 PNG를 읽는 요청이다.

세 모집단은 호출 경계가 다르므로 시간을 합산하지 않는다. 모든 시간은 로컬 경과 시간이며 Cloudflare 호출당 CPU10ms와 비교할 수 없다. 실제 원격 CPU와 로그 확보율은 별도 미검증이다.

## 측정 결과와 결정

| 모집단    | 형식     | 첫 실행 중앙값 ms | 첫 실행 범위 ms | 반복 평균 ms | 반복 표본 |
| --------- | -------- | ----------------: | --------------: | -----------: | --------: |
| 준비 전체 | JSON     |            64.297 |  42.004~132.134 |       48.837 |       200 |
| 준비 전체 | 바이너리 |            59.750 |  42.686~122.322 |       48.776 |       200 |
| 단일 조립 | JSON     |            17.432 |   11.401~27.567 |        4.594 |       200 |
| 단일 조립 | 바이너리 |            21.581 |   14.996~28.461 |        4.415 |       200 |
| 전체 생성 | JSON     |            55.709 |  33.909~101.324 |       41.110 |       200 |
| 전체 생성 | 바이너리 |            53.897 |   34.968~98.188 |       44.076 |       200 |

같은 입력·라운드20쌍에서 바이너리 방식이 짧았던 횟수는 준비 첫14쌍/반복11쌍, 조립 첫5쌍/반복13쌍, 전체 첫11쌍/반복6쌍이다. 전체 반복 평균은 약7.2% 늘었다. 느린 표본도 제외하지 않았다. 로컬 런타임·자산·전달 비용과 변동이 포함되므로 바이너리가 언제나 느리다는 의미도 아니다. 현재 근거로는 목표인 최초 조립과 전체 경로의 일관된 개선이 확인되지 않아 **JSON 기본값을 유지**한다.

이전 N1이나 다른 날짜의 평균을 이번 후보와 직접 비교하지 않는다. 동일 실행의 JSON 대조군을 기준으로 한다. 전송 바이트 감소는 확인했지만 어느 CPU 구간이 몇 ms 줄었는지는 이 측정만으로 특정할 수 없다.

근거: [120행·반복값·6집계·소스18개 해시](evidence/AI_PNG_BINARY_LOCAL_2026-10-03.json), [로컬 연동·전송량·PNG 해시](evidence/AI_PNG_BINARY_WORKER_2026-10-03.json). 소스 해시와 집계·모집단 수를 별도로 다시 계산해 일치를 확인했다.

## 검증·리뷰와 남은 조건

- 관련 Vitest4파일53개 통과. 신규 codec5개 테스트와 기존48개를 포함한다. 소수 advance·음수 위치·보충 평면 문자·빈 글자·비정렬 view·크기/순서/중복/예약 필드/알파/형식 혼용을 검사했다. 기존 실제 폰트 테스트를 확장해 동적 한영 카드의 PNG 일치도 확인했다.
- 실제 로컬 workerd smoke에서 PNG40개·준비 프레임144개가 기준과 같고 거부14건을 통과했다. 초기 smoke에서 후보 Worker의 경로 선택 정규식에 남은 `lean`을 수정한 뒤 전체 검증·측정을 다시 실행했다.
- 최종 비교는 새 workerd120개와 별도 smoke2개다. **실제 계산 PNG1,080개·준비 응답 프레임3,888개가 바이트 일치**했다. PNG는 smoke40+조립520+전체520, 프레임은 smoke144+준비3,744다. 전체 경로 안에서 전달된 내부 프레임이나 입력 준비의 Node PNG를 여기에 중복 집계하지 않았다. 사전 PNG 응답으로 대체한 표본은 없다.
- 타입·Vite·제품 두 Worker dry-run, `check:free`, 새 시험 두 Worker dry-run·변경 코드 서식 검사 통과. 시험 렌더러 gzip1,569.01KiB, 입구1,565.94KiB다. dry-run은 실제 배포가 아니다.
- 요청한 `review`의 테스트·성능·보안·유지보수 전문 검토와 독립 적대적 검토에서 구체적인 미수정 결함을 찾지 못했다. 테스트 전문 검토는 원문을 읽었고 적대적 검토는 테스트·fixture를 요약 범위로 읽었다. 같은 모델의 검토이며 별도 모델/Claude/CLI 검증으로 주장하지 않는다.

신규 의존성·유료 자원을 추가하지 않았다. 무료 구성 검사는 통과했지만 계정 플랜·공유 쿼터를 재조회하지 않았으며 원격 CPU 적합성을 증명하지 않는다. 전체 제품 Vitest/E2E, 실제 AI·카카오 연동도 이번 단계에서 새로 실행하지 않았다. 기존 임시 Worker·Secret은 정리된 상태로 유지한다.

N2의 로컬 구현·비교는 완료했다. 다음 미완료 후보는 **N3: 글자별 압축 해제를 작은 블록 단위로 묶기**다. 네이티브 해제 호출 횟수와 불필요하게 해제하는 바이트가 함께 변하므로, JSON/fetch 기준을 유지하며 이 두 비용을 분리 비교해야 한다. 무료 CPU·로그 누락과 전체 AI 자동화2~5단계는 여전히 미완료이며 운영 활성화하지 않는다.

## 재현

저장소 루트에서 실행한다. `.automation-png` 자산이 없으면 [최적화 재현 명령](AI_CARD_AUTOMATION_OPTIMIZATION.md#재현-명령)의 전체 atlas→common→optimized-build→자산 복사→optimized 기준PNG 생성 순서를 먼저 따른다. 실제 비밀값이나 운영 계정이 필요하지 않다.

```powershell
npm test -- tests/automation-binary.test.ts tests/automation-rpc.test.ts tests/automation-atlas.test.ts tests/automation-optimized.test.ts
node experiments/automation-png/research-binary-workerd.mjs --smoke
node experiments/automation-png/research-binary-workerd.mjs
npm run build
npm run check:free
npx wrangler deploy --config experiments/automation-png/wrangler.atlas-binary.jsonc --dry-run
npx wrangler deploy --config experiments/automation-png/wrangler.atlas-binary-probe.jsonc --dry-run
```

측정 중 다른 테스트·빌드·CPU 부하를 실행하지 않는다. 같은 명령은 해당 날짜의 로컬 결과를 다시 작성하므로 기존 결과를 보존하려면 별도 복사한다. 실제 원격 시험 원장은 수정하지 않는다. 측정 인스턴스는 `finally`에서 정리한다.
