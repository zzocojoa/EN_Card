# R1·R2 수정 및 검증 보고서

이 문서는 R1·R2 검토 커밋의 검증 기록입니다. 이후 R3·R4와 M5 준비의 현재 결과는 [R3_R4_M5_READINESS.md](R3_R4_M5_READINESS.md)를 참고하세요.

검증일: 2026-09-29 KST. 작업 브랜치: `codex/development`. 시작 HEAD: `ff9c0e2ffc0d3c371fd0e6a6a0b8b4181e11260d`.

첨부 리뷰 원문은 `EN_Card_Review_2026-09-29.md`에 보존했다. 상세 지시 파일 `EN_Card_R1_R2_GOAL_PROMPT.txt`는 Downloads에 없으며 대화의 명시적 목표를 기준으로 작업했다. 원격 배포·live 전환·실제 카카오 발송·원격 DB 변경·요금제 변경·PR 병합은 수행하지 않았다.

## 1. 원인과 변경된 동작

### R1: 결과 불명과 예약 버전의 불일치

기존 재개·수정은 미해결 unknown을 남겨 둔 채 버전을 올릴 수 있었다. 엔진은 이전 버전 unknown 때문에 후속 회차를 막지만 수동 재시도는 유효한 현재 버전만 허용하므로 복구가 막혔다.

- DB 트리거가 미해결 unknown 또는 sending이 있는 예약의 버전 변경·재활성화를 원자적으로 거부한다. 재개 조회에서도 먼저 안내한다. 조회 이후 발송이 시작된 경합까지 DB에서 차단한다. 일시정지·취소와 늦은 발송 결과 기록은 유지한다.
- 서버는 `409 SCHEDULE_UNRESOLVED`와 발송 기록의 결과 확인 안내를 반환한다. 화면은 발송 기록으로 이동한다.
- **재전송하지 않고 종료**는 추가 전송을 포기하는 선택이다. `state=unknown`, 원래 오류·시도 횟수·`delivery_attempts`는 보존하고 `resolution=abandoned` 및 `manual_decisions.action=abandon`으로 별도 기록한다. sent·mock_sent·사용자 수신 확인으로 바꾸지 않는다.
- 이전 버전·일시정지·취소 예약에서도 종료할 수 있으며 예약을 자동 활성화하지 않는다. 명시적으로 종료한 unknown만 차단 대상에서 제외한다. 다른 미해결 unknown의 후속 발송 차단은 유지한다.
- 종료 요청의 조건부 INSERT와 UPDATE를 한 D1 batch로 처리하여 중복 요청 중 하나만 성공하고 감사 이력도 하나만 남긴다. 기존 수신 확인·현재 유효한 예약에서의 명시적 수동 재시도는 유지한다.
- API·공유 타입·화면·회차 집계·이미지 보호가 resolution을 함께 반영한다. 종료된 건은 ‘재전송 없이 종료 (수신 미확인)’로 표시하며 접수·수신 확인·미해결 건수에 포함하지 않는다. 해당 이미지의 다른 예약·미확정 발송 참조는 계속 보호한다.

### R2: 모든 토큰 실패를 인증 거절로 처리

기존 어댑터는 비정상 HTTP 응답을 모두 `TOKEN_REJECTED / 401`로 바꿨고, 인증 함수와 엔진은 일괄적으로 needs_reconnect와 예약 중단을 적용했다.

| 오류 분류                    | 현재 정책                                                                                                                         |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 인증 무효·실제 리프레시 만료 | 재연결 요구. KOE322/invalid_grant 등 확정된 인증 오류와 로컬 만료 판정                                                            |
| 명시적 일시 오류             | HTTP 503 + temporarily_unavailable 또는 HTTP 400·429 + invalid_request/KOE237만 자동 재시도                                       |
| 응답 불명                    | 네트워크 응답 유실, 잘못된 JSON, 불완전한 성공, 그 밖의 5xx, 중단된 갱신 잠금. 회전 여부를 확정할 수 없어 자동 재시도 없이 재연결 |
| 설정 오류                    | invalid_client/KOE010, 요청 구성 오류 등. 사용자 인증 무효로 바꾸지 않고 설정 확인 후 명시적 재시작                               |
| 동시 갱신·인증 변경          | TOKEN_BUSY/TOKEN_CHANGED. 이전 결과로 새 연결을 변경하지 않고 다음 Cron에서 확인                                                  |
| 재시도 소진                  | 인증 무효와 구별. 자동 호출 중단, 연결·토큰·미래 예약 보존. 설정 화면의 **토큰 갱신 다시 시도**로 새 시도 묶음을 명시적으로 시작  |

`credentials`에 시도 횟수·다음 시각·분류·HTTP 상태·제공사 error/code를 저장한다. 최초 포함 3회, 실패 후 1분·2분 간격이다. 갱신 잠금 획득과 횟수 증가가 원자적이며 여러 Cron·카드가 같은 예산을 공유한다. 성공한 갱신·새 OAuth 연결·명시적 재시작에서만 재시도 정보를 초기화한다. 실행마다 초기화하거나 sleep하지 않는다.

일시 오류는 암호화 토큰을 삭제하지 않으며 전체 미래 예약을 중단하지 않는다. 토큰 대기는 메시지 호출·발송 예산을 소비하지 않는다. 발송 15분 허용 시간과 메시지 재시도 상한은 그대로 유지한다. 갱신 소진의 해당 미발송 건은 failed이고 자동으로 되살리지 않는다. 실패·시각 경과 카드는 새 날짜로 예약한다.

버전·잠금 소유권 비교, 늦은 응답 차단, refresh_token 생략 시 기존 값·만료 보존을 유지했다. 토큰·Secret·OAuth 응답 원문 및 error_description은 로그나 운영 응답에 포함하지 않는다.

판단 근거: [카카오 오류 문서](https://developers.kakao.com/docs/ko/kakaologin/trouble-shooting)는 KOE322를 무효·만료, KOE237을 요청 제한, KOE010을 클라이언트 설정 문제로 구분한다. [갱신 문서](https://developers.kakao.com/docs/ko/kakaologin/rest-api#refresh-token)는 refresh_token이 생략될 수 있음을 명시한다. 503/temporarily_unavailable 조합은 이번 요청에 따른 좁은 허용 조건이다. [OAuth RFC의 temporarily_unavailable 설명](https://www.rfc-editor.org/rfc/rfc6749.html#section-4.1.2.1)은 일시적 과부하·점검을 뜻하지만 인가 응답에 관한 설명이며 모든 토큰 5xx의 재시도 안전성을 보장하지 않는다. 실카카오 장애 응답은 미검증이다.

## 2. 변경 파일과 마이그레이션·호환성

| 파일                                                                                             | 책임                                                                                                         |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `src/worker/schedules.ts`, `engine.ts`                                                           | 원자적 예약 보호, 결과 불명 종료, 토큰 오류별 엔진 처리                                                      |
| `src/worker/kakao.ts`, `auth.ts`, `token-errors.ts`, `types.ts`                                  | 오류 분류·메타데이터, 영속 재시도·잠금, 안전한 수동 갱신 재시작                                              |
| `src/worker/index.ts`, `catalog.ts`, `src/shared/model.ts`                                       | action=abandon, resolution·회차 결과, 안전한 연결 상태 조회, `POST /api/connection/retry`                    |
| `src/web/App.tsx`, `api.ts`                                                                      | 종료 선택·감사 이력·집계, 토큰 대기·소진 표시와 명시적 재시작                                                |
| `migrations/0007_unknown_resolution.sql`                                                         | resolution CHECK, manual_decisions의 새 action 및 기존 행 복사, 예약 보호 트리거, 이미지 보호·회차 집계 갱신 |
| `migrations/0008_token_refresh_recovery.sql`                                                     | 기존 인증을 보존하면서 갱신 횟수·시각·오류 메타데이터 열 추가                                                |
| `tests/r1-r2.test.ts`, `token-recovery.test.ts`, `auth.test.ts`, `reaudit.test.ts`, `helpers.ts` | 정상 동작 회귀 테스트, 과거 스키마에서의 업그레이드, 동시 실행·API 보호                                      |
| `tests/e2e/recovery.spec.ts`, `playwright.config.ts`                                             | 격리된 실제 로컬 D1 fixture와 Worker를 사용하는 복구 UI 검증                                                 |
| `AGENTS.md`, `docs/OPERATIONS.md`, `PROGRESS.md`, `SETUP.md`, `VERIFICATION.md`                  | 현재 오류 정책·운영 조치·검증 범위                                                                           |

0001~0006 파일과 적용 이력은 변경하지 않았다. 기존 행은 유지하며 운영 초기화가 필요하지 않다. 새 서버 실행 전에 0007·0008을 모두 적용해야 한다. Worker와 화면을 함께 갱신해야 구버전 화면이 종료한 unknown을 미해결로 표시하지 않는다. 구버전 Worker는 resolution을 모르므로 종료한 건을 다시 차단할 수 있어 단순 코드 롤백은 호환되지 않는다. 백업을 보관하고 전진 수정 또는 별도 DB 복구 절차를 사용한다.

로컬 개발 DB는 Git 제외 경로 `backups/pre-r1-r2-20260929.sql`에 내보낸 뒤 0007·0008을 적용했다. 원격 DB에는 적용하지 않았다. 별도 Miniflare DB에서 0001~0006의 이전 버전 unknown·호출·사용자 판단·암호화 인증·사용량을 넣고 업그레이드하여 값 보존과 foreign_key_check를 확인했다. 이후 이전 unknown 종료 → 유효한 다음 회차 1회 발송도 검사했다.

## 3. 수정 전 실패 / 수정 후 통과 근거

같은 개발 HEAD에서 구현 수정 전에 `npm test -- tests/r1-r2.test.ts`를 실행했다. 정상 동작을 기대하는 초기 3개 모두 실패했다. 보고서의 결함을 기대하는 assert를 복사하지 않았다.

| 초기 회귀 테스트       | 수정 전 관측                        | 수정 후 기대                                                          |
| ---------------------- | ----------------------------------- | --------------------------------------------------------------------- |
| R1 결과 불명 이후 재개 | 거부를 기대했으나 성공 반환         | SCHEDULE_UNRESOLVED, 버전·일시정지 상태 보존                          |
| R1 결과 불명 이후 수정 | 거부를 기대했으나 새 버전 저장 성공 | SCHEDULE_UNRESOLVED, 버전 불변                                        |
| R2 명시적 HTTP 503     | TOKEN_REJECTED, status=401          | TOKEN_TEMPORARY, status/httpStatus=503, transient·연결·미래 예약 유지 |

실패 로그 요약: `Test Files 1 failed (1), Tests 3 failed (3)`. 초기 실행 시각 08:53:50 KST, 2.32초. 최종 전체 검증에는 위 3개가 포함된다.

추가 검증은 이전 버전 복구·취소 보존·동시 종료/동시 Cron·sending 중 수정·조회/저장 사이 경합·이미지 보호 해제·확인/재시도 유지·마이그레이션·CSRF·로그 비밀값 제외를 다룬다. R2는 503→성공→발송, 무발송 예산 불변, 여러 Cron에 걸친 간격·3회 소진·15분 경과, 실제 인증 무효·만료, 불완전 응답·회전 위험, 동시 갱신·새 OAuth 뒤 늦은 성공/오류, refresh_token 생략을 인증 함수와 엔진에서 검사한다.

## 4. 실행한 검증과 결과

최종 결과는 로컬 모의 환경의 검증이며 실제 카카오 수신을 증명하지 않는다.

| 명령                                                                           | 결과                                                                                 |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `npm test -- tests/r1-r2.test.ts tests/token-recovery.test.ts`                 | 커밋 전 재검증: 2개 파일, 32개 통과. 09:34:36 KST 시작, 17.91초                      |
| `npm test`                                                                     | 커밋 전 재검증: 8개 파일, 131개 통과. 09:35:16 KST 시작, 61.75초. 초기 실패 3개 포함 |
| `npm run build`                                                                | strict TypeScript·Vite·Worker 배포 dry-run 통과. 원격 업로드 없음                    |
| `npm run check:free`                                                           | 통과. Workers/D1/KV, 허용 호스트, 기본 dry_run, 로컬/모의 인증의 운영 번들 제외      |
| `npm run test:e2e`                                                             | Chromium 8개 통과, 17.3초. 기존 6개 + 복구 화면 2개, 실제 로컬 Worker와 격리 D1      |
| `npm run db:migrate:local`                                                     | 백업 후 0007·0008 적용 통과. 신규 테스트 DB에는 0001~0008 적용                       |
| `git diff --cached --check -- . ':(exclude)docs/EN_Card_Review_2026-09-29.md'` | 통과. 첨부 원문을 제외한 코드·테스트·문서 변경 검사                                  |

환경 메모: 기본 Wrangler 로그 경로 쓰기에서 EPERM이 발생했다. 빌드 자체는 완료했으며 쓰기 가능한 경로를 지정한 `WRANGLER_LOG_PATH=/private/tmp/en-card-r1-r2-build.log npm run build`와 배포 dry-run 재검증을 수행했다. 로컬 런타임/브라우저 검증은 로컬 서버 실행 권한으로 수행했다. 환경 문제로 남겨 둔 미실시 로컬 검증은 없다.

첨부 리뷰 원문의 3~5행에는 Markdown 줄바꿈용 공백 두 칸이 있어 전체 staged 공백 검사에서 경고한다. 원문 보존을 위해 변경하지 않았으며 Downloads 원본과 바이트 일치를 확인했다.

## 5. 완료·미완료·다음 작업

- 완료 범위: R1·R2 코드·화면·새 스키마·회귀 테스트·운영 문서. 전체 로컬 검사와 요구사항 대조 완료. 상태: DONE.
- 별도 작업: R3의 일시정지 때 현재 회차 미발송 카드 정책, R4의 서버 PNG 구조 검사 강화. 이번 변경으로 수정했다고 주장하지 않는다.
- 실제 환경 미검증: 계정의 Free 플랜·공유 한도·CPU, 실카카오 OAuth/장애 응답/갱신/이미지 표시, PC 종료 후 미래 예약 수신. 모든 카카오 응답은 모의 주입이다.
- 운영 기본 SEND_MODE=dry_run, Workers/D1/KV Free 구성과 의존성 잠금 파일은 유지했다. 유료 경로·외부 상품을 추가하지 않았다.
- 로컬 실행: `npm run dev`. 배포 전 계정 조건·설정을 확인하고 승인된 범위에서 마이그레이션과 dry_run 운영 검증을 진행한다. 원격 배포·발송은 이번 작업의 완료 조건이 아니다.
