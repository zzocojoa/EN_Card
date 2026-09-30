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

2026-09-30 공식 문서 재확인 기준입니다. 배포 직전에 다시 확인합니다.

| 항목          | 확인한 Free 한도                                            | 공식 문서                                                                                                                               |
| ------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Workers       | 요청 100,000회/일, 호출당 CPU 10ms                          | [요금](https://developers.cloudflare.com/workers/platform/pricing/), [제한](https://developers.cloudflare.com/workers/platform/limits/) |
| D1            | 읽기 500만 행/일, 쓰기 10만 행/일, 총 저장 5GB              | [D1 요금](https://developers.cloudflare.com/d1/platform/pricing/)                                                                       |
| KV            | 저장 1GB, 쓰기·삭제·목록 각각 1,000회/일, 읽기 100,000회/일 | [KV 요금](https://developers.cloudflare.com/kv/platform/pricing/)                                                                       |
| Static Assets | 정적 자산 요청 무료·무제한; Worker 실행 요청은 별도 한도    | [정적 자산 요금](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)                                      |
| 카카오        | 본인 전송 무료, 푸시 알림·알림음 없음                       | [공식 답변](https://devtalk.kakao.com/t/api/146901)                                                                                     |

실제 계정의 Workers Free 상태, D1/KV 리소스 수와 공유 사용량, 유료 부가 상품이 없는지 대시보드에서 확인해야 합니다. Free 자격이 확인되지 않으면 배포를 보류합니다. 기존 구독·결제 수단은 변경하지 않습니다. 무료 CPU 시간은 외부 응답을 기다리는 벽시계 시간과 다르며 실제 배포에서 측정해야 합니다.

앱 제한은 `src/shared/model.ts`와 DB 제약으로 강제합니다. 이미지 1MiB/장·총 200MB, 업로드 100회/일, 활성 예약 10개, 회차당 1~5장, 분당 실제 시도 3건, 하루 실제 시도 20건, 확실한 미접수 거절 최대 3회입니다. 앱 날짜는 KST, 제공사 한도 초기화는 제공사 정책을 따릅니다. D1 Free의 [호출당 50쿼리 제한](https://developers.cloudflare.com/d1/platform/limits/)을 고려해 예약 목록은 한 번에 최대 40개, 회차 생성은 Cron당 최대 2개입니다. JSON 가져오기는 최대 100개·본문 1,000,000바이트이며 json_each를 이용한 단일 INSERT로 해당 파일 전체를 원자적으로 저장합니다. 목록과 JSON 백업은 100개씩 이어서 조회합니다.

## 계정이 없을 때 시작 순서

가입·이메일 인증·약관 동의·로그인 승인은 운영자가 직접 수행합니다. 채팅에는 완료 여부와 막힌 화면의 항목명만 알려주고 비밀번호·인증 코드·키·Secret 값은 입력하지 않습니다.

1. [Cloudflare 가입](https://dash.cloudflare.com/sign-up)에서 계정을 만들고 수신한 인증 메일의 링크로 이메일 인증을 완료합니다. [공식 가입 안내](https://developers.cloudflare.com/fundamentals/account/create-account/)를 따릅니다. 이 앱은 `workers.dev`를 사용하므로 도메인을 구매할 필요가 없습니다.
2. Dashboard에서 Workers Free 플랜과 기존 공유 사용량을 확인합니다. 이 프로젝트를 위해 유료 플랜·결제 수단을 추가하지 않습니다. 확인이 끝나면 개발 worktree에서 `npx wrangler login`을 실행하고 브라우저에서 해당 계정으로 승인을 완료합니다. `npx wrangler whoami`로 로그인 대상 계정을 확인합니다.
3. [Kakao Developers](https://developers.kakao.com/)에 메시지를 받을 본인의 카카오계정으로 로그인한 뒤 개발자 회원가입을 완료합니다. [공식 시작 안내](https://developers.kakao.com/docs/ko/tutorial/start)에 따라 등록합니다.
4. 아래 원격 절차에서 실제 `APP_ORIGIN`을 확정한 뒤 카카오 앱을 생성합니다. 앱 이름은 `EN_Card`, 카테고리는 영어 학습 서비스에 맞는 항목을 선택합니다. 개인 개발자는 회사명에 개발자나 서비스 출처를 대표하는 이름을 입력할 수 있습니다. 앱 아이콘은 생략할 수 있으며 대표 도메인에는 확정된 HTTPS 주소를 사용합니다. 기존 EN_Card 앱이 있으면 재사용합니다.

두 계정 등록이 끝난 뒤 이어서 할 작업은 무료 리소스 확인·생성, 주소 확정, 카카오 설정, Worker Secret 입력, `dry_run` 배포입니다. 화면에 입력할 정확한 주소는 실제 계정의 `workers.dev` 주소가 확인된 뒤 정합니다. 가입만으로 배포나 실제 메시지 수신이 완료되지는 않습니다.

### 카카오 앱 설정 위치

2026-09-30 공식 문서와 실제 콘솔 기준 메뉴입니다. `APP_ORIGIN`은 placeholder가 아닌 실제 운영 HTTPS 주소이며 끝 슬래시를 넣지 않습니다.

| 목적           | 메뉴와 입력값                                                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 로그인 활성화  | 해당 앱의 `카카오 로그인 → 사용 설정 → 상태`를 ON                                                                            |
| OAuth 콜백     | `앱 → 플랫폼 키 → REST API 키 → 카카오 로그인 리다이렉트 URI`에 `APP_ORIGIN/auth/callback` 등록                              |
| 원본 보기 링크 | `앱 → 제품 링크 관리 → 웹 도메인`에 `APP_ORIGIN` 등록                                                                        |
| 발송 동의      | `카카오 로그인 → 동의항목 → 접근권한 → 카카오톡 메시지 전송(talk_message)` 설정. 동의 목적은 본인의 영어 학습 카드 예약 발송 |
| REST API 키    | `앱 → 플랫폼 키 → REST API 키`의 값을 해당 Worker의 `KAKAO_REST_API_KEY` Secret에 직접 입력                                  |
| Client Secret  | 같은 REST API 키의 `클라이언트 시크릿` 값을 Worker의 `KAKAO_CLIENT_SECRET` Secret에 직접 입력                                |

새 REST API 키는 Client Secret이 활성화된 상태로 생성됩니다. 값을 코드·설정 파일·Git에 넣지 않고 아래 Secret 입력 절차를 사용합니다. Redirect URI는 프로토콜·도메인·경로·끝 슬래시까지 요청과 정확히 일치해야 합니다. 출처: [카카오 로그인 설정](https://developers.kakao.com/docs/ko/kakaologin/prerequisite), [앱·키·제품 링크 설정](https://developers.kakao.com/docs/ko/app-setting/app).

## 운영 입력값과 확인 위치

2026-09-30 아래 계정·리소스·Secret 설정과 본인 카카오 OAuth 연결을 완료했습니다. 20:06 한 장의 실제 API 접수·CPU 5/5/10ms와 사용자 휴대전화의 이미지·원본 링크를 확인했습니다. 현재 원격은 23:45 일회 종료 시험을 위해 live이며 PC 종료 수신·정상 토큰 갱신은 아직 미검증입니다. 값 자체를 채팅·Git·로그에 남기지 마세요. 기본 `wrangler.jsonc`는 placeholder와 `SEND_MODE=dry_run`을 유지합니다. 실제 값은 Git 제외 파일 `wrangler.deploy.jsonc`에 넣고 live는 `wrangler.live.jsonc`로 분리합니다. 비공개 자식 설정은 `wrangler.delivery.deploy.jsonc`입니다. 세 파일은 프로젝트 루트에 둡니다.

| 입력·확인            | 입력 위치·확인 방법                                                                                          | 현재 상태                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------- |
| Cloudflare 계정      | Dashboard의 Workers Free 플랜·공유 사용량·유료 부가 상품 유무 확인. Wrangler 로그인 계정과 일치              | Free·계정 일치 확인; 공유 사용량 미측정 |
| D1 식별자            | `d1_databases[0].database_name/database_id`, 바인딩 `DB`. 기존 DB가 있으면 재사용                            | 전용 en-card·9개 마이그레이션 적용      |
| KV 식별자            | `kv_namespaces[0].id`, 바인딩 `CARD_IMAGES`. 기존 이미지 namespace 보존                                      | 전용 CARD_IMAGES 생성                   |
| workers.dev 주소     | Dashboard의 계정 하위 도메인과 Worker 이름으로 실제 HTTPS 주소 확인. `vars.APP_ORIGIN`에 끝 슬래시 없이 입력 | 실제 배포·APP_ORIGIN 일치               |
| 실행 모드            | 두 설정 모두 `COST_MODE=free_only`; deploy 파일은 `dry_run`, live 파일만 명시적으로 `live`                   | 기본 dry_run                            |
| 카카오 앱            | Kakao Developers에서 개인용 앱, 카카오 로그인, 본인 계정 접근 설정 확인                                      | EN_Card 생성·로그인 ON·OAuth 완료       |
| Redirect URI         | `APP_ORIGIN/auth/callback`을 완전히 일치하게 등록                                                            | 등록·일치 확인                          |
| 웹 도메인·동의       | 메시지 링크 웹 도메인에 APP_ORIGIN 등록, `talk_message` 동의 항목 설정·실제 동의 확인                        | 도메인·선택 동의·실제 동의 완료         |
| KAKAO_REST_API_KEY   | 해당 Worker Secret 입력창 또는 아래 `secret put`의 숨김 입력                                                 | 등록 완료                               |
| KAKAO_CLIENT_SECRET  | Kakao 앱의 Client Secret과 같은 Worker Secret                                                                | 재발급한 새 값 등록                     |
| TOKEN_ENCRYPTION_KEY | 별도 무작위 32바이트 base64 Worker Secret. 암호화 자료 복구에 필요하므로 개인 비밀 저장소에도 보관           | 등록·DPAPI 백업                         |
| SESSION_SECRET       | 별도 무작위 최소 32자 Worker Secret                                                                          | 등록·DPAPI 백업                         |
| SETUP_TOKEN          | 별도 무작위 최소 32자 Worker Secret. 최초 운영자 등록 화면에서만 입력                                        | 등록·DPAPI 백업                         |

`.dev.vars.example`은 형식 예시입니다. `.dev.vars`의 로컬 테스트 값을 운영에 복사하지 않습니다. 비밀값은 개인 비밀 관리 도구에서 생성하여 Secret 입력창에 직접 넣습니다. [카카오 로그인](https://developers.kakao.com/docs/ko/kakaologin/rest-api), [메시지](https://developers.kakao.com/docs/ko/kakaotalk-message/rest-api), [피드 규격](https://developers.kakao.com/docs/ko/message-template/default)을 배포 직전 확인하세요.

## 원격 실행 절차

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
DELIVERY_CONFIG=wrangler.delivery.deploy.jsonc
cp -n wrangler.delivery.jsonc "$DELIVERY_CONFIG"
npx wrangler deploy --dry-run --config "$DEPLOY_CONFIG" --outdir .worker-build
npm run check:free -- --config "$DEPLOY_CONFIG" --delivery-config "$DELIVERY_CONFIG" --mode dry_run
```

검사는 대상 경로·SEND_MODE·설정 SHA-256을 출력하며 배포·발송하지 않습니다. 검사 통과가 계정 요금제·실제 리소스 존재를 증명하지는 않습니다. placeholder가 남지 않았는지 표와 대조합니다.

### 비공개 발송 Worker 설정

CPU를 나누기 위해 `en-card`의 Cron은 claim·인증을 담당하고 HTTP Service Binding으로 `en-card-delivery`를 호출합니다. 준비와 카드별 발송은 각각 별도 요청입니다. 매분 Cron 하나·최대 3건·하루 시도 20회는 그대로입니다. [Service Binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)은 공개 URL 없이 Worker를 연결합니다.

`wrangler.delivery.deploy.jsonc`에는 주 Worker와 **동일한 D1 식별자·APP_ORIGIN**을 입력합니다. `COST_MODE=free_only`, `SEND_MODE=live`, `workers_dev=false`, `preview_urls=false`를 유지합니다. 별도 Cron·KV·정적 자산·Secret은 넣지 않습니다. 주 Worker의 `services`에는 `DELIVERY_SERVICE → en-card-delivery` 하나만 둡니다. 실제 카카오 토큰은 비공개 요청 메모리로만 전달되며 기존 암호화 저장 위치는 바뀌지 않습니다. 자식이 항상 live여도 dry_run 주 Worker는 이를 호출하지 않습니다.

새 검사 옵션은 두 설정의 D1 일치·비공개 접근·허용 바인딩을 검사합니다. 실제 식별자를 쓰는 검사에는 `--delivery-config`도 반드시 전달합니다. 두 Worker 모두 Free 계정에서 실측하며 설정 검사만으로 CPU 충족을 보장하지 않습니다.

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

### Windows 마이그레이션 오류 복구 기록

2026-09-30 Wrangler 4.142.0의 `d1 migrations apply`는 신규 DB의 0006에서 `incomplete input`으로 중단했다. 실패 후 적용 이력은 0001~0005였고, 0006의 새 컬럼·임시 테이블이 없으며 기존 트리거가 보존된 것을 확인했다. CRLF를 LF로 바꾼 뒤에도 같았으므로 LF를 해결 원인으로 보고하지 않는다. .gitattributes는 이후 SQL 줄바꿈을 일관되게 유지한다.

이 DB에만 Git 원본과 대조한 0006~0009 SQL과 각 파일의 `d1_migrations` 이력 INSERT를 묶어 Git 제외 파일로 만들고, 아래 파일 import를 한 번 실행했다. 원본 마이그레이션의 SQL 의미는 변경하지 않았다. 48개 쿼리 성공 후 9개 이력과 FK 빈 결과를 확인했다. 이미 적용된 DB에는 이 파일을 재실행하지 않는다. 다른 환경에서 같은 오류가 나면 먼저 백업·실제 스키마·적용 이력을 확인하고 미적용 SQL만 검토하여 새 파일을 준비한다.

```powershell
$env:CLOUDFLARE_ACCOUNT_ID='<사용할 계정 식별자>'
& ./node_modules/.bin/wrangler.cmd d1 execute DB --remote --config wrangler.deploy.jsonc --file backups/remote-migrations-0006-0009-20260930.sql --yes
```

고정된 라이브러리의 query 경로에서는 실패하고 file import 경로에서는 성공한 것이 확인된 사실이다. 트리거의 CASE/END 분할 문제는 원인 후보이며 단일 문장까지 분리해 확정하지 않았다. 공식 근거: [SDK 트리거 분할 이슈](https://github.com/cloudflare/workers-sdk/issues/4727), [CRLF 이슈](https://github.com/cloudflare/workers-sdk/issues/14991), [D1 import](https://developers.cloudflare.com/d1/best-practices/import-export-data/).

### 3. Secret 입력과 dry_run 배포

이미 올바르게 설정된 Secret은 재입력하지 않습니다. 평문 입력값을 명령 인수나 파일에 쓰지 않습니다. 이번 연결에서는 표준 입력으로 Secret을 전달했고, 복구용 암호화본만 `backups/en-card-server-secrets.dpapi.json`과 `backups/en-card-kakao-secrets-current.dpapi.json`에 저장했습니다. 두 파일은 Git 제외이며 Windows 현재 사용자 DPAPI로 보호됩니다. 다른 PC·Windows 계정에서 자동 복호화되는 백업이 아닙니다. 계정·기기를 바꾸기 전에 운영자가 별도 암호화 비밀 저장소로 복구 자료를 이관해야 합니다. 최초 연결 이후에는 SETUP_TOKEN을 다시 입력할 필요가 없습니다.

```sh
npx wrangler secret put KAKAO_REST_API_KEY --config "$DEPLOY_CONFIG"
npx wrangler secret put KAKAO_CLIENT_SECRET --config "$DEPLOY_CONFIG"
npx wrangler secret put TOKEN_ENCRYPTION_KEY --config "$DEPLOY_CONFIG"
npx wrangler secret put SESSION_SECRET --config "$DEPLOY_CONFIG"
npx wrangler secret put SETUP_TOKEN --config "$DEPLOY_CONFIG"
npx wrangler deploy --dry-run --config "$DEPLOY_CONFIG" --outdir .worker-build
npx wrangler deploy --dry-run --config "$DELIVERY_CONFIG" --outdir .delivery-build
npm run check:free -- --config "$DEPLOY_CONFIG" --delivery-config "$DELIVERY_CONFIG" --mode dry_run
npx wrangler deploy --config "$DELIVERY_CONFIG"
npx wrangler deploy --config "$DEPLOY_CONFIG"
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
npm run check:free -- --config "$LIVE_CONFIG" --delivery-config "$DELIVERY_CONFIG" --mode live
```

live 검사도 유료 바인딩·외부 서비스·로컬 인증·모의 구현 제한을 그대로 적용합니다. `--mode live`만 쓰거나 기본 파일을 live로 바꾸면 거부합니다. **검사 통과는 발송 승인이 아닙니다.** 본인 테스트 범위가 허용된 이후에만 다음 명령을 실행합니다.

```sh
npm run check:free -- --config "$LIVE_CONFIG" --delivery-config "$DELIVERY_CONFIG" --mode live && npx wrangler deploy --config "$LIVE_CONFIG"
```

### 6. 실제 운영 검증과 중단 기준

2026-09-30 최초 시험은 메시지 권한 부족(403/-402)·CPU 24ms로 중단했습니다. 이후 정확한 talk_message scope를 확인한 새 연결과 비공개 HTTP Worker 분리 뒤, 20:06 한 장의 API 접수·CPU 5/5/10ms·휴대전화 이미지와 원본 링크를 확인했습니다. 검증 모드 복귀 후 사용자의 다음 작업 승인으로 23:45 비교형 한 장의 live 종료 시험을 준비했습니다. 최신 실제 결과·미확인 조건은 VERIFICATION.md를 따릅니다. 미동의·scope 누락이면 카카오 다시 연결로 새 동의를 시작하며 기존 실패 예약을 자동 활성화하지 않습니다.

1. 테스트 카드 1장으로 API 접수 시각·상태를 확인합니다. 사용자 휴대전화에서 이미지·한영 글자·원본 링크를 직접 확인합니다. 무료 나에게 보내기는 푸시 알림·알림음이 없습니다.
2. 실제 액세스 토큰 만료·갱신이 발생하는 정상 시점에 갱신 성공과 연결 유지·후속 발송을 관측합니다. 토큰 값·OAuth 응답 원문을 기록하지 않습니다. 아직 갱신을 관측하지 못했으면 미검증으로 남깁니다.
3. 새 미래 예약을 만든 뒤 PC·브라우저·Codex를 종료합니다. 별도 휴대전화로 확인한 사용자·기기·KST 예정/수신 시각·이미지/링크 결과를 VERIFICATION.md에 기록합니다.
4. Cloudflare의 실제 CPU·D1/KV 사용량을 확인합니다. 원격 CPU 10ms 초과, 무료 한도 오류, unknown, 잘못된 이미지, 인증 문제는 live 확대 중단 조건입니다. 경량화·배치 축소 후 Free 환경에서 다시 검증하며 유료 상품으로 우회하지 않습니다.

중단·데이터 복구는 [OPERATIONS.md](OPERATIONS.md#운영-중단과-스키마-복구)를 따릅니다. 원격 배포 성공·API 접수·실제 수신·PC 종료 검증은 각각 별개입니다. 현재 M5는 운영 검증 미완료입니다.
