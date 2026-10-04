# PNG 수집 호출 감소 구현·실측

최신 로컬 후속은 [조립 함수 분리·native CRC 비교](AI_CARD_AUTOMATION_BLIT.md)다. 실제 CPU는 [최초 조립·준비 진단](AI_CARD_AUTOMATION_DIAGNOSTIC.md)을 따른다. 아래는 누적76 PNG 시점의 기록이며, 최신 원격 누적은88 PNG다.

2026-10-03 00:25 KST / `codex/ai-card-automation` / 기반 `ad875e8`

**수집 호출을 줄였고 실제 PNG 10개가 기존 결과와 일치했다. 무료 CPU 조건은 아직 불충족이다.** 이번 10회를 포함한 누적 실험은 76 PNG다. AI 작성·교차 검토·자동 예약·운영 UI인 전체 계획 2~5단계는 미완료다. [직전 결과](AI_CARD_AUTOMATION_OPTIMIZATION.md)는 과거 기록으로 보존한다.

## 변경과 선택 근거

- `atlas-pipeline.ts`에 고정 경로 접두사를 전달해 서비스·자산 요청의 중복 `Request` 생성을 제거했다. 기존 경로와 기본 동작은 유지한다.
- 작은 32/64슬롯 페이지에 한해 묶음 상한을 8개로 열고 3·4·6·8개를 비교했다. 기존 1,024슬롯은 최대 3개다. 실제 후보 `atlas-lean-*`는 **64슬롯·6개 묶음**, 800/720 직접 생성·RLE·제한된 본문 읽기를 사용한다.
- 프레임 1MiB·조립 본문 4MiB·최대 29묶음, 실제 본문 크기·글자·픽셀·PNG 검증을 유지한다. 외부 입력으로 내부 URL이나 경로 접두사를 지정할 수 없다.
- 5예제×2해상도의 준비 호출은 140→72개, 수집·조립을 포함한 전체 기대 호출은 **160→92개**다. 한 PNG에는 준비 4~13회, 전체 6~15회가 필요하다. 읽는 페이지 수와 그림 내용은 동일하다.

로컬 workerd에서 하위 응답을 실제 프레임·PNG로 미리 준비한 모의 바인딩을 사용했다. 모든 후보를 예열하고 5회 순서 회전·반전, 후보당 250회(총 1,250회)를 측정했다. 네트워크·하위 Worker 계산·원격 CPU는 포함하지 않는다.

| 수집 후보              | 평균 로컬 경과 시간 | 비유휴 프로파일 표본 |
| ---------------------- | ------------------: | -------------------: |
| 기존 3개 묶음          |             16.39ms |                  404 |
| 경로 복사 제거·3개     |             17.18ms |                  442 |
| 경로 복사 제거·4개     |             13.16ms |                  323 |
| **경로 복사 제거·6개** |          **9.85ms** |              **258** |
| 경로 복사 제거·8개     |              8.81ms |                  259 |

**복사 제거만의 성능 향상은 입증되지 않았다.** 6개 후보의 수집 개선은 호출 묶음 확대를 포함한 결과다. 8개는 준비 호출별 작업량이 더 커져 6개를 원격 후보로 선택했다. Node 준비 시간은 각 청크를 10회씩 5라운드 측정한 평균이며 단일 요청 CPU 최대치가 아니다. [로컬 원자료](evidence/AI_PNG_LEAN_LOCAL_2026-10-03.json)

## 실제 무료 계정 시험

00:15~00:18 KST 무렵 Dashboard에서 Workers **무료·US$0**, 표시된 일일 요청 **2,504/100,000**, 기존 Worker 3개를 확인했다. 승인된 임시 시험 방식으로 같은 두 Worker만 배포했다. 생산 서비스·D1·KV·예약·AI·카카오 발송은 변경하지 않았다.

- 비공개 renderer `7b3f64cb-937e-47e2-84c1-c4ef2bf0b71a`, 인증 probe는 Secret 설정 후 `2e9ef706-91ce-423c-8713-739f83e40776`.
- 최초 코드 배포 startup은 renderer 97ms, probe 63ms. 요청 CPU와 별개다.
- `run-remote.ps1 -Mode atlas_lean`: **started 10 / completed 10 / unknown 0**, 재시도 0. 모두 HTTP 200·로컬 SHA256 전체 일치. 비인증 입구 401·비공개 renderer 공개 URL 404.
- 파일 크기는 기존과 같아 800 **14,764~27,314B**, 720 **13,022~24,198B**다. 실제 휴대전화·카카오에서 새 해상도 품질은 미검증이다.

| 단계     | 확보 / 기대 | 확보 CPU | 10ms 초과 |
| -------- | ----------: | -------: | --------: |
| 800 준비 |      0 / 36 |   미확인 | 판정 불가 |
| 800 조립 |       5 / 5 |   6~19ms |       2회 |
| 800 수집 |       5 / 5 |    6~9ms |       0회 |
| 720 준비 |      0 / 36 |   미확인 | 판정 불가 |
| 720 조립 |       5 / 5 |   5~30ms |       3회 |
| 720 수집 |       5 / 5 |   4~15ms |       2회 |

800 수집 5표본은 한도 이내지만 전체 경로의 통과가 아니다. 크기가 작은 720의 CPU가 항상 낮지도 않았다. 예제별 한 번뿐인 표본이므로 p95·성능 보장을 계산하지 않는다. 실제 조립·수집의 초과가 있어 준비 로그 누락과 별개로 무료 기준 실패다.

## 로그 누락 조사

renderer 전체 tail과 `--method POST` tail, probe tail을 함께 열었다. 조립 10개가 두 renderer 채널 모두에 동일 timestamp·version·CPU로 수집됐다. `report-automation-lean.mjs`는 이 중복 10개를 제거하고 **생성 이벤트 20/92개**만 확보했다고 보고한다. 준비 72개는 미확인이다. 사전 비인증 이벤트 1개는 생성 표본에서 제외했다.

두 renderer 채널의 수신 바이트와 이벤트가 완전히 같았다. **동시 tail 필터가 서로 영향을 줬을 가능성은 추론이며, 원인은 확정하지 못했다.** 이번 시험으로 전체 준비 CPU를 평가하거나 과거 누락 원인을 해결했다고 주장하지 않는다. 공식 문서는 필터와 sampling 가능성을 설명하지만 이번 관측의 원인을 보증하지 않는다. [Wrangler tail](https://developers.cloudflare.com/workers/wrangler/commands/workers/#tail)

세 수집 프로세스에서 JSON 오류·버퍼 폐기·stderr·sampling 경고는 0이었다. Windows 종료 시 잔여 버퍼 필드는 다시 기록되지 않았다. 후속 수정으로 매 stdout 처리 때 `pending_characters`를 저장하고 파서 테스트로 확인했다. **이 수정 뒤 원격 시험은 하지 않았다.** 비교용 POST 추가 채널은 이제 `--compare-post`를 명시할 때만 실행한다. 다음 측정은 Worker당 단일 tail로 준비·조립 로그 수집부터 검증해야 한다.

## 검증·리뷰·정리

- 관련 Vitest **4파일 62개**, 58.36초 통과. 3/4/6/8개 묶음·동적 문장·세 해상도에서 PNG 전체 일치, 상한 위반의 읽기 전 거부, 직접 경로의 실제 자산 접근을 포함한다.
- 실제 로컬 workerd의 Static Assets·Service Binding에서 PNG 10개 전체 바이트 일치, 401/405/404/손상 조립 400 확인.
- 로그 파서 **3개** 통과, 원격 호출 원장 **10가지 오프라인 시나리오** 통과. 실제 Cloudflare 호출과 구분한다.
- `npm run build`, `npm run check:free`, 두 lean Worker `deploy --dry-run`, 타입·변경 파일 서식·`git diff --check` 통과. 전체 Vitest/E2E를 이번에 새로 통과했다고 표시하지 않는다.
- 요청한 `$review`의 테스트·유지보수·보안·성능·독립 적대적 검토를 수행했다. 테스트 전문 검토의 파서 회귀 검사 실행 누락을 수정해 기본 `npm test`에 연결했다. 성능 검토의 복사 제거 단독 효과 미입증을 위 표에 반영했다. 원격 요약 중복 제거도 독립 재검토했다. Claude/독립 Codex CLI 검토는 기존 도구 제약으로 통과 근거에 포함하지 않는다.
- 시험 후 두 임시 Worker를 이름을 확인해 삭제했다. 임시 DPAPI Secret 삭제·관련 프로세스 종료, Dashboard 기존 Worker 3개만 남은 상태를 확인했다.

근거: [원격 요약](evidence/AI_PNG_LEAN_SUMMARY_2026-10-03.json), [원격 CPU](evidence/AI_PNG_LEAN_2026-10-03_REMOTE.jsonl), [응답](evidence/AI_PNG_LEAN_2026-10-03_RESPONSES.json), [원장](evidence/AI_PNG_LEAN_2026-10-03_ATTEMPTS.jsonl), [수집기 진단](evidence/AI_PNG_LEAN_2026-10-03_TAIL.json), [로컬 바인딩](evidence/AI_PNG_LEAN_2026-10-03_WORKER.json).

## 재현과 남은 단계

전체 글자 자료·기존 기준 PNG는 [직전 문서의 준비 명령](AI_CARD_AUTOMATION_OPTIMIZATION.md#재현-명령)으로 만든다. 아래는 로컬 검사이며 원격 생성이나 운영 배포가 아니다.

```powershell
node experiments/automation-png/research-lean-collector.mjs
npx vitest run tests/automation-optimized.test.ts tests/automation-atlas.test.ts tests/automation-probe.test.ts tests/png.test.ts
npm run test:automation:tail
pwsh -File scripts/check-automation-trial-ledger.ps1
npm run build
npm run check:free
```

로컬 터미널 두 개에서 서버를 실행한 뒤 검사한다. 아래 토큰은 로컬 합성 값이다.

```powershell
npx wrangler dev --config experiments/automation-png/wrangler.atlas-lean.jsonc --local --ip 127.0.0.1 --port 8792
npx wrangler dev --config experiments/automation-png/wrangler.atlas-lean-probe.jsonc --local --ip 127.0.0.1 --port 8793 --var BENCH_TOKEN:local-synthetic-token-not-for-deployment
node scripts/check-automation-optimized.mjs --lean
```

이번 원자료는 `node scripts/report-automation-lean.mjs`로 재집계한다. 이미 사용한 `atlas_lean` 원장을 삭제하거나 재사용해 추가 생성하지 않는다. 다음 미완료 단계는 **현재 800/720 조립의 첫 실행·예열 후 비용을 분리한 프로파일링과 준비 CPU의 단일 tail 재검증**이다. 새 AI 기능 활성화·새 크기의 운영 업로드 및 카카오 메타데이터 연동은 무료 조건을 해결한 뒤 진행한다. 현재 사용자에게 필요한 새 비밀값 입력은 없다.
