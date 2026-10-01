# 검증 근거

최종 검증: 2026-10-01 (KST). 최신 R8 전체 실행과 운영 확인은 문서 끝에 있습니다. 아래 첫 표와 macOS 환경은 9월 29일의 과거 실행 기록입니다.

검증 환경: macOS arm64, Node.js 24.6.0, npm 11.5.1, Wrangler 4.142.0, Playwright 1.63.0. 라이브러리의 정확한 버전은 package-lock.json을 기준으로 합니다.

| 명령                                                                                                                             | 상태                  | 증명하는 범위                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                                                                                              | 통과                  | strict TypeScript, 프런트엔드·Worker·테스트 타입                                                                       |
| `npm run build`                                                                                                                  | 통과                  | Vite 정적 산출물, Worker dry-run 번들. 원격 배포 아님                                                                  |
| `npm run check:free` 및 `npm run check:free -- --config wrangler.live.jsonc --mode live`                                         | 모두 통과             | 기본 dry_run·명시적 live에 같은 허용 목록, 구성 경로·SHA 출력. live는 placeholder 임시 파일로 로컬 번들만 검사 후 제거 |
| `npm test -- tests/r3-r4.test.ts tests/pause-recovery.test.ts tests/png.test.ts tests/free-config.test.ts tests/storage.test.ts` | 62개 통과, 5개 파일   | R3·R4·live 구성 검사와 저장량 회귀                                                                                     |
| `npm test`                                                                                                                       | 177개 통과, 12개 파일 | 순수 로직과 실제 Miniflare D1/KV를 사용하는 통합 검증                                                                  |
| `npm run test:e2e`                                                                                                               | Chromium 10개 통과    | 실제 로컬 Worker, 데스크톱·390px 모바일, 실제 PNG·미발송 복구/제외·결과 불명 종료·토큰 복구 UI                         |
| `npm run db:migrate:local`                                                                                                       | 9개 마이그레이션 적용 | 개발 DB 백업 후 0009 적용, 독립 E2E·테스트 DB에 전체 스키마 적용                                                       |

## 테스트가 다루는 위험

- KST 00:05 전날 UTC, 월말·윤년 오류, 매일·요일 반복과 종료일.
- 동시 Cron, UNIQUE 회차, 한 번의 목록 소비, claim 경합과 만료 복구.
- 발송 준비 후 취소, 예약 동시 수정의 패자 차단, 이전 버전 미발송 취소. 편집 화면을 연 뒤 또는 저장 요청 처리 중 Cron이 카드를 소비하면 오래된 수정 요청을 거부하고, 최신 남은 목록으로 저장하면 각 카드가 한 번씩 발송됩니다.
- 일시정지 미발송 2장 새 예약/명시적 제외 + 기존 5장 재개, 접수 3장 재전송 없음, 중복 선택·동시 Cron·조회 후 sending 경합, 15분 경과, 역사적 접수/unknown·수신 확인·종료 제외, 고정 PNG 부재·원문 수정·취소 상태 보존.
- 일부 성공 뒤 unknown 대기, 성공 응답 뒤 DB 실패와 재시작, 15분 경과 missed.
- 미해결 unknown·sending 중 예약 재개/수정의 원자적 거부, 기존 수신 확인·명시적 재시도 유지. 이전 버전·취소 예약에서도 재전송 없이 종료하며 원래 결과·호출 기록·취소 상태를 보존합니다. 중복 종료와 동시 Cron, 회차 집계·이미지 참조 보호를 검사합니다.
- 명시적 거절 최대 3회, 401 최대 1회 추가 시도, 분당·일일 시도 상한.
- 최초 등록 토큰, 소유자 외 거부, OAuth 브라우저 바인딩·만료·재사용, 세션·CSRF·Origin.
- 로그아웃 후 예약·카카오 연결 유지, 재연결 후 현재 회차와 반복 일정 재개.
- 토큰 인증 암호화, 리프레시 누락 보존·회전·갱신 직렬화·재연결·연결 해제 경합. 이전 갱신의 거절·응답 유실·만료 판정이 새 OAuth 연결이나 새 갱신 잠금을 변경하지 않으며 다음 Cron에서 새 토큰을 사용합니다.
- 명시적 503 일시 오류 후 연결·미래 예약 유지, 영속 재시도 간격·3회 상한, 복구 뒤 발송, 대기 중 메시지 예산 불변. 인증 무효·실제 만료·응답 불명·설정 오류·동시 충돌을 구분하고 비밀값을 로그에서 제외합니다. 소진 후 명시적 재시작 API와 화면도 검증합니다.
- 동시 업로드 횟수/저장량 원자성, KV 실패 후 용량 보존·정리, 참조 이미지 보호, 공개 PNG 경로. 정리 후 늦은 업로드, 삭제 응답 유실·보상 삭제 실패, 삭제 소유권 경합, 반환한 용량의 재사용에도 재계상하고 신규 업로드 상한을 유지합니다.
- 재연결 대기 중 미래 이미지 삭제 보호, 원문 수정 후에도 고정한 이미지 버전 재개, 수동 재시도 시 원래 예정 시각 보존.
- 카드 편집→실제 1080×1080 PNG→저장·검토→예약→dry_run 기록 및 커서 불변. 저장·복원 응답을 지연시킨 상태에서 다른 카드로 편집 대상이 바뀌지 않으며 기존 카드 내용이 보존됩니다.
- 비교형 이미지, 한글 폰트, 긴 문장 초과 시 저장 차단, JSON 부분 오류, 모바일 가로 넘침 방지, PNG 백업 복원.

PNG 단위·통합 테스트는 실제 압축 해제가 가능한 4,613바이트 PNG를 사용합니다. 33바이트 헤더는 거부 테스트에만 남겼습니다. 청크 경계·순서·IHDR·IDAT/IEND·CRC·1MiB 상한과 오류 업로드의 KV/쿼터 불변을 확인합니다. 실제 PNG 생성·다운로드·복원은 Chromium E2E가 담당합니다. 카카오 응답은 주입된 HTTP 응답이며 실제 수신을 증명하지 않습니다. 테스트 결과 이미지는 로컬 `test-results/editor-desktop.png`, `test-results/editor-mobile.png`에 생성되며 Git에는 넣지 않습니다.

## 요구사항별 현재 근거

프로젝트 지침과 모든 src/worker·src/shared·src/web 파일, 마이그레이션·실행 설정·운영 문서를 대조했습니다. 테스트는 기존 성공 경로와 아래 실패·경합 경로를 함께 실행합니다. 이 표의 통과 범위는 로컬이며 원격 서비스의 실제 동작을 대신하지 않습니다.

| 요구사항                   | 실제 구현 경로                                     | 검증 근거                                                                                                                                                                                      |
| -------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0 전체 연결·운영 진입점   | index.ts, local.ts, wrangler.jsonc                 | 운영 구성 오류 거부, production scheduled의 dry_run 비소비, 브라우저 입력→PNG→KV→예약→기록                                                                                                     |
| 두 템플릿·폰트·줄바꿈      | web/canvas.ts, public/fonts, App.tsx               | 실제 1080×1080 PNG, 비교형·500자 긴 문장 차단, 390px 모바일, 미리보기·다운로드·저장 PNG 바이트 일치                                                                                            |
| 가져오기·백업·복원         | shared/model.ts, index.ts, catalog.ts              | 중복 ID·부분 오류·빈 백업·100개 파일 원자성, 205개 JSON 분할 백업/복원, 복원 PNG 다운로드 바이트 일치                                                                                          |
| 이미지 보관·정리·공개 범위 | storage.ts, assets 트리거                          | 1MiB 초과·잘못된 PNG 거부, 동시 횟수·용량 예약, KV 실패, KV 성공 후 D1 확정 실패, 삭제 응답 유실 후 단일 용량 반환, 참조 이미지 보호                                                           |
| 운영자·세션·CSRF           | auth.ts, crypto.ts, index.ts                       | 최초 등록 토큰, 소유자 외 로그인, state 브라우저 바인딩·만료·재사용, 세션 없는 API, CSRF·Origin, 로그아웃/연결 해제 구분, 세션 만료 후 화면 재로그인                                           |
| 인증 갱신과 경합           | auth.ts, engine.ts, kakao.ts                       | refresh 누락 보존·회전·직렬화, 연결 해제 중 갱신, 이전 인증의 늦은 401/권한 오류가 새 연결을 변경하지 않음, 권한 철회 시 미래 예약 중지                                                        |
| KST·반복·예약 변경         | shared/time.ts, schedules.ts                       | 자정 UTC·월말·윤년·요일·종료일, 잘못된 날짜 400, 준비 목록 소진, 재개/수정 경합, 소비 이미지 삭제 후 재개, 원문 편집 후 고정 이미지 유지                                                       |
| 발송·복구·중복 방지        | engine.ts, pause-recovery.ts, migrations/0001~0009 | 동시 Cron/claim, 예산 확보 후 연결 해제, 호출 전 claim/허용 시간 만료, sending 중단, 성공 후 DB 실패, 부분 성공, 취소 후 늦은 인증 오류·연결 해제에서도 취소 보존, unknown 수동 처리 경합·기록 |
| 카카오 어댑터              | kakao.ts, mock.ts                                  | native fetch 계약·form payload·result_code=0, 401/429/5xx/응답 유실 분류, 읽기 전용 사용자 조회의 제한된 재시도. HTTP 응답은 모의 주입                                                         |
| 무료 구성·처리량           | check-free.mjs, DB 제약, engine.ts                 | 허용 의존성/바인딩/외부 호스트·dry_run, 운영 번들의 로컬/모의 인증 제외, 활성 10·분당 3·일일 20, 실제 인증 함수+2회차/3장 경로의 호출당 50쿼리 이내                                            |
| 운영 화면·기록 접근        | catalog.ts, pagination.ts, App.tsx                 | 카드 205개·이미지/예약/발송 105개 연속 조회, 개별 발송의 전체 시도/사용자 확인 기록, 수동 수신 확인을 API 접수 집계와 구분                                                                     |
| M5 준비 산출물             | README, SETUP, OPERATIONS, .dev.vars.example       | 로컬 명령, Free 계정 확인 조건, 바인딩·Secrets·카카오 설정·마이그레이션·dry_run→live 절차, 백업/장애 복구 안내                                                                                 |

이번 수정에서 변경 테스트 62개가 10:40:13 KST 시작, 34.82초에 통과했습니다. 이후 전체 Vitest 12개 파일의 **177개**가 10:41:35 KST 시작, 91.16초에 통과했습니다. 이전 131개 결과를 현재 결과로 재사용하지 않았습니다. E2E는 최종 UI에서 Chromium **10개**, 23.6초에 통과했습니다. R3 복구·제외 후 기존 5장 재개, 취소 후 기록 접근, 실제 Canvas PNG 업로드를 포함하며 R1·R2 UI 2개도 유지했습니다. typecheck·build·기본/명시적 live 구성 검사도 통과했습니다. 모든 메시지 호출은 모의 응답이고 실제 카카오 수신은 미실시입니다.

R3·R4 정상 기대 테스트 2개는 구현 수정 전 실패하고 수정 후 통과했습니다. 초기 오류와 해결한 테스트 준비 문제, 로컬 PNG 구조·CRC 측정, 설정 SHA와 증거 로그는 [R3_R4_M5_READINESS.md](R3_R4_M5_READINESS.md)에 있습니다. 외부 검토에서 보고된 `uv_interface_addresses ... error 1`은 이 실행 환경에서 재현되지 않았습니다. 격리 DB·8787 포트·Chromium으로 실제 실행했으며 skip·assertion 약화를 사용하지 않았습니다.

개발 DB는 Git 제외 경로 `backups/pre-r3-r4-20260929.sql`에 내보낸 뒤 0009를 적용했습니다. 적용 이력 8→9, 카드·이미지·예약·저장량은 모두 0으로 유지했고 `PRAGMA foreign_key_check`는 빈 결과입니다. populated 업그레이드는 별도 Miniflare DB의 0001~0008에 접수 3장·취소 2장·남은 5장·사용량을 준비한 뒤 0009를 적용하여 원본 delivery·사용량·외래키를 보존하고 2장 복구를 확인했습니다. 신규 통합·E2E DB에는 전체 0001~0009를 적용했습니다. R1·R2 및 0006의 기존 데이터 업그레이드 테스트도 전체 실행에 포함했습니다. 기존 0001~0008과 잠금 파일, 기본 wrangler.jsonc는 변경하지 않았습니다.

쿼리 수 테스트는 지정된 대표 발송 경로를 검사합니다. 실제 계정의 행 읽기/쓰기 사용량과 CPU 10ms 충족 여부는 원격 측정 대상입니다. 2026-09-29에 Workers·D1·KV 요금, D1 제한, Cron, 카카오 인증·메시지 공식 문서를 재확인했으며 출처는 SETUP.md에 연결했습니다.

## 2026-09-29 원격 미실시 기록

- 실제 Cloudflare 계정 Free 플랜, 공유 사용량과 리소스 한도.
- Workers Free 호출당 실제 CPU 10ms 충족, 원격 장애·부하에서의 동작.
- 실제 카카오 앱 등록·동의·OAuth 로그인·토큰 갱신·메시지 접수.
- 카카오 서버의 이미지 URL 접근, KV 전파, 휴대전화 이미지 표시·원본 링크.
- PC·브라우저·Codex 종료 후 미래 예약 수신. 확인 주체와 기기·예정/수신 시각 기록 필요.

위 항목은 M0 원격 검증 및 M5 운영 검증으로 남습니다. 원격 리소스 생성·배포·실제 발송은 수행하지 않았습니다.

이 문단은 당시 상태이며 2026-09-30 후속 원격 결과는 아래 최신 기록을 따른다.

## Windows symlink EPERM 수정 — 2026-09-30 중간 결과

환경: DESKTOP-SS5CURC, Windows, Node 22.22.2, npm 10.9.7. 기준 HEAD: 55d63986afc3c06fb199f67a25715c6847da610b. 로컬 미커밋 수정이며 push·merge·배포·실제 발송은 수행하지 않았다.

원인은 테스트 beforeEach의 디렉터리 symlink 생성에 필요한 Windows 권한 부재였다. Windows에서는 Node의 junction 타입을 사용하고 다른 플랫폼에서는 dir 타입을 지정한다. 같은 설치된 node_modules를 가리키는지 realpath assertion을 모든 fixture 준비에 추가했다. symlink는 격리된 검사 프로세스에 의존성을 제공하기 위한 수단이며 검사 대상이 아니다. 기존 정상·오설정·유료 바인딩 거부 assertion을 삭제하거나 완화하지 않았다. Node API 근거: https://nodejs.org/docs/latest-v22.x/api/fs.html#fspromisessymlinktarget-path-type

- npm test -- tests/free-config.test.ts --reporter=verbose: 8개 모두 통과, 1.69초.
- npm test -- --reporter=verbose: 로그에 116개 통과, 실패 기록 없음. 실행 서버 연결 단절 뒤 로그가 2026-09-30T05:22:53Z에서 멈췄으며 05:24:29Z에 Vitest 프로세스 0개와 최종 요약 부재를 확인했다. 전체 통과로 보고하지 않는다. 중복 재실행하지 않았으며 전체 재검증은 대기 중이다.
- 최종 수정 후 타입·빌드·무료 구성 검사와 필요한 E2E는 아직 미실시다. 앞선 checkout 검증 결과로 대체하지 않는다.
- 근거 로그: C:/Users/user/Documents/Codex/2026-09-30/task/en-card-windows-focused.log 및 en-card-windows-all-final.log. 후자는 연결로 중단된 부분 기록이다.

OS 설정·관리자 권한·보안 정책·lockfile·제품 코드·마이그레이션은 변경하지 않았다. 45장 복구 결함과 원격 검증 미실시 항목은 유지한다.

### 최종 Windows 재검증 완료

최종 실행 ID: 20260930T053655Z. 종료 시각: 2026-09-30T05:44:53.5363590Z. 앞의 중간 기록 이후 같은 테스트 수정으로 재검증했으며, 다음 결과가 현재 완료 상태다.

| 명령                           | 최종 결과                                           | 종료코드 |
| ------------------------------ | --------------------------------------------------- | -------- |
| npm test -- --reporter=verbose | 12개 파일, 177개 모두 통과; Vitest 430.25초         | 0        |
| npm run build                  | strict TypeScript·Vite·Worker deploy --dry-run 통과 | 0        |
| npm run check:free             | 기본 dry_run 무료 구성·운영 번들 검사 통과          | 0        |
| npm run test:e2e               | Chromium 10개 통과, Playwright 40.4초               | 0        |

전체 테스트의 8개 무료 구성 검사는 junction 대상 realpath 일치와 기존 dry_run/live·유료 바인딩·외부 서비스·기본 모드 보호를 그대로 확인했다. 단계별 실행 시간과 종료코드는 C:/Users/user/Documents/Codex/2026-09-30/task/en-card-windows-validation-status.json에, 출력은 기존 en-card-windows-all-final.log의 VALIDATION_RUN_BEGIN 20260930T053655Z 이후에 기록했다. 앞의 116개 부분 결과 및 로그 기록 명령의 초기 오류는 이전 실행 기록으로 구분한다.

이번 결과는 로컬 Miniflare DB/KV·모의 HTTP와 로컬 Chromium에 대한 것이다. 실제 Free 계정·원격 CPU·OAuth·카카오 수신은 여전히 미검증이며, 45장 복구 결함은 수정하지 않았다. 제품 소스·lockfile·OS 설정은 그대로 유지했다. 커밋·push·merge·원격 리소스 변경·배포·발송은 수행하지 않았다.

## 최신 원격 시험 배포 — 2026-09-30

환경: Windows·Node 22.22.2·잠금 파일의 Wrangler 4.142.0, 기준 HEAD 222d750. 사용자는 Cloudflare 직접 진행과 카카오 연결을 허용했고, Wrangler와 카카오의 실제 동의는 본인이 완료했다. 이 기록은 위의 로컬 검증 및 당시 원격 미실시 기록 이후의 결과다.

### 계정·DB·배포

- Dashboard의 현재 Workers Free·US$0와 실제 Wrangler 로그인 계정의 일치를 확인했다. D1 `en-card`와 KV `CARD_IMAGES`를 새로 만들었다. 기존 Worker와 다른 카카오 앱, 구독·결제는 변경하지 않았다. 계정 전체 공유 사용량과 CPU는 미측정이다.
- 처음 비어 있는 원격 D1을 `backups/pre-first-deploy-20260930.sql`에 export했다. 0001~0005 적용 뒤 0006이 incomplete input으로 실패했다. 실패 후 적용 이력 5개, 기존 assets_quota 존재, 새 cleanup_owner·usage_counters_next 없음, 사용자 핵심 테이블 0행을 확인했다. LF로 정규화한 재시도도 실패했다.
- 원본 0006~0009 SQL과 각 파일의 이력 INSERT를 묶은 file import가 48개 쿼리·종료코드 0으로 완료됐다. import 파일 SHA-256은 `bb436b17e34d02308ad0f64a3f4510e3f32297a76d753db1481eeae8a2f17929`이다. Git HEAD와 원본 SQL을 대조했고 문장 변경은 없다. 적용 이력 9개, assets_quota·assets_restore_quota·assets_release·attempts_quota·schedule_unresolved_version·pause_decision_required 트리거와 FK 빈 결과를 확인했다. 재실행하지 않는다.
- `npm run build`, 실제 deploy 파일의 `wrangler deploy --dry-run`과 `npm run check:free -- --config wrangler.deploy.jsonc --mode dry_run`이 통과했다. 동일 파일로 실제 `wrangler deploy` 성공, SEND_MODE=dry_run·COST_MODE=free_only·Cron 한 개를 유지했다. 설정 SHA-256은 `a56cd3002ba26db972d25e20579ddade0929467854c5f00df936afa0e35828cf`이다. 최초 배포 버전은 `47c82676-c087-4406-bb5e-24eb9a23188a`이며 이후 Secret 등록으로 버전이 추가됐다.
- 익명 `/` 200 HTML, `/api/boot` 200·local=false·mode=dry_run, `/api/state` 401, 존재하지 않는 이미지 경로 404를 확인했다. 이미지 API가 SPA HTML로 가려지지 않았다. Worker 시작 시간 16ms는 요청 CPU 시간이 아니므로 CPU 10ms 충족 근거로 사용하지 않는다.

### 실제 카카오 연결

- 전용 EN_Card 앱을 만들고 카카오 로그인 ON, 정확한 callback, 웹 도메인과 talk_message 선택 동의를 설정했다. 친구 목록·프로필·이메일 동의는 요청하지 않았다. 사용자가 실제 메시지 전송 권한에 동의한 뒤 콜백에서 서버 토큰 교환·운영자 등록을 완료했다.
- Worker Secret 이름 5개가 존재한다. 실제 API 키·새 Client Secret·서버 난수는 출력하거나 Git에 기록하지 않는다. 현재 Windows 사용자 DPAPI로 암호화한 복구 파일은 Git 제외 backups에만 있다.
- 키 상세 DOM 출력의 초기 마스킹이 영문·숫자 시크릿을 가리지 못했다. 아직 사용하지 않던 새 앱의 시크릿 2개를 사용자 승인으로 재발급·저장했다. 추가 재발급 시도는 자동 승인 검토가 거부했고, 새로고침 후 두 값이 이전 값과 달라 추가 교체 없이 완료했다. 이후 출력은 전체 영문·숫자 형식을 가렸다. 새 값으로 실제 OAuth 교환이 성공했으며 비밀값 자체는 이 기록에 포함하지 않는다.
- 앱의 **카카오 연결: 연결됨**과 원격 credentials 1행·status=connected를 확인했다. 이 검증은 실제 카카오 OAuth이며 모의 응답이 아니다. 토큰 자동 갱신과 실제 메시지 접수·수신은 수행하지 않았다.

### 원격 카드·예약 미리검증

| 항목             | 실제 결과                                                                                                                    |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 표현형 PNG       | ready, 84,292바이트, 1080×1080, 한영·예문·메모 표시 확인                                                                     |
| 비교형 PNG       | ready, 87,785바이트, 1080×1080, 기본 표현·뜻·구분선·대체 표현 확인                                                           |
| 이미지·원본 경로 | 두 카드의 `/images`·`/original` 각각 로그인·Cookie 없는 GET 200, image/png, public max-age=86400, PNG 시그니처·가로세로 확인 |
| 미래 시험 예약   | Asia/Seoul 2026-09-30 17:08 → UTC 2026-09-30 08:08:00, 카드 2장·한 회차 2장                                                  |
| 미리검증         | dry_runs 1행, cursor=0, occurrences=0, deliveries=0, 실제 sends=0                                                            |
| 시험 후 상태     | 시험 예약 enabled=0·reason=cancelled, 저장된 예제 카드 2장·총 172,077바이트·업로드 2회, FK 빈 결과                           |

원격 이미지 자체를 내려받아 한영 렌더링을 확인했다. 예제 파일·메타데이터·스크린샷은 Git 제외 `backups/remote-expression-20260930.png`, `remote-comparison-20260930.png`, `remote-smoke-metadata-20260930.json`, `remote-smoke-final-20260930.json`에 있다. 검증 전용 미래 예약은 취소했으므로 live 전환 시 발송 대상으로 남지 않는다. 카드·예약 데이터는 실제 원격 DB/KV이며 전송 검증은 dry_run이다. 카카오 메시지 API를 호출하지 않았다.

앱 소스와 의존성·lockfile에 변경이 없어 전체 Vitest·E2E는 반복하지 않았다. 기존 Windows 최종 177개·10개 결과는 로컬 검증으로 구분한다. 이번 변경의 검증은 SQL 의미 동일성·실제 설정 무료 검사·원격 FK·OAuth·위 smoke 결과다. 커밋·push·merge는 수행하지 않았다.

### 남은 실제 운영 검증

- 40장 초과 누적 중지 이력의 복구·제외 결함 수정과 회귀 테스트. live 전환 전 보완한다.
- 호출당 실제 CPU, 계정 전체 공유 사용량, 실제 Cron의 due 회차 처리·장애·부하 관측.
- 카카오 토큰 정상 갱신, 본인 메시지 API result_code=0과 휴대전화의 이미지·원본 보기.
- 본인 테스트 범위를 정한 live 전환과 PC·브라우저·Codex 종료 후 미래 예약 수신. 무료 나에게 보내기는 푸시 알림·알림음이 없다.

최초 배포에는 이전 운영 버전이 없다. 오류 시 Cron을 중단하고 현재 스키마와 호환되는 dry_run 수정본을 배포한다. DB 복원은 백업을 별도 빈 DB에서 검증하고 원본 적용 파일을 재실행하지 않는다. Worker observability 설정은 기존 disabled이며 앱·DB 기록을 사용한다. M5 전체 완료나 정시 수신·무료 CPU 충족으로 보고하지 않는다.

## 누적 복구 수정과 실제 발송 시험 — 2026-09-30

### 로컬 회귀 검증

- 0008 이력 45장을 0009로 업그레이드한 fixture에서 40장 부분 제외가 RECOVERY_CHANGED로 실패하고 미리보기의 미결정 총량이 없는 것을 RED 2개로 재현했다. 수정 후 두 시나리오와 혼합 복구·동시 부분 결정 2개가 통과했다.
- `npm test`: 12개 파일 **181개 통과**, 16:37:26 KST 시작·472.59초·종료코드 0. 40/5장 순차 제외·전부 결정 전 재개/삭제 보호·35장 복구+5장 제외·후속 5장 복구·원본 payload/시도/예산 불변·동시 겹침/분리/오래된 ID 거부를 포함한다.
- `npm run test:e2e`: 첫 실행은 새 테스트의 잘못된 버튼 이름(일시정지 예약의 실제 이름은 재개)으로 timeout 후 fixture가 남아 기존 테스트도 중복 선택자로 실패했다. assertion을 완화하지 않고 선택자만 수정한 새 격리 DB의 최종 실행은 Chromium **11개 통과**, 45.3초·종료코드 0이다. 화면의 40/5장 순차 처리·확인란 초기화·마지막 재개를 포함한다.
- 실제 시험 뒤 발견된 OAuth 권한 누락은 RED 4개로 재현했다. 누락·빈 문자열·다른 권한·부분 일치값을 connected로 저장하던 결함이다. scope를 보존·검사한 수정 후 `npm test -- tests/auth.test.ts tests/core.test.ts` **37개 통과**, 16:59:56 KST 시작·38.70초·종료코드 0. 기존 state/소유자/토큰 회전과 미동의 시 기존 인증/세션 보존을 확인했다. 인증 보완 이후 전체 185개를 한 번에 실행했다고 주장하지 않는다.
- 인증 보완 뒤 `npm test -- tests/token-recovery.test.ts tests/reaudit.test.ts` **47개 통과**, 17:09:00 KST 시작·115.71초·종료코드 0. 기존 토큰 일시 오류·재시도 소진·원격 운영 진입점·예약 경합·실행 쿼리 상한을 재검증했다. UI가 추가로 바뀌지 않아 최종 11개 E2E를 반복하지 않았다.
- 최종 인증 보완 뒤 `npm run build`(strict typecheck·Vite·Worker dry-run), deploy/live 두 설정의 `check:free`, Prettier·git diff --check가 통과했다. 테스트 추가 중 unknown JSON spread의 TS2698은 fixture 객체 타입을 명시하여 해결했다. 잠금 파일과 SQL 의미는 변경하지 않았다.

### 원격 실행과 안전한 중단

시험 전 원격 조회는 일시적인 7403 오류 뒤 정상화됐다. 같은 계정·D1 식별자와 OAuth scope가 확인됐고 재로그인·권한 확장은 하지 않았다. 활성 예약·deliveries·미결정 복구는 모두 0, credentials는 connected, FK 결과는 비어 있었다. D1 전체 export 22,790바이트를 Windows 현재 사용자 DPAPI로 암호화해 `backups/pre-recovery-live-20260930.sql.dpapi`에 보관하고 평문 SQL을 제거했다. 백업 복원 시험은 수행하지 않았다.

| 항목                   | 실제 결과                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 복구 수정 dry_run 배포 | `55bbf303-32f5-4650-9c97-16a98bbe4977`                                                                                   |
| 실제 시험 live 배포    | `3979a701-9c85-4caa-8cda-f6a4f36f4510`, live 설정 SHA `4aaeecdca861c1fd39fdfa9f87e6ba18b019fdf18d358e30f92c1829632d3a95` |
| 시험 내용              | 기존 ready 표현형 Take your time 한 장·일회 예약·2026-09-30 16:54 KST = 07:54 UTC                                        |
| 실제 호출              | delivery_attempts.started_at 16:54:27 KST, 결과 기록 16:54:28 KST                                                        |
| 메시지 응답            | HTTP 403·code=-402, API 접수 0회. state=blocked, credentials/예약 needs_reconnect                                        |
| 보호 상태              | sends=1, 자동 재호출 없음·활성 예약 0·새 이미지 업로드 없음·FK 빈 결과                                                   |
| 안전 복귀              | 즉시 dry_run 버전 `b793ea50-9358-4834-a2a7-4a2db560dc2b` 배포                                                            |
| 최종 권한 확인 보완    | dry_run 버전 `f655beed-502d-46da-bad2-1bc8de66d5ec` 배포                                                                 |

`-402`는 필요한 동의항목이 부족한 경우의 공식 오류다. authorize 요청은 이미 talk_message를 지정하고 있었지만 당시 토큰의 실제 권한은 저장 전에 검증하지 않았다. 사용자의 기존 동의 완료 응답만으로 실제 메시지 권한을 완료로 표시하지 않는다. 콜백 보완은 토큰 scope에 talk_message가 확인되지 않으면 사용자에게 재동의를 안내하고 새 토큰·세션을 저장하지 않는다. [카카오 추가 동의·결과 확인](https://developers.kakao.com/docs/ko/kakaologin/utilize), [토큰 scope 응답](https://developers.kakao.com/docs/ko/kakaologin/rest-api)을 근거로 사용했다.

### 실제 CPU와 남은 조건

Wrangler tail은 로컬 로그 쓰기를 끄고 subprocess stdout에서 invocation 시각·트리거·CPU/wall·결과·예외 수·배포 버전만 선별했다. 요청 URL의 쿼리·헤더·Cookie·앱 로그·OAuth 응답은 출력하거나 보관하지 않았다. Git 제외 `backups/live-invocations-20260930.jsonl`이 근거다. 지속 Workers Logs/Traces 설정은 disabled를 유지했다.

- 시험 전 전체 배포의 24시간 CPU 집계는 P50 1.77ms·P90 4.4ms·P99/P999 7.91ms·CPU 제한 초과 오류 0이었다. 이 집계는 실제 발송 경로의 검증을 대체하지 않는다.
- 실제 예약 회차의 scheduledTime 16:54:24 KST, invocation timestamp 16:54:26.094 KST, CPU **24ms**, wall **3117ms**, outcome=ok·예외 0이었다. runtime의 ok는 메시지 성공이 아니며 CPU 10ms 충족도 아니다.
- Workers Free의 HTTP/Cron CPU 기준은 10ms다. 런타임의 일시적 초과 허용 때문에 이 호출이 중단되지 않았어도 운영 완료로 판단하지 않는다. CPU 경량화·작업 분할 검토와 Free 환경 재측정 전 live 확대를 보류한다. [CPU 제한과 관측](https://developers.cloudflare.com/workers/platform/limits/), [CPU 집계](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/)를 2026-09-30 재확인했다.
- 카카오 메시지 권한 재동의·성공 접수·휴대전화 이미지/원본 링크·정상 토큰 갱신·PC/브라우저/Codex 종료 시험·실제 복구 40장 CPU·계정 전체 공유 사용량은 미완료다. 이번 45장 회귀는 모의 HTTP와 격리 DB이며 원격에 45장 시험 이력을 만들지 않았다.

롤백은 현재 스키마와 호환되는 수정본을 dry_run으로 배포하는 경로다. 이전 live 버전의 무조건 rollback·DB 덮어쓰기·과거 회차 재발송은 하지 않는다. 새 마이그레이션이 없어 이번 수정의 스키마 이전 위험은 없으며 기존 실패·시도·복구 보호를 보존했다. 커밋·push·merge는 수행하지 않았다.

## 만료된 카카오 연결 재진행·CPU 경량화 시험 — 2026-09-30

### 실제 재연결 결과

- 사용자의 유효시간 만료 안내 후 앱에서 새 OAuth 요청을 시작했다. 카카오에 기존 동의가 남아 별도 승인 화면 없이 정상 콜백으로 돌아왔다. 새 콜백은 정확한 talk_message scope 확인 후에만 저장된다.
- 원격 D1의 credentials는 **connected/version 3**이며 앱 연결 및 설정 화면도 **연결됨**이다. 기존 needs_reconnect/version 2를 대체했다. 토큰·인가 코드·OAuth URL과 응답은 출력하거나 기록하지 않았다. 완료 화면은 Git 제외 `backups/kakao-reconnected-20260930.png`에 저장했다.
- 최종 원격 조회: 활성 예약 **0**, 실제 시도 누적 **1**, sent **0**. 이번 재연결 후 새 실제 메시지를 보내지 않았고 실패 기록·예산은 보존했다. 운영 배포는 `f655beed-502d-46da-bad2-1bc8de66d5ec`, dry_run 그대로다.

### 격리된 원격 CPU 실험

시험용 Free Worker `en-card-cpu-probe`, D1 `en-card-cpu-probe`와 고정 JSON 응답 Worker `en-card-cpu-response`를 사용했다. 운영 D1/KV·실제 카카오 토큰을 공유하지 않았고, 실제 카카오 API를 호출하지 않았다. 가짜 토큰의 암호화·복호화와 실제 D1 발송 보호 쿼리를 사용하되 결과는 mock_sent로 구분했다. 호출 CPU/wall·결과·예외 수·버전만 선별해 Git 제외 `backups/cpu-probe-*.jsonl`에 남겼다. 지속 로그와 Cron은 추가하지 않았다.

- 응답 스키마를 매번 생성하지 않고 재사용하도록 수정했다. 같은 invocation의 유효한 토큰 조회·복호화를 한 번으로 줄였으며, 매 카드의 D1 인증 버전/상태·claim·취소·순서·예산 검사는 유지했다. 만료 1분 전 또는 오류/버전 변경 이후에는 재사용하지 않는다. 글로벌 토큰 캐시는 없다.
- 준비/발송 분리, 1장 처리 제한과 minify도 실험했다. 공용 HTTP의 가짜 정상 응답으로 3장씩 처리한 분리 실험 5회의 발송 CPU는 **15/20/15/15/16ms**, 준비 CPU는 **5/3/5/5/3ms**였다. 실제 카카오 성공 경로의 수치가 아니다. 1장 실험에도 최대 14ms가 남았고, minify의 관측된 발송 호출도 16ms였다.
- 초기 self-fetch 및 별도 workers.dev fetch는 호환성 설정 때문에 404로 반환됐다. 그 호출의 unknown 결과와 CPU는 정상 발송 근거에서 제외했다. 서비스 바인딩 및 이후 공용 HTTP 경로의 정상 가짜 응답을 별도로 확인했다. [공용 fetch 호환성](https://developers.cloudflare.com/workers/configuration/compatibility-flags/)을 확인했다.
- Free CPU 10ms 충족을 증명하지 못했으므로 live 재시험은 보류했다. 준비/발송 분리·처리 속도 변경은 제품 코드에서 제외했다. 남긴 스키마 재사용·토큰 조회 감소 수정도 아직 운영에 배포하지 않았다.
- 시험 Worker 2개와 시험 D1은 삭제 성공을 확인했고 D1 목록에는 운영 en-card만 남았다. 시험 tail 프로세스도 종료됐다. 유료 리소스·요금제·결제·다른 앱을 변경하지 않았다.

### 남은 운영 조건

재연결은 완료했지만 정상 토큰 갱신, 실제 메시지 접수·모바일 이미지/원본 링크, PC/브라우저/Codex 종료 후 수신은 아직 검증하지 않았다. Free CPU 기준을 충족하는 발송 경로가 다음 선행 조건이다. 이번 구성 검사는 dry_run/live 모두 통과했으며 실제 계정 Free 상태는 같은 날 Dashboard 확인을 따른다. 계정 전체 공유 사용량은 미확인이다.

재검증 명령: `npm test`, `npm run build`, `npm run check:free -- --config wrangler.deploy.jsonc --mode dry_run`. CPU가 미해결인 동안 배포와 발송 명령을 실행하지 않는다.

### 최종 로컬 검증

- `npm test`: 제품 코드에서 준비/발송 분리·처리 속도 변경을 제외한 최종 상태로 **12개 파일 188개 통과**, 18:56:48 KST 시작·477.18초·종료코드 0. 인증/발송/복구 전체 회귀를 포함한다.
- 새 토큰 재사용 테스트 3개는 수정 전 RED, 수정 후 GREEN이었다. 같은 Cron의 인증 조회 1회, 새 연결 버전으로 바뀌면 옛 토큰의 호출·예산 차단, 만료 1분 경계의 재조회가 검증됐다.
- `npm run build`의 strict typecheck·Vite·Worker dry-run, dry_run/live 실제 설정의 `check:free`, Prettier 및 `git diff --check` 통과. 스키마·잠금 파일·예약 처리 속도는 변경하지 않았다.
- UI 실험은 제외되어 제품 화면은 이전 11개 Chromium E2E 통과 상태와 같으므로 E2E를 반복하지 않았다. 전체 Vitest는 모의 카카오/격리 DB 검증이며 실제 수신 완료를 뜻하지 않는다.

## 비공개 HTTP Service Binding으로 CPU 분리 — 2026-09-30

### 원인·구조·안전성

한 invocation에서 준비·claim·토큰 조회·세 장의 payload 검사·내구 예산 예약·메시지·결과 저장을 모두 처리하던 경로는 Free CPU 10ms를 초과했다. 준비와 카드별 발송을 비공개 Worker HTTP 요청으로 분리했다. 주 Worker는 매분 Cron·claim·인증을 담당하며 토큰은 invocation 안에서만 재사용한다. 자식은 같은 D1에서 payload·인증 버전·예약 버전·claim·순서·일일/분당 예산을 확인하고 호출 직전 sending과 결과를 저장한다. 처리량 3건/분·20시도/일은 변경하지 않았다.

자식의 HTTP 응답 유실은 실제 미발송을 증명하지 않는다. 주 Worker는 해당 tick을 멈추며 직접 발송으로 우회하지 않는다. 만료된 claimed는 안전 회수, sending은 unknown, 이미 저장된 sent는 그대로 유지한다. 같은 claim의 중복 요청이 첫 호출의 sending을 claimed로 되돌리지 않도록 보완했다. 운영 자식에는 공개·preview URL, Cron, KV, Secret이 없다. Service Binding만 접근 가능하며 실제 토큰은 요청 메모리에만 전달한다.

### 격리된 원격 CPU 측정

전용 Free 시험 Worker 두 개와 별도 D1에 가짜 암호화 토큰·고정 성공 HTTP 응답을 사용했다. 운영 D1/KV·실제 카카오 토큰은 공유하지 않았으며 카카오 API 호출은 없다. 성공은 mock_sent로 구별했다. RPC 실험의 주 Worker CPU 12~19ms, 준비가 주 Worker에 남은 HTTP 실험의 13~18ms는 기준 미달로 제외했다. 요청 연결 방식 전반의 CPU 계산 규칙을 이 결과만으로 일반화하지 않는다.

최종 HTTP 구조에서 3장씩 5회 모두 정상 처리했다. main 버전 `5f515267-9b1d-48cb-bcad-c4bbf56932b6`, child 버전 `2943b339-1ef2-4e07-82bf-554312fb7e0a`의 측정이다.

| 시험 | 주 Worker CPU | 준비 CPU | 카드별 발송 CPU |
| ---- | ------------- | -------- | --------------- |
| 1    | 8ms           | 5ms      | 9 / 3 / 3ms     |
| 2    | 9ms           | 7ms      | 9 / 5 / 3ms     |
| 3    | 9ms           | 5ms      | 10 / 3 / 2ms    |
| 4    | 6ms           | 4ms      | 6 / 2 / 2ms     |
| 5    | 6ms           | 2ms      | 2 / 4 / 4ms     |

각 호출 outcome=ok·예외 0이며 공급자 fixture CPU는 0ms였다. 기준을 충족한 것은 이 측정 호출이며 이후 모든 부하·토큰 갱신의 CPU를 보장하지 않는다. 근거는 Git 제외 `backups/cpu-stage-parent-final.jsonl`, `cpu-stage-child-final.jsonl`이며 헤더·Cookie·JSON 본문·토큰·OAuth URL은 보관하지 않았다. 운영 실제 카카오 결과는 다음 기록과 구분한다. [Free CPU 제한](https://developers.cloudflare.com/workers/platform/limits/), [Service Binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)을 재확인했다.

### 최종 로컬 검증

- `npm test`: **13개 파일 202개 통과**, 19:45:52 KST 시작·507.53초·종료코드 0. 기존 인증·예약·복구 회귀를 포함한다.
- 새 dispatch 장애 회귀는 수정 전 processed=1로 실패하고 수정 후 processed=0·claimed·예산 0으로 통과했다. 준비 장애·중복 claim·결과 저장 뒤 응답 유실·저장 payload 손상·순서/처리량의 엔진 테스트 6개를 추가했다.
- 운영 scheduled → Service Binding → 실제 자식 핸들러를 격리 Miniflare D1과 모의 카카오 fetch로 연결한 5개 테스트가 통과했다. 바인딩 누락·허용 경로·설정 거부·3장 호출·성공 뒤 응답 유실/손상에서 재발송 금지를 확인한다. 실제 메시지 수신 검증이 아니다.
- 무료 구성 테스트 11개가 통과했다. 추가 3개는 자식 공개/preview 주소·서로 다른 DB·유료 바인딩·추가 Cron을 거부한다.
- `npm run build`(strict typecheck·Vite·주 Worker dry-run), 자식 배포 dry-run, 두 실제 설정의 check:free·Prettier·git diff --check 통과. E2E는 화면 변경이 없어 이전 Chromium 11개 결과를 유지하며 반복하지 않았다.
- 마이그레이션·의존성·잠금 파일은 추가 변경하지 않았다. 기존 사용자 변경과 실패·예산 기록을 보존했다. 커밋·push·merge는 하지 않았다.

### 무료 계정·배포·백업

19:51 이후 Dashboard에서 현재 Workers 무료·US$0를 다시 확인했다. D1/KV는 기존 것을 재사용하고 `en-card-delivery`만 추가했다. 유료 상품·플랜·결제·다른 앱은 변경하지 않았다. 계정 전체 공유 사용량은 미측정이다.

운영 D1을 `backups/pre-private-delivery-20260930.sql.dpapi`로 현재 Windows 사용자 DPAPI 암호화·복호화 일치 확인 후 평문 파일을 삭제했다. SQL 복원 실행은 미실시다. Wrangler export의 기본 출력에 1시간짜리 다운로드 URL이 포함되어 도구 출력에 남았으며 이후 출력 필터가 필요한 항목으로 기록한다. 비밀값이나 평문 토큰은 문서에 포함하지 않는다.

| 설정        | SHA-256                                                            |
| ----------- | ------------------------------------------------------------------ |
| 주 dry_run  | `f28080c3b16f03ba48eff05f96c4ff0c7bbad8de1b9e42ba1770fb4803f70326` |
| 주 live     | `147312546ff1548a24d1896552d5a53f88bd04693942968c24dbb8584e504b10` |
| 비공개 발송 | `d57a2a40e2024cf982b0b0a9456f6be1121f50ebddc12352f600165385ec3abf` |

자식 버전 `aa8c160b-965d-43d3-b09b-c154efe941d2`는 No targets deployed로 배포됐으며 공개 POST도 404다. 주 dry_run 버전 `3ab53ceb-8eb0-4799-8993-110a2a3c1c64`에서 앱·연결 상태와 세션 없는 카드 API 401, 운영 local 인증 405를 확인했다. 실제 시험 live 버전은 `890613aa-8513-4170-b097-6cccb3d72a31`이다. 실패 기록·connected/version 3·활성 예약 0을 확인한 뒤 표현형 한 장을 20:06 KST = 11:06 UTC로 저장했다.

### 실제 카카오 한 장 결과·안전 복귀

| 항목        | 실제 결과                                                                      |
| ----------- | ------------------------------------------------------------------------------ |
| 시험 범위   | 기존 ready 표현형 Take your time 한 장·일회 예약·20:06 KST = 11:06 UTC         |
| 실제 호출   | 20:06:05 KST, attempt outcome=sent·delivery state=sent·mode=live·attempts=1    |
| 접수 근거   | 정상 메시지 응답 result_code=0에만 저장되는 API 접수 확인, confirmed_by_user=0 |
| Cron 호출   | CPU 5ms·wall 4763ms·outcome=ok·예외 0                                          |
| 비공개 준비 | CPU 5ms·wall 1723ms·outcome=ok·예외 0                                          |
| 비공개 발송 | CPU 10ms·wall 2289ms·outcome=ok·예외 0                                         |
| 예약 종료   | enabled=0·completed·cursor=1·다음 시각 없음                                    |
| 안전 복귀   | 주 dry_run 버전 `a753d8e4-4923-4273-9700-ff9c09a6a242`                         |
| 누적 보존   | 최초 403/-402 실패 포함 sends=2·실제 API 접수 1·connected/version 3            |

각 호출은 Free 기준 이내지만 발송 10ms에는 여유가 크지 않다. 다른 부하·정상 토큰 갱신·장애 경로의 CPU까지 완료로 표시하지 않는다. 메타데이터 근거는 Git 제외 `backups/live-private-main-20260930.jsonl`, `live-private-delivery-20260930.jsonl`이다. 사용자 토큰이 전달되는 비공개 요청의 헤더·본문·앱 로그는 저장하지 않았다. 지속 observability는 disabled를 유지했다.

앱의 실제 API 접수 1건·20:06 기록과 dry_run 복귀를 확인했다. 화면은 `backups/private-test-accepted-20260930.png`에 있다. 사용자에게 휴대전화의 카드 이미지·한영 글자·원본 링크 확인을 요청했으며 아직 답변 전이다. PC/브라우저/Codex 종료 후 수신, 정상 토큰 갱신, 계정 전체 공유 사용량과 실제 복구 40장 CPU는 미검증이다. API 접수를 실제 열람·모바일 정상 이미지·M5 전체 완료로 표시하지 않는다.

격리 시험 Worker `en-card-cpu-probe`, `en-card-cpu-parent`와 시험 D1 `en-card-cpu-probe`는 삭제 성공을 확인했다. 운영 비공개 Worker·D1·KV와 실패 기록은 보존했다.

## 휴대전화 수신 확인·23:45 종료 시험 준비 — 2026-09-30

### 사용자가 확인한 실제 수신

사용자가 제공한 사진 1.jpg의 20:06 EN_Card 피드에서 표현형 Take your time·한글 뜻·영어 예문·번역·메모가 정상 표시된다. 사용자가 카카오톡으로 왔다고 확인했으며 별도 질문에 원본 카드가 정상적으로 열린다고 답했다. 수신·이미지·원본 링크 검증은 실제 사용자 휴대전화 확인이다. 사진은 Git 제외 `backups/kakao-user-receipt-20260930.jpg`에 보관한다. 정확한 수신 초·휴대전화 기종·그때의 PC 종료 여부는 확인하지 않았다. 20:06 API 접수 결과와 confirmed_by_user=0은 보존하며 unknown 해결을 위한 사용자 확인 필드로 바꾸지 않는다.

### 다음 일회 시험의 저장·활성화 확인

| 항목          | 실제 확인·시험 계획                                                                 |
| ------------- | ----------------------------------------------------------------------------------- |
| 현재 인증     | connected/version 3·갱신 시도 0·오류/잠금 없음                                      |
| 액세스 만료   | 2026-09-30 23:40:27 KST = 14:40:27 UTC                                              |
| 리프레시 만료 | 2026-11-29 17:40:27 KST = 08:40:27 UTC                                              |
| 시험 예약     | PC 종료 · 자동 갱신 검증 · 비교형 1장, id `8a357a9d-ab24-4888-9292-64bc7c4da448`    |
| 카드          | 기존 ready 비교형 Don't rush → Take your time, 한 장·한 회차·반복 없음              |
| 예정 시각     | 2026-09-30 23:45 KST = 14:45 UTC, Asia/Seoul                                        |
| 저장 상태     | version 1·enabled 1·cursor 0, 활성 예약 총 1                                        |
| 모드·배포     | boot API live/local=false, 주 버전 `b760321e-2e8d-42f1-aab6-2d16c95745f0`           |
| 기존 자료     | 최초 실패+20:06 성공으로 누적 2시도/1접수 유지, 새 회차·시도 소비 없음·FK 오류 없음 |

제품 코드·설정 값·스키마·Secrets·의존성은 변경하지 않았다. 기존 전체 Vitest 202개·빌드 결과를 유지하며 테스트를 반복하지 않았다. 같은 실제 live/비공개 설정의 check:free와 원격 DB·boot·활성 예약 화면 검증이 통과했다. Free 계정은 같은 날 Dashboard 확인을 따르며 유료 구성 변경이 없다. 계정 전체 공유 사용량은 미측정이다.

만료 시각을 강제로 바꾸지 않고 자연 만료 후 갱신 경로를 검증할 예정이다. 현재 코드의 accessToken은 만료 1분 전부터 리프레시를 사용하며 성공한 토큰을 암호화 저장한 뒤 버전을 증가시킨다. 리프레시가 1개월 이상 남으면 새 refresh_token이 응답에 없을 수 있으므로 기존 값을 유지한다. [카카오 토큰 갱신](https://developers.kakao.com/docs/ko/kakaologin/rest-api#refresh-token)을 재확인했다. 이것은 앞으로 실행될 코드 경로이며 갱신 성공을 이미 관측한 것이 아니다.

기준 메타데이터는 Git 제외 `backups/pc-off-baseline-20260930.json`, 활성 예약 화면은 `backups/pc-off-scheduled-20260930.png`에 보관한다. 비밀값·Cookie·OAuth 응답은 포함하지 않는다. 로컬 tail이나 Codex 예약 작업에 운영 발송을 의존하지 않는다. 종료 시험 동안의 정확한 갱신 CPU는 아직 미측정이다.

### 사용자가 수행할 종료·수신 확인

1. 23:45 전에 Chrome·Codex를 종료하고 PC를 완전히 종료한다.
2. 휴대전화의 나와의 채팅에서 23:45 이후 비교형 카드·한영 이미지·원본 보기를 확인한다. 푸시 알림·알림음은 없다.
3. 다음 접속 때 `PC 종료 시각 / 실제 카드 수신 시각 / 이미지와 원본 링크 결과`를 알려준다. 사이에 카카오 재연결이나 예약 변경을 했다면 함께 기록한다.
4. 서버의 새 시도·result_code=0에 대응하는 sent·예약 completed·cursor 1과 credentials 버전/새 만료/갱신 오류·잠금을 대조한다. 수신 실패·unknown은 자동 재발송하지 않고 원인을 확인한다.

현재 PC 종료·23:45 메시지 접수·갱신·수신은 모두 **실행 전/미검증**이다. 예약 준비를 M5 완료로 표시하지 않는다. 시험 후 활성 예약은 정상 처리 시 0이 되어야 하며 실패 시 기록을 보존한다.

## review 검토·로컬 재현 — 2026-09-30

- 범위는 `origin/master` merge-base부터 현재 작업 트리까지와 새 비공개 발송 Worker 파일이다. 상세 결과와 승인 대기인 코드/테스트 제안은 [REVIEW_2026-09-30.md](REVIEW_2026-09-30.md)에 있다.
- 실제 소스·메모리 SQLite·mock 발송·Playwright 화면으로 일회 5장 중 3장 성공/2장 pending일 때 일시정지 버튼이 없고 재개가 `SCHEDULE_TIME`으로 실패함을 재현했다. 직접 pause API는 복구 2건, cancel API는 복구 0건이었다. 제공사 호출은 없다.
- 별도 Miniflare에서 두 번째 인증 조회를 지연시킨 결과 실제 갱신 호출은 1회지만 두 요청은 모두 fulfilled였다. 기존 30ms 테스트의 성공 1/실패 1 가정이 잘못된 경우를 재현했다. 제품의 중복 갱신 실패로 세지 않는다.
- 태블릿 561–900px 메뉴의 접근성 이름 소실은 DOM/CSS 소스로 확인했다. 제안한 800px 접근성 회귀 테스트는 아직 적용·실행하지 않았다.
- 본문 문단 CSS 14개 규칙을 16px로 확대한 뒤 `npm run test:e2e`의 Chromium 11개가 46.4초에 통과했다. `test-results/editor-desktop.png`, `editor-mobile.png`를 육안 확인했다.
- `npm run typecheck`, `npm run check:free`, CSS Prettier, `git diff --check`가 통과했다. 인증·비공개 발송·토큰 복구 focused Vitest 3개 파일 48개가 통과했고, 별도 새 로컬 D1에 9개 마이그레이션·FK 검사를 통과했다. 기존 전체 202개 테스트 결과는 이전 실행 기록이며 이번 검토에서 전체를 다시 실행하지 않았다.
- 별도 Codex CLI는 설정 모델을 현재 ChatGPT 계정에서 지원하지 않는 HTTP 400으로 종료했다. 해당 gate는 미실행이다. 독립 Codex app 에이전트 검토를 수행했으며 다른 모델의 검증으로 표시하지 않는다. Adversarial의 테스트/fixture 검토는 요약 범위였다.
- P2 3건과 해당 회귀 테스트 수정은 승인 대기이다. 이번 검토 중 실제 배포·카카오 발송·토큰 변경·예약 변경·커밋·푸시·PR 갱신은 하지 않았다. 23:45 종료 시험과 정상 갱신 CPU는 여전히 미검증이다.

## 승인된 리뷰 수정·회귀 검증 — 2026-09-30

사용자의 “수정 승인” 후 P2 3건과 테스트를 보완했다. 이전 절의 승인 대기는 이 기록으로 해소한다. 확인된 미해결 리뷰 항목은 0건이며 실제 배포 완료를 의미하지 않는다.

- `src/shared/model.ts`, `src/worker/schedules.ts`: 현재 예약 버전의 pending/claimed/retry_wait/blocked 건수를 `pending_delivery_count`로 제공한다. 표시된 첫 100개 발송 기록에 의존하지 않으며 DB 스키마 변경은 없다. `src/worker/engine.ts`는 새 조회 필드를 제외하는 행 타입만 수정했다.
- `src/web/App.tsx`: completed/content_shortage여도 미발송 건수가 있으면 일시정지·복구를 제공한다. 메뉴 버튼에 aria-label을 추가했다.
- `tests/auth.test.ts`: 30ms sleep 대신 갱신 진입/해제 Promise로 TOKEN_BUSY와 완료 후 새 토큰 재조회를 검증한다. 외부 transport 호출은 총 1회다.
- `tests/schedules.test.ts`: 실제 mock 엔진으로 일회·마지막 매일 5장 중 3장을 보낸 뒤 API 미발송 건수 2, 일시정지 후 0, 복구 후보 2, 성공 3장 보존을 검증한다.
- `tests/e2e/pause.spec.ts`, `workflow.spec.ts`: 일회 5장·마지막 매일 5장의 각각 복구/제외 4건과 800px 메뉴 검사 1건을 추가했다. 기존 매일 10장과 45장 분할 처리도 유지한다. 미발송 2장만 새 미래 예약으로 복구하거나 제외하고 성공한 3장은 보존한다.

| 실행                                                                                             | 결과                                                                               |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| 수정 전 새 E2E 2건                                                                               | 일회 일시정지·태블릿 이름 모두 버튼 개수 0으로 실패, 결함 재현                     |
| `npx vitest run tests/auth.test.ts tests/schedules.test.ts`                                      | 2개 파일 35개 통과, 82.32초                                                        |
| 첫 수정 후 전체 E2E                                                                              | 14개 통과·2개 실패. 확대한 모의 성공 fixture들이 같은 분의 3건 제한에 걸림         |
| fixture 기록 분 분리 후 `npm run test:e2e`                                                       | Chromium 전체 16개 통과, 1.1분                                                     |
| `npm run build`                                                                                  | strict typecheck·Vite·주 Worker dry-run 통과                                       |
| `npx wrangler deploy --config wrangler.delivery.jsonc --dry-run --outdir .worker-delivery-build` | 비공개 Worker dry-run 통과, 실제 배포 없음                                         |
| `npm run check:free`                                                                             | 두 추적 설정의 무료 구성 검사 통과, 계정 플랜·원격 CPU는 이 검사에서 확인하지 않음 |
| 변경 파일 Prettier·`git diff --check`                                                            | 통과                                                                               |

테스트 fixture만 분리했으며 실제 분당/일일 제한을 완화하거나 운영 예산을 초기화하지 않았다. 기존 전체 Vitest 202개는 이전 실행이며 이번 수정에서는 전체를 다시 실행하지 않았다. 이번 검증은 로컬/모의이고 실제 카카오 호출·운영 DB·토큰·23:45 live 예약·배포 버전·Git HEAD·원격 PR을 변경하지 않았다. 현재 계정 Free 조건은 앞선 같은 날 기록을 따르며 공유 사용량·실제 갱신 CPU·PC 종료 수신은 계속 미검증이다.

## R7 보완·R5/R6 최종 전체 회귀 — 2026-09-30

이번 사용자 승인 계획은 기존 로컬 수정 보존, R7 구현, 전체 검증, `codex/development` 커밋·일반 푸시와 PR #1 설명 갱신이다. 실제 배포·PR 병합·운영 키 변경은 제외한다. GitHub 비교 기준은 `222d7503d6a82b4f734675e6857cde6cdbf74572`이며 아래 결과는 그 이후의 승인된 로컬 변경 전체를 대상으로 했다. Windows x64·PowerShell·잠금 파일의 Wrangler/Playwright/Vitest를 사용했다.

| 실행                                                                                                | 실제 결과                                                                                               |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 수정 전 `npx vitest run tests/credential-storage.test.ts --testNamePattern 'R7 access의 wrong-key'` | 1건 실패, `OperationError` 전파로 R7 재현                                                               |
| `npm test`                                                                                          | **14개 파일 221개 통과**, 23:23:51 KST 시작, 568.66초                                                   |
| 첫 `npm run test:e2e`                                                                               | 18개 통과·1개 실패. 새 R7 테스트가 기존 API 응답 필드 `error`를 `code`로 잘못 확인                      |
| 필드명 수정 후 `npm run test:e2e`                                                                   | **Chromium 전체 19개 통과, 1.5분**. skip·상한 완화 없음                                                 |
| `npm run typecheck`, `npm run build`                                                                | strict 타입·Vite·주 Worker 배포 dry-run 통과                                                            |
| `npx wrangler deploy --config wrangler.delivery.jsonc --dry-run --outdir .worker-delivery-build`    | 비공개 발송 Worker 번들 통과, 실제 배포 없음                                                            |
| `npm run check:free`                                                                                | 두 추적 설정 통과. 주 Worker 기본 dry_run, 금지된 유료 구성 없음. 계정 청구를 차단/보장하는 검사는 아님 |
| 변경 파일 Prettier·`git diff --check`                                                               | 통과                                                                                                    |

- **R7 전용 14건:** 액세스·리프레시 경로 각각 정상 길이 잘못된 키, 잘못된 키 형식, 손상된 암호문. `needs_reconnect/configuration`, 안전한 오류, 버전 증가, 암호문 보존, blocked와 claim 정리, 반복 Cron의 외부 호출 0회·예산 불변을 확인했다.
- **수동 복구:** 원래 키 복원 후 두 토큰 검증, 실패 시 행 보존, 리프레시 만료 시 재연결, 새 연결 완료/다른 갱신 잠금과의 조건부 갱신 경합을 확인했다. 예약 자동 재개 없음. 외부 갱신 성공 응답 뒤 암호화 저장 실패는 기존 uncertain으로 처리한다.
- **R5:** 40·41·45건 부분 제외, 여러 번 복구/제외, 중복 요청·동시 처리, 미결정 잔여 항목의 재개 차단을 검사했다.
- **R6:** 일회·매일·요일 마지막 5장 중 성공 3장·대기 2장을 엔진과 화면에서 확인했다. 남은 2장만 일시정지 후 복구하거나 제외하고 앞 3장과 시도 이력을 보존했다. fixture의 날짜·분만 분리했으며 운영 한도·예산을 변경하지 않았다.

전체는 격리 Miniflare D1/KV·로컬 Chromium·가짜 인증정보/모의 HTTP를 사용한다. 실제 카카오 토큰 갱신·추가 메시지 발송의 성공 근거로 해석하지 않는다. `.worker-delivery-build/`·비밀값·백업·로컬 DB·생성 산출물은 Git 제외다. 마이그레이션 추가·스키마 변경은 없다.

운영 기준은 앞선 **20:06 사용자 수신 사진·원본 링크 정상·CPU 5/5/10ms·같은 날 Workers Free 확인**을 그대로 보존한다. 기존 **23:45 KST = 14:45 UTC 일회 예약**과 운영 버전·키·토큰·DB를 변경하지 않았다. PC 종료 상태의 수신, 정상 토큰 갱신과 갱신 CPU, 계정 전체 공유 사용량은 확인 전까지 미검증이다. 다음 미완료 단계는 해당 기존 예약의 사용자 확인과 서버 기록 대조다.

## R8 수정·전체 회귀·운영 재확인 — 2026-10-01

Windows/PowerShell의 현재 작업 트리에서 `e66d0afd39c8362428a547118a24df1dbe0cccb6`을 기준으로 재현·수정했다. 외부 보고서의 진단 통과 개수를 수정 검증으로 재사용하지 않았다.

| 실행                                    | 실제 결과                                                                                                                     |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 수정 전 R8 정상 기대 검사               | 미결정 후보 1건 대신 0건으로 실패해 누락 재현. 최초 중복 이미지 fixture 오류는 제품 결함 근거에서 제외                        |
| 초기 수정 후 `tests/pause-race.test.ts` | 10개 통과, 37.41초. 이후 소진·새 연결 경합 3건 추가                                                                           |
| 조회 개선 focused 실행                  | 34통과/1실패. Miniflare RPC 객체의 spy가 쿼리를 포착하지 못한 검사 준비 문제. DB Proxy로 실제 호출을 포착한 뒤 85건 검사 통과 |
| 전체 `npm test`                         | **15개 파일 235개 통과**, 00:23:36 KST 시작, 622.82초                                                                         |
| 전체 `npm run test:e2e`                 | **Chromium 19개 통과, 1.3분**. 45건 완료 이력 40/5 페이지·더 보기 포함                                                        |
| `npm run build`                         | strict 타입·웹·주 Worker와 발송 Worker dry-run 모두 통과. 표준 build에 두 번들을 통합                                         |
| `npm run check:free`                    | 두 추적 설정 통과. 기본 dry_run·유료 의존성 추가 없음                                                                         |
| 변경 파일 Prettier·`git diff --check`   | 통과                                                                                                                          |

R8의 13건은 확정 미접수 4종, 성공·unknown·취소 유지, 제한/401 소진 중 일시정지, production Cron→비공개 HTTP Worker→모의 429/-10·401/-401·403/-402, 새 연결 완료와의 경합을 검사한다. 미결정 재개 차단, 복구·제외 뒤 남은 카드 보존, claim 정리와 원래 모든 시도 기록을 확인한다. 응답 저장의 조건부 UPDATE와 기존 복구 트리거를 사용하며 추가 마이그레이션은 없다. 원격 카카오 호출은 하지 않는다.

조회 개선은 미결정 40건·선택한 요청 대상만 SQL에서 제한한다. 85건을 40/40/5로 처리하고 동일 decided_at의 완료 이력을 40/40/5 keyset 페이지로 중복·누락 없이 읽었다. 잘못된 커서·다른 예약 버전은 거부한다. 완료 이력 GET도 기존 세션 접근 제어를 통과해야 한다. 이 개선을 R5의 별도 미해결 결함으로 집계하지 않는다.

### 기존 23:45 예약의 읽기 전용 운영 확인

- 사용자 답변: **PC·Chrome·Codex를 종료하지 않았으며 마지막 카드 수신 시각은 23:45**. 이 결과를 PC 종료 시험으로 표시하지 않는다.
- D1: 예정 2026-09-30 23:45:00 KST, 호출 23:45:01.947, 저장 23:45:04.408. live/sent·attempts 1·시도 outcome sent. 원래 예약은 completed/disabled·cursor 1·next null이다.
- 사용자 원본 링크와 DB public_id가 일치한다. `/original/1e30986897f54acd96a0b5ab8d0f0ae5af94e9a94872498a932d32302eeb0a34`의 HTTPS 응답은 HTTP 200·image/png·87,785바이트로 DB bytes와 일치했다. 추가 메시지는 보내지 않았다.
- 인증은 version 4·connected·attempts 0·failure/retry null·잠금 없음이다. 액세스 만료는 2026-10-01 04:01:49.049 KST, 리프레시 만료는 2026-11-29 22:01:49.049 KST다. 이 값만으로 새 OAuth와 자동 갱신을 구분할 수 없으므로 **정상 토큰 갱신 성공은 미검증**이다. 만료 시각을 인위적으로 변경하지 않았다.
- 현재 활성 예약 0건, 일시정지 뒤 retry_wait/blocked/failed인데 복구 관계가 없는 R8 형태도 0건이다. 조회 결과 모두 rows_written=0·changed_db=false다. 운영 데이터 보정은 없다.
- 배포 목록과 Cloudflare 화면 모두 주 Worker `b760321e-2e8d-42f1-aab6-2d16c95745f0`(9월 30일 20:26 KST), 자식 `aa8c160b-965d-43d3-b09b-c154efe941d2`(19:57 KST)를 확인했다. R7 커밋은 23:38 KST이며 새 R7/R8 수정본은 아직 배포하지 않았다.
- 10월 1일 Cloudflare Workers 요금제 화면에서 **Free·US$0·현재 요금제**를 재확인했다. 기존 주 Worker에는 Logs/Traces가 비활성화돼 있어 지난 호출의 갱신 CPU를 소급 확정할 근거가 없다. 화면의 전체 기간 CPU 집계를 해당 갱신 호출 수치로 쓰지 않는다. 계정 전체 공유 사용량은 계속 미확인이다.

### 배포 전 운영 검증 계획

검증된 R7/R8 코드를 기존 두 Worker에 배포하는 단계는 이전 사용자 계획의 제외 범위였으므로 별도 승인을 받은 후 수행한다. 기존 D1/KV·Secrets·키·소유자·지연/횟수 상한·과거 예약/호출 이력은 보존한다. 신규 스키마 변경은 없다.

정상 갱신과 CPU는 자연 만료 이후의 첫 본인 한 장을 PC가 켜진 상태에서 로컬 tail의 안전한 CPU·시간·결과만 기록해 확인한다. 다음 한 장은 별도 미래 시각에 PC·브라우저·Codex를 종료하고 수신을 확인한다. 두 시험 모두 일회 예약과 일일 발송 예산을 사용하며 실제 접수·수신·CPU를 따로 기록한다. 위 계획 작성 시점에는 배포·새 시험 예약을 수행하지 않았고, 이후 아래 승인 범위를 적용했다.

## 승인 후 실제 배포·두 시험 예약 — 2026-10-01 08:02~08:10 KST

사용자는 두 Worker의 최신 수정 배포와 오늘 09:00 정상 갱신·CPU 시험, 09:10 PC 종료 수신 시험을 각각 본인 한 장으로 승인했다. 시험은 자연 만료 상태를 사용하며 키·암호문·만료값을 변경하지 않는다. 새 OAuth 연결이나 추가 메시지를 실행하지 않는다.

| 확인                            | 실제 결과                                                                                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 배포 코드                       | `a954ceda7248171a165e6069626a66ee795b3a4d` (R5~R8 포함)                                                                                                             |
| 실제 운영 구성 검사             | main SHA 147312546ff1548a24d1896552d5a53f88bd04693942968c24dbb8584e504b10, delivery SHA d57a2a40e2024cf982b0b0a9456f6be1121f50ebddc12352f600165385ec3abf, live 통과 |
| 실제 구성 dry-run               | 기존 두 Worker 바인딩·웹 자산 번들 통과                                                                                                                             |
| 비공개 발송 Worker 배포         | `4cd666e8-8f06-4135-a415-cbc900812c55`, 08:02:34 KST, 100%                                                                                                          |
| 주 Worker 배포                  | `1dbacb30-332c-40c1-8506-09b85ea0e996`, 08:02:47 KST, 100%, 기존 매분 Cron 1개                                                                                      |
| 배포 후 공개 경로               | boot HTTP 200·local false·mode live·카카오 설정 존재, 기존 원본 PNG 200/image/png·87,785바이트                                                                      |
| 자식 공개 접근                  | HTTP 404, Service Binding만 사용                                                                                                                                    |
| 09:00 일회 예약                 | `5ca71713-e8b8-4d6d-ba73-56a14f8461ed`, UTC 1790812800000, version 1·enabled·cursor 0·ready 이미지 1장                                                              |
| 09:10 일회 예약                 | `5e773613-b746-4fc2-8710-9c9f36d43b62`, UTC 1790813400000, version 1·enabled·cursor 0·ready 이미지 1장                                                              |
| 시험 전 DB                      | 시험 회차 0건, 오늘 sends 소비 0건, FK 오류 0건                                                                                                                     |
| 시험 전 인증                    | connected/version 4, 액세스 만료 04:01:49.049 KST, refresh 만료 2026-11-29 22:01:49.049 KST, refresh_attempts 0·failure null·잠금 없음                              |
| 정상 갱신·해당 호출 CPU         | **09:00 결과 대기**                                                                                                                                                 |
| 새 카드 실제 휴대전화 수신·원본 | **사용자 확인 대기**                                                                                                                                                |
| PC·Chrome·Codex 종료 후 수신    | **09:10 결과 대기**, 서버 접수와 사용자 종료/수신 증언을 함께 확인해야 함                                                                                           |

배포 목록과 읽기 전용 D1 조회로 위 상태를 확인했다. 카드 선택 검증의 첫 보조 SELECT는 잘못된 `schedule_version` 컬럼명으로 실패했고, 실제 스키마의 `schedule_items.version`으로 수정한 조회가 각 ready 이미지 1장과 시험 회차 0건을 확인했다. 실패한 SELECT로 운영 DB를 변경하지 않았다. 앱의 예약 저장 알림은 dry_run 동작도 설명하지만 실제 활성 모드는 boot와 화면 LIVE, 위 운영 설정에서 확인했다.

안전한 로컬 tail은 새 두 배포 버전에 한정해 Cron/준비/발송의 CPU·wall time·결과·예외 수만 저장한다. Wrangler 디스크 로그와 사용 통계 전송은 수집 프로세스에서 끈다. 요청 URL은 메모리에서 경로 분류만 하고 헤더·쿠키·본문·OAuth 응답·토큰·원래 예외는 저장하지 않는다. 초기 실행 세션이 사라진 것을 실제 PID와 도구 핸들로 확인한 후 숨김 백그라운드 프로세스로 다시 시작했다. Git 제외 `backups/live-cpu-en-card-20261001.jsonl`, `backups/live-cpu-en-card-delivery-20261001.jsonl`에 안전한 근거만 남기며 09:04 종료한다. 일회 후속 확인은 이 채팅에서 09:03 실행한다. 실제 발송 시각은 이 로컬 후속 작업이 아닌 Cloudflare Cron이 처리한다.

09:00 첫 시험 확인까지 PC·Chrome·Codex를 켜두고 정상 확인 뒤 09:10 전에 종료한다. 계정 Free·US$0은 같은 날 기존 화면 확인 기록을 유지하며 공유 사용량은 계속 미확인이다. 제품 코드는 전체 235개·Chromium 19개·타입/빌드가 통과한 그대로 배포했으며 문서·배포 변경에 전체 테스트를 반복하지 않았다. 전체 목표와 M5는 아직 완료하지 않았다.

## 09:00 정상 토큰 갱신·실제 접수·CPU 목표 미충족 — 2026-10-01 09:01 KST

08:58:14 KST의 시험 직전 조회에서도 version 4·connected·만료 04:01:49.049·refresh 유효·잠금/오류 없음이고 두 회차는 미생성이었다. 운영 키·토큰·만료값을 조작하거나 새 OAuth를 수행하지 않았다. 자연 만료 뒤 production Cron이 갱신을 수행한 결과를 새 인증 버전/만료와 실제 메시지 접수, 같은 배포의 tail 이벤트로 대조했다.

| 항목                                 | 실제 결과                                                                                                               |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| 첫 시험 delivery                     | `2d625475-af25-4b65-a262-875e2228908c-0`                                                                                |
| 예정 / 실제 호출 / 결과 저장         | 09:00:00 / 09:01:22.631 / 09:01:24.025 KST                                                                              |
| 발송 상태                            | live/sent, attempts 1, auth_retries 0, claim 없음, 시도 outcome sent                                                    |
| 원래 예약                            | completed/disabled, cursor 1, 새 재시도 없음                                                                            |
| 오늘 발송 예산                       | sends 1, 정상 갱신 대기는 메시지 시도 추가 소비 없음                                                                    |
| 새 인증                              | version 5·connected, 액세스 만료 15:01:19.985 KST, refresh 만료 기존 값 유지, refresh_attempts 0·failure null·잠금 없음 |
| 갱신 포함 주 Cron                    | **CPU 14ms**, wall 4369ms, outcome ok, 예외 0, 주 배포 `1dbacb30`                                                       |
| 비공개 회차 준비                     | CPU 4ms, wall 739ms, outcome ok, 예외 0, 발송 배포 `4cd666e8`                                                           |
| 비공개 실제 발송                     | CPU 10ms, wall 1606ms, outcome ok, 예외 0, 발송 배포 `4cd666e8`                                                         |
| 정상 토큰 갱신 / 카카오 API 접수     | **실제 성공 확인**                                                                                                      |
| CPU 10ms 목표                        | **Cron 초과로 미충족**. API 성공을 무료 CPU 검증 통과로 바꾸지 않음                                                     |
| 휴대전화 새 카드·원본 / PC 종료 수신 | 사용자 확인 대기, 09:10 종료 시험은 enabled/cursor 0·미소비로 유지                                                      |

Cron CPU 14ms에는 갱신과 claim/dispatch가 함께 포함된다. 별도 갱신 함수만의 CPU라고 주장하지 않는다. 약 1분 24초의 예정 대비 지연도 기록하며 정시·무중단을 보장하지 않는다. 09:00:33의 보조 D1 읽기는 일시적인 Cloudflare API 7403 오류였고 동일한 읽기 재시도가 성공했다. 제품의 토큰 갱신 실패나 추가 메시지 시도로 집계하지 않는다.

같은 날 공식 [Workers 가격](https://developers.cloudflare.com/workers/platform/pricing/)·[호출 한도](https://developers.cloudflare.com/workers/platform/limits/)에서 Free 100,000요청/일·HTTP와 Cron 호출당 CPU 10ms를 다시 확인했다. 외부 fetch/KV/DB 응답 대기는 CPU에 포함되지 않고 간헐적 초과에 실행 여유가 있어 outcome ok여도 10ms 충족 근거가 되지 않는다. [D1 가격](https://developers.cloudflare.com/d1/platform/pricing/)은 Free 읽기 500만/일·쓰기 10만/일·총 저장 5GB, [KV 가격](https://developers.cloudflare.com/kv/platform/pricing/)은 저장 1GB·읽기 10만/일·쓰기/삭제/list 각각 1,000/일·00:00 UTC 일일 초기화를 명시한다. 계정 Free 확인과 호출 CPU·공유 사용량 확인은 각각 구분한다.

후속 과제는 갱신 포함 CPU 경로를 경량화하거나 기존 무료 작업으로 분할하고 회귀·두 Worker 검증 및 실제 정상 갱신 CPU를 다시 확인하는 것이다. 추가 실제 발송은 기존 두 시험의 승인 범위를 넘어 자동 실행하지 않는다. 자연 만료 상태를 유지하며 다음 액세스 만료는 15:01:19.985 KST이다. 이 절은 09:01 결과이며 이후 종료 수신 확인은 아래 절을 따른다. M5·전체 목표는 CPU 보완이 남아 완료하지 않았다. 이 채팅에서 첫 결과를 직접 확보해 일회 09:03 확인 자동화는 PAUSED로 종료했다. 안전 CPU 수집기는 09:04 자동 종료했고 Git 제외 로컬 근거를 보존한다.

## PC·Chrome·Codex 종료 후 이미지·원본 수신 — 2026-10-01 09:11 KST

사용자가 PC·Chrome·Codex를 모두 종료했고 09:11에 카드가 도착했다고 확인했다. 제공한 카카오 사진은 Take your time 표현형 이미지와 오전 9:11 시각을 보여준다. 휴대전화에서 원본 보기도 정상적으로 열린다고 답했다. PC 종료의 정확한 시각은 별도로 제공하지 않았으며 추정값을 기록하지 않는다.

| 항목                      | 실제 결과                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 예약 / delivery           | `5e773613-b746-4fc2-8710-9c9f36d43b62` / `ae29ade8-b51d-4fb8-bcea-0c15beb05b5c-0`                             |
| 예정 / 호출 / 결과 저장   | 09:10:00 / 09:11:05.511 / 09:11:07.430 KST                                                                    |
| API 결과                  | live/sent, attempts 1, auth_retries 0, claim 없음, 시도 outcome sent                                          |
| 원래 예약                 | completed/disabled, cursor 1, next_run 없음                                                                   |
| 실제 수신                 | **사용자 확인: 세 프로그램/기기 종료 상태, 09:11 이미지 수신·원본 정상**                                      |
| 표현형 원본               | public ID `50d0803d255a490e8f59d1a411a4c2c98df1ccba043344a49f9f6d1e2e702e17`, HTTP 200·image/png·84,292바이트 |
| 09:42 읽기 전용 운영 조회 | 두 시험 종료, 활성 예약 0, 2026-10-01 sends 2, connected/version 5·오류/잠금 없음                             |
| 해당 회차 CPU             | 미측정. 안전 수집기는 09:04 종료됐으므로 09:00 수치를 재사용하지 않음                                         |

서버 접수와 휴대전화 수신을 각각 확인했으며 로컬 모의 테스트와 구분한다. 예정 대비 약 1분 7초 늦게 접수됐다. PC 종료 발송·이미지·원본 검증은 완료했고 정상 갱신 포함 CPU 14ms 보완·재측정은 남아 있다. 두 승인 시험은 각각 1회로 종료했으며 추가 예약·메시지·배포·키/토큰 변경은 하지 않았다. 계정 Free·US$0은 같은 날 확인 기록을 유지하고 공유 사용량은 미확인이다.

## 정상 갱신 CPU 분리의 로컬 검증 — 2026-10-01

`auth.ts`·`crypto.ts`는 정상 갱신 표시와 인증 작업 안의 AES 키 준비 1회를 적용한다. `engine.ts`·`index.ts`·`delivery-service.ts`는 갱신 성공 시 기존 비공개 Worker에 ID·claim 소유자만 보내 정리하고 메시지를 다음 분 실행으로 넘긴다. 토큰 원문·암호문·키는 정리 요청에 없다. claim 소유권·일시정지·취소·버전·15분 유예·원래 회차/커서와 메시지 한도를 유지한다. 기존 주·비공개 발송 Worker 두 개와 바인딩·Secret·DB 스키마는 그대로다. UI와 설정/운영 안내에 추가 대기를 반영했다.

| 검사                         | 결과                                                      |
| ---------------------------- | --------------------------------------------------------- |
| 새 갱신 분리 회귀            | **16개 통과**, 51.04초                                    |
| 전체 Vitest                  | **16개 파일 251개 통과**, 10:13:01 KST 시작·670.59초      |
| 전체 Chromium E2E            | **19개 통과**, 1.2분                                      |
| npm run build                | strict 타입·웹·주/발송 두 Worker dry-run 통과             |
| 실제 운영 설정 두 dry-run    | 기존 D1/KV·Service Binding·자산 번들 통과, 원격 배포 없음 |
| 무료 구성                    | 추적 기본 설정·실제 live 두 설정 모두 통과                |
| 변경 파일 Prettier·diff 검사 | 통과                                                      |
| 추가 실제 카카오 메시지·CPU  | 미실행, 기존 두 시험 승인 범위 밖                         |

16건은 실제 production Cron과 비공개 HTTP 진입점을 연결하되 격리 D1/KV·가짜 인증·모의 제공사 응답을 사용한다. 정상 갱신 첫 실행에 메시지 0회·예산 불변·claim 정리를 확인하고, 다음 실행들의 5장 3/2 처리와 유효 토큰의 즉시 처리를 확인했다. 401 뒤 갱신에도 분리를 적용하고 허용한 추가 메시지 1회·auth_retries 1을 확인했다. 잘못된 소유자·중복 정리, 정리 호출 전/후 응답 유실의 안전한 재개, 일시정지/취소·15분 경과, 새 OAuth·동시 갱신, R7 키 형식 오류, 회전 시 AES 키 준비 1회와 다른 키 격리를 포함한다. 정상 정리의 retry_at은 다음 분 경계이며, 정리 미접수 시 claim 만료 경계 자체에서는 회수하지 않고 이후 실행에서 회수한다.

이 회귀의 통과는 CPU 작업 분리·보호 동작을 검증한 것이며 실제 ms CPU 통과 근거가 아니다. 현재 운영 배포는 `a954ceda`·주 `1dbacb30`·발송 `4cd666e8` 그대로다. 새 분리 코드의 실제 배포와 자연 만료 후 정상 갱신/다음 발송의 CPU 재측정은 승인 후 수행한다. 현 액세스 만료는 15:01:19.985 KST이며 추가 키·토큰·만료 조작이나 자동 예약은 없다.

실제 live 설정 SHA-256은 주 `147312546ff1548a24d1896552d5a53f88bd04693942968c24dbb8584e504b10`, 발송 `d57a2a40e2024cf982b0b0a9456f6be1121f50ebddc12352f600165385ec3abf`로 배포 전 기록과 같다. 최종 무료 검사도 accountPlan/remoteCpu는 검사 자체로 확인하지 않는다고 표시한다. 같은 날 Dashboard의 Free·US$0 기록을 유지하고 계정 공유 사용량은 미확인이다. 다음 실행 명령은 `npm run build`, `npm run check:free -- --config wrangler.live.jsonc --delivery-config wrangler.delivery.deploy.jsonc --mode live`이며 승인 후 자식→주 순서로 `npx wrangler deploy --config wrangler.delivery.deploy.jsonc`, `npx wrangler deploy --config wrangler.live.jsonc`를 수행한다. CPU 측정은 새 배포 버전의 갱신 Cron·정리 요청·다음 발송 Cron·준비/발송 요청을 각각 확인해야 한다.

## CPU 분리 승인 배포·10:45 유효 토큰 시험 준비 — 2026-10-01

위 로컬 검증 절의 미배포·15:01 만료는 배포 전 시점 기록이다. 사용자 승인으로 제품 코드 `8638e2ab0023d0d9e5435ab98c574db854ab4c6a`를 같은 실제 live 설정으로 배포했다. 비공개 `en-card-delivery`를 먼저 배포했으며 버전 `42185de3-70c5-43b4-a4c3-cc81a0ffcff3`의 배포 시각은 10:32:48.877 KST, 주 `en-card` 버전 `fe54570a-9a08-4584-8ba4-837f07148a2b`는 10:33:04.267이다. 목록에서 각각 100% 적용을 확인했다. boot는 live·kakao_configured true, 비공개 자식의 공개 접근은 404, 기존 원본 PNG는 200·image/png·87,785바이트다. 기존 D1/KV·Secrets·스키마·바인딩·Cron 하나를 유지했고 PR은 병합하지 않았다. 배포 startup 20/28ms는 호출별 CPU 측정이 아니다.

최초 승인 시각 10:35를 넘겨 예약을 만들지 못했으며, 최소 2분 여유를 우회하지 않고 사용자에게 재선택을 요청했다. 사용자가 **10:45 유효 토큰 본인 한 장 시험**을 선택했다. 앱에서 예약 `083f9d84-f0bc-4486-bcbc-ae5b7a715025`를 once/version 1·10:45 KST로 저장했다. UTC 01:45·1790819100000, enabled 1·cursor 0·준비 이미지 한 장(비교형·87,785바이트), 시험 회차 0·오늘 sends 2·FK 오류 0을 읽기 전용 조회로 확인했다. 15:05 예약이나 추가 카드는 만들지 않았다.

인증 메타데이터는 이전 version 5에서 조회 중 version 6·7로 바뀌었다. 시험 전 최신은 version 7·connected, 액세스 만료 16:38:16.112 KST, refresh 만료 2026-11-30 10:38:16.112, 시도 0·오류/잠금 없음이다. 변경 원인을 OAuth/정상 갱신 중 하나로 단정하지 않는다. 이번 배포·예약 작업에서 로그인·재연결·키/토큰/만료 조작은 수행하지 않았다. 10:45 시험은 정상 갱신 CPU 검증을 대신하지 않는다.

두 새 배포 버전의 Cron·준비·발송·정리 호출을 안전 수집기로 구분한다. 저장 항목은 호출 시각·CPU/wall·결과·예외 개수·버전뿐이며 원문 요청/응답·토큰·키·쿠키는 보관하지 않는다. Wrangler 디스크 로그/사용 통계는 수집기에서 비활성화했고 산출물·화면은 Git 제외 backups에 둔다. 조회 준비 중 잘못된 열 이름 두 건(i.card_id/a.status)은 7500으로 실패했으며 스키마의 a.card_id/a.state로 정정한 읽기 전용 조회는 통과했다. 제품 실패나 발송 실패로 집계하지 않는다.

## 새 배포의 유효 토큰 실제 발송·CPU 결과 — 2026-10-01 10:45 KST

| 항목               | 실제 결과                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------- |
| 대상               | 위 10:45 once 예약, 기존 비교형 이미지 한 장, 본인 나와의 채팅                               |
| delivery           | `712a9dfd-89fd-4a93-b8f0-00b927b68c67-0`                                                     |
| 호출 / 결과 저장   | 10:45:55.209 / 10:45:57.583 KST (`1790819155209` / `1790819157583`)                          |
| 발송               | live·sent, attempts 1·auth_retries 0, claim_owner/claim_until 없음                           |
| 예약               | completed·enabled 0·cursor 1·version 1·next_run null                                         |
| 인증               | 시험 전후 version 7·connected·같은 액세스 만료 16:38:16.112, 갱신 시도 0·오류/잠금 없음      |
| 예산 / 활성 예약   | 오늘 sends 2→3, 활성 예약 0                                                                  |
| 주 Cron            | CPU **4ms**, wall 4356ms, 10:45:53.729 시작, 새 주 버전 일치                                 |
| 비공개 준비        | CPU **2ms**, wall 982ms, 10:45:53.730 시작, 새 자식 버전 일치                                |
| 비공개 발송        | CPU **7ms**, wall 2642ms, 10:45:55.209 시작, 새 자식 버전 일치                               |
| 호출 결과          | 세 호출 모두 outcome ok·예외 0                                                               |
| 모바일 이미지      | 사용자 사진의 **10:45 비교형 카드 수신·이미지 표시 확인**                                    |
| 원본               | 사용자 제공 기존 비교형 URL, 서버 200·image/png·87,785바이트. 휴대전화 열림은 명시 확인 대기 |
| 정상 갱신·정리 CPU | 이번 회차에는 실행되지 않아 미검증                                                           |

새 코드의 **이번 유효 토큰 발송 호출**은 모두 10ms 목표를 충족했다. wall은 네트워크/DB 응답 대기를 포함하며 CPU와 구분한다. 이전 갱신 포함 Cron 14ms를 이 4ms로 대체하지 않는다. 새 코드의 자연 만료 정상 갱신 Cron·정리 요청·다음 발송 호출을 각각 측정해야 한다. 키·토큰·만료를 조작하거나 추가 발송을 자동 예약하지 않는다. 제품 소스와 설정은 전체 251개·Chromium 19개·빌드·두 실제 설정 dry-run·무료 검사를 통과한 `8638e2a` 그대로이고 이번 후속은 문서 변경이다.

## 16:42 자연 만료 갱신 CPU 시험 승인·준비 — 2026-10-01

사용자의 **진행 승인**은 앞서 요청한 16:42 KST 본인 카드 한 장 추가 시험을 허용한다. 기존 Chrome 운영자 세션에서 로그인·재연결 없이 일회 예약을 저장했다. 추가 배포·키/토큰/만료 변경·반복 예약·PR 병합은 없다. 아래는 시험 전 기준이며 실제 갱신·API 접수·CPU·새 모바일 수신 완료 기록이 아니다.

| 기준        | 시험 전 확인                                                                           |
| ----------- | -------------------------------------------------------------------------------------- |
| 예약        | `30ba832f-8b4b-479b-a2e1-79bac0457a39`, once·2026-10-01 16:42 KST                      |
| UTC / 상태  | 07:42·1790840520000, version 1·enabled 1·cursor 0, 활성 예약 1                         |
| 준비 이미지 | 기존 비교형 asset `623d64a6-4c5e-4f2c-8965-aef1905fc386`, ready·87,785바이트·한 장     |
| 인증        | connected/version 7, 액세스 만료 16:38:16.112 KST·refresh 만료 2026-11-30 10:38:16.112 |
| 갱신 / 예산 | 시도 0·오류/잠금 없음, 시험 회차/발송 0·오늘 sends 3, FK 오류 0                        |
| 운영 코드   | 제품 `8638e2a`, 주 `fe54570a`·비공개 발송 `42185de3`, 기존 무료 구성 유지              |
| 수집 대기   | 실제 PID 38812/39964·node, 16:39 시작·16:52 자동 종료                                  |
| 수집기 검사 | node --check 통과, 준비 시 대기 이벤트 확인, CPU 실측은 아직 없음                      |
| 후속 확인   | 기존 이 채팅 heartbeat ACTIVE·오늘 16:40 사전 확인·16:46 결과 확인의 두 번 실행       |

수집기는 이전에 검증한 안전 parser를 사용하며 Cron·준비·발송·`/_internal/defer` 정리를 구분한다. 긴 시간 tail 연결을 유지하지 않고 시작 전 node 타이머로 대기한다. `backups/refresh-cpu-job-20261001-1642.json`의 PID와 현재 프로세스로 대기를 확인하며 관찰 timeout이나 파일만으로 실행 종료를 판단하지 않는다. 생존하지 않거나 명확한 종료가 확인된 경우에만 수집기를 다시 시작한다. 원문 요청/응답·쿠키·키·토큰은 저장하거나 출력하지 않고 산출물은 Git 제외 backups에 둔다. heartbeat는 새 발송이나 토큰 변경을 수행하지 않으며 승인된 한 장의 결과만 확인한다.

이번 변경은 제품 코드와 설정을 바꾸지 않아 기존 전체 Vitest 251개·Chromium 19개·두 Worker 빌드·무료 구성 통과 기록을 유지한다. 문서 서식·diff와 로컬 수집기 문법을 검사한다. 정상 갱신·CPU 결과는 시험 후 기록한다. 계정 Workers Free·US$0은 같은 날 확인 기록을 유지하며 계정 공유 사용량은 여전히 미확인이다. PC·Codex를 켜두고 카카오 다시 연결을 실행하지 않는 것이 이번 시험 조건이다.
