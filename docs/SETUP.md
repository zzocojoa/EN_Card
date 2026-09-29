# 설정과 배포 준비

## 로컬 개발

Node.js 22.12 이상과 npm을 사용합니다. 잠금 파일을 보존하여 `npm ci`로 설치합니다.

```sh
npm ci
npm run dev
```

`dev`는 Vite 빌드, 로컬 D1 마이그레이션, `wrangler.local.jsonc`의 loopback 서버를 순서대로 실행합니다. 주소는 `http://127.0.0.1:8787`입니다. 프런트엔드 수정 후에는 `npm run build:web`로 갱신하고 브라우저를 새로 고칩니다. Node.js는 개발 도구에만 사용하며 운영 Worker는 Web API 기반입니다.

`npm run dev`의 같은 출처 화면·API를 사용합니다. 별도 Vite 개발 포트에서 운영자 API를 호출하는 스크립트는 제공하지 않습니다.

로컬 진입점 `src/worker/local.ts`에는 테스트 세션 시작 기능이 있습니다. 이 파일은 운영 설정에서 참조하지 않습니다. 로컬 DB/KV ID는 운영 설정과 다르며 테스트는 매번 독립적인 Miniflare DB/KV를 만듭니다. E2E 저장소도 `.wrangler/e2e-*`로 분리합니다. 로컬 진입점·테스트 키를 운영으로 복사하지 마세요.

## 무료 조건의 근거

2026-09-29 공식 문서 확인 기준입니다. 배포 직전에 다시 확인합니다.

| 항목          | 확인한 Free 한도                                            | 공식 문서                                                                                                                               |
| ------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Workers       | 요청 100,000회/일, 호출당 CPU 10ms                          | [요금](https://developers.cloudflare.com/workers/platform/pricing/), [제한](https://developers.cloudflare.com/workers/platform/limits/) |
| D1            | 읽기 500만 행/일, 쓰기 10만 행/일, 총 저장 5GB              | [D1 요금](https://developers.cloudflare.com/d1/platform/pricing/)                                                                       |
| KV            | 저장 1GB, 쓰기·삭제·목록 각각 1,000회/일, 읽기 100,000회/일 | [KV 요금](https://developers.cloudflare.com/kv/platform/pricing/)                                                                       |
| Static Assets | 정적 자산 요청 무료·무제한; Worker 실행 요청은 별도 한도    | [정적 자산 요금](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)                                      |
| 카카오        | 본인 전송 무료, 푸시 알림·알림음 없음                       | [공식 답변](https://devtalk.kakao.com/t/api/146901)                                                                                     |

실제 계정의 Workers Free 상태, D1/KV 리소스 수와 공유 사용량, 유료 부가 상품이 없는지 대시보드에서 확인해야 합니다. Free 자격이 확인되지 않으면 배포를 보류합니다. 기존 구독·결제 수단은 변경하지 않습니다. 무료 CPU 시간은 외부 응답을 기다리는 벽시계 시간과 다르며 실제 배포에서 측정해야 합니다.

앱 제한은 `src/shared/model.ts`와 DB 제약으로 강제합니다. 이미지 1MiB/장·총 200MB, 업로드 100회/일, 활성 예약 10개, 회차당 1~5장, 분당 실제 시도 3건, 하루 실제 시도 20건, 확실한 미접수 거절 최대 3회입니다. 앱 날짜는 KST, 제공사 한도 초기화는 제공사 정책을 따릅니다. D1 Free의 [호출당 50쿼리 제한](https://developers.cloudflare.com/d1/platform/limits/)을 고려해 예약 목록은 한 번에 최대 40개, 회차 생성은 Cron당 최대 2개입니다. JSON 가져오기는 최대 100개·본문 1,000,000바이트이며 json_each를 이용한 단일 INSERT로 해당 파일 전체를 원자적으로 저장합니다. 목록과 JSON 백업은 100개씩 이어서 조회합니다.

## 운영 입력값과 확인 위치

현재 원격 계정·리소스·Secret은 확인하지 않았습니다. 아래 표를 채운 뒤에만 원격 절차를 진행합니다. 값 자체를 채팅·Git·로그에 남기지 마세요. 기본 `wrangler.jsonc`는 placeholder와 `SEND_MODE=dry_run`을 유지합니다. 실제 값은 Git 제외 파일 `wrangler.deploy.jsonc`에 넣고 live는 `wrangler.live.jsonc`로 분리합니다. 둘 다 프로젝트 루트에 두어 소스·자산·마이그레이션 경로를 같게 합니다.

| 입력·확인            | 입력 위치·확인 방법                                                                                          | 현재 상태    |
| -------------------- | ------------------------------------------------------------------------------------------------------------ | ------------ |
| Cloudflare 계정      | Dashboard의 Workers Free 플랜·공유 사용량·유료 부가 상품 유무 확인. Wrangler 로그인 계정과 일치              | 미확인       |
| D1 식별자            | `d1_databases[0].database_name/database_id`, 바인딩 `DB`. 기존 DB가 있으면 재사용                            | 미설정       |
| KV 식별자            | `kv_namespaces[0].id`, 바인딩 `CARD_IMAGES`. 기존 이미지 namespace 보존                                      | 미설정       |
| workers.dev 주소     | Dashboard의 계정 하위 도메인과 Worker 이름으로 실제 HTTPS 주소 확인. `vars.APP_ORIGIN`에 끝 슬래시 없이 입력 | 미설정       |
| 실행 모드            | 두 설정 모두 `COST_MODE=free_only`; deploy 파일은 `dry_run`, live 파일만 명시적으로 `live`                   | 기본 dry_run |
| 카카오 앱            | Kakao Developers에서 개인용 앱, 카카오 로그인, 본인 계정 접근 설정 확인                                      | 미확인       |
| Redirect URI         | `APP_ORIGIN/auth/callback`을 완전히 일치하게 등록                                                            | 미등록       |
| 웹 도메인·동의       | 메시지 링크 웹 도메인에 APP_ORIGIN 등록, `talk_message` 동의 항목 설정·실제 동의 확인                        | 미확인       |
| KAKAO_REST_API_KEY   | 해당 Worker Secret 입력창 또는 아래 `secret put`의 숨김 입력                                                 | 미입력       |
| KAKAO_CLIENT_SECRET  | Kakao 앱의 Client Secret과 같은 Worker Secret                                                                | 미입력       |
| TOKEN_ENCRYPTION_KEY | 별도 무작위 32바이트 base64 Worker Secret. 암호화 자료 복구에 필요하므로 개인 비밀 저장소에도 보관           | 미입력       |
| SESSION_SECRET       | 별도 무작위 최소 32자 Worker Secret                                                                          | 미입력       |
| SETUP_TOKEN          | 별도 무작위 최소 32자 Worker Secret. 최초 운영자 등록 화면에서만 입력                                        | 미입력       |

`.dev.vars.example`은 형식 예시입니다. `.dev.vars`의 로컬 테스트 값을 운영에 복사하지 않습니다. 비밀값은 개인 비밀 관리 도구에서 생성하여 Secret 입력창에 직접 넣습니다. [카카오 로그인](https://developers.kakao.com/docs/ko/kakaologin/rest-api), [메시지](https://developers.kakao.com/docs/ko/kakaotalk-message/rest-api), [피드 규격](https://developers.kakao.com/docs/ko/message-template/default)을 배포 직전 확인하세요.

## 원격 실행 절차 — 준비만 완료, 이번 작업에서는 미실행

아래 명령은 프로젝트 루트에서 순서대로 실행하는 운영자용 절차입니다. `wrangler deploy --dry-run`은 로컬 번들 검사이고, `SEND_MODE=dry_run` 파일로 하는 `wrangler deploy`는 실제 원격 배포이므로 구별합니다. live 전환은 본인 테스트의 카드·횟수·시각 범위를 정한 뒤 별도로 허용된 경우에만 실행합니다.

### 1. 로컬 검증과 대상 설정

```sh
npm ci
npm test
npm run build
npm run check:free
npm run test:e2e
npx wrangler login
cp -n wrangler.jsonc wrangler.deploy.jsonc
```

Free 자격이 확인되지 않으면 여기서 중단합니다. 기존 D1/KV가 없는 계정에서만 `npx wrangler d1 create en-card`, `npx wrangler kv namespace create CARD_IMAGES`로 필요한 무료 리소스를 만듭니다. 반환된 식별자·실제 APP_ORIGIN을 `wrangler.deploy.jsonc`에 입력합니다. 표의 카카오 설정도 완료합니다. 기존 서비스나 Secret을 임의로 교체하지 않습니다.

```sh
DEPLOY_CONFIG=wrangler.deploy.jsonc
LIVE_CONFIG=wrangler.live.jsonc
npx wrangler deploy --dry-run --config "$DEPLOY_CONFIG" --outdir .worker-build
npm run check:free -- --config "$DEPLOY_CONFIG" --mode dry_run
```

검사는 대상 경로·SEND_MODE·설정 SHA-256을 출력하며 배포·발송하지 않습니다. 검사 통과가 계정 요금제·실제 리소스 존재를 증명하지는 않습니다. placeholder가 남지 않았는지 표와 대조합니다.

### 2. 기존 DB 백업 → 미적용 마이그레이션

기존 live 운영이면 Dashboard에서 해당 Worker의 Cron Trigger를 잠시 제거하고 신규 편집·업로드를 멈춥니다. 진행 중 호출은 종료를 기다리고 `sending`·`unknown`을 기록합니다. 중단 전에 접수된 메시지는 회수할 수 없습니다. 최초 배포의 빈 DB도 백업·마이그레이션 이력을 보관합니다.

```sh
umask 077
mkdir -p backups
BACKUP_STAMP=$(date +%Y%m%d-%H%M%S)
npx wrangler d1 export DB --remote --config "$DEPLOY_CONFIG" --output "backups/pre-m5-$BACKUP_STAMP.sql"
npx wrangler d1 migrations list DB --remote --config "$DEPLOY_CONFIG"
npx wrangler d1 execute DB --remote --config "$DEPLOY_CONFIG" --command "SELECT name FROM d1_migrations ORDER BY id;" --json > "backups/migrations-$BACKUP_STAMP.json"
npx wrangler d1 migrations apply DB --remote --config "$DEPLOY_CONFIG"
npx wrangler d1 execute DB --remote --config "$DEPLOY_CONFIG" --command "PRAGMA foreign_key_check; SELECT name FROM d1_migrations ORDER BY id;" --json
```

신규 DB에서 `d1_migrations`가 아직 없으면 이력 내보내기만 생략하고 빈 DB임을 기록합니다. 나머지 오류는 중단하여 조사합니다. 새 DB에는 0001~0009, 기존 DB에는 미적용 파일만 순서대로 적용합니다. 0001~0008 파일은 변경하지 않았습니다. 0009는 취소 이력을 보존하면서 일시정지 미발송의 복구 관계·선택 보호를 추가합니다. FK 검사 결과가 비어 있고 적용 이력에 0009가 있어야 새 서버를 배포합니다. 전체 백업은 암호화 토큰·개인 정보를 포함하므로 접근 제한된 개인 저장소에 보관합니다. [D1 내보내기·가져오기](https://developers.cloudflare.com/d1/best-practices/import-export-data/)를 참고하세요.

### 3. Secret 입력과 dry_run 배포

이미 올바르게 설정된 Secret은 재입력하지 않습니다. 입력값을 명령 인수나 파일에 쓰지 않습니다.

```sh
npx wrangler secret put KAKAO_REST_API_KEY --config "$DEPLOY_CONFIG"
npx wrangler secret put KAKAO_CLIENT_SECRET --config "$DEPLOY_CONFIG"
npx wrangler secret put TOKEN_ENCRYPTION_KEY --config "$DEPLOY_CONFIG"
npx wrangler secret put SESSION_SECRET --config "$DEPLOY_CONFIG"
npx wrangler secret put SETUP_TOKEN --config "$DEPLOY_CONFIG"
npx wrangler deploy --dry-run --config "$DEPLOY_CONFIG" --outdir .worker-build
npm run check:free -- --config "$DEPLOY_CONFIG" --mode dry_run && npx wrangler deploy --config "$DEPLOY_CONFIG"
```

검사와 실제 배포는 같은 파일을 사용합니다. 검사 뒤 설정을 바꾸면 다시 검사합니다. 설정의 Cron 하나가 다시 적용되며 dry_run은 실제 전송·회차·커서를 소비하지 않습니다. 운영 `/auth/local` 접근은 거부되어야 합니다.

### 4. dry_run 운영 점검

- SETUP_TOKEN으로 운영자를 등록하고 카카오 로그인·동의·콜백을 확인합니다. 다른 계정 접근과 세션 없는 API는 거부되어야 합니다.
- 두 종류 카드를 검토·저장하고 2분 이상 뒤 Cookie 없는 별도 브라우저에서 이미지·원본 URL을 확인합니다. image/png, 1080×1080, 한영 표시를 확인합니다. [KV 전파](https://developers.cloudflare.com/kv/api/write-key-value-pairs/)에는 지연이 있을 수 있습니다.
- KST 미래 예약과 UTC 저장 시각을 대조합니다. 미리검증·Cron 뒤 dry_run 기록만 생기고 회차·커서·발송 예산이 소비되지 않는지 확인합니다.
- 이후 live에서 불필요한 시험 예약이 실행되지 않도록 본인 테스트 대상 이외의 예약을 중지합니다. 중지 카드의 복구·제외 선택을 확인합니다. 과거 dry_run 예정 시각을 그대로 live 발송 대상으로 쓰지 말고 새 미래 시각을 정합니다.

### 5. 명시적인 live 설정 검사 → 허용된 본인 테스트

dry_run 파일을 기준으로 별도 live 파일을 만듭니다. 기존 live 파일이 있으면 덮어쓰지 않고 대상·차이를 먼저 확인합니다. 아래 명령은 새 파일만 생성합니다.

```sh
node --input-type=module <<'JS'
import { readFile, writeFile } from 'node:fs/promises';
import { parse } from 'jsonc-parser';
const config = parse(await readFile('wrangler.deploy.jsonc', 'utf8'));
const live = { ...config, vars: { ...config.vars, SEND_MODE: 'live' } };
await writeFile('wrangler.live.jsonc', JSON.stringify(live, null, 2) + '\n', { flag: 'wx' });
JS
npx wrangler deploy --dry-run --config "$LIVE_CONFIG" --outdir .worker-build
npm run check:free -- --config "$LIVE_CONFIG" --mode live
```

live 검사도 유료 바인딩·외부 서비스·로컬 인증·모의 구현 제한을 그대로 적용합니다. `--mode live`만 쓰거나 기본 파일을 live로 바꾸면 거부합니다. **검사 통과는 발송 승인이 아닙니다.** 본인 테스트 범위가 허용된 이후에만 다음 명령을 실행합니다.

```sh
npm run check:free -- --config "$LIVE_CONFIG" --mode live && npx wrangler deploy --config "$LIVE_CONFIG"
```

### 6. 실제 운영 검증과 중단 기준

1. 테스트 카드 1장으로 API 접수 시각·상태를 확인합니다. 사용자 휴대전화에서 이미지·한영 글자·원본 링크를 직접 확인합니다. 무료 나에게 보내기는 푸시 알림·알림음이 없습니다.
2. 실제 액세스 토큰 만료·갱신이 발생하는 정상 시점에 갱신 성공과 연결 유지·후속 발송을 관측합니다. 토큰 값·OAuth 응답 원문을 기록하지 않습니다. 아직 갱신을 관측하지 못했으면 미검증으로 남깁니다.
3. 새 미래 예약을 만든 뒤 PC·브라우저·Codex를 종료합니다. 별도 휴대전화로 확인한 사용자·기기·KST 예정/수신 시각·이미지/링크 결과를 VERIFICATION.md에 기록합니다.
4. Cloudflare의 실제 CPU·D1/KV 사용량을 확인합니다. 원격 CPU 10ms 초과, 무료 한도 오류, unknown, 잘못된 이미지, 인증 문제는 live 확대 중단 조건입니다. 경량화·배치 축소 후 Free 환경에서 다시 검증하며 유료 상품으로 우회하지 않습니다.

중단·데이터 복구는 [OPERATIONS.md](OPERATIONS.md#운영-중단과-스키마-복구)를 따릅니다. 원격 배포 성공·API 접수·실제 수신·PC 종료 검증은 각각 별개입니다. 현재 M5는 운영 검증 미완료입니다.
