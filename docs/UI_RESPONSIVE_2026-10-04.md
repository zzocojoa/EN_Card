# 카드 작업실 웹·아이폰 개선

브랜치: `codex/card-studio-responsive-ui` · 기준: `6253776` · 적용 스킬: frontend-design

## 목표와 디자인

기존 차분한 학습 작업실을 유지하면서 자동 제작의 진입·설정·상태 확인을 웹과 아이폰에서 쉽게 만든다. 내보내는 1080 PNG와 예약·인증·발송 규칙은 유지한다.

| 구분 | 적용 기준 |
| --- | --- |
| 색상 | 흰 콘텐츠, 밝은 회색 배경, 먹색 본문, 파란 주요 행동. 상태는 문구를 함께 표시 |
| 글자 | 로컬 Noto Sans KR, 입력 16px 이상, 본문 16px, 보조 정보 12px 이상 |
| 배치 | 데스크톱은 설정 폼과 실행 요약을 나란히, 모바일은 상태→설정→실행 순서. 8px 간격 기준 |
| 공통 요소 | 버튼·상태 배지·분리선·초안 표시를 통일. 키보드 포커스와 최소 44px 터치 영역 확보 |
| 아이폰 | 하단 안전 영역, 날짜·시간 입력 너비, 375/390/430px 세로·가로 화면과 짧은 높이 점검 |

## 구현 범위

- 자동 제작을 `#/automation` 독립 화면과 주 메뉴로 제공한다. 카드 편집에서는 바로가기 안내를 제공한다.
- 홈에서 자동 제작의 실행 상태·다음 제작/발송 시각을 읽고 관리 화면으로 이동한다. 조회 실패를 비활성으로 표시하지 않는다.
- 자동 제작은 현재 실행과 저장하지 않은 설정을 구분한다. 기본 설정·일정·주요 실행 동작·추가 시험·최근 기록의 순서를 정리한다.
- 아이폰의 하단 메뉴에서 자동 제작에 직접 접근하고 더보기에서 편집·발송 기록·설정으로 이동한다.
- 공통 화면 여백·메뉴·모바일 입력·대화상자·미리보기의 적응형 레이아웃을 다듬는다.

## 완료 확인표

- [x] 새 브랜치 생성 및 기존 구현·검증 구조 확인
- [x] 변경 전후 데스크톱·아이폰 폭 화면 직접 검토
- [x] 자동 제작 설정·시작·중단·추가 시험·늦은 조회·초안 보존 회귀
- [x] 기존 제작·PNG·보관함·예약·기록·연결 흐름 회귀
- [x] Chromium/WebKit 및 iPhone 장치 에뮬레이션 검증
- [x] 타입·빌드·무료 구성·diff 검사
- [x] 운영 반영 여부와 실제 아이폰 기기 미검증 범위 기록

테스트는 로컬·모의 제공자를 사용하며 AI/카카오 실제 호출을 만들지 않는다. 실기기 Safari의 키보드·공유 메뉴는 자동화 에뮬레이션과 구분한다.

## 결과와 재현

- 최종 전체 브라우저 회귀 **60/60**: Chromium 40, WebKit 18, iPhone 13 에뮬레이션 2. 375/390/430/768/1440px 전 화면, 844×390 회전, 최소 44px 터치, 입력 16px, 본문 대비, 키보드 포커스, 초안·날짜·시각 보존을 확인했다. 실제 로컬 Canvas PNG를 생성하며 서버·AI·카카오 응답은 로컬 저장소/모의 연동이다.
- 새 홈 검사는 자동/기존 예약 중 더 가까운 시간, 실행 중인데 다음 시각이 없는 경우, 상태 조회 실패·복구를 구분한다. 저장 전 입력은 실행 중인 요약을 바꾸지 않는다. 자동 제작 기존 경합·중단·추가 시험 검사를 새 경로에서 유지했다.
- `npm run typecheck`, `npm run build`(웹과 세 Worker dry-run), 기본·실제 live 설정 `check:free`, Prettier, `git diff --check` 통과. 서버 소스·마이그레이션·의존성 변경은 없다.
- Site 프록시/릴레이 **15/15**, 타입·프레임워크 빌드 통과. lint 오류 0, 기존 테스트 경고 13이다. 생성 relay 파일은 기존과 동일하고 UI 자산 129개를 정식 exporter로 갱신했다.
- 초기 새 테스트 6개는 Node/브라우저의 한국어 오전·오후 문자열 차이로 실패했다. 브라우저의 실제 국제화 환경으로 기대값을 계산한 뒤 6개와 최종 전체 60개가 통과했다. Windows 명령 실행 문제는 npm CLI의 절대 경로로 해결했다.

```powershell
npm run typecheck
npm run build
npm run check:free
npx playwright test --reporter=line
node scripts/check-free.mjs --config wrangler.live.jsonc --mode live --delivery-config wrangler.delivery.deploy.jsonc --automation-config wrangler.automation.live.jsonc --automation-active
node scripts/export-haru.mjs --target C:/Users/user/Documents/ChatGPT/하루단어
```

## 게시와 보존

2026-10-04 17:17 KST **Site v114**(소스 `c65b66dca23f9e15b661d1b4a2dfdfd0b5a48f17`) 게시 succeeded. 주 Worker `6b289f9c-84cb-4905-9684-7b9897064109` 100% 적용. 비공개 DO·발송 Worker는 기존 버전이다. [기계 판독 검증 기록](evidence/UI_RESPONSIVE_2026-10-04.json)에 버전·HTTP·행 수·해시·롤백 대상을 남겼다.

운영 D1 주요 14개 테이블의 행 수·전체 해시, 바인딩·Secret 이름·Cron·Site 환경 revision59·공개 정책 revision4를 보존했다. 작업 중 최신 조회에서는 자동화 **version10·enabled0·기간 종료**였다. 과거 문서의 10월5일 활성 일정을 복원하지 않았다. 배포 전후 이 최신 상태가 같고 진행 중 제작·발송 및 FK 오류는 0이다. 새 AI/카카오 시험·DB 마이그레이션·계정/결제 변경은 없다.

독립 Worker HTML/JS/CSS와 Site JS/CSS의 운영 바이트가 로컬 산출물과 일치했다. Site `index.html`의 정규 URL 이동(307)은 로그인한 실제 브라우저에서 새 메뉴·설정·기록·정확한 번들 경로로 확인했다. 비인증 자동화 API는 401이다. UI 롤백은 Site v113과 직전 주 Worker `a1771709-28e3-4124-9735-cf517c15a248`이며 DB 롤백은 필요 없다.

## 검증 한계

- Windows WebKit에서 가변 폰트의 굵기가 얇게 표시됐다. 동일 폰트·정상 weight·명시적 `wght` 축만 둔 최소 HTML에서도 재현했고 Chromium에서는 정상이다. [Playwright의 유사 Windows WebKit 보고](https://github.com/microsoft/playwright/issues/7441)는 참고 근거이며 이번 실기기 iPhone 정상 여부를 증명하지 않는다. 글꼴을 무작정 바꾸지 않았으며 **실제 iPhone 글꼴·키보드·홈 표시 영역·공유 메뉴는 미검증**이다.
- 무료 구성 검사는 통과했지만 계정 구독 API 403으로 실제 Free 자격을 이번에 재확인하지 못했다. 기존 확인된 자원과 설정을 유지하며 새로운 유료 의존성은 없다. 이번 UI 변경으로 실제 AI·발송 CPU나 새 수신을 검증했다고 주장하지 않는다.
- 변경 전후 스크린샷과 글꼴 최소 재현은 Git 제외 `backups/ui-responsive-20261004/`에 보존했다. 원본 저장소의 GitHub push/PR/병합은 이번 UI 목표에 포함하지 않았다.
