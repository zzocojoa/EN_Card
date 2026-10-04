# AI 카드 PNG 최적화 구현·실측

후속 결과: [2026-10-03 조립 함수 분리·native CRC 로컬 비교](AI_CARD_AUTOMATION_BLIT.md). 실제 CPU는 [최초 조립·준비 진단](AI_CARD_AUTOMATION_DIAGNOSTIC.md)을 따른다. 아래는66장 시점의 과거 기록이며 최신 원격 누적은88장이다.

2026-10-02 23:45 KST / `codex/ai-card-automation` / 기반 `ad875e8`

**승인된 페이지·복사·800/720 직접 생성·RLE 개선을 구현했다. PNG는 정상이지만 Workers Free CPU 조건은 여전히 불충족이다.** 이번 실제 시험은 10 PNG, 이전 시험을 포함한 누적은 66 PNG다. 전체 자동화 2~5단계는 미완료다.

## 반영한 변경

| 개선              | 구현과 검증                                                                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 작은 글자 페이지  | 기존 1,024슬롯을 64/32슬롯으로 재구성. 기존 압축 글자 바이트를 유지하고 오프셋·헤더를 다시 작성한다. 11,478문자×34스타일 범위를 세 해상도에 빌드했다. 이는 모든 글리프를 하나씩 시각 검증했다는 뜻은 아니다. |
| 본문 복사 감소    | 한 청크면 그대로 반환하고 여러 청크면 제한된 버퍼에 합친다. 실제 읽은 바이트 상한·중단·잘못된 Content-Length 검증은 유지한다.                                                                                |
| 800/720 직접 생성 | 배치는 1080 논리 좌표, 사전 글자 픽셀은 목표 해상도로 만든다. 실행 중 1080 이미지를 축소하지 않는다.                                                                                                         |
| RLE               | 최종 PNG 압축에 `Z_RLE`를 적용한다. 같은 해상도에서 압축 해제한 픽셀은 기존 전략과 동일하다.                                                                                                                 |
| 측정·재현         | 후보별 로컬 비교, 두 해상도 Worker 경로, 최대 10회 원장, 실제 CPU 로그 대조와 요약 도구를 추가했다.                                                                                                          |

`atlas.ts`, `atlas-pages.ts`, `atlas-build.ts`, `atlas-pipeline.ts`, `atlas-optimized-*.ts`가 구현을 담당한다. `src/worker/png.ts`는 명시적 크기 인자를 추가했으며 **기본값은 1080**이다. 운영 업로드·복원 호출은 기본값을 유지하므로 800/720을 운영 규격으로 활성화하지 않았다. 카카오 payload·저장 메타데이터의 새 크기 연동은 무료 경로를 확정한 다음 단계다.

원격 후보는 **64슬롯**을 선택했다. 32슬롯과 통합 후보의 로컬 조립 시간 차이는 작았고, 64슬롯은 파일 수가 절반이다. 800·720을 합친 실제 파일은 라이선스 포함 **12,582개**, 최대 페이지 28,151바이트다. 예제별 준비 호출 8~25회에 수집·조립 각 1회를 더해 총 **10~27회**다. 일반 입력에는 기존 최대 29 준비 묶음 제한을 유지한다. 고정 예제용 폰트 부분집합으로 수치를 줄이지 않았다.

## 로컬 결과

모든 후보를 예열한 뒤 순서를 회전·반전한 5라운드×10회 평균이다. 준비는 해당 카드의 모든 글자 준비 호출을 합친 경과 시간이고, 조립은 준비된 묶음에서 PNG를 만드는 경과 시간이다. 자산은 메모리에 미리 읽었으며 실제 네트워크·cold isolate·Cloudflare CPU를 포함하지 않는다.

| 후보                               | 글자 준비 평균 ms | PNG 조립 평균 ms | 기존 대비 읽기 바이트 감소 |
| ---------------------------------- | ----------------: | ---------------: | -------------------------: |
| 기존 1080                          |             4.154 |            2.904 |                       기준 |
| 64슬롯만                           |             3.922 |            2.769 |                 82.6~89.9% |
| 32슬롯만                           |             3.455 |            2.528 |                 90.9~94.8% |
| 복사 감소만                        |             3.369 |            2.589 |                       없음 |
| 800 직접 생성                      |             3.638 |            1.673 |                 16.9~17.4% |
| 720 직접 생성                      |             3.231 |            1.413 |                 22.1~23.1% |
| RLE만                              |             3.704 |            2.349 |                       없음 |
| **800 + 64슬롯 + 복사 감소 + RLE** |         **3.105** |        **1.459** |             **85.8~91.6%** |
| **720 + 64슬롯 + 복사 감소 + RLE** |         **2.934** |        **1.290** |             **86.8~92.2%** |

페이지 단독 후보는 호출 상한 때문에 2→3페이지 묶음 변경도 포함한다. 영향을 받지 않아야 하는 단계도 후보 간 차이가 있어 로컬 실행 잡음이 남아 있다. 이 표를 원인별 정확한 CPU 절감률이나 원격 성능 보장으로 쓰지 않는다. 초기 비교의 실행 순서 편향을 확인해 순서 교차 측정으로 교체했고, 재실행 시에도 수치 변동이 있었다. 전체 세부 수치는 [로컬 원자료](evidence/AI_PNG_OPTIMIZED_2026-10-02_LOCAL.json)에 있다.

- 관련 Vitest 4파일 **56개 통과**. 최적화 신규 11개는 전문 검토자도 별도 실행해 통과했다.
- 실제 로컬 workerd의 Static Assets·Service Binding으로 **10 PNG가 Node 기준과 전체 바이트 일치**. 401/405/404/손상 입력 400도 확인했다.
- 800 PNG **14,764~27,314B**, 720 PNG **13,022~24,198B**. 모든 파일이 앱 1MiB 상한 이내다.
- 긴 비교형 PNG를 두 해상도에서 직접 열어 한글·영문과 줄바꿈을 확인했다. 실제 휴대전화·카카오 이미지 표시와 확대 품질은 미검증이다.
- `npm run build`, 두 시험 Worker `deploy --dry-run`, `npm run check:free` 통과. 전체 Vitest/E2E를 이번에 새로 통과했다고 주장하지 않는다.

## 실제 Cloudflare 시험

23:33 KST 무렵 Dashboard에서 **Workers Free·US$0**, 일일 요청 **2,257/100,000**과 기존 세 Worker를 확인했다. 사용자 승인을 근거로 같은 시험 Worker 두 개만 배포했다. 5예제×800/720 각각 1회, 총 **10회**이며 재시도는 없다. 원장 started 10·completed 10·unknown 0이다. PNG 10개 모두 HTTP 200·로컬 SHA256 일치다.

- 비공개 준비·조립 Worker: `d40571e1-a3d1-4818-84df-a07fe708c2d9`.
- 인증 시험 입구: Secret 설정 후 `7d92b290-be74-4899-83db-44da1b07bfb9`.
- 최초 코드 배포 startup은 각각 66ms다. 요청 CPU와 합산하지 않는다.
- 비인증 요청 401, 비공개 렌더러 공개 주소 404를 확인했다. AI·카카오·운영 DB/KV·예약 호출은 없다.

| 해상도·단계   | 기대 / 확보 이벤트 |  확보한 CPU | 10ms 초과 |
| ------------- | -----------------: | ----------: | --------: |
| 800 글자 준비 |            70 / 45 |      2~13ms |      2/45 |
| 800 PNG 조립  |              5 / 1 | 비교형 11ms |       1/1 |
| 800 인증·수집 |              5 / 5 |      8~22ms |       3/5 |
| 720 글자 준비 |            70 / 43 |      2~13ms |      1/43 |
| 720 PNG 조립  |              5 / 1 |  비교형 9ms |       0/1 |
| 720 인증·수집 |              5 / 5 |      6~27ms |       2/5 |

생성 이벤트 **160개 중 100개**를 확보했고, 사전 비인증 요청 1개는 별도로 제외했다. 미수집 60개는 준비 52개·조립 8개다. 확보한 이벤트는 outcome ok·예외 0이다. **720 비교형 조립 한 번의 9ms를 전체 성공으로 해석할 수 없다.** 모든 수집 이벤트를 확보했으며 그중 5회가 기준을 넘으므로, 누락과 별개로 무료 조건을 충족하지 못했다.

이번 수집기의 JSON 오류·1MB 버퍼 폐기·stderr·sampling 경고 카운터는 모두 0이었다. 이는 수집기 안의 해당 탈락을 배제하는 근거이며 제공사 전달 누락 원인의 증명은 아니다. 종료 시 잔여 버퍼 카운터는 이번 기록에 남지 않아, 종료 직전 직접 기록하도록 도구를 추가 보완했다. 이 보완 뒤 새 원격 시험은 하지 않았다. 공식 문서상 실시간 로그는 sampling으로 누락될 수 있지만 이번 누락이 그 때문이라고 확정하지 않는다. [실시간 로그 한계](https://developers.cloudflare.com/workers/observability/logs/real-time-logs/#limits)

두 시험 Worker를 정확한 이름으로 삭제하고 임시 DPAPI Secret·tail·로컬 서버를 정리했다. Dashboard에 기존 `en-card`, `en-card-delivery`, `worker-royal-haze-2380`만 남았음을 확인했다. 무료 정적 파일·CPU 기준은 [Cloudflare 제한](https://developers.cloudflare.com/workers/platform/limits/)을 확인했다. 정적 구성 검사만으로 무료 운영을 보증하지 않는다.

근거: [요약·누락 경로](evidence/AI_PNG_OPTIMIZED_SUMMARY_2026-10-02.json), [CPU](evidence/AI_PNG_OPTIMIZED_2026-10-02_REMOTE.jsonl), [응답](evidence/AI_PNG_OPTIMIZED_2026-10-02_RESPONSES.json), [원장](evidence/AI_PNG_OPTIMIZED_2026-10-02_ATTEMPTS.jsonl), [수집기 진단](evidence/AI_PNG_OPTIMIZED_2026-10-02_TAIL.json), [로컬 바인딩](evidence/AI_PNG_OPTIMIZED_2026-10-02_WORKER.json).

## 남은 원인과 다음 단계

수집기를 로컬 workerd에서 200회 추가 프로파일링했다. 하위 호출에는 미리 준비한 실제 프레임/PNG를 돌려주는 모의 바인딩을 사용했다. 비유휴 표본 280개에서 native fetch 18.9%, compact body 읽기 15.0%, native read 7.9%, Request 생성 7.5%, 계획 계산 3.9%였다. 함수 self 표본이며 원격 전체 CPU의 정확한 구성 비율은 아니다. [프로파일](evidence/AI_PNG_OPTIMIZED_COLLECTOR_PROFILE_2026-10-02.json)

이 근거에서 다음 대상은 **수집 단계의 반복 요청·스트림 처리 비용**이다. CRC는 수집 경로에 없고 배치 계산만의 비중도 작아, 당초 후속 후보였던 CRC·배치 변경을 무조건 적용하지 않았다. 외부 PNG의 CRC·입력 검증도 유지한다. 추가 후보는 요청 객체 중복 생성 제거와 글자 준비 묶음 크기의 재조정이며, 준비 측 CPU와 호출 수를 함께 측정해야 한다. 단순히 해상도를 더 낮추면 해결된다고 결론 내리지 않는다.

다음 원격 시험 전에는 조립 로그만 선별 수집하거나 제공사의 무료 관측 범위에서 누락 없는 방법을 로컬 준비해야 한다. 과거 로그와 합쳐 전체 CPU 분포·p95·최대치를 계산하지 않는다. 현재 계정의 AI 무료 자격·공유 쿼터, 전체 자동화 경로와 PC 종료 수신은 미검증이다.

## 재현 명령

새 로컬 환경은 기존 전체 글자 자료부터 만든다. 아래 명령은 원격 배포·AI·카카오 호출을 하지 않는다.

```powershell
node scripts/benchmark-automation-png.mjs --atlas-full
node scripts/benchmark-automation-png.mjs --atlas-common
node scripts/benchmark-automation-png.mjs --atlas-optimized-build
node scripts/prepare-automation-optimized.mjs
node scripts/benchmark-automation-png.mjs --atlas-optimized
npx vitest run tests/automation-optimized.test.ts tests/automation-atlas.test.ts tests/automation-probe.test.ts tests/png.test.ts
pwsh -File scripts/check-automation-trial-ledger.ps1
npm run build
npm run check:free
```

실제 로컬 바인딩 검사는 별도 터미널 두 개에서 아래 dev 서버를 실행한 뒤 검사기를 실행한다. 적힌 토큰은 로컬 모의 값이며 배포에 사용하지 않는다.

```powershell
npx wrangler dev --config experiments/automation-png/wrangler.atlas-optimized.jsonc --local --ip 127.0.0.1 --port 8792
npx wrangler dev --config experiments/automation-png/wrangler.atlas-optimized-probe.jsonc --local --ip 127.0.0.1 --port 8793 --var BENCH_TOKEN:local-synthetic-token-not-for-deployment
node scripts/check-automation-optimized.mjs
node experiments/automation-png/research-optimized-collector.mjs
```

`scripts/report-automation-optimized.mjs`는 이번 원격 원장·응답·로그가 남아 있을 때만 요약을 재생성한다. `run-remote.ps1 -Mode atlas_optimized`는 이미 사용한 원장을 보고 재실행을 거부한다. 기록을 지워 새 호출을 허용하지 않는다. 추가 원격 배포는 무료 자격·변경 후보·시험 횟수 범위를 확정한 후 수행한다.
