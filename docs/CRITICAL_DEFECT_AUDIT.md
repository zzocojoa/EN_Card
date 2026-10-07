# EN_Card 중대 결함 조사 결과

조사일: 2026-10-07 / 기준: `master@33774a06b57e4d6b2f81ddf5a5f28eb6a3b40f81`

작업 브랜치: `codex/critical-defect-audit`. [조사·개선 계획](CRITICAL_DEFECT_IMPROVEMENT_PLAN.md)에 따른 조사·수정·로컬 검증 기록이다. 최종 리뷰 결론과 검토 소스 커밋은 이 브랜치의 PR 본문에 기록한다. 운영 반영 완료 기록이 아니다.

## 범위와 판정

EN_Card의 예약·발송, 인증, AI 자동 제작, 저장, 복구·시간, 한도 경로를 조사했다. 하루단어는 카드 인증·프록시·AI 릴레이 연결만 읽고 로컬 통합 테스트를 실행했다. 하루단어의 진행 중 브랜치와 PR #33을 수정하지 않았다.

- **결함 확인·수정 완료**: 수정 전 실제 SQL을 사용하는 격리 테스트에서 계약 위반을 재현하고 수정 후 같은 테스트가 통과한 항목.
- **조사 범위에서 미발견**: 아래 소스와 시나리오에서 추가 P0/P1 근거를 발견하지 못했다는 뜻이다. 시스템 전체의 무결함 보증이 아니다.
- **미검증**: 운영 환경의 현재 상태, 새 소스의 원격 CPU, 실제 수신 등 이번 로컬 조사의 증거가 없는 항목.

## C-01 — 연결 해제 이전 요청이 재연결 후 발송 권한을 되살림

**P1 / 재현 확인 / 코드 수정 및 핵심 회귀 통과.** 영향 경로는 새 수동 예약, 예약 수정, 일시정지 예약 재개, 미발송 카드 복구다.

기존 구현은 요청 초기에 `credentials.status='connected'`만 읽고, 이후 이미지 조회·검증을 마친 뒤 예약을 썼다. 그 사이 연결 해제가 완료돼도 실제 쓰기 SQL에는 연결 검사가 없었다. 오래된 요청이 활성 예약을 만들거나 되살린 뒤 다시 연결하면 사용자가 새로 재개하지 않은 카드가 발송될 수 있었다. 일반 예약 버전 검사만으로는 연결 해제를 구분하지 못했다.

재현 순서:

1. 메모리 Miniflare D1/KV에 합성 연결 정보와 검토된 카드를 준비한다.
2. 해당 요청의 최초 연결 조회를 통과시킨다.
3. 첫 원자적 `DB.batch` 실행 직전에 실제 `disconnect()`를 실행한다. 별도 경우에는 바로 재연결도 한다.
4. 원래 요청을 계속 처리하고 재연결 후 `runEngine()`을 실행한다.
5. 수정 전에는 네 경로 × 두 순서 모두 모의 sender가 1회 호출됐다. 수정 후에는 요청 거절, 활성 예약 0, 복구 예약 결정 0, 발송 시도 0이다.

수정 내용:

- [`src/worker/connection.ts`](../src/worker/connection.ts): 연결 상태와 버전을 읽는 공통 함수 및 매개변수 SQL 조건.
- [`src/worker/schedules.ts`](../src/worker/schedules.ts): 생성·수정 및 재개의 두 분기에서 **첫 쓰기 시점**에 연결 상태와 동일 버전을 확인한다.
- [`src/worker/pause-recovery.ts`](../src/worker/pause-recovery.ts): 새 복구 예약을 만들기 전에 같은 검사를 적용한다. 제외만 하는 처리는 연결 없이도 가능하다.
- [`tests/connection-mutation-race.test.ts`](../tests/connection-mutation-race.test.ts): 정상 요청, 연결 해제/재연결 경합, 토큰 갱신, 미발송 재개, 연결 없는 제외를 검증한다.

후속 SQL은 원래부터 새 `mutation_id`가 설정된 행만 변경한다. 따라서 첫 쓰기가 연결 변경으로 거절되면 예약 카드·복구 결정·취소 처리도 함께 보류된다. 새 테이블·마이그레이션·외부 API·자동 재시도를 추가하지 않았다. [D1 공식 batch 문서](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)의 순차 실행·롤백 계약과 [prepared statement 바인딩](https://developers.cloudflare.com/d1/worker-api/prepared-statements/)을 확인했다.

정상 토큰 갱신도 연결 버전을 올리므로 겹친 요청은 기존 409 충돌로 거절될 수 있다. 사용자가 새 상태를 읽고 다시 요청하면 저장된다. 오류를 숨겨 자동 재시도하면 연결 해제 의도를 무효화할 수 있어 자동 재시도는 넣지 않았다. `SEND_MODE`가 live가 아닌 격리 개발 환경의 기존 동작도 보존한다.

## 영역별 조사 근거

| 영역 | 읽은 핵심 소스·계약 | 회귀 근거 | 현재 판정 |
| --- | --- | --- | --- |
| 예약·발송 | `worker/engine.ts`, `delivery-service.ts`, `schedules.ts`; 회차 UNIQUE, 조건부 claim, 내구 sending, 호출 직전 취소/버전/연결, unknown 재발송 차단 | `engine`, `delivery-service`, `schedules`, `pause-race`, `r1-r2`, `cancellation-provenance` 테스트 | C-01 수정. 나머지 조사 범위에서 추가 P0/P1 미발견 |
| 인증·접근 제어 | `auth.ts`, `crypto.ts`, `studio-bridge.ts`, `durable-token.ts`, `automation/credentials.ts`; 고정 소유자, 브라우저에 묶인 1회 OAuth state, 세션/Origin/CSRF, 암호화, 갱신 잠금·버전 | `auth`, `credential-storage`, `studio-bridge`, `token-recovery`, `token-rpc-guards`, `token-rpc-runtime` 테스트 | C-01의 연결 경계 보완. 나머지 조사 범위에서 추가 P0/P1 미발견 |
| AI 제작·검토·수량 | `automation/engine.ts`, `providers.ts`, `types.ts`, `run-queue.ts`, 마이그레이션 0014~0021; 반대 제공자, 내용/검토 해시, 수정·새 후보·중복 상한, 마감·현재 설정·lease 조건 | `automation-product`, `quantity`, `trial-quantity`, `duplicate-retry`, `quality-retry`, `quality-replacement`, `revise-fallback` 테스트 | 조사 범위에서 추가 P0/P1 미발견. 정상 품질 탈락·55분 마감으로 5장 미달은 정책상 가능한 결과 |
| 데이터·이미지 | `storage.ts`, `png.ts`, DB 자산 보호/용량 트리거; 용량 예약→KV→ready, 부분 실패 보상, 고정 payload, 미확정 참조 삭제 차단 | `storage`, `png`, `pause-recovery`, `automation-product`, `quality-replacement`의 이력/마이그레이션 검사 | 조사 범위에서 추가 P0/P1 미발견 |
| 중단·재개·시간 | `pause-recovery.ts`, `shared/time.ts`, `automation/settings.ts`, `trial.ts`, `run-queue.ts`; KST/UTC, 종료일, 사용자 버전, daily/trial 분리, 만료 lease와 늦은 결과 | `core`, `pause-recovery`, `pause-race`, `token-recovery`, `automation-product`, `automation-trial-quantity` 테스트 | C-01 수정. 나머지 조사 범위에서 추가 P0/P1 미발견 |
| 한도·운영 구성 | `engine.ts`의 시도 예약 및 트리거, `storage.ts`, AI 총 호출 예약, `wrangler*.jsonc`, `scripts/check-free.mjs`; DB 원자적 예산과 비공개 서비스, 개발 모드 격리 | `engine`, `storage`, `free-config`, 자동화 예산/설정 테스트 및 `check:free` | 구성 변경 없음. 코드 조사에서 추가 P0/P1 미발견. 현재 계정 Free 여부·실제 배포 바인딩은 재확인하지 않음 |

표의 테스트 명칭은 `tests/*.test.ts` 또는 `.test.mjs`에 대응한다. 전체 실행 결과는 아래 검증 표로 판정하며, 테스트가 존재한다는 사실만으로 통과로 세지 않는다.

하루단어의 `app/api/card-studio/[...path]/route.ts` → `lib/server/card-studio.ts`는 소유자·허용 경로·Origin·본문 크기를 확인하고 브라우저의 Bearer/Cookie/소유자 헤더를 서버 값으로 대체한다. `app/api/card-automation/route.ts` → 내보낸 릴레이는 서명·시간·nonce·본문과 제공자 고정값을 검사한다. 생성 원본은 EN_Card `automation/relay-server.ts`이다. 이 PR은 Worker 서버 파일만 바꾸므로 화면/릴레이 exporter 출력 변경이 필요하지 않다.

하루단어 `getChatGPTUser()`는 배포 플랫폼이 제공하는 인증 헤더를 신뢰한다. 플랫폼 앞단의 헤더 정제·직접 원본 접근 차단은 이번 로컬 테스트로 증명하지 않았다. 로컬 프록시 소유자 검사 통과를 운영 플랫폼 전체 인증 검증으로 확대하지 않는다.

화면에서는 `HistoryPage.tsx`의 API 접수/사용자 확인/결과 불명/모의 발송 표시와 `AutomationPanel.tsx`의 제작·검토·발송 상태를 확인했다. 새 화면 변경이나 운영 브라우저 테스트는 없다.

## 검증 기록

| 검사 | 결과 | 범위·근거 |
| --- | --- | --- |
| 수정 전 기본 로직 | 48개 통과 | `core.test.ts`; 별도 전체 baseline은 완료 전에 중단했으므로 전체 통과로 세지 않음 |
| C-01 수정 전 | 정상 4개 통과 / 경합 8개 실패 | 합성 sender 실제 1회 호출로 피해 경로 재현 |
| 수정 후 관련 회귀 | 58개 통과 | 연결 경합 초기 12개 + schedules/pause-recovery |
| 추가 경계 회귀 | 15개 통과 | 토큰 갱신 뒤 명시적 새 요청, 미발송 재개 중 재연결 필요 상태 재발, 연결 없는 제외 포함. 초기 제외 fixture의 필수 nullable 필드 누락은 테스트 입력 오류로 구분 |
| 하루단어 연결 | 19개 통과 | 인증·프록시·서명 릴레이. 실제 AI/카카오 호출 없음 |
| 전체 `npm test -- --reporter=verbose` | 49개 파일·738개 통과 | 최종 연결 경계 회귀 15개 포함. 2026-10-07 13:37~14:15 KST, exit 0 |
| `npm run typecheck` | 통과 | 최종 테스트 보완 후 재확인 |
| `npm run build` | 통과 | 타입 검사·웹 및 주/발송/자동화 Worker dry-run. 실제 배포 없음 |
| `npm run check:free` | 통과 | 기본 dry_run 구성 검사. 실제 계정 플랜·과금·운영 CPU는 미검증 |
| 변경 코드 형식·패치 | 통과 | 4개 코드/테스트 파일 Prettier 및 `git diff --check` |
| 변경 리뷰 | 첫 native 적대적 검토 지적 0 | 최종 후보의 부모 체크리스트·native 검토 결과와 소스 커밋은 PR 본문에서 추적 |

review QA의 최종 근거 판정은 `pass`, 열린 계약은 0이다. 초기 12개 smoke는 이력으로 보존하고 같은 명령의 최종 15개 재실행으로 대체했다. 전체 테스트·빌드·무료 구성 검사는 별도 근거이며 통과 수를 서로 합산하지 않는다. 테스트 완료 후 변경된 제품 소스 3개와 회귀 파일 1개의 SHA256이 실행 전 기록과 일치함을 확인했다. 이후 문서 편집은 이 제품 검증 입력을 바꾸지 않는다.

## 별도 추적 — 개발 도구 의존성 경고

2026-10-07 `npm audit --json`은 high 5개 패키지(직접/전이 영향 포함), critical 0을 반환했다. `npm audit --omit=dev --json`은 0개다. 이 두 결과만으로 배포 번들의 안전성을 판정하지 않으며, 개발 의존성에 들어 있는 실제 Worker 런타임 라이브러리도 빌드에 포함될 수 있음을 구분한다.

| 잠금 파일의 경로 | 확인된 경고·패치 | 이번 처리 |
| --- | --- | --- |
| Vite → PostCSS → `source-map-js@1.2.1` | [indexed source map 처리 중 서비스 거부](https://github.com/advisories/GHSA-68fv-2mgg-jv7q); 패치 1.2.2 | 개발 빌드 경고로 별도 기록. 운영 카드 입력으로 해당 파서에 도달하는 경로는 확인하지 못함 |
| Wrangler/Miniflare → `sharp@0.35.4` | [librsvg 의존성 경고](https://github.com/advisories/GHSA-wq5f-xc86-pv6w); 패치 0.35.5 | 개발 이미지 도구 의존성. 제품 PNG는 resvg/자체 렌더 경로를 사용하며 이 취약점의 제품 영향은 재현하지 않음 |
| Wrangler/Miniflare → `undici@7.29.0` | [BalancedPool TLS 옵션](https://github.com/advisories/GHSA-w293-vg96-wgc3), [WebSocket subprotocol](https://github.com/advisories/GHSA-rfgv-xxqx-mfg5) 등; 패치 7.29.1 | 패키지 경고를 보존. 특정 취약 API의 운영 도달·피해를 입증한 P0/P1로 분류하지 않음 |

해결 완료로 표시하지 않는다. 별도 개발 도구 업데이트에서 패치 버전과 Wrangler/Miniflare 호환성을 검증해야 한다. audit이 제안한 구형 major 버전으로의 강제 하향은 적용하지 않았고 이번 잠금 파일·의존성은 유지했다. 이 목록은 C-01의 재현 가능한 운영 경합과 구별한다.

이번 최종 빌드의 주/발송/자동화 Worker source map(각 116/104/266개 source)에서 `sharp`, `undici`, `source-map-js`, `miniflare`, `wrangler` 패키지 경로가 0개임을 확인했다. 이는 해당 빌드의 패키지 포함 여부에 관한 근거이며, 개발 도구 경고의 해소나 모든 운영 취약점의 부재를 의미하지 않는다.

실행 로그·원본 증거는 Git 제외 `backups/critical-defect-audit-20261007/`에 보존한다. 수정 전 영향은 `connection-red-impact.log`, 초기 관련 통과는 `connection-green.log`, 최종 경계 회귀는 `connection-edges-final.log`, review QA는 `review-qa/`에 있다. 초기 테스트 하네스 실패나 중단된 baseline은 제품 결함/통과 근거에 포함하지 않는다.

재실행 명령:

```powershell
node node_modules/vitest/vitest.mjs run tests/connection-mutation-race.test.ts tests/schedules.test.ts tests/pause-recovery.test.ts --reporter=verbose
npm test -- --reporter=verbose
npm run typecheck
npm run build
npm run check:free
# 하루단어 저장소에서, 카드 연결 부분만 검사
node --test tests/card-studio.test.mjs tests/card-automation.test.mjs
```

## 검증 한계와 후속 운영 단계

- 실제 추가 AI 호출·카카오 발송·Cloudflare 배포·운영 DB/설정/Secret 변경은 수행하지 않았다. 이번 새 소스의 실제 수신과 CPU는 미검증이다.
- 이전 날짜 표시 시험의 CPU(주 5.967ms, 발송 4.697ms, DO 590.185ms) 및 관측 한계는 이전 소스의 근거다. 새 SQL 조건의 운영 CPU 적합성으로 재사용하지 않는다.
- 추후 배포를 승인받으면 계정 Free 상태·활성 버전과 바인딩/Cron·진행 중/unknown·백업을 확인하고, 변경된 예약 저장/재개/복구 요청의 일반 Worker CPU를 계측해야 한다. 10ms 이하 여부와 관측 누락을 함께 기록한다. 이미지 생성 DO는 별도 기준이며 이번 이미지 경로는 바뀌지 않았다.
- `cso` 스킬은 설치된 경로에 필수 launcher가 없어 **not assessed**다. 이 보고서는 수동 소스 조사와 로컬 검증이며 전용 보안 스캐너 통과 보고서가 아니다.
- `review`의 외부 Claude Code CLI는 설치되지 않아 별도 모델 검토는 미실시다. native 적대적 검토는 같은 모델의 별도 문맥이다. fixtures는 해당 검토에서 요약만 읽었으며 부모는 실제 테스트 소스를 읽고 실행했다.
- 현재 범위에서 확인된 결함 외에 조사를 근거로 운영 전체 무결함, 정확히 한 번 도착, 무료 한도 영구 충족을 보장하지 않는다.

## 산출물과 완료 판정

- [x] 기준 브랜치 확인 후 별도 브랜치 생성 및 계획 저장
- [x] 6개 조사 영역과 하루단어 카드 연결 범위의 소스 점검
- [x] 확인된 P1의 수정 전 피해 재현 및 최소 코드 수정
- [x] 최종 회귀·타입·빌드·무료 구성 검사 완료
- [x] 조사 결과와 진행/검증 문서에 근거 및 미검증 항목 기록

최종 review와 PR 생성은 GitHub의 `codex/critical-defect-audit` PR 본문·소스 커밋·원격 head로 확인한다. 리뷰 근거 원본은 Git 제외 `backups/critical-defect-audit-20261007/review-qa/review-report.md`와 해당 체크포인트에 보존한다. Git 제외 파일은 원격 독자에게 제공되는 근거가 아니므로 PR 본문에도 검증 명령·결과·검토 한계를 명시한다.

PR·배포·병합은 구별한다. 이 작업의 완료점은 수정·검증·리뷰·PR이며 운영 배포와 병합은 포함하지 않는다.
