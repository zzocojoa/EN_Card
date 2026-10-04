# 실제 토큰 갱신 CPU 검증

운영 `scheduledToken` → 비공개 `credentials` DO RPC를 그대로 호출하는 한시적 검증 진입점이다. 일반 운영 설정에는 연결하지 않는다.

- HTTP 요청은 기존 운영 처리기에 전달한다. 새 공개 호출 경로가 없다.
- `TOKEN_REFRESH_PROBE`에는 `{ "start": <UTC epoch ms>, "end": <UTC epoch ms>, "version": <현재 버전>, "expiresAt": <현재 만료 시각> }`만 넣는다. 비밀값을 넣지 않는다.
- 최대 5분 창, 현재 연결 상태·버전·만료 시각 일치, 갱신 잠금/오류 없음, 활성 예약/자동화/미해결 발송 없음이 필요하다. `blocked`인 과거 발송은 엔진이 자동 claim하지 않으므로 그대로 보존한다.
- 조건부 UPDATE로 `expires_at=0`을 먼저 저장한 한 실행만 실제 RPC를 호출한다. 성공·실패·응답 유실 모두 같은 검증을 반복하지 않는다. 오류에 대한 기존 인증 정책을 유지하며 만료 시각이나 암호화 토큰을 과거 값으로 되돌리지 않는다.
- 창 안에서는 일반 제작·발송 Cron을 호출하지 않는다. 창이 끝나면 일반 Cron이 자동 복귀한다. 정상 완료 시에는 즉시 기존 Worker 버전으로 복원한다.

## 실행 체크리스트

1. 현재 배포 버전·바인딩·Secret 이름과 모든 DB 테이블의 행 수/해시를 보존한다. 실제 토큰은 출력하지 않는다.
2. `npx vitest run tests/token-refresh-verification.test.ts tests/refresh-cpu.test.ts tests/token-rpc-guards.test.ts tests/token-rpc-runtime.test.mjs`와 `npm run typecheck`를 실행한다.
3. 운영 설정을 별도 무시된 파일로 복사하고 `main`과 검증 변수만 바꾼다. dry-run 후 배포 직전에 현재 상태와 시간을 다시 확인한다. 새 자원·Secret·Cron은 추가하지 않는다.
4. 승인된 실제 검증 1회를 수행하고 기존 버전으로 복원한다. 복원 결과와 토큰 버전 증가·갱신 오류/잠금 해제, 다른 테이블 해시 보존을 확인한다. 실패하거나 결과가 불명확하면 자동 재시도하지 않는다.
5. Cloudflare GraphQL의 버전/시각별 CPU를 수집한다. CPU 단위는 microseconds이며 ms 값은 1,000으로 나눈다. 요청 수와 표본 간격도 기록한다.

DO 표본은 실제 운영 갱신 RPC다. 이 진입점의 주 Worker 표본에는 검증용 조건부 UPDATE가 포함되고 정상 예약 엔진의 prepare/defer는 포함되지 않는다. 따라서 주 Worker 수치를 정상 갱신 예약 회차 전체의 CPU로 표시하지 않는다. 한 번의 측정은 미래 모든 실행의 최댓값이나 무료 과금 보장이 아니다.
