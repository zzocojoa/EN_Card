# 설정과 배포 준비

## 로컬 개발

Node.js 22.12 이상과 npm을 사용합니다. 잠금 파일을 보존하여 `npm ci`로 설치합니다.

```sh
npm ci
npm run dev
```

`dev`는 Vite 빌드, 로컬 D1 마이그레이션, `wrangler.local.jsonc`의 loopback 서버를 순서대로 실행합니다. 주소는 `http://127.0.0.1:8787`입니다. 프런트엔드 수정 후에는 `npm run build:web`로 갱신하고 브라우저를 새로 고칩니다. Node.js는 개발 도구에만 사용하며 운영 Worker는 Web API 기반입니다.

로컬 진입점 `src/worker/local.ts`에는 테스트 세션 시작 기능이 있습니다. 이 파일은 운영 설정에서 참조하지 않습니다. 로컬 DB/KV ID는 운영 설정과 다르며 테스트는 매번 독립적인 Miniflare DB/KV를 만듭니다. E2E 저장소도 `.wrangler/e2e-*`로 분리합니다. 로컬 진입점·테스트 키를 운영으로 복사하지 마세요.

## 무료 조건의 근거

2026-09-28 공식 문서 확인 기준입니다. 배포 직전에 다시 확인합니다.

| 항목          | 확인한 Free 한도                                            | 공식 문서                                                                                                                               |
| ------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Workers       | 요청 100,000회/일, 호출당 CPU 10ms                          | [요금](https://developers.cloudflare.com/workers/platform/pricing/), [제한](https://developers.cloudflare.com/workers/platform/limits/) |
| D1            | 읽기 500만 행/일, 쓰기 10만 행/일, 총 저장 5GB              | [D1 요금](https://developers.cloudflare.com/d1/platform/pricing/)                                                                       |
| KV            | 저장 1GB, 쓰기·삭제·목록 각각 1,000회/일, 읽기 100,000회/일 | [KV 요금](https://developers.cloudflare.com/kv/platform/pricing/)                                                                       |
| Static Assets | 정적 자산 요청 무료·무제한; Worker 실행 요청은 별도 한도    | [정적 자산 요금](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)                                      |
| 카카오        | 본인 전송 무료, 푸시 알림·알림음 없음                       | [공식 답변](https://devtalk.kakao.com/t/api/146901)                                                                                     |

실제 계정의 Workers Free 상태, D1/KV 리소스 수와 공유 사용량, 유료 부가 상품이 없는지 대시보드에서 확인해야 합니다. Free 자격이 확인되지 않으면 배포를 보류합니다. 기존 구독·결제 수단은 변경하지 않습니다. 무료 CPU 시간은 외부 응답을 기다리는 벽시계 시간과 다르며 실제 배포에서 측정해야 합니다.

앱 제한은 `src/shared/model.ts`와 DB 제약으로 강제합니다. 이미지 1MiB/장·총 200MB, 업로드 100회/일, 활성 예약 10개, 회차당 1~5장, 분당 실제 시도 3건, 하루 실제 시도 20건, 확실한 미접수 거절 최대 3회입니다. 앱 날짜는 KST, 제공사 한도 초기화는 제공사 정책을 따릅니다. D1 Free의 호출당 쿼리 한도를 고려해 가져오기·예약 목록은 한 번에 최대 40개, 회차 생성은 Cron당 최대 2개입니다.

## 운영 환경 설정

`wrangler.jsonc`의 DB UUID, KV ID, APP_ORIGIN은 배포 전 교체해야 하는 placeholder입니다. `wrangler.local.jsonc`는 배포하지 않습니다.

| 이름                 | 저장 위치와 의미                                                      |
| -------------------- | --------------------------------------------------------------------- |
| APP_ORIGIN           | 일반 vars, 실제 HTTPS workers.dev 출처. 끝의 슬래시 없이 입력         |
| COST_MODE            | 일반 vars, `free_only` 고정                                           |
| SEND_MODE            | 일반 vars, 최초 `dry_run`                                             |
| DB / CARD_IMAGES     | 운영 D1 / KV 바인딩                                                   |
| KAKAO_REST_API_KEY   | Worker Secret, 카카오 REST API 키                                     |
| KAKAO_CLIENT_SECRET  | Worker Secret, 카카오 Client Secret                                   |
| TOKEN_ENCRYPTION_KEY | Worker Secret, 무작위 32바이트의 base64. 기존 암호화 자료 복구에 필요 |
| SESSION_SECRET       | Worker Secret, 최소 32자 이상의 무작위 값                             |
| SETUP_TOKEN          | Worker Secret, 최초 운영자만 아는 최소 32자 이상의 무작위 값          |

`.dev.vars.example`은 형식 안내입니다. 실제 값은 채팅·Git·로그에 붙이지 말고 Worker Secret 입력창에 직접 넣습니다. 운영 키를 생성할 때 `openssl rand -base64 32`를 사용할 수 있으며 출력은 개인 비밀 저장소에 보관합니다. 각 Secret은 별개의 값으로 만듭니다.

## 적용 순서

아래 원격 명령은 **준비된 절차이며 이번 구현 중 실행하지 않았습니다**.

1. `npm run build`, `npm run check:free`, `npm test`, `npm run test:e2e`를 통과시킵니다.
2. Cloudflare의 Free 플랜과 공유 한도를 직접 확인하고 Wrangler에 해당 계정으로 로그인합니다.
3. 필요한 무료 리소스만 생성합니다.

```sh
npx wrangler login
npx wrangler d1 create en-card
npx wrangler kv namespace create CARD_IMAGES
```

4. 반환된 D1 UUID와 KV ID를 `wrangler.jsonc`에 넣고, 계정의 workers.dev 하위 도메인을 사용해 APP_ORIGIN을 설정합니다. Cron은 `* * * * *` 하나이며 UTC로 동작합니다. 개별 예약은 D1에서 KST→UTC로 계산합니다.
5. 카카오 앱에서 카카오 로그인·`talk_message` 동의를 설정합니다. Redirect URI를 `APP_ORIGIN/auth/callback`으로 정확히 등록하고 메시지 제품 링크 웹 도메인에 APP_ORIGIN을 등록합니다. REST API 키와 Client Secret을 확인합니다. [로그인 API](https://developers.kakao.com/docs/ko/kakaologin/rest-api), [메시지 API](https://developers.kakao.com/docs/ko/kakaotalk-message/rest-api), [피드 규격](https://developers.kakao.com/docs/ko/message-template/default)을 재확인합니다.
6. 마이그레이션과 Secrets를 적용합니다.

```sh
npx wrangler d1 migrations apply DB --remote --config wrangler.jsonc
npx wrangler secret put KAKAO_REST_API_KEY
npx wrangler secret put KAKAO_CLIENT_SECRET
npx wrangler secret put TOKEN_ENCRYPTION_KEY
npx wrangler secret put SESSION_SECRET
npx wrangler secret put SETUP_TOKEN
```

7. `npm run build && npm run check:free`를 다시 실행하고 사용자에게 허용된 범위에서 `npx wrangler deploy --config wrangler.jsonc`로 dry_run 배포합니다. Static Assets의 `run_worker_first`로 API·인증·공개 이미지 경로가 SPA에 가려지지 않게 구성되어 있습니다.
8. 앱에서 SETUP_TOKEN으로 최초 운영자를 등록합니다. DB의 소유자 ID는 고정되며 다른 카카오 ID는 거부합니다. 카드·공개 이미지·원본 링크·예약 미리검증을 확인합니다. KV 전파를 고려해 이미지 저장 후 2분 이상 기다립니다. 이 시간은 가용성 보장이 아닙니다. [KV 전파 정책](https://developers.cloudflare.com/kv/api/write-key-value-pairs/)을 참고합니다.
9. 실제 발송 승인을 받은 뒤에만 SEND_MODE를 live로 변경합니다. 현재 `check:free`는 dry_run 기본값을 강제하므로 live 전환 시 승인된 운영 설정에 맞춘 검토·검사 변경이 필요합니다. 모드를 자동 전환하는 UI는 없습니다.
10. 실제 CPU, 한도, 토큰 갱신, 휴대전화의 이미지·원본 링크 수신을 검증합니다. PC·브라우저·Codex를 종료한 상태의 미래 예약은 별도 모바일 기기에서 사용자가 확인하고 그 사실을 기록합니다.

로컬 통과·배포 성공·API 접수·실제 수신은 서로 다른 검증입니다. 실제 호출당 CPU 10ms를 초과하면 배치 축소·코드 경량화 후 Free 환경에서 재검증하며 유료 전환으로 해결하지 않습니다.
