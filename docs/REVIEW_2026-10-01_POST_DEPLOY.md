# R11 배포 후 PR 재검토와 승인된 보완 — 2026-10-01

사용자의 CPU 측정 필요 여부 질문과 `$review` 요청으로 수행했다. 검토 대상은 PR #1의 `0c34fff839d30a98079f9d972413ac5e3776e108`, 기준은 `origin/master`의 `08058916e02f5059f786179064edc9778f3897ce`다. 운영 제품 소스는 `6ec4579124f4d0d29dd34507f66ae7187476fb96`이며 0011까지 적용됐다. 로컬 HEAD·원격 브랜치·PR HEAD 일치를 다시 확인했다.

첫 검토에서 **7건**을 확인했다. 현재 상태 문서의 잘못된 배포 정보 1건은 로컬에서 정정했다. 사용자가 **P2 4건과 P3 2건 모두 로컬 수정·검증**을 승인하여 아래 보완과 최종 전체 회귀 검증을 완료했다. Vitest **299개**·Chromium **19개**가 통과했고 수정 후 독립 검토의 추가 미해결 결함은 0건이다. P1은 확인하지 못했다. 운영 변경·추가 카카오 발송·커밋·푸시·PR 병합은 수행하지 않았다.

## CPU와 리뷰의 관계

코드 리뷰는 CPU 실측과 별도로 수행할 수 있다. 다만 프로젝트의 무료 운영 완료 조건에는 최신 제품 소스의 실제 호출 CPU 검증이 필요하다. [Cloudflare 공식 제한](https://developers.cloudflare.com/workers/platform/limits/)은 Free HTTP·Cron 호출에 CPU 10ms를 명시하며 네트워크·KV·DB 응답을 기다리는 시간은 CPU와 구분한다. 배포 startup 시간, 로컬 테스트 실행 시간, HTTP 성공은 발송 CPU 증거가 아니다.

이전 `8638e2a`의 유효 토큰 4/2/7ms, 조기 갱신 6/2/2ms·다음 발송 2/1/3ms 및 사용자 휴대전화·PC 종료 수신은 당시 실제 기록으로 보존한다. 최신 `6ec4579`의 발송·갱신·다량 발송 CPU는 미측정이다. 새 실제 발송은 이번 리뷰 범위에 포함하지 않았다. 보완본을 검증한 후 승인된 시험으로 메인 Cron·비공개 준비·갱신 정리·카드 전송을 구분해 측정하는 순서가 적절하다.

## R12 — 과거 원인 불명 취소가 이미 보낸 카드의 복구 후보로 남음 · P2

위치: `migrations/0011_delivery_cancellation_reason.sql:7–9`, `migrations/0009_pause_recovery.sql:4–6`.

0011은 네 가지 과거 오류 문구만 취소 원인으로 변환하고 나머지는 `ELSE NULL`로 남긴다. 미결정 관계 삭제도 `cancellation_reason IN ('cancelled','schedule_changed','disconnected')`에 한정한다. 기존 후보 view의 `safe`는 이 출처를 확인하지 않는다.

도달 가능한 재현은 0008까지의 DB에서 발송 예산 예약 직후 연결을 해제하는 경합이다. 호출 전 중지 확인은 `호출 전에 예약 중지·수정을 확인했습니다.`라는 일반 문구와 cancelled 호출 기록을 남긴다. 외부 호출은 0회다. 같은 카드의 예약을 v2로 바꾸어 모의 접수 1회 후 일시정지하고 0009→0010→0011을 적용하면 옛 행은 원인 NULL·미결정 1건·`available:true`다. 실제 `decideRecovery()`도 동일 asset을 가진 새 예약을 만들었다.

제품 함수와 원본 마이그레이션을 사용한 메모리 SQLite 진단이며 실제 카카오 성공이 아니다. root가 별도 실행해 같은 결과를 확인했다. 현 운영 DB의 복구 관계가 0건이라는 앞선 조회와는 구분한다. 이번에는 운영 DB에 재현 데이터를 넣지 않았다.

승인 후 새 **0012_pause_recovery_cause_guard.sql**에 view 보호를 적용했다. 이미 적용된 0001~0011은 변경하지 않았다. 출처를 일반 오류 문구에서 추측하지 않고, 제외 선택·정상 일시정지·완료 결정·대상 예약·원본 발송·호출·예산을 보존한다. 아래 조건으로 `available:false`, 복구 `RECOVERY_UNAVAILABLE`, 명시적 제외 후 남은 카드 재개를 확인했다. 운영 DB에는 적용하지 않았다.

```sql
AND (r.decision IS NOT NULL OR d.cancellation_reason IS 'paused')
```

회귀는 기존 `tests/pause-recovery.test.ts`와 `tests/cancellation-provenance.test.ts`에 추가했다. 수정 전 available=true로 실패했고 수정 후 통과했다. 원본·대상·완료 이력·호출·예산·트리거·FK 보존을 비교했으며 R12/R11/R9·40/41/45 경계 집중 **20개 통과·16개 제외, 155.33초**를 확인했다. 아래는 초기 제안 골격이며 별도 실행 개수로 집계하지 않는다.

```ts
it('과거 호출 전 연결 해제의 원인 불명 후보는 다시 예약하지 않는다', async () => {
  // 0008 DB: 예산 INSERT 직후 disconnect → 외부 호출 0.
  // 동일 asset v2 모의 접수 → 일시정지 → 0009부터 새 보정까지 적용.
  expect(candidate).toMatchObject({ available: false });
  await expect(recoverOldDelivery()).rejects.toMatchObject({
    code: 'RECOVERY_UNAVAILABLE',
  });
  // 제외 허용, 정상 paused 후보와 완료 결정·원본·호출·예산/FK 보존.
});
```

## R13 — 인증 중지 경합이 호출하지 않은 카드를 취소로 소진 · P2

위치: `src/worker/engine.ts:215`, 관련 `engine.ts:337–344`, `src/worker/schedules.ts:171–176`.

`releaseBeforeCall()`은 `!row?.eligible ? 'cancelled'`로 분기한다. 다른 실행의 `markReconnect()`가 현재 예약을 `needs_reconnect`로 중지하면 이 조건도 false다. 하지만 인증 재개 경로는 `state IN ('blocked','pending','retry_wait')`만 찾는다.

전문 검토의 격리 source-only 진단에서 실제 제품 함수·0001~0011 SQL로 예산 INSERT와 최종 유효성 검사 사이에 `markReconnect()`를 실행했다. sender 호출 0·delivery cancelled·원인 NULL·attempt cancelled·부모 needs_reconnect/cursor 1이 됐다. OAuth 완료와 동등한 격리 연결 복구 후 1분 이내에 실제 `resumeSchedule()`를 호출해도 일회 예약에서 `SCHEDULE_TIME` 400이 발생했다. 실제 카카오 인증/발송을 수행한 결과가 아니다.

승인 후 같은 예약 버전의 인증 중지와 사용자 일시정지·취소·연결 해제·버전 교체를 구분했다. 유예 시간 내의 확정 미호출 인증 대기는 blocked로 보존하여 재연결 후 동일 회차를 재개할 수 있다. 15분 경과는 missed로 끝낸다. 수정 후 독립 검토가 상태 조회와 최종 저장 사이의 추가 연결 해제 경합을 발견하여, 실제 미호출에만 사용하는 `finishBeforeCall()`에서 중지·버전 교체를 DB 갱신 시점에 다시 확인하도록 보완했다. 원래 외부 응답용 `finish()`와 결과 불명·갱신 소진 정책은 유지했다. 호출 기록·예산은 보존하며 환불하지 않는다.

회귀 위치는 `tests/pause-race.test.ts`다. 예산 INSERT 및 상태 조회 직후에 실제 제품 중지·연결 해제·버전 수정 함수를 실행하는 명시적 barrier를 사용한다. 동일 카드 재개 1회, 유예 경과, 명시적 중지, claim 정리·호출 기록·예산 보존을 확인한다. 아래는 초기 제안 골격이다.

```ts
it('호출 직전 인증 중지는 재연결 후 같은 미발송 카드를 재개한다', async () => {
  // 실제 예산 INSERT 직후 markReconnect를 실행하는 명시적 barrier.
  expect(senderCalls).toBe(0);
  expect(delivery.state).toBe('blocked');
  // 격리 연결 복구 → 15분 이내 resume → 동일 asset 접수 1회.
  // 최초 확정 미호출 기록, 명시적 pause/cancel/disconnect 보호도 확인.
});
```

## R14 — 운영자 등록 후 공개 OAuth 시작에 쓰기 입장 제한 없음 · P2

위치: `src/worker/auth.ts:70`, 관련 `auth.ts:80–89`, `src/worker/index.ts:59`.

`!owner &&` 때문에 등록 이후 SETUP_TOKEN 검사를 건너뛴다. `/auth/start`는 세션 없이 진입하며 올바른 Origin 문자열만 제공하면 매번 만료 행 DELETE·OAuth 행 INSERT를 수행한다. 브라우저가 아닌 클라이언트의 Origin 헤더는 운영자 인증이 아니다. 콜백의 소유자 ID 고정은 유지되므로 이를 무단 로그인 가능성으로 보고하지 않는다.

GPT-5.5 CLI가 독립적으로 발견했고 보안 전문 검토와 root가 확인했다. 메모리 SQLite·실제 `beginOAuth()`에 등록된 합성 운영자를 두고 빈 등록 토큰·세션 없이 3회 요청했더니 200 세 번·OAuth 행 3개·외부 호출 0회였다. 한도를 소진하는 부하/운영 요청은 실행하지 않았다. 공개 쓰기 요청의 반복이 Free D1 공유 쓰기 한도를 소모할 수 있다는 가용성 문제다.

승인 후 OAuth 상태 쓰기 전에 **유효한 운영자 세션+CSRF 또는 기존 SETUP_TOKEN**을 요구한다. 로그인 상태의 재연결에는 `state.csrf`를 전달하고, 로그아웃 상태의 입력을 **운영자 등록·접속 토큰**으로 안내한다. 소유자 고정·state의 브라우저 바인딩·한 번 사용을 보존한다. 별도 유료 상품이나 권한을 추가하지 않았다.

기존 `tests/auth.test.ts`에서 **32개 통과, 53.18초**를 확인했다. 잘못된 토큰·CSRF·만료 세션은 OAuth INSERT와 만료 행 DELETE 전에 거부하여 상태 행을 보존한다. 올바른 등록 토큰은 유효/만료 쿠키가 남아 있어도 별도 인증으로 사용할 수 있고 최초 등록은 세션만으로 우회할 수 없다. 아래는 초기 제안 골격이다.

```ts
it('등록 후 비인증 OAuth 시작은 상태 행을 쓰지 않는다', async () => {
  // 빈/잘못된 등록 토큰 + 유효 세션 없음 → 거부, auth_state 불변.
  // 유효 세션+CSRF와 로그아웃 상태의 올바른 등록 토큰은 허용.
  // CSRF 불일치·다른 소유자 콜백·state 재사용 거부 유지.
});
```

## A2 — 복구 실패 메시지가 열린 대화상자 밖에 표시 · P2

위치: `src/web/App.tsx:1330`, 관련 `App.tsx:263,471`, `src/web/PauseDialogs.tsx:164–195`.

복구 POST 실패는 공통 `perform()`의 전역 notice에만 기록되고 복구창은 열린 상태로 남는다. 과거 날짜 입력에 대한 서버의 `RECOVERY_TIME` 400을 받아도 창 내부에는 실패 이유가 없다.

실제 소스 Vite와 완전히 모의한 API를 이용한 격리 Chromium에서 아홉 번째 예약의 복구창을 열고 1999-01-01 00:00로 제출했다. native dialog는 `:modal=true`로 유지됐고 내부 alert 0개, 바깥 error notice는 900px 뷰포트의 top -2055/bottom -1987에 있어 보이지 않았다. 스크린샷도 root가 확인했다. 이 결과로 스크린리더의 안내 여부까지 단정하지 않는다. 실제 Worker·운영 DB/카카오를 호출하지 않았다.

승인 후 `RecoveryDialog`에 오류를 전달해 창 안에서 `role="alert"`로 표시한다. 선택·날짜·시각을 유지하여 고칠 수 있다. 실제 회귀는 `tests/e2e/pause.spec.ts`의 기존 복구 흐름을 확장했다. 격리 로컬 Worker의 실제 RECOVERY_TIME 400, 내부 오류의 가시성, 체크·입력 보존, 시각 수정 후 성공과 오류 제거까지 전체 Chromium **19개**에 포함해 통과했다. 아래는 초기 모의 제안이며 별도로 집계하지 않는다.

```ts
// recovery POST를 RECOVERY_TIME 400으로 모의한다.
await dialog.getByRole('button', { name: '복구·제외 선택 저장' }).click();
await expect(dialog.getByRole('alert')).toContainText('최소 2분 이후');
// 선택 카드·날짜·시각이 유지되고 수정 후 다시 제출 가능함을 확인한다.
```

## M1 — 서비스 바인딩의 속성 순서만 바뀌어도 무료 구성 검사 실패 · P3

위치: `scripts/check-free.mjs:73`.

`JSON.stringify(config.services) === JSON.stringify([{ binding, service }])`는 JSON 객체 속성 순서까지 비교한다. 같은 바인딩을 `{ service, binding }`으로 저장하면 내용이 같아도 배포 검사에서 거부된다. 전문 검토의 in-memory 비교에서 original true·reordered false·sameStructure true를 확인했다.

승인 후 `assert.deepEqual()`로 정확한 허용 구조를 비교하고 추가 필드/다른 서비스의 거부를 유지한다. `tests/free-config.test.ts`는 실제 검사 스크립트와 격리 파일로 허용/거부를 검증해 **12개 통과, 2.20초**다.

```ts
// 허용 서비스의 { service, binding } 순서도 실제 check-free 실행에 통과.
// 금지 서비스·추가 필드가 통과하지 않는 기존 검사 유지.
```

## D1 — 정상 크기 운영 안내의 명도 대비 부족 · P3

위치: `src/web/styles.css:442`.

`.help`는 16px·`#8b94a4`로 흰 패널에서 명도 대비가 약 3.057:1이다. 이미지 공개 범위·예약 지연·삭제 결과 등 운영 안내에 사용된다. [W3C SC 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)의 일반 텍스트 최소 4.5:1보다 낮다. 장식용 작은 라벨은 이번 지적에서 제외했다.

승인 후 이미 쓰는 색 `#626e80`으로 `.help`만 바꿨다. 로컬 Chromium에서 실제 보이는 안내문의 computed style은 16px·rgb(98,110,128)·흰 배경이며 계산 대비 **5.1706:1**이었다. 구현을 그대로 따라 쓰는 새 단위 테스트는 추가하지 않았다.

## 자동 정정한 현재 상태 문서

`docs/PROGRESS.md:3`과 M5 행은 이미 17:04에 반영된 R11·0011을 미적용으로 표시했다. 뒤의 배포 기록과 일치하게 제품 SHA·0011·11개 이력·데이터 보존·현재 미측정 조건을 로컬에서 정정했다. 이전 기록은 해당 단계의 시점으로 명확히 남겼다. 새 결함을 완료로 표시하지 않는다.

## 수정 전 진단과 검토 방법

| 이번 실행                                                                        | 결과/범위                                            |
| -------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `npx vitest run tests/cancellation-provenance.test.ts tests/refresh-cpu.test.ts` | **2개 파일·21개 통과, 70.06초**, 17:20:26 KST 시작   |
| R12 기존 결함 진단                                                               | 원인 NULL·available true·동일 asset 새 예약 생성     |
| R12 격리 수정안 진단                                                             | available false·복구 거부·제외 성공, 제품 미적용     |
| R13 전문 검토 진단                                                               | 외부 호출 0·cancelled·격리 재연결 후 재개 400        |
| R14 입장 제한 진단                                                               | 비인증 빈 토큰 요청 3회 모두 200·OAuth 행 3개        |
| A2 로컬 Chromium 진단                                                            | 열린 복구창 안 오류 없음·바깥 오류 화면 밖           |
| `npm run check:free`                                                             | 기본 dry_run 구성 통과, 계정 플랜/CPU는 검사 범위 밖 |
| 문서 Prettier·`git diff --check`                                                 | 통과                                                 |

위 21개는 초기 리뷰에서 기존 테스트를 다시 실행한 결과이며 새로운 R12~R14·A2 회귀가 아니다. 앞선 `6ec4579`의 전체 **272개·Chromium 19개·타입/웹/두 Worker dry-run**은 당시 검증 결과로 보존한다. 승인 후 추가한 제품 코드·회귀의 최종 전체 결과는 아래에 별도로 기록한다.

테스트·유지보수·보안·성능·마이그레이션·API·디자인 전문 검토를 모두 수행했고 Red Team 및 적대적 소스 검토를 추가했다. 전문 검토는 Codex 앱 에이전트이며 일부 슬롯을 재사용했다. Claude는 없어 Claude 검토로 표시하지 않는다. 적대적 검토의 초기 회귀/fixture는 요약만 확인했고 새 승인 회귀는 제품 저장소에서 실행했다. 최초 CLI는 새 모델 지원 오류로 실패했고, 설정을 바꾸지 않은 GPT-5.5 fallback `codex exec`는 성공하여 R14를 제출했다.

별도 구조화 `codex review`의 갱신 소진 카드 failed 지적은 기존 승인 요구인 **“기존 제공사 설정 오류·재시도 소진의 처리 방식은 유지한다”**, `tests/token-recovery.test.ts`와 운영 문서의 명시적 정책에 따라 반영하지 않았다. 후속 R14 CLI의 올바른 등록 토큰+세션 쿠키에서 CSRF를 요구해야 한다는 후보도 승인된 **두 인증 경로의 OR 계약**과 달라 제외했다. 원래 Origin 검증은 두 경로에 모두 적용되고, 등록 토큰이 없을 때 세션 경로의 CSRF·유효기간은 필수다. 독립 검토와 새 유효/만료 쿠키 회귀로 이 경계를 확인했다.

R14의 계약을 명확히 한 최종 CLI 재검토는 Windows read-only sandbox의 `setup refresh failed`로 소스를 읽지 못했다. 권한을 확장하지 않고 auth·인증 테스트·클라이언트 변경/API 소스를 stdin으로 제공하여 source-only 재검토를 완료했고 GPT-5.5는 **추가 결함 없음**으로 보고했다. 이 fallback은 도구·테스트·실제 서비스 호출을 수행하지 않았다.

R12의 testing·migration 중복과 R13의 Red Team·적대적 검토 중복은 각각 한 건으로 합쳤다. 다른 모델은 R14를 단독 발견했다. P2/P3 우선순위는 사용자 영향 기준이며 스킬의 CRITICAL/INFORMATIONAL 분류와 다르다. 수정 전 스킬 분류는 critical 3·informational 3으로 계산식 `10 - 2*critical - 0.5*informational`에 따른 점수가 **2.5/10**이었다. 이 점수는 실제 CPU·운영 성공률을 의미하지 않는다.

## 승인된 로컬 범위와 운영 경계

1. R12 후속 보정·R13 인증 대기·R14 OAuth 입장 보호·A2 내부 오류 안내와 M1/D1 보완을 로컬에서 구현했다.
2. 새 회귀와 기존 R5/R6/R7·명시적 취소·동시 처리, 전체 Vitest·Chromium·타입/빌드·두 dry-run·무료 구성·서식을 검증했다. 최종 결과와 로컬 소스 기준은 아래 기록을 따른다.
3. 커밋·푸시·PR 설명 갱신·운영 0012 적용·두 Worker 반영·실제 본인 발송/CPU 시험은 이번 로컬 작업에서 수행하지 않았다. 키·토큰·운영 예약은 유지한다.

새 기능 분기·후속 마이그레이션·회귀 작성은 [review/SKILL.md](C:/Users/user/.agents/skills/gstack/review/SKILL.md)의 “Any finding that has a `test_stub` field … is reclassified as ASK” 및 “ASK items are only applied after user approval”에 따라 확인했고, 사용자가 **6건 모두 로컬 수정·검증**을 승인했다. 추가 승인을 반복해서 요구하지 않고 승인 범위의 코드·회귀·문서를 보완했다. 비밀값·백업·진단 스크립트·화면 캡처·로컬 DB·생성 산출물은 Git 제외 경로에 있다.

## 최종 수정본 검증과 결과

| 최종 검증                   | 결과                                                                     |
| --------------------------- | ------------------------------------------------------------------------ |
| `npm test`                  | **17개 파일·299개 통과**, 18:08:40 KST 시작·892.86초                     |
| `npm run test:e2e`          | **Chromium 19개 통과, 1.4분**; A2 실제 로컬 Worker 오류·수정·재제출 포함 |
| `npm run build`             | strict 타입·Vite·메인/비공개 Worker 배포 dry-run 모두 통과               |
| `npm run check:free`        | 기본 dry_run 무료 구성 통과; 운영 계정·CPU는 검사 범위 밖                |
| Prettier·`git diff --check` | 전체 src/tests/docs와 검사 스크립트·README 통과                          |
| 적용된 SQL 보존             | 0001~0011의 HEAD 대비 변경 0, 신규 0012만 추가                           |
| 후속 독립 소스 검토         | R12·최종 R13·R14·A2·M1·D1의 추가 미해결 결함 0                           |

기존 272개에서 **새 단위 회귀 27개**를 추가했고, 기존 Chromium 복구 흐름에 A2 검증을 확장했다. 초기 R13 fixture의 sending 중 버전 수정은 기존 보호 트리거에 의해 거부되어, 실제 허용된 claimed 단계의 `saveSchedule()`로 수정했다. 최종 전체 실행 이전 소스는 확정됐으며 초기 전체 실행은 경합 보완을 위해 중단한 것으로 통과 개수에 넣지 않았다.

R13 추가 경합 7개와 과거 R12 shim 1개 집중 **8개**, 다른 Cron의 unknown 이력 보존 **1개**도 최종 소스에서 통과했다. 최종 외부 응답용 finish·토큰 갱신 소진 정책은 그대로이며, 호출 전 시도 갱신은 `outcome='sending'`일 때만 수행한다. 이미 unknown으로 확정된 호출 내역을 덮어쓰지 않는다.

검증 중 및 종료 대조한 src/tests/migrations/scripts 전체 manifest SHA-256은 `BD1D7FA34EB13560210387E7159168636396EE1CE2DB781C1D66CFBAD58A91A2`로 일치했다. 이 기준은 커밋하지 않은 로컬 작업본이며 GitHub의 새 SHA가 아니다. 18:18 KST 재조회에서도 원격 브랜치와 OPEN PR #1 HEAD는 `0c34fff839d30a98079f9d972413ac5e3776e108`이었다. 변경 파일은 auth/engine, App/PauseDialogs/styles, check-free, 신규 SQL과 관련 인증·복구·경합·무료 구성·E2E 회귀, README/진행·설정·운영·검증·리뷰 문서다.

최종 남은 critical 0·informational 0으로 로컬 코드 리뷰 점수는 **10/10**이다. 이 점수는 미수행 운영 검증의 완료를 뜻하지 않는다. 현재 운영 `6ec4579`·0011과 새 로컬 보완본의 실제 발송·갱신·다량 CPU는 미측정이다. 다음은 검증본의 커밋·일반 푸시·기존 PR 설명 갱신이며, 운영 반영 단계에서는 백업·쓰기 중단·0012·두 Worker와 실제 CPU 시험이 필요하다. 로컬 실행은 `npm run dev`다.
