# PNG 최초 조립 비용·준비 CPU 진단

후속 로컬 구현은 [조립 함수 분리·native CRC 비교](AI_CARD_AUTOMATION_BLIT.md)를 따른다. 추가 원격 호출은 없으며 아래 실제 CPU 결과와 누적88 PNG는 유지한다.

2026-10-03 10:00 KST / `codex/ai-card-automation` / 기반 `ad875e8`

**첫 조립의 주요 로컬 병목을 확인했고 준비 CPU 표본도 확보했다. 무료 CPU 조건은 여전히 불충족이다.** 이번 실제 시험은 PNG 12개와 글자 준비 단독 진단 72개이며, 누적 PNG는 88개다. 단독 진단은 PNG 개수에 포함하지 않는다. 전체 AI 작성·교차 검토·자동 예약·운영 UI인 계획 2~5단계는 미완료다. [직전 76개 시점 기록](AI_CARD_AUTOMATION_LEAN.md)을 보존한다.

## 최초 조립 로컬 분석

`research-assembly-workerd.mjs`는 기존 lean 조립 코드를 수정하지 않고 새 workerd 인스턴스 20개에서 실행했다. 5예제×800/720×2회이며 두 번째 회차는 순서를 뒤집었다. 인스턴스마다 첫 조립 1회, 후속 4회, 반복 조립 20회를 실행했다. **전체 500개 PNG가 기준 바이트와 일치했다.** 실제 글자 묶음을 사용하지만 준비 단계와 모듈 시작 시간은 측정에서 제외한다.

- 첫 조립의 로컬 경과 시간: **11.59~22.65ms**.
- 인스턴스별 마지막 20회 평균 경과 시간: **3.22~5.14ms**.
- 위 값에는 로컬 호출·응답 읽기·전체 바이트 비교 시간이 포함된다. **Cloudflare 요청 CPU가 아니다.** 프로파일러 자체의 비용도 있어 운영 시간으로 예측하지 않는다.

100µs 간격의 비유휴 프로파일 표본에서 다음 경로가 두드러졌다. 첫 조립은 20회 합계 511표본, 반복은 400회 합계 1,862표본이다. 요청 수가 다르므로 원시 합계를 성능 비율로 비교하지 않는다.

| 경로             |   첫 조립 표본 비중 |   반복 조립 표본 비중 | 의미                                     |
| ---------------- | ------------------: | --------------------: | ---------------------------------------- |
| `paintText`      | 216/511 = **42.3%** |      169/1,862 = 9.1% | 글자의 각 픽셀을 JS 중첩 반복문으로 그림 |
| `deflateSync`    |       22/511 = 4.3% | 426/1,862 = **22.9%** | 전체 화면 PNG 압축                       |
| PNG 검증의 `crc` |       12/511 = 2.3% | 364/1,862 = **19.5%** | 완성 PNG의 CRC 재계산                    |

`atlas.ts`의 `paintText`는 픽셀마다 알파값을 읽고 색상 인덱스를 계산해 쓴다. `packIndexedPng`는 native CRC로 청크를 작성한 뒤 `validatePng`의 JS CRC로 다시 검사한다. **우선 개선 대상은 첫 조립의 픽셀 반복문이며, 반복 비용의 후속 후보는 CRC와 압축이다.** 이 단계에서는 입력·CRC 검증이나 렌더 알고리즘을 제거·변경하지 않았다. [로컬 원자료](evidence/AI_PNG_ASSEMBLY_COLD_LOCAL_2026-10-03.json)

## 진단 코드와 실제 시험

`atlas-diagnostic.ts`는 기존 lean Worker를 감싸 난수 실행 인스턴스 ID와 조립/준비 호출 순번을 응답에 넣는다. UUID는 첫 요청 안에서 생성한다. 모듈 초기화에서 난수를 생성하면 workerd가 시작을 거부하는 문제를 로컬 실제 실행에서 찾아 수정했다.

Secret 인증 입구는 고정 예제·800/720·글자 묶음 번호만 허용한다. `X-Lab-Call`의 32자리 난수 ID를 하위 요청까지 전달해 응답과 CPU 로그를 **호출 ID·Worker·정확한 경로**로 대조한다. 단독 준비 경로는 글자 묶음 하나만 반환하며 임의 URL·본문·카드 입력을 받지 않는다. 원장 파일은 배타적으로 생성하고 실제 호출 전에 디스크로 flush한다. 실패·결과 불명은 예산을 소비하며 재시도하지 않는다.

09:51~09:54 KST Dashboard에서 **Workers 무료·US$0**, 표시된 오늘 요청 **102/100,000**, 기존 Worker 3개를 확인했다. 같은 임시 Worker 두 개만 배포했고 생산 Worker·D1·KV·예약·AI·카카오 발송은 변경하지 않았다.

- 비공개 renderer 버전: `44d7d11c-bc1d-4d29-b1f1-f443c7f7a27d`.
- 인증 probe의 Secret 설정 후 버전: `52aef9a0-2ab4-4927-83d9-81063cb31f7e`.
- 최초 배포 startup: renderer 53ms, probe 57ms. 요청 CPU와 별개다.
- 비인증 입구 401, 비공개 renderer 공개 주소 404 확인.
- 09:56~09:58 KST, **started 84 / completed 84 / unknown 0**, 재시도 0. PNG 12개와 준비 묶음 72개 모두 HTTP 200·로컬 크기·SHA256 일치.
- PNG는 expression/long/coverage 각각 두 해상도에서 연속 2회, 단독 준비는 comparison/long_comparison을 포함한 5예제의 모든 72묶음을 실행했다.

원격 CPU에는 진단용 UUID·순번·헤더·입구의 추가 인증 비용이 포함된다. 순수 lean 코드와의 동일 조건 A/B가 아니므로 직전 시험 대비 개선율을 계산하지 않는다.

## 실제 CPU 결과

| 경로             |  해상도 | 확보 / 기대 | 확보 CPU | 10ms 초과 |
| ---------------- | ------: | ----------: | -------: | --------: |
| 전체 생성의 준비 |     800 |     26 / 52 |   2~10ms |         0 |
| 전체 생성의 조립 |     800 |       1 / 6 |     13ms |         1 |
| 전체 생성의 수집 |     800 |       6 / 6 |   4~11ms |         1 |
| 전체 생성의 준비 |     720 |     48 / 52 |   2~18ms |         5 |
| 전체 생성의 조립 |     720 |       4 / 6 |  13~22ms |         4 |
| 전체 생성의 수집 |     720 |       6 / 6 |   7~15ms |         1 |
| 단독 준비        |     800 |     34 / 36 |   1~18ms |         3 |
| 단독 준비        |     720 |     36 / 36 |   1~12ms |         2 |
| 단독 진단 입구   | 800/720 |     72 / 72 |    0~1ms |         0 |

조립 12개 응답은 **5개 실행 인스턴스의 첫 조립 5회와 이후 조립 7회**로 나뉜다. 확보된 조립 CPU는 모두 첫 조립이며 13~22ms, 이후 7회의 CPU는 누락됐다. 따라서 **원격 예열 효과의 수치 비교는 미완료**다. 같은 인스턴스의 첫 조립 전에도 준비 요청은 실행될 수 있으므로 ‘인스턴스 전체의 첫 요청’과 구별한다.

연속된 720 expression 두 요청은 서로 다른 인스턴스의 첫 조립이었다. 해상도와 실행 순서만으로 cold/warm을 구분할 수 없다. 단독 준비의 초과 5회 중 3회는 해당 인스턴스의 준비 순번이 9·24·29였다. 단, 해상도·예제가 달라질 수 있어 완전히 예열됐다는 증거는 아니다. **처음만 예열하면 해결된다고 결론 내릴 근거는 없다.** 720이 항상 더 빠르다고도 결론 내리지 않는다.

## 준비 로그 확보와 남은 누락

이번에는 **Worker마다 필터 없는 tail 하나씩**만 사용했다. 기대 272개 중 **233개**를 확보했다. 누락 39개는 전체 생성 준비 30개·조립 7개·단독 준비 2개다. 비인증 사전 점검 1개는 제외하고 중복 0개, 확보 이벤트는 모두 outcome ok·예외 0이다.

단독 준비에서는 70/72개를 확보하여 준비 CPU를 직접 평가할 수 있었다. 전체 생성 준비도 74/104개를 확보했다. 하지만 tail 단순화로 모든 누락이 해결되지는 않았다. 로컬 파서의 JSON 오류·버퍼 폐기·종료 전 잔여 문자는 모두 0이며 stderr·sampling 경고·수신 이벤트의 truncated 표시는 0이다. **이 사실이 제공사의 전체 전달을 증명하지는 않는다.** 동시 tail 필터가 과거 누락의 원인이었다는 가설도 확정할 수 없다.

공식 문서는 실시간 로그의 표본 추출 가능성과 요청별 로그 용량 제한을 설명한다. 현재 실험에서 어느 제한이 적용됐는지는 확인되지 않았다. 로그 누락은 별도 미해결 항목으로 남기고, 이미 확보한 CPU 초과 때문에 무료 판정은 실패로 유지한다. [실시간 로그](https://developers.cloudflare.com/workers/observability/logs/real-time-logs/), [Workers 제한](https://developers.cloudflare.com/workers/platform/limits/)

## 검증·리뷰·정리

- 진단/파서 Vitest **2파일 7개**, 894ms 통과. 인증·경로·본문·순번·로그 분류를 검사한다.
- 원장 **7가지 오프라인 시나리오** 통과: 타임아웃·파일 실패·HTTP 실패·잘못된 메타데이터·겹친 실행·정상 84회·중단 흔적의 재실행 차단.
- 실제 로컬 workerd Static Assets·Service Binding에서 PNG 10개 + 준비 묶음 72개 전체 바이트 해시와 메타데이터 일치.
- `npm run build`, `npm run check:free`, 진단 Worker 두 개의 `deploy --dry-run`, 타입·변경 파일 서식·`git diff --check` 통과. 전체 Vitest/E2E를 새로 실행했다고 표시하지 않는다.
- 요청한 `$review`의 테스트·유지보수·보안·성능·독립 적대적 검토 적용. 단독 진단 로그가 `wasm`으로 잘못 분류되는 문제를 수정하고 실제 분류 함수의 회귀 검사를 추가했다. 다른 모델의 Claude/별도 Codex CLI 검토는 기존 도구 제약으로 수행 근거에 포함하지 않는다.
- 두 임시 Worker를 CLI로 삭제한 뒤 Dashboard에 기존 `en-card`, `en-card-delivery`, `worker-royal-haze-2380` 세 개만 남음을 확인했다. 임시 DPAPI Secret 삭제, 로컬 서버·tail·시험 프로세스 종료를 확인했다.

근거: [원격 집계](evidence/AI_PNG_DIAGNOSTIC_SUMMARY_2026-10-03.json), [CPU 원자료](evidence/AI_PNG_DIAGNOSTIC_2026-10-03_REMOTE.jsonl), [응답](evidence/AI_PNG_DIAGNOSTIC_2026-10-03_RESPONSES.json), [원장](evidence/AI_PNG_DIAGNOSTIC_2026-10-03_ATTEMPTS.jsonl), [tail 진단](evidence/AI_PNG_DIAGNOSTIC_2026-10-03_TAIL.json), [로컬 바인딩](evidence/AI_PNG_DIAGNOSTIC_2026-10-03_WORKER.json).

## 재현과 다음 구현 순서

전체 글자 자료와 기준 PNG는 [기존 준비 절차](AI_CARD_AUTOMATION_OPTIMIZATION.md#재현-명령)를 먼저 실행한다. 아래 명령은 로컬 분석·검증이며 원격 배포나 카카오 발송이 아니다.

```powershell
node experiments/automation-png/research-assembly-workerd.mjs
npm test -- tests/automation-diagnostic.test.ts tests/automation-tail.test.mjs
pwsh -NoProfile -File scripts/check-automation-diagnostic-ledger.ps1
npm run build
npm run check:free
```

로컬 실제 바인딩 검사는 터미널 두 개에서 아래 서버를 각각 실행한 후 마지막 명령으로 확인한다. 토큰은 공개된 로컬 합성 값이다.

```powershell
npx wrangler dev --config experiments/automation-png/wrangler.atlas-diagnostic.jsonc --local --ip 127.0.0.1 --port 8792
npx wrangler dev --config experiments/automation-png/wrangler.atlas-diagnostic-probe.jsonc --local --ip 127.0.0.1 --port 8793 --var BENCH_TOKEN:local-synthetic-token-not-for-deployment
node scripts/check-automation-diagnostic.mjs
```

원자료 집계는 `node scripts/report-automation-diagnostic.mjs`로 재현한다. 원격 호출 원장·응답은 재실행 방지용이므로 삭제하거나 덮어써 추가 호출하지 않는다. 진단 배포 설정은 재사용 가능한 도구이며 현재 배포는 삭제된 상태다.

다음 미완료 구현은 **픽셀별 JS 쓰기를 줄이는 조립 방식**이다. 투명 픽셀과 겹침을 보존하는 행 구간·연속 복사 후보를 기존 코드와 비교하고, 매 후보를 새 인스턴스에서 시작해 첫 조립 CPU 표본·전체 PNG 바이트 동일성을 확인한다. 그 뒤 CRC 검증 자체는 유지하면서 native CRC 경로를 비교한다. 준비 CPU 초과와 원격 반복 조립의 누락도 함께 재검증해야 한다. 예상 절감 ms는 아직 제시할 근거가 없다. 사용자에게 필요한 새 비밀값 입력은 없다.
