# 하루단어 영어 카드 통합

2026-10-02 / 상태: 운영 반영 완료, 실제 iPhone·새 카카오 재연결/발송 검증은 별도

[하루단어 영어 카드 열기](https://wordgrain-oxford-study.hoihou-o.chatgpt.site/cards). 기존 ChatGPT 계정으로 로그인하고 홈의 **영어 카드** 버튼을 누른다. 운영자 접속 토큰은 필요 없다. 카드 내용과 관리는 연결된 본인 계정만 허용한다.

## 확정한 사용 방식

- 주소와 로그인 화면은 공개할 수 있지만 카드 내용·예약·관리는 본인만 사용한다.
- 하루단어 안에서 카드 제작, 1080×1080 PNG 저장, 카카오 예약과 발송 기록 확인을 제공한다.
- 평소에는 기존 하루단어 ChatGPT 로그인을 사용한다. 운영자 접속 토큰을 매번 입력하지 않는다.
- 카카오 연결은 발송 동의를 위한 별도 연결이다. 기존 연결을 유지하며 재연결이 필요할 때만 실행한다.

## 구조와 이유

```text
하루단어 /cards (기존 ChatGPT 로그인)
  └ 같은 출처의 /card-studio/index.html (카드 화면·Canvas·한글 폰트)
      └ /api/card-studio/* (매 요청 본인 계정·출처·허용 경로 검사)
          └ 기존 EN_Card Worker (서버 전용 인증·동일 운영자 확인)
              ├ 기존 D1: 카드·예약·발송 기록
              ├ 기존 KV: PNG·기존 공개 이미지 URL
              └ 기존 Cron·비공개 발송 Worker → 카카오 나와의 채팅
```

화면은 하루단어와 같은 출처의 프레임에 넣어 기존 학습 화면의 CSS·React 버전과 분리한다. 외부 workers.dev 화면을 iframe으로 넣지 않으며 브라우저의 제3자 쿠키에 의존하지 않는다. 기능 이동은 서버 렌더링 `/cards` 경로와 학습 화면의 영어 카드 버튼으로 제공한다. 이동 전 작성 중인 문법·학습 입력의 저장 절차를 따른다.

카드 서버와 DB를 유지해 예약 시각, 과거 발송 이력, 이미지 원본 링크를 보존한다. 새 DB·KV·R2·Cron·AI 의존성·마이그레이션을 추가하지 않는다. 두 프로젝트의 원래 체크아웃과 하루단어의 진행 중인 정확성 개선 브랜치는 수정하지 않는다.

## 구현 위치

| 프로젝트 | 브랜치·기준                                                              | 주요 파일                                                                                                        |
| -------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| EN_Card  | `codex/haru-card-integration`, `8e4bf67` 기준(master와 동일한 제품 트리) | `src/worker/studio-bridge.ts`, `auth.ts`, `index.ts`, `src/web/environment.ts`, `scripts/export-haru.mjs`        |
| 하루단어 | `codex/card-studio-integration`, 운영 소스 `b3b686f` 기준                | `app/cards/`, `app/api/card-studio/`, `lib/server/card-studio.ts`, `app/learning-app.tsx`, `public/card-studio/` |

EN_Card 작업 위치는 `.worktrees/haru-integration`이다. 하루단어 작업 위치는 `C:/Users/user/Documents/ChatGPT/haru-word-card-integration`이다. 원래 하루단어 폴더의 진행 작업을 덮어쓰지 않는다. 하루단어 기준 커밋에는 아직 main에 병합되지 않은 기존 작업이 있으므로 통합 변경만 별도로 검토하고 기존 PR을 임의로 병합하지 않는다.

## 접근 제어

1. Sites가 인증한 `userId`를 사용하고 서버 설정의 허용된 본인 ID와 정확히 비교한다. 이메일·첫 방문자·브라우저가 보내는 사용자 헤더를 운영자 증거로 사용하지 않는다.
2. 요청마다 Sites와 EN_Card 양쪽에서 허용 계정을 검사한다. 서버 전용 비밀키는 브라우저·소스·쿠키·URL에 넣지 않는다. 사용자 Cookie/Authorization/임의 헤더를 카드 서버로 전달하지 않는다.
3. 쓰기는 같은 출처와 JSON/PNG 형식을 확인한다. 요청 본문은 스트림을 읽으면서 1MiB를 넘으면 중단한다. 경로·메서드 허용 목록과 리디렉션 거부로 임의 프록시를 차단한다.
4. 불확실한 쓰기는 자동 재시도하지 않는다. 기존 revision 충돌·결과 불명·발송 예산 보호를 유지한다.
5. 카카오 재연결은 60초·일회용 티켓으로 기존 Worker에서 OAuth를 시작한다. 티켓만으로 세션을 발급하지 않으며, 기존 state/브라우저 바인딩과 카카오 운영자 ID 검증 후 고정된 하루단어 `/cards`로 돌아온다.
6. 원본 PNG는 카카오 표시를 위해 기존처럼 정확한 공개 URL을 아는 사람이 볼 수 있다. 카드 목록·예약·토큰은 공개하지 않는다.

## 서버 설정·반영 순서

비밀값을 채팅·Git·명령 인수에 기록하지 않는다. 기존 SETUP_TOKEN·카카오 토큰·암호화 키는 변경하지 않는다.

| 하루단어 Sites 설정         | EN_Card Worker Secret  | 의미                                                    |
| --------------------------- | ---------------------- | ------------------------------------------------------- |
| `card_studio_enabled`       | 해당 없음              | 명시적으로 `true`일 때만 기능 사용. 기본 비활성         |
| `card_studio_owner_id`      | `STUDIO_OWNER_ID`      | 운영자 본인이 해당 Site에 로그인했을 때의 Site별 userId |
| `card_studio_bridge_secret` | `STUDIO_BRIDGE_SECRET` | 동일한 새 서버 전용 난수, 최소 32자                     |
| `card_studio_origin`        | 기존 `APP_ORIGIN`      | 기존 영어 카드 Worker의 HTTPS 출처                      |
| 기존 하루단어 URL           | `STUDIO_ORIGIN`        | 재연결 후 돌아갈 고정 HTTPS 출처                        |

운영 반영 체크리스트:

- [x] 사용자에게 두 운영 앱의 인증 연결 설정·게시 범위를 확인했다. 실제 메시지 발송은 별도 허용 범위다.
- [x] 기존 Site ID·D1 바인딩·공개 정책 revision 4·기존 환경 7개를 보존하고 Workers Free·공유 사용량을 확인했다.
- [x] D1 백업을 Windows DPAPI로 암호화하고 복호화 해시를 검증했다. 활성 예약 0·진행 중/미해결 unknown 0, 새 스키마 이전 없음.
- [x] 비활성 상태로 게시한 후 본인 브라우저의 `/cards` → **계정 연결 정보**에서 Site별 ID를 확인했다. Chrome이 JSON API 직접 탐색을 차단하여 정상 로그인 화면에 본인 식별자 표시를 추가했다. 전체 사용자 목록·학습 답안·토큰은 읽지 않았다.
- [x] 양쪽에 일치하는 운영자 ID와 새 서버 키를 설정했다. 기존 세션·암호화·카카오 키는 변경하지 않았다.
- [x] 메인 Worker와 동일 Site를 배포해 통합 기능을 활성화했다. delivery Worker·Cron·DB/KV는 유지했다.
- [x] 본인 ChatGPT 로그인 → 홈 버튼 → 카드 목록/미리보기/예약 화면과 PNG 다운로드를 확인했다. 비로그인401·위조 플랫폼 헤더401·다른 bridge ID403을 확인했고 DB 15개 테이블 해시가 유지됐다. 다른 사람의 실제 계정을 사용한 시험은 하지 않았다.
- [x] 조회 CPU 2~5ms, 무작업 Cron 1~3ms·예외 0을 관측했다. 실제 발송 CPU 재검증은 아니다.
- [ ] 실제 iPhone Safari의 로그인 복귀·다운로드·키보드·날짜 입력을 확인한다.

## 빌드와 로컬 검증 재현

EN_Card 체크아웃에서 통합 화면을 내보낸다. 출력에는 원본 코드·산출물 해시가 기록되며 기존 산출물의 수동 변경을 덮어쓰지 않는다.

```powershell
npm run build
npm run check:free
node scripts/export-haru.mjs --target 'C:\Users\user\Documents\ChatGPT\haru-word-card-integration'
```

하루단어 체크아웃에서는 기존 실행 프로필을 설정하고 `work` 폴더를 준비한 후 `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`를 실행한다. 로컬 전용 `.env`의 `card_studio_owner_id=local_seedy`, 가짜 서버 키, localhost 카드 서버는 검증용이며 운영 설정으로 복사하지 않는다. 배포용 빌드에서는 로컬 `.env`를 제외한다.

두 로컬 서버를 실행하고 EN_Card에서 다음을 실행한다. 모든 생성·예약은 별도 로컬 D1/KV와 dry_run이다.

```powershell
# EN_Card: 127.0.0.1:8787
npm run dev
# 하루단어: 127.0.0.1:5175
npm run dev -- --hostname 127.0.0.1 --port 5175
# EN_Card의 통합 검사
npx playwright test --config playwright.haru.config.ts
```

검증 결과:

- EN_Card 기존 인증 + 신규 통합 인증 37개, 조회·접근 회귀 29개 통과.
- 하루단어 전체 714개 통과(신규 프록시 10개 포함). 타입 검사 통과, lint 오류 0·기존 경고 13.
- Chromium·WebKit 통합 흐름 각 1개 통과: 기존 로그인, 두 템플릿 PNG 시그니처·1080×1080, 저장·검토·예약, 모바일 메뉴·가로 넘침, 학습 기록 불변.
- 기존 독립 앱 로그인 표시·PNG/예약·100개 이상 조회의 Chromium 3개 통과.
- 양쪽 Worker 빌드·EN_Card 무료 구성 검사를 수행했다. 아래 운영 검증을 별도로 완료했으며 실제 iPhone·새 카카오 재연결/발송은 미검증이다.
- 초기 Sites 전체 검사 1개는 새 체크아웃의 `work` 폴더 누락으로 실패한 뒤 폴더 준비·재실행으로 전체 통과했다. 프록시의 `redirect: error`는 Workers 런타임에서 지원하지 않아 `manual`+3xx 거부로 수정·회귀 검증했다. 독립 앱 검사를 통합 검사의 DB와 함께 실행했을 때 예약 선택자가 중복되어 실패했으며 별도 E2E DB에서 재실행해 통과했다.

## 복구

Sites 환경 변경은 저장된 버전을 재배포해야 적용된다. 비활성화만 저장하고 재배포를 생략하면 운영 기능은 그대로 남는다.

`card_studio_enabled`를 비활성화하면 하루단어의 진입 버튼과 프록시가 닫힌다. 기존 EN_Card 주소·카카오 연결·Cron 발송은 계속 유지한다. 필요하면 직전 Site 버전과 메인 Worker로 복귀한다. DB 스키마·학습 기록·이미지를 이동하거나 삭제하지 않는다. 키를 폐기할 때는 서버 전용 통합 키만 대상으로 하며 기존 암호화·세션·카카오 키는 건드리지 않는다.

## 운영 반영 기록

- 하루단어 **v101**, 제품 소스 `abd915346cbe3dce8d982c2d0a8b0da8ec6b197a`, 환경 revision **48**, 배포 `appgdep_6abf589d577081918af7fee44d8f3435`가 **2026-10-02 16:09:33 KST succeeded**다. v100은 초기 잠금 배포였으며 v101에서 본인 계정 정보 표시를 보완했다.
- EN_Card 제품 소스 `cd8d2232e6164e1023e6925ec4fdb9f4359fd703`, 최종 메인 버전 `a51bde4f-24d9-4fab-ba82-a2393d0cb334` 100%. Secret 설정이 버전을 생성하므로 코드 업로드 직후의 `071849d5`와 구분한다. 비공개 발송 Worker는 `6af1daf0-a247-4481-a52c-94b861361624`로 유지했다.
- 기존 카드14·준비 이미지5/402,286바이트·발송 예산8/20·업로드3/100을 보존했다. 인증 version11/connected는 배포 전에 확인한 값이며 이번에 카카오 재연결을 하지 않았다.
- 실제 Chrome에서 기존 ChatGPT 계정 선택·로그인 후 영어 카드 버튼과 통합 화면을 확인했다. 다운로드한 `english-card.png`는 78,331바이트·PNG·1080×1080이다. 다운로드 이벤트 수집기는 시간 초과됐으나 실제 다운로드 파일의 시그니처·크기를 별도로 검증했다.
- Workers 현재 플랜 Free·US$0, 오늘 요청926/100,000, D1 읽기20.11k/5M·쓰기182/100k·저장299.01kB/5GB를 Dashboard에서 확인했다. KV UTC 10/02 집계는 읽기9·목록1·저장403,116바이트/5키였다. 집계 시각과 지연이 있으므로 앱의 PNG 바이트 합계와 구분한다. 공식 [Workers](https://developers.cloudflare.com/workers/platform/pricing/), [D1](https://developers.cloudflare.com/d1/platform/pricing/), [KV](https://developers.cloudflare.com/kv/platform/pricing/) 요금 문서를 재확인했다. 새 리소스·유료 플랜·AI 호출은 추가하지 않았다.
- 로컬 npm 경로 오류는 기존 설치의 npm CLI를 명시하여 해결했다. 만료된 Cloudflare CLI 인증은 기존 권한으로 갱신했다. 비밀키 입력 도우미의 Windows 줄바꿈 대기를 수정했으며 비밀값은 출력하지 않았다. 배포용 빌드에서 로컬 `.env`를 제외하고 완료 후 복원했다.
- 안전한 증거는 Git 제외 `backups/haru-deploy-20261002/`에 있다. CPU 수집기는 종료했다. 새 운영 카드/예약 저장·실제 메시지 발송·카카오 재연결·실제 iPhone 검사는 하지 않았다. 로컬 dry_run 제작·예약 검증과 운영 읽기 검증을 구분한다.
- Sites 소스는 게시 절차로 동기화했다. GitHub PR 병합은 이번 배포에 포함하지 않았고 기존 정확성 개선 PR도 변경하지 않았다.

## 후속 검토·운영 v104 — 2026-10-02

- 계정이 다른 경우 기존 Sites 로그아웃·고정 `/cards` 복귀 링크를 제공하고, 통합 홈 버튼의 접근성 이름을 `하루단어 홈`으로 수정했다. 독립 앱의 표시 이름·인증 계약은 유지한다.
- 운영 v103의 정확성 작업 `af2ca8e`를 보존한 소스 `c2457b746a3a8a8fafdbf317735bbe14a6816de4`로 **v104**, 환경49/정책4, 배포 `appgdep_6abf653ed81481919afaccb27116f9b6`가 **17:03:29 KST succeeded**다. 이 작업은 운영 환경 값을 변경하지 않았다. 후속 UI 수정의 롤백은 v103이다.
- GitHub main의 카드 기능만 분리한 [하루단어 PR #13](https://github.com/zzocojoa/haru-word/pull/13)은 exact HEAD `1a39f24`의 Node22/24 push·PR 검사 4개 통과 후 **17:14:05 KST**, `06fbd8382410a6b1e3d0579e5a189f4e431b1a05`로 병합됐다. 정확성 초안 PR #12는 OPEN/draft로 유지했다. GitHub main과 Sites 운영 전체 소스가 다르므로 다음 게시 전 Sites 최신 소스를 열어 보존한다.
- EN_Card 전체 **19개 파일/342개 테스트**, 타입·Vite·양쪽 Worker dry-run·기본/live 무료 구성 검사 통과. 하루단어 GitHub main 기준 **500개**, 운영 소스 기준 **722개**, 이후 최신 평가/카드 **19개**와 타입·lint·빌드 통과. lint는 오류0/기존 경고13이다.
- 전문 보안/API/성능/유지보수/디자인/테스트, Red Team, 독립 적대적 검토를 수행했다. 계정 전환·접근성 이름·저장 실패 회귀 검사 보완을 완료했다. 보조 Codex CLI 검토는 설치 CLI와 현재 모델 호환 오류로 실행되지 않았으므로 통과로 집계하지 않는다.
- `tests/haru/draft-navigation.spec.ts`는 로컬 합성 계정에서 학습·문법 저장 지연/503, 이동 잠금, 초안 백업, 재시도, 카드 왕복·새로고침 후 보존을 검증한다. Chromium/WebKit **2/2·39.4초**, 타입·Prettier 통과. 기존 카드/이미지/예약/발송 불변·합성 학습 상태 복원·AI 요청0을 확인했다.
- WebKit의 카드→홈→새로고침 후 첫 마우스 재개 클릭에서 시계 GET만 발생했다. 기존 focus/pageshow 시계 준비 잠금이 원인으로 추정되지만 이벤트 인과관계는 미확정이다. 관련 학습 코드는 통합에서 변경되지 않았다. 재열기 보조 단계만 포커스 후 Enter로 분리했고 핵심 카드 이동 검사는 실제 클릭이다. 실제 iPhone 영향은 아직 미검증이며 자동 검사 성공으로 대체하지 않는다.
- 원본·129개 생성 산출물 해시 일치, v104 운영 익명/위조401·다른 bridge 사용자403 재확인. 메인 Worker `a51bde4f`와 발송 Worker `6af1daf0`는 이번 후속 UI 수정에서 재배포하지 않았다. 신규 의존성·DB 이전·유료 자원·운영 학습 QA 쓰기 없음.

초안 회귀만 재현하려면 로컬 하루단어의 grammar 기능을 활성화한 뒤 두 로컬 서버를 실행하고 다음 명령을 사용한다. 이 검사는 고정 로컬 계정 `local_seedy`와 dry_run을 확인한 후 시작한다.

```powershell
node node_modules/@playwright/test/cli.js test --config playwright.haru.config.ts tests/haru/draft-navigation.spec.ts --reporter line
```

## 승인된 본인 1장 예약 발송 — 2026-10-02 17:16 KST

- 사용자가 기존 준비 카드 `That makes sense` 1장의 본인 시험 발송을 명시적으로 승인했다. 하루단어 정상 예약 화면에서 1회·1장, 17:16 KST/08:16 UTC(`1790928960000`)로 저장했다. 서버 직접 쓰기나 추가 발송은 수행하지 않았다.
- 예약 `bf5dcce4-8ee7-48a7-8798-89bc2f0fe671`의 발송 `df24eb94-b7dc-479c-bb24-60ac10ac5701-0`은 **live/sent, attempts=1**이다. **17:17:00.898 KST**에 카카오 API 접수를 기록했다. 이는 실제 휴대폰 수신·이미지 표시·열람 확인과 다르다.
- 예약은 completed/비활성, 목록 커서1·다음 회차 없음이다. 이후 전체 활성 예약0, claimed/sending/미해결 unknown0, 오늘 실제 시도9/20(직전8/20)이다. 카드14·이미지5/402286바이트·업로드3/100·인증connected/version11 유지. 재연결·새 이미지 생성·추가 메시지 없음.
- 해당 회차 Cron은 CPU5ms/wall3783ms, 발송 준비3ms/wall712ms, 실제 발송4ms/wall2487ms다. 모두 ok·예외0·기대 Worker 버전 일치. 네트워크 대기 포함 wall과 CPU를 구별하며 한 번의 측정으로 모든 부하를 보장하지 않는다.
- 사용자에게 카카오 1장 수신·이미지·원본 보기 결과를 요청했다. 실제 iPhone 로그인·PNG 파일 앱 저장 확인도 응답 대기다. 현재 상태는 **실제 API 접수 완료 / 기기 수신 확인 대기**다.
- 안전한 상태·CPU 증거와 예약 화면은 Git 제외 `backups/haru-deploy-20261002/test-send-latest.json`, `final-send-cpu-*.jsonl`, `test-send-scheduled.jpg`에 있다.
