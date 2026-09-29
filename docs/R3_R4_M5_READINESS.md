# R3·R4 보완과 M5 배포 준비

커밋 전 원격 SHA 확인: 2026-09-29 10:52:11 KST. 개발 worktree: `.worktrees/development`, 브랜치: `codex/development`.
검증 기준 HEAD와 당시 원격 SHA는 모두 `dcc9f77474032f1772b04d7e64850d41ee8e67ca`였다. 이 문서는 그 기준 이후의 R3·R4 보완과 M5 배포 준비 변경을 다룬다. 반영 커밋은 이 문서를 포함하는 후속 커밋으로 식별한다. 원격 리소스 변경·배포·실제 카카오 발송·PR 병합은 수행하지 않았다.

## 동작과 선택 근거

### R3 — 현재 회차의 미발송을 명시적으로 처리

기존에는 10장·회차당 5장 중 3장을 접수한 뒤 일시정지하면 나머지 2장이 취소되고, 재개 시 미소비 5장만 남았다. 현재는 중지 전에 미발송 수·목록을 확인하고 중지 완료 후 실제 결과를 다시 보여준다. 미발송 2장은 새 미래 시각에 예약하거나 명시적으로 제외한다. 회차에 들어가지 않은 5장은 기존 재개 절차로 이어 보낸다.

| 보호                | 구현 판단                                                                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 접수·결과 불명 보존 | state만 보지 않고 전체 delivery_attempts, attempts 개수, 수신 확인, resolution, 사용자 확인 기록을 검사. sent/mock_sent·sending·unknown·abandoned 및 과거 접수/unknown 이력은 자동 편입하지 않음 |
| 새 미래 예약        | 최소 현재+2분. 과거 회차·커서를 되돌리지 않으며 원본 due_at과 취소/호출 이력을 보존. 오래된 원본도 즉시 몰아보내지 않음                                                                          |
| 고정 버전           | 원본 asset_id·payload를 새 예약 항목에 복사. 카드 원문이 바뀌어도 고정 이미지가 있으면 사용. 이미지 부재는 사유를 표시하여 제외/재작성 선택 필요                                                 |
| 중복·경합           | 원본 delivery_id를 PK로 하는 pause_recoveries에 단일 결정과 새 예약/순서를 기록. D1 batch의 조건부 변경 ID와 트리거가 동시 요청·상태 변경을 차단                                                 |
| 원본 예약           | 복구만으로 기존 예약을 활성화하지 않음. 별도의 남은 목록 재개. 취소된 원본은 중지 카드 확인만 가능하며 재활성화하지 않음                                                                         |
| 이미지 수명         | 결정 전 후보는 삭제 보호. 명시적 제외 후에도 다른 예약/미확정 발송의 보호 조건은 유지                                                                                                            |
| R1 유지             | sending·미해결 unknown이 있어도 중지는 허용하지만 복구와 버전 변경·재개는 차단. 조회 뒤 경합도 SQL 조건에서 재확인                                                                               |

원본별 결정은 불변이고 새 예약과 연결되어 추적 가능하다. 복구 예약의 이후 변경·취소는 일반 예약 절차를 따른다. 선택 화면에는 제외 수·목록과 확인란을 제공한다. 취소된 원본이 자동으로 다시 실행되지 않는다. 5장을 넘는 대상은 5장씩 2분 간격으로 새 예약을 만들며 활성 예약 10개·분당 3건 상한을 유지한다.

### R4 — PNG 청크 구조와 CRC

기존 33바이트 헤더 허용을 차단했다. 1080×1080·1MiB는 그대로다. 모든 청크의 길이·경계·유효한 이름, 첫 IHDR의 길이/중복/색상/비트 깊이/압축/필터/인터레이스, PLTE의 순서·허용 조건, 연속 IDAT와 비어 있지 않은 합계, 마지막 IEND 및 뒤쪽 잔여 바이트를 검사한다. 알 수 없는 필수 청크와 애니메이션 PNG는 거부한다.

[PNG 규격](https://www.w3.org/TR/png-3/)의 청크 순서·CRC 정의를 기준으로 **모든 청크의 타입+데이터 CRC-32**를 검사한다. 보조 청크 CRC도 생략하지 않는다. 고정 256항목 표와 바이트 순회를 사용하므로 입력 길이에 비례하며 파일 크기는 1MiB로 제한한다. 업로드 검증은 D1 횟수/저장량 예약과 KV put보다 먼저 수행된다.

**보장 범위는 구조와 CRC다.** IDAT의 zlib 스트림을 전체 압축 해제하거나 필터·픽셀 수·팔레트 인덱스를 완전히 디코딩하지 않는다. 보조 청크 내부 의미도 전체 검증하지 않는다. 올바른 CRC를 붙인 잘못된 압축 데이터까지 유효한 이미지로 증명하지 않으며 CRC는 콘텐츠 인증 수단이 아니다. 저장 전 브라우저 미리보기와 검토, 실제 운영 이미지 수신 확인이 별도로 필요하다. 서버 디코더·브라우저 서비스·새 의존성·유료 이미지를 추가하지 않았다.

정상 테스트 fixture는 native zlib로 만든 실제 압축 해제 가능한 4,613바이트 RGBA PNG다. 테스트 CRC oracle은 Node native crc32로 독립 생성한다. 33바이트 fixture는 거부 테스트에 남겼고 실제 Canvas PNG는 E2E에서 생성·업로드한다.

## 변경 파일

| 파일                                                                                  | 책임                                                               |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `src/worker/pause-recovery.ts`, `src/shared/model.ts`                                 | 중지 목록·복구 계획, 입력 검증, 원본별 원자적 결정, 미래 예약      |
| `migrations/0009_pause_recovery.sql`                                                  | 이전 취소 이력의 복구 후보, 결정 불변·안전성·재개·이미지 보호      |
| `src/worker/schedules.ts`, `src/worker/index.ts`                                      | 기존 재개 보호와 인증/CSRF 적용 API 연결                           |
| `src/web/PauseDialogs.tsx`, `App.tsx`, `styles.css`                                   | 중지 목록, 복구·제외·시각 확인, 결과·기존 목록 재개                |
| `src/worker/png.ts`, `storage.ts`                                                     | PNG 구조·CRC 검사와 업로드 연결                                    |
| `scripts/check-free.mjs`, `.gitignore`                                                | 명시적 설정 경로/모드 검사, 기본 dry_run 보호, 운영 설정 파일 제외 |
| `tests/r3-r4.test.ts`, `pause-recovery.test.ts`, `png.test.ts`, `free-config.test.ts` | 실패 재현·정상 동작·경합·오류 업로드·무료 구성 보호                |
| `tests/png-fixture.ts`, `helpers.ts`, `storage.test.ts`                               | 실제 PNG fixture, 바뀐 실제 바이트 수를 사용한 동일 용량 경계 검증 |
| `tests/e2e/pause.spec.ts`, `db.ts`, `recovery.spec.ts`                                | 실제 Canvas와 중지/복구/제외 흐름, 격리 D1 fixture 공유            |
| `docs/PROGRESS.md`, `VERIFICATION.md`, `SETUP.md`, `OPERATIONS.md`, 이 문서           | 현재 상태·근거·운영 입력표·실행/중단/복원 절차                     |

R1·R2 보고서에는 현재 결과 문서 링크만 추가했다. 첨부 검토 원문, 기존 0001~0008, 잠금 파일, 기본 wrangler.jsonc는 보존했다.

## 실패 재현과 최종 검증

수정 전 정상 기대 테스트를 먼저 실행했다. `npm test -- tests/r3-r4.test.ts`는 10:15:57 KST 시작, 2.26초에 **2개 모두 실패**했다. R3는 명시적 복구/제외 없이 재개가 성공 반환했고, R4는 33바이트 파일이 예외 없이 통과했다. 동일 테스트는 수정 후 전체 통과 결과에 포함된다.

| 실제 실행 명령                                                                                                                                          | 결과·범위                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `npm test -- tests/r3-r4.test.ts tests/pause-recovery.test.ts tests/png.test.ts tests/free-config.test.ts tests/storage.test.ts`                        | 5개 파일 62개 통과. 10:40:13 시작, 34.82초                                                                                           |
| `npm test`                                                                                                                                              | 12개 파일 177개 통과. 10:41:35 시작, 91.16초. 기존 131개 결과를 재사용하지 않음                                                      |
| `npm run typecheck`                                                                                                                                     | 통과. build에서도 다시 수행                                                                                                          |
| `npm run build`                                                                                                                                         | 통과. Vite 및 Worker 로컬 dry-run 번들, gzip 약 142.86KiB. 원격 배포 아님                                                            |
| `npm run check:free`                                                                                                                                    | 기본 dry_run 통과, 허용 의존성/바인딩/호스트와 운영 번들 검증                                                                        |
| `npx wrangler deploy --dry-run --config wrangler.live.jsonc --outdir .worker-build` 후 `npm run check:free -- --config wrangler.live.jsonc --mode live` | 동일한 임시 placeholder live 파일로 로컬 번들·검사 통과. deploymentPerformed=false. 검사 후 임시 파일 제거                           |
| `npm run test:e2e`                                                                                                                                      | 최종 Chromium 10개 통과, 23.6초. 정상 Canvas PNG 업로드, 복구/제외 각각, 기존 5장 재개, 취소 후 카드 기록, 기존 R1·R2 및 모바일 흐름 |
| `npm run db:migrate:local`                                                                                                                              | 백업 후 개발 DB의 0009 적용, 이력 8→9. FK 위반 없음                                                                                  |

검증 환경: macOS arm64, Node 24.6.0, npm 11.5.1, Wrangler 4.142.0, Playwright 1.63.0. 테스트는 로컬 포트 권한으로 실행했고 Wrangler 로그는 `/private/tmp`에 썼다. API 응답과 발송은 모의 주입이며 live 설정 **검사**를 실제 live 발송으로 보고하지 않는다.

새 테스트 준비 중 발생한 실패는 실제 fixture와 계약에 맞춰 수정했다. 저장량의 기존 33바이트 상수는 실제 PNG 길이로 대체했고, 과거 호출 fixture는 같은 분의 3건 예산과 섞이지 않도록 과거 시각에 넣었다. macOS `/var`→`/private/var` 경로는 realpath로 비교한다. E2E 검토 요청은 API가 요구하는 `reviewed: true`를 포함했다. 제품 assertion·쿼터·동의 검사를 완화하거나 테스트를 skip하지 않았다.

외부 검토의 `uv_interface_addresses returned Unknown system error 1`은 현재 환경에서 재현되지 않았다. Playwright는 기존 8787 서버 재사용 없이 독립 `.wrangler/e2e-*` DB로 시작해 실제 Chromium을 실행했다. 다른 환경에서는 포트 점유와 Node/잠금 파일 버전을 확인한 뒤 `WRANGLER_LOG_PATH=/tmp/en-card-e2e.log npm run test:e2e`를 실행한다. 실패를 성공으로 처리하지 않는다.

로컬 증거 로그: `/private/tmp/en-card-r3-r4-red.log`, `en-card-r3-r4-focused-final.log`, `en-card-r3-r4-all.log`, `en-card-r3-build.log`, `en-card-r3-e2e-final.log`, `en-card-r3-live-bundle.log`, `en-card-r3-live-check.log`, `en-card-r3-db-before.json`, `en-card-r3-db-after.json`, `en-card-png-benchmark.json`. 이 파일들은 임시 로컬 자료이며 Git에는 포함하지 않는다.

### R1·R2와 데이터 보존

- 기존 R1·R2 단위/통합 및 UI 검증은 이번 전체 실행에 포함됐다. 새 복구 경로에서도 sending·미해결 unknown은 재개를 막고 중지는 허용한다.
- 신규 Miniflare·E2E DB에 0001~0009 전체를 적용했다. 별도 0008 DB에 원본 deliveries·사용량을 준비한 뒤 0009를 적용하여 원본 행·외래키 보존 및 미발송 2장 복구를 검사했다.
- 개발 DB는 `backups/pre-r3-r4-20260929.sql`에 로컬 export 후 0009를 적용했다. 적용 전후 카드·이미지·예약·저장량은 각 0이고 FK 검사는 빈 결과다. 데이터가 있는 업그레이드의 근거는 위 독립 통합 테스트다.
- 0009는 원본 발송·취소 이력을 다시 pending으로 바꾸지 않는다. 새 코드 실행 전 0009가 필요하다. 스키마를 모르는 이전 Worker로 단순 rollback하지 않으며 복구 절차는 OPERATIONS.md를 따른다.

### PNG 검사 비용의 로컬 측정

Node arm64에서 warm-up 100회 후 각 1,000회 검사했다. 4,613바이트는 중앙값 0.0303ms/p95 0.0333ms, 정확히 1MiB는 중앙값 6.7218ms/p95 7.1125ms/최대 8.7320ms였다. 큰 입력은 정상 PNG에 CRC가 맞는 큰 보조 청크를 넣은 **구조 검사 부하 fixture**이며 보조 청크 의미나 원격 렌더링 성공을 증명하지 않는다.

측정에는 네트워크·D1·KV·인증·Worker 시작 비용이 포함되지 않는다. [Workers 제한](https://developers.cloudflare.com/workers/platform/limits/)의 실제 Free CPU 10ms 충족 증거로 사용하지 않는다. 원격 최대 크기 업로드와 Cron 경로를 각각 측정하고 초과하면 live 확대를 중단해야 한다.

재현용 로컬 번들 명령은 아래와 같다. esbuild는 이미 잠금 파일에 설치된 Wrangler 도구 의존성이다. 입력은 두 번들에서 내보내는 `validPng()`와 `assemble([PNG_CHUNKS[0], chunk('tEXt', new Uint8Array(1048576-validPng().length-12)), ...PNG_CHUNKS.slice(1)])`를 사용하고 `performance.now()`로 `validatePng(bytes)`만 측정한다.

```sh
npx esbuild src/worker/png.ts --bundle --platform=node --format=esm --outfile=/tmp/en-card-png-bench.mjs
npx esbuild tests/png-fixture.ts --bundle --platform=node --format=esm --outfile=/tmp/en-card-png-fixture.mjs
```

## M5 준비와 남은 조건

기본 dry_run SHA-256: `2816ba30069eaebd222386283a9467119edfbd2b10013a32ad0e01e547b914b7`.
검사한 임시 live 파일 SHA-256: `48152e63ccd8070a5fffce3b9b2fb0d066fede0fe5f70dc7ae4def8443bce859`.
운영자는 실제 값이 들어간 자신의 설정 파일을 다시 검사해야 한다. 두 검사 모두 계정 Free 플랜은 미확인, 원격 CPU는 미검증, 과금 보장 없음으로 보고했다. 새로운 유료 바인딩·AI API·패키지를 추가하지 않았다.

| 준비 완료                                                      | 아직 미완료                                                  |
| -------------------------------------------------------------- | ------------------------------------------------------------ |
| 별도 설정 파일에도 동일한 무료 구성 검사, 경로·모드·SHA 출력   | 실제 Cloudflare Free 계정·공유 사용량 확인, 운영 D1/KV·주소  |
| DB 백업·적용 이력 확인·후속 마이그레이션·dry_run→live 명령     | 실제 원격 백업·마이그레이션·배포                             |
| Kakao Redirect/도메인/talk_message 및 Secret 입력 위치 표      | 실제 앱 설정·Secret 입력·로그인·동의·갱신                    |
| 일시정지/Cron 제거/dry_run 중단, 호환 스키마·별도 DB 복원 절차 | 원격 CPU·쿼터, 카카오 이미지 접근·휴대전화 수신·PC 종료 검증 |

다음 순서는 [SETUP.md](SETUP.md)의 운영 입력 표를 채우고, 기존 DB 백업 → 미적용 migration → dry_run 배포 → 인증·공개 이미지·예약 확인 → 허용된 본인 테스트 live 전환 → 휴대전화 수신·실제 토큰 갱신·PC 종료 예약 관측이다. 실제 토큰 갱신을 관측하지 못하면 미검증으로 남긴다. 수신·PC 종료 검증에는 사용자의 별도 휴대전화 관측이 필요하다. [OPERATIONS.md](OPERATIONS.md)의 중단 기준과 데이터/스키마 복원 절차를 함께 적용한다. **M5는 준비 완료, 실제 운영 검증 미완료다.**

이번 반영 대상은 28개 파일(기존 파일 수정 16개, 새 파일 12개)이며 소스·테스트·0009·문서를 함께 포함한다. Secret·로컬 DB·백업·생성 산출물은 제외한다. 별도 PR 갱신과 master 병합은 범위에 포함하지 않는다. 루트 master는 원격과 같은 `08058916e02f5059f786179064edc9778f3897ce`이며 기존 worktree를 유지했다. 검증 후 개발 서버를 기존 로컬 DB로 다시 시작했고 `http://127.0.0.1:8787/api/boot`의 HTTP 200을 확인했다.

커밋 전 검증 대조에서 Worker 프로젝트 소스 15개가 성공한 로컬 번들의 sourcesContent와 정확히 일치했고, 웹 JS/CSS 산출물 이름도 최종 테스트 당시 빌드와 같았다. 이후 소스 변경은 PauseDialogs.tsx의 포맷 정리뿐이며 동작 변경은 없다. 전체 177개·E2E 10개 결과를 유지하고 커밋 전 typecheck·build·check:free를 다시 확인했다. 이번 게시 작업에서 추가로 수정한 것은 문서의 반영 상태 설명뿐이다.
