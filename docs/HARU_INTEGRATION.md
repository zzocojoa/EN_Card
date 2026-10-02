# 하루단어 영어 카드 통합

2026-10-02 / 상태: 로컬 구현·검증, 운영 반영 전

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

- [ ] 사용자에게 두 운영 앱의 인증 연결 설정·게시 범위를 확인한다. 실제 메시지 발송은 별도 허용 범위다.
- [ ] 기존 Site ID·D1 바인딩·공개 접근 정책·환경 값을 보존하고 현재 버전/계정 Free·공유 한도를 확인한다.
- [ ] 기존 D1 백업, 진행 중/결과 불명 발송, 활성 예약을 확인한다. 새 스키마 이전은 없다.
- [ ] feature 비활성으로 동일 Site에 통합 소스를 게시하고 정상 사용자 브라우저의 `/api/card-studio/account`에서 본인의 Site별 ID를 확인한다. 전체 사용자 목록·학습 답안·토큰은 읽지 않는다.
- [ ] 양쪽에 일치하는 운영자 ID와 서버 키를 설정한다. 비밀키가 없는 첫 방문자를 자동 운영자로 등록하지 않는다.
- [ ] 기존 메인 Worker만 배포하고 Site의 통합 기능을 활성화한다. delivery Worker·Cron·DB/KV를 교체하지 않는다.
- [ ] 본인 로그인·다른 계정 거부·목록/PNG 확인, 원격 CPU 10ms·데이터 보존을 검증한다. 실제 발송 성공으로 보고하지 않는다.
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
- 양쪽 Worker 빌드·EN_Card 무료 구성 검사를 수행했다. 새로운 실서비스 인증 연결·CPU·실제 iPhone·운영 배포는 미검증이다.
- 초기 Sites 전체 검사 1개는 새 체크아웃의 `work` 폴더 누락으로 실패한 뒤 폴더 준비·재실행으로 전체 통과했다. 프록시의 `redirect: error`는 Workers 런타임에서 지원하지 않아 `manual`+3xx 거부로 수정·회귀 검증했다. 독립 앱 검사를 통합 검사의 DB와 함께 실행했을 때 예약 선택자가 중복되어 실패했으며 별도 E2E DB에서 재실행해 통과했다.

## 복구

`card_studio_enabled`를 비활성화하면 하루단어의 진입 버튼과 프록시가 닫힌다. 기존 EN_Card 주소·카카오 연결·Cron 발송은 계속 유지한다. 필요하면 직전 Site 버전과 메인 Worker로 복귀한다. DB 스키마·학습 기록·이미지를 이동하거나 삭제하지 않는다. 키를 폐기할 때는 서버 전용 통합 키만 대상으로 하며 기존 암호화·세션·카카오 키는 건드리지 않는다.
