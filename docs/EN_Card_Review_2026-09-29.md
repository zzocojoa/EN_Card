# EN_Card 구현 검토 보고서

검토일: 2026-09-29 KST  
저장소: https://github.com/zzocojoa/EN_Card  
검토 대상: PR #1, `codex/development`  
기준 커밋: `ff9c0e2ffc0d3c371fd0e6a6a0b8b4181e11260d`

## 판단

카드 편집 → 브라우저 PNG 생성 → 이미지 저장·검토 → 예약 → 클라우드 Cron → 카카오 본인 메시지 발송의 핵심 구조는 구현되어 있다. 무료 구성, 토큰 암호화, 예약 버전, 원자적 발송 선점, 결과 불명 자동 재전송 방지, 백업·복원까지 고려한 코드다.

다만 무인 운영 전에 수정할 장애 복구 문제 2건을 재현했다. 일시정지 때 미발송 카드를 처리하는 정책 1건도 보완이 필요하다. 서버 PNG 검사는 추가 강화 대상으로 분류했다. 실제 계정 배포와 PC 종료 상태의 수신 검증은 저장소 문서에도 미완료로 명시되어 있다.

`master`에는 구현 전체가 병합되지 않아 PR의 개발 브랜치를 직접 검토했다. 아래 결과는 이 커밋에 한정한다. 운영 소스 수정, 원격 배포, 실제 카카오 발송, PR 댓글·커밋·푸시는 수행하지 않았다. 재현용 테스트만 격리된 로컬 체크아웃에 추가했다.

## 직접 실행한 검증

| 항목                                           | 이번 검토 결과          | 해석                                                                                                             |
| ---------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `npm ci --ignore-scripts --no-audit --no-fund` | 성공                    | 잠금 파일 기준 의존성 설치                                                                                       |
| 기존 `npm test`                                | 6개 파일, 95개 통과     | 현재 테스트가 다루는 로직·Miniflare D1/KV 통합 경로 통과                                                         |
| `WRANGLER_SEND_METRICS=false npm run build`    | 통과                    | 타입 검사, 웹 빌드, Worker 배포 dry-run. 실제 배포 아님                                                          |
| `npm run check:free`                           | 통과                    | 허용 구성·기본 모드 검사. 계정 요금제나 청구 보장은 아님                                                         |
| 별도 진단 테스트                               | 5개 통과                | 아래 4개 동작 재현 및 완료 상태 의미 1개 확인. 결함 수정 완료를 뜻하지 않음                                      |
| `npm run test:e2e` 재실행                      | 서버 시작 단계에서 중단 | 이 검토 환경의 Wrangler가 `uv_interface_addresses returned Unknown system error 1`로 종료. UI 테스트 본문 미실행 |
| 실제 Cloudflare·카카오                         | 미검증                  | 실제 토큰 갱신, 폰 수신, PC 종료 후 발송, 원격 CPU는 별도 운영 검증 필요                                         |

저장소 `docs/VERIFICATION.md`에는 작성자 환경에서 Chromium E2E 6개 통과 기록이 있다. 이번 환경의 E2E 실행 실패를 제품 결함으로 판정하지 않았다.

## 우선순위

| ID  | 우선순위           | 분류             | 현상                                                                                           |
| --- | ------------------ | ---------------- | ---------------------------------------------------------------------------------------------- |
| R1  | P1: 운영 전 수정   | 복구 경로 결함   | 결과 불명이 남은 예약을 일시정지·재개하면 활성 예약의 다음 발송과 기존 건의 재시도가 함께 막힘 |
| R2  | P1: 운영 전 수정   | 오류 분류 결함   | 토큰 API의 명시적인 HTTP 503도 인증 거절로 변환되어 재연결 전까지 예약이 중단됨                |
| R3  | P2: 정책·화면 보완 | 미발송 카드 처리 | 5장 중 3장 발송 후 일시정지·재개하면 나머지 2장이 다음 발송 목록에서 제외됨                    |
| R4  | P3: 추가 강화      | 이미지 입력 검증 | 서버가 PNG 헤더만 검사하여 이미지 데이터가 없는 33바이트 파일도 허용함                         |

P1은 이번 검토에서 정한 구현 우선순위이며, 보안 취약점 점수나 상시 장애 판정을 의미하지 않는다.

## R1. 결과 불명 + 예약 버전 변경으로 복구가 막힘

### 재현

1. 카드 2장, 하루 1장인 반복 예약을 등록한다.
2. 첫 발송의 응답이 유실된 것으로 모의하여 `unknown`을 만든다.
3. 해당 예약을 일시정지하고 재개한다. 예약은 활성 상태, 버전 2가 된다.
4. 다음 날 예정 시각에 엔진을 실행해도 발송 호출이 0회다.
5. 이전 결과 불명 건의 재시도를 선택하면 `SCHEDULE_INACTIVE` 오류가 난다.

관측값:

```json
{ "enabled": 1, "version": 2, "nextDayCalls": 0, "retryError": "SCHEDULE_INACTIVE" }
```

### 원인과 영향

- `engine.ts`의 회차 생성은 동일 예약 ID에 `unknown`이 하나라도 있으면 차단한다. 버전에 관계없이 적용된다.
- `resumeSchedule()`은 예약 버전을 증가시킨다.
- `resolveUnknown(..., 'retry')`는 발송 건의 버전과 현재 예약 버전이 같아야 허용한다.
- 결과 불명 처리에는 `confirm_sent`와 `retry`만 있다. 미수신을 확인하거나 재전송을 포기한 뒤 안전하게 종료하는 선택지가 없다.

따라서 실제로 메시지를 받지 못한 사용자는 사실과 다른 ‘수신 확인’을 하거나 새 예약을 만드는 우회가 필요하다. 기존 예약은 활성으로 보이면서 계속 대기할 수 있다. 결과 불명을 차단하는 안전 원칙은 적절하지만 버전 변경 후의 복구 절차가 불완전하다.

### 개선안

우선 결과 불명 건이 있는 예약의 버전 변경을 막고, 해당 건을 해결할 수 있는 화면으로 안내한다. 기존 데이터에 이미 버전이 어긋난 결과 불명이 있을 수 있으므로 기존 건의 복구도 지원해야 한다.

수신 확인·위험을 인지한 수동 재전송 외에 **재전송하지 않고 종료** 같은 명시적 종료 동작을 추가한다. 이는 `sent`로 기록하지 않고 별도 종료 상태와 사용자 판단 이력을 남겨야 한다. 미수신 확인 후 새 발송을 만드는 정책을 택한다면 새로운 발송 건과 원래 건의 관계도 보존한다.

단순히 이전 버전의 결과 불명을 무시하거나 자동 재전송하도록 바꾸면 중복 수신 방지 장치가 약해진다. 종료·취소·버전 변경·발송 선점을 함께 검토해야 한다.

수정 완료 기준:

- 결과 불명 → 일시정지 → 재개/수정 경로에서 이유 없이 영구 대기하지 않는다.
- 받은 경우와 받지 못한 경우 모두 사실에 맞는 복구 선택지가 있다.
- 복구 후 다음 예정 회차가 진행되고, 이전 발송을 자동으로 중복 전송하지 않는다.
- 이미 존재하는 이전 버전 결과 불명도 처리할 수 있다.

근거: [회차 차단 조건](https://github.com/zzocojoa/EN_Card/blob/ff9c0e2ffc0d3c371fd0e6a6a0b8b4181e11260d/src/worker/engine.ts#L66-L69), [버전별 발송 자격](https://github.com/zzocojoa/EN_Card/blob/ff9c0e2ffc0d3c371fd0e6a6a0b8b4181e11260d/src/worker/engine.ts#L142-L145), [재개 시 버전 변경](https://github.com/zzocojoa/EN_Card/blob/ff9c0e2ffc0d3c371fd0e6a6a0b8b4181e11260d/src/worker/schedules.ts#L209-L219), [결과 불명 처리](https://github.com/zzocojoa/EN_Card/blob/ff9c0e2ffc0d3c371fd0e6a6a0b8b4181e11260d/src/worker/engine.ts#L412-L459).

## R2. 토큰 갱신의 일시 오류가 지속적인 예약 중단으로 바뀜

### 재현

1. 액세스 토큰은 만료, 리프레시 토큰은 유효한 상태와 미래 예약을 준비한다.
2. 토큰 갱신 API가 HTTP 503, `{"error":"temporarily_unavailable"}`를 반환하도록 모의한다.
3. 오류가 HTTP 401의 `TOKEN_REJECTED`로 변환된다.
4. 연결 상태가 `needs_reconnect`가 되고 미래 예약도 비활성화된다.
5. 다음 실행에서 서버가 정상 응답하도록 설정해도 API를 다시 호출하지 않고 `NEEDS_RECONNECT`로 종료된다.

관측값:

```json
{ "status": "needs_reconnect", "enabled": 0, "subsequentTransportCalls": 0 }
```

실제 카카오 서버 장애를 관측한 것은 아니다. 명시적인 일시 장애 응답을 주입하여 현재 코드의 분류·상태 전이를 확인했다.

### 원인과 개선안

`requestTokens()`는 성공이 아닌 HTTP 응답을 모두 인증 거절로 변환하고, `accessToken()`의 catch는 모든 갱신 실패를 재연결 필요로 바꾼다. 발송 엔진도 `TOKEN_BUSY`·`TOKEN_CHANGED` 이외의 토큰 오류를 재연결 필요로 취급한다. 따라서 인증 함수 한 곳만 수정해서는 충분하지 않다.

원래 HTTP 상태와 오류 코드를 보존하고 다음을 구분한다.

| 상황                                              | 권장 처리                                                 |
| ------------------------------------------------- | --------------------------------------------------------- |
| 확정된 만료·권한 철회·유효하지 않은 refresh token | 재연결 필요로 전환                                        |
| 재시도가 안전하다고 분류한 명시적 일시 오류       | 연결을 유지하고 제한된 횟수·간격으로 다음 실행에서 재시도 |
| 토큰 회전 응답 유실·성공 여부 불명                | 기존의 보수적 처리 유지. 무조건 재시도하지 않음           |
| 다른 실행이 토큰 갱신 중 / 새 인증으로 교체됨     | 현재 잠금·버전 보호 유지                                  |

오류 분류를 인증 계층과 엔진이 함께 사용하게 하고, 재시도 간격·상한·15분 발송 허용 시간을 명시한다. 지연된 옛 오류 응답이 새 연결을 덮어쓰지 않도록 기존 버전 조건을 유지한다.

수정 완료 기준:

- 명시적 일시 오류 후 정상화되면 정책 범위 내에서 새 로그인 없이 회복한다.
- 실제 인증 무효는 계속 재연결을 요구한다.
- 결과가 불명확한 토큰 회전은 무조건 반복하거나 새 토큰을 덮어쓰지 않는다.
- 인증 함수 단독 검사뿐 아니라 Cron → 토큰 → 발송 경로를 함께 검사한다.

근거: [오류 변환](https://github.com/zzocojoa/EN_Card/blob/ff9c0e2ffc0d3c371fd0e6a6a0b8b4181e11260d/src/worker/kakao.ts#L148-L175), [미래 예약 중단](https://github.com/zzocojoa/EN_Card/blob/ff9c0e2ffc0d3c371fd0e6a6a0b8b4181e11260d/src/worker/auth.ts#L172-L175), [토큰 오류 후 상태 변경](https://github.com/zzocojoa/EN_Card/blob/ff9c0e2ffc0d3c371fd0e6a6a0b8b4181e11260d/src/worker/auth.ts#L245-L253), [엔진의 토큰 오류 처리](https://github.com/zzocojoa/EN_Card/blob/ff9c0e2ffc0d3c371fd0e6a6a0b8b4181e11260d/src/worker/engine.ts#L234-L259).

## R3. 일시정지하면 현재 회차의 미발송 카드가 재개 대상에서 제외됨

### 재현

카드 10장, 회차당 5장인 반복 예약을 만든다. 한 번의 실행은 최대 3장이므로 첫 실행 후 3장은 모의 발송, 2장은 대기 상태가 된다. 이때 일시정지 후 재개한다.

```json
{
  "states": ["mock_sent", "mock_sent", "mock_sent", "cancelled", "cancelled"],
  "remainingAfterResume": 5
}
```

미발송은 총 7장이지만 재개 목록에는 마지막 5장만 남는다. 앞 회차의 미발송 2장은 자동 발송 대상에서 제외된다. 원본 카드나 이미지 자체가 삭제되는 것은 아니다.

### 해석과 개선안

현재 커서는 회차 생성 시 5장 전체를 소비하고, 일시정지는 대기·준비·재시도 대기 건을 취소한다. 재개는 커서 이후 카드만 새 버전으로 복사한다. 저장소 운영 문서에도 소비한 카드를 제외한다는 설명은 있어, 명세를 무조건 위반한 버그로 단정하기보다 **일시정지의 의미와 미발송 복구 정책**으로 분류했다.

사용자가 기대하는 ‘잠깐 멈췄다가 이어 보내기’를 지원하려면 확정된 미발송 건을 보존하거나 명시적으로 새 회차에 편입한다. 이미 발송된 건과 결과 불명 건을 자동 편입해서는 안 된다. 15분 허용 시간이 지난 경우에는 즉시 몰아서 보내지 말고 다음 시간으로 다시 예약하도록 한다.

기존 정책을 유지한다면 버튼을 누르기 전에 취소되는 미발송 수와 제외되는 카드 목록을 보여주고, ‘미발송 카드 다시 예약’ 동작을 제공한다. 문서 설명만으로 사용자가 결과를 예측하기는 어렵다.

수정 완료 기준: 3장 발송 후 정지·재개 시 나머지 7장을 이어 보낼지, 현재 회차의 2장을 취소할지 화면에서 명확하게 선택·확인할 수 있고, 이미 발송된 3장은 자동 재전송되지 않는다.

근거: [커서 선소비](https://github.com/zzocojoa/EN_Card/blob/ff9c0e2ffc0d3c371fd0e6a6a0b8b4181e11260d/src/worker/engine.ts#L111-L120), [일시정지의 대기 건 취소](https://github.com/zzocojoa/EN_Card/blob/ff9c0e2ffc0d3c371fd0e6a6a0b8b4181e11260d/src/worker/schedules.ts#L128-L145), [재개 목록 복사](https://github.com/zzocojoa/EN_Card/blob/ff9c0e2ffc0d3c371fd0e6a6a0b8b4181e11260d/src/worker/schedules.ts#L198-L219).

## R4. 서버 PNG 검증은 헤더 수준에 그침

`validatePng()`는 시그니처, IHDR, 1080×1080 크기, 파일 크기만 검사한다. IDAT·IEND와 실제 이미지 데이터가 없는 33바이트 fixture가 통과했다.

```json
{ "acceptedBytes": 33, "containsIdat": false, "containsIend": false }
```

일반 화면의 PNG 생성은 Canvas가 담당하며, 백업 복원도 브라우저에서 `createImageBitmap()`으로 검사한다. 따라서 정상 UI 사용자가 모두 손상 이미지를 저장하게 되는 결함은 아니다. 인증된 직접 API 요청까지 보장하려면 서버 쪽 구조 검사가 부족하다는 의미다.

PNG 청크 경계, 필수 청크, 종료, 필요하면 CRC를 가볍게 검사하고 실제 PNG fixture와 잘린 파일을 테스트에 추가한다. 전체 디코더 도입은 Free CPU 제한을 측정한 뒤 결정한다. 서버 브라우저나 유료 이미지 서비스를 추가할 필요는 없다.

근거: [서버 검사](https://github.com/zzocojoa/EN_Card/blob/ff9c0e2ffc0d3c371fd0e6a6a0b8b4181e11260d/src/worker/storage.ts#L44-L57), [브라우저 백업 검사](https://github.com/zzocojoa/EN_Card/blob/ff9c0e2ffc0d3c371fd0e6a6a0b8b4181e11260d/src/web/canvas.ts#L167-L178).

## 아직 완료되지 않은 운영 검증

다음 항목은 코드 결함으로 판정한 것이 아니라, 사용자의 핵심 요구인 ‘컴퓨터가 꺼져 있어도 무료로 예약 발송’을 입증하기 위해 남아 있는 작업이다. README와 M5 문서에도 미실시로 표시되어 있다.

| 남은 작업                   | 완료 증거                                                                                |
| --------------------------- | ---------------------------------------------------------------------------------------- |
| 실제 Free 계정·리소스 구성  | Workers/D1/KV 요금제 및 계정 전체 공유 사용량 확인. 설정의 DB·KV·도메인 placeholder 교체 |
| 실카카오 연결과 이미지 표시 | 본인 계정 로그인, 나에게 보내기, 휴대전화에서 이미지와 원본 링크 확인                    |
| 클라우드 예약 동작          | PC·브라우저·Codex 종료 후 미리 등록한 미래 시각에 수신한 기록                            |
| 실제 토큰 갱신              | 갱신 성공 및 갱신 뒤 예약 발송, 재연결이 필요한 경우의 복구 확인                         |
| 무료 실행 한도              | 실제 요청·Cron CPU와 D1/KV 사용량 측정, 최대 입력과 발송 배치 경로 확인                  |
| 대상 모바일 브라우저        | 실제 사용할 iOS Safari/Android Chrome에서 카드 생성·복원·시간 입력 확인                  |

Cloudflare 공식 문서의 Workers Free CPU 제한은 HTTP 요청과 Cron 각각 10ms다. 외부 API·DB 응답을 기다리는 시간과 CPU 실행 시간은 다르다. 이 코드는 로컬 빌드와 테스트를 통과했지만 실제 CPU 충족 여부는 원격 측정이 필요하다. 초과한다면 배치 크기·파싱·암호화 경로를 경량화하여 무료 구성 안에서 다시 측정한다.

`check:free`는 계정의 청구 설정을 조회하지 않는다. 검사 결과에도 계정 요금제 미확인, 원격 CPU 미검증, 청구 보장 불가가 표시된다. 이를 ‘비용이 절대로 발생하지 않음’이나 ‘운영 검증 완료’로 해석하면 안 된다.

근거: [현재 진행 상태](https://github.com/zzocojoa/EN_Card/blob/ff9c0e2ffc0d3c371fd0e6a6a0b8b4181e11260d/docs/PROGRESS.md), [배포·운영 준비](https://github.com/zzocojoa/EN_Card/blob/ff9c0e2ffc0d3c371fd0e6a6a0b8b4181e11260d/docs/SETUP.md), [검증 범위](https://github.com/zzocojoa/EN_Card/blob/ff9c0e2ffc0d3c371fd0e6a6a0b8b4181e11260d/docs/VERIFICATION.md), [Cloudflare Workers 공식 제한](https://developers.cloudflare.com/workers/platform/limits/).

## 권장 수정 순서

1. R1의 결과 불명 종료·버전 변경 정책을 정하고 DB 상태·API·화면·회귀 테스트를 함께 수정한다.
2. R2의 토큰 오류 분류를 인증 함수와 발송 엔진에 함께 반영한다.
3. R3의 일시정지 정책을 화면에 명확히 드러내고 미발송 복구를 구현한다.
4. 기존 95개 테스트와 해당 회귀 테스트, 빌드·무료 구성 검사를 통과시킨다. 실행 가능한 환경에서 기존 Chromium E2E도 재실행한다.
5. M5의 실제 Free 환경 검증을 수행하여 PC 종료 후 수신까지 기록한다.
6. R4 및 화면 컴포넌트 분리를 진행한다. 큰 `App.tsx`를 카드 편집·예약·이력·설정 단위로 나누되, 장애 복구 수정을 앞에 둔다.

추가 진단에서 예약의 `reason='completed'`가 대기 발송보다 먼저 설정되는 것도 확인했다. 그러나 UI는 이를 ‘목록 소비 완료’로 표시하고 발송 기록과 구분하고 있어, ‘미발송인데 수신 완료로 잘못 표시한다’는 결함으로는 분류하지 않았다. 예약 화면에 발송·대기·결과 불명 건수를 함께 보여주는 개선은 가능하다.

## 부록: 핵심 4개 재현용 테스트

아래 파일은 해당 기준 커밋의 테스트 helper를 사용하는 **진단용** 코드다. 현재 문제가 있는 동작을 확인하는 assert이므로 통과는 수정 완료가 아니라 재현 성공이다. 실제 개선 작업에서는 기대 동작을 반영한 회귀 테스트로 바꿔야 한다. 실카카오 호출은 하지 않는다.

기준 브랜치의 `tests/review-probes.test.ts`에 저장하여 실행한다.

```sh
npm test -- tests/review-probes.test.ts --reporter=verbose
```

```typescript
import { afterEach, beforeEach, expect, it } from 'vitest';
import { accessToken } from '../src/worker/auth';
import { encrypt } from '../src/worker/crypto';
import { resolveUnknown, runEngine } from '../src/worker/engine';
import { sendMock } from '../src/worker/mock';
import { listSchedules, resumeSchedule, saveSchedule, stopSchedule } from '../src/worker/schedules';
import { validatePng } from '../src/worker/storage';
import type { ScheduleInput } from '../src/shared/model';
import { harness, NOW, readyCard, png, type Harness } from './helpers';

// Review-only probes: isolated local D1/KV; no real Kakao calls.
let h: Harness;
beforeEach(async () => {
  h = await harness();
});
afterEach(async () => {
  await h.mf.dispose();
});

async function repeat(count: number, perOccurrence = 1) {
  const assets = await Promise.all(
    Array.from({ length: count }, () => readyCard(h.env, NOW - 300_000)),
  );
  const data: ScheduleInput = {
    name: 'Review probe',
    kind: 'daily',
    date: '2026-09-28',
    time: '12:05',
    end_date: null,
    weekdays: [],
    cards_per_occurrence: perOccurrence,
    asset_ids: assets.map((a) => a.assetId),
  };
  return { ...(await saveSchedule(data, null, null, h.env, NOW)), data };
}

it('probe: refresh HTTP 503 permanently pauses even the future schedule', async () => {
  const { id } = await repeat(2);
  await h.env.DB.prepare(
    "INSERT INTO credentials(singleton,owner_id,access_token,refresh_token,expires_at,refresh_expires_at,version,status) VALUES(1,'42',?,?,?, ?,1,'connected')",
  )
    .bind(
      await encrypt('access', h.env.TOKEN_ENCRYPTION_KEY),
      await encrypt('refresh', h.env.TOKEN_ENCRYPTION_KEY),
      NOW - 1,
      NOW + 86400_000,
    )
    .run();
  await expect(
    accessToken(h.env, NOW, async () =>
      Response.json({ error: 'temporarily_unavailable' }, { status: 503 }),
    ),
  ).rejects.toMatchObject({ code: 'TOKEN_REJECTED', status: 401 });
  expect(await h.env.DB.prepare('SELECT status FROM credentials').first('status')).toBe(
    'needs_reconnect',
  );
  const schedule = (await listSchedules(h.env)).find((s) => s.id === id)!;
  expect([schedule.enabled, schedule.reason]).toEqual([0, 'needs_reconnect']);
  let retries = 0;
  await expect(
    accessToken(h.env, NOW + 60_000, async () => {
      retries++;
      return Response.json({ access_token: 'new', expires_in: 3600 });
    }),
  ).rejects.toMatchObject({ code: 'NEEDS_RECONNECT' });
  expect(retries).toBe(0);
  console.log(
    'PROBE_AUTH_503',
    JSON.stringify({
      status: 'needs_reconnect',
      enabled: schedule.enabled,
      subsequentTransportCalls: retries,
    }),
  );
});

it('probe: unknown + pause/resume leaves an active future schedule with no usable retry', async () => {
  const { id } = await repeat(2);
  const due = NOW + 300_000;
  await runEngine(h.env, {
    mode: 'mock',
    clock: () => due,
    token: async () => 'mock',
    sender: async () => ({ outcome: 'unknown', detail: 'response lost' }),
  });
  const delivery = await h.env.DB.prepare("SELECT id FROM deliveries WHERE state='unknown'").first<{
    id: string;
  }>();
  await stopSchedule(id, 1, 'paused', h.env, due + 10_000);
  await resumeSchedule(id, 1, h.env, due + 20_000);
  const resumed = (await listSchedules(h.env))[0]!;
  expect([resumed.enabled, resumed.version]).toEqual([1, 2]);
  let calls = 0;
  await runEngine(h.env, {
    mode: 'mock',
    clock: () => due + 86400_000,
    token: async () => 'mock',
    sender: async () => {
      calls++;
      return { outcome: 'mock_sent', detail: 'mock' };
    },
  });
  expect(calls).toBe(0);
  expect(await h.env.DB.prepare('SELECT count(*) AS n FROM occurrences').first('n')).toBe(1);
  await expect(resolveUnknown(delivery!.id, 'retry', h.env, due + 86400_000)).rejects.toMatchObject(
    { code: 'SCHEDULE_INACTIVE' },
  );
  console.log(
    'PROBE_UNKNOWN_TRAP',
    JSON.stringify({
      enabled: resumed.enabled,
      version: resumed.version,
      nextDayCalls: calls,
      retryError: 'SCHEDULE_INACTIVE',
    }),
  );
});

it('probe: pausing a partially sent five-card occurrence discards its two pending cards', async () => {
  const { id } = await repeat(10, 5);
  const due = NOW + 300_000;
  await runEngine(h.env, {
    mode: 'mock',
    clock: () => due,
    token: async () => 'mock',
    sender: sendMock,
  });
  await stopSchedule(id, 1, 'paused', h.env, due + 10_000);
  await resumeSchedule(id, 1, h.env, due + 20_000);
  const schedule = (await listSchedules(h.env))[0]!;
  const rows = await h.env.DB.prepare(
    'SELECT position,state FROM deliveries ORDER BY position',
  ).all<{ position: number; state: string }>();
  expect(rows.results.map((r) => r.state)).toEqual([
    'mock_sent',
    'mock_sent',
    'mock_sent',
    'cancelled',
    'cancelled',
  ]);
  expect(schedule.asset_ids.length).toBe(5);
  console.log(
    'PROBE_PAUSE_PENDING',
    JSON.stringify({
      states: rows.results.map((r) => r.state),
      remainingAfterResume: schedule.asset_ids.length,
    }),
  );
});

it('probe: a signature-only PNG is accepted by the server validator', () => {
  const bytes = png();
  expect(bytes.byteLength).toBe(33);
  expect(() => validatePng(bytes)).not.toThrow();
  console.log(
    'PROBE_PNG',
    JSON.stringify({ acceptedBytes: bytes.byteLength, containsIdat: false, containsIend: false }),
  );
});
```
