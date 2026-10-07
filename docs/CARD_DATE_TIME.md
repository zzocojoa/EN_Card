# AI 카드 날짜·요일 표시 — 2026-10-07 로컬 후보

EN_Card `master@aea0d4c`와 하루단어 `main@34cdf03`의 병합 완료 상태에서 각각 `codex/card-date-time` 브랜치를 만들었다. 구현·로컬 검증 단계이며 운영 배포·실제 발송·새 CPU 실측은 하지 않았다.

## 표시 계약

- 새로 생성하는 AI 카드(정규 자동 제작과 추가 시험)의 상단에 `2026년 10월 07일`, `수요일`, `07:30`을 표시한다. 시각은 24시간제 한국 시간이다.
- `최초 발송 예정 · 한국 시간`을 함께 적는다. 저장된 `automation_runs.due_at` 기준이며 제작 시각·재시도 시각·휴대전화 수신 시각이 아니다. 실제 도착이 지연돼도 PNG를 다시 생성하지 않는다.
- 같은 회차의 5장은 같은 예약 시각과 각자의 카드 번호를 사용한다. 날짜는 AI 작성·검토 내용에 삽입하지 않고 렌더링 인자로만 전달해 기존 검토 해시를 보존한다.
- 요일 이름과 색상을 함께 표시한다. 요일 배지와 상단 표시선만 요일색을 쓰고 영어 본문·파란 뜻·회색 설명은 유지한다.

| 요일 | 색상 | 글자색 / 배경색 |
| --- | --- | --- |
| 월요일 | 보라 | `#6941C6` / `#F4F3FF` |
| 화요일 | 파랑 | `#175CD3` / `#EFF8FF` |
| 수요일 | 초록 | `#067647` / `#ECFDF3` |
| 목요일 | 주황 | `#93370D` / `#FFFAEB` |
| 금요일 | 분홍 | `#C11574` / `#FDF2FA` |
| 토요일 | 청록 | `#0E7090` / `#ECFDFF` |
| 일요일 | 빨강 | `#B42318` / `#FEF3F2` |

## 범위·호환성

우선 현재 사용 중인 AI 자동 제작 카드에 적용한다. 수동 제작 화면은 날짜를 임의로 넣지 않는다. 기존 PNG·원본 URL은 변경하지 않으며, 저장된 AI 이미지를 다른 시각에 수동 재예약해도 이미지의 최초 예약 날짜는 유지된다. 이를 카드의 `최초` 문구와 자동화 설정 화면에서 안내한다. 수동 반복 예약까지 회차별 날짜를 바꾸는 이미지는 이 후보의 범위가 아니다.

DB 마이그레이션, API 형식·AI 프롬프트·발송 예산·예약 시각 변경은 없다. 공유 KST/요일 정책과 상단 레이아웃을 Canvas·DO SVG에서 사용한다. 배포 시 추가 폰트나 외부 상품은 필요 없다. 무료 구성 검사와 계정 플랜·원격 CPU 실측은 서로 다르다.

## 최초 구현 검증

- 관련 Vitest 4파일 86개 통과. 날짜 경계/색상/PNG 검사 13개를 포함한다. 정규 예약·추가 시험의 `due_at` 전달과 5장 번호/동일 시각을 검사했다.
- 표현형·비교형 × 7요일 = 14개 실제 1080 PNG를 로컬 생성했다. 1MiB 이하, 글자 경계, 배지 색상, 날짜 영역 아래 본문 픽셀의 기존 이미지와 일치 여부를 검사했다. 두 예제 PNG를 직접 확인했다.
- 자정·연말·윤일의 UTC→KST 변환, 잘못된 시각 거절, 7개 색상과 배경 사이 명도 대비 4.5 이상을 검사했다.
- 실제 SQLite DO/패키징 폰트/PNG/KV 저장은 로컬 Miniflare에서 검증했다. AI·카카오 호출은 모의이며 실제 전송하지 않았다.
- Chromium·WebKit의 자동화 UI 2개, 하루단어 카드 연동 19개, 양쪽 타입·빌드, EN_Card 3개 Worker dry-run 및 기본 무료 구성 검사가 통과했다.
- 하루단어 화면·릴레이는 정식 exporter를 사용한다. 릴레이 실행 파일 바이트는 변경하지 않았다.

검증 예:

```powershell
$env:CARD_DATE_PREVIEW_DIR='backups/card-date-time-preview'
npm test -- tests/card-stamp.test.ts tests/automation-product.test.ts tests/automation-quantity.test.ts tests/automation-product-do.test.mjs
npm run test:e2e -- tests/e2e/redesign.spec.ts --grep 'AI 자동 제작'
npm run build
npm run check:free
node scripts/export-haru.mjs --target 'C:/Users/user/Documents/ChatGPT/하루단어'
```

## 2026-10-07 리팩토링

- `src/shared/card-layout.ts`로 헤더·본문 배치와 줄바꿈 계산을 분리했다. 브라우저 Canvas와 자동화 SVG, 기존 실험 렌더러가 이 순수 함수를 공유하며 자동화의 `src/web/` 의존을 제거했다.
- `src/shared/card-stamp.ts`의 `CardDeliveryStamp`를 사용해 렌더링마다 날짜 정보를 한 번 계산한다. Canvas는 글꼴 준비·측정·그리기를, SVG는 글리프 변환·마크업 조립을 담당한다. 공개 렌더 함수 인자, 최초 예약 시각 기준, 요일색과 배치 수치는 유지했다.
- 소스 해시를 기록하는 실험 도구도 새 레이아웃 경로를 사용한다. reference 명세는 새 실행에 버전 2를 기록하고 기존 무버전/버전 1 기록도 별도로 검증한다. 과거 실측 JSON·이미지·CPU 값은 수정하거나 재측정하지 않았다.
- 변경 전후 표현형·비교형 × 7요일 및 날짜 없는 두 예제, 총 16개 PNG의 바이트와 SHA256이 모두 같다. 이는 로컬 SVG/Resvg 경로 비교이며 실제 카카오 표시나 원격 CPU 검증이 아니다.
- 리팩토링 후 관련 Vitest 3파일 62개와 소스 근거 검증 2파일 20개, Chromium/WebKit 6개, 하루단어 연동 19개가 통과했다. 브라우저에서는 PNG 저장·복원 바이트, 긴 문장·비교형과 자동화 화면을 확인했다. 양쪽 타입·빌드, EN_Card 3개 Worker dry-run·무료 구성, 생성 파일 131개·런타임 해시 8개와 기존 출시 상태 보존을 확인했다.
- 로그와 PNG 비교 근거는 Git 제외 `backups/card-date-refactor-20261007/`에 보존한다. 아래 review는 리팩토링 전 기록이며 이번에 gstack review를 다시 실행한 것은 아니다. 운영 배포·실제 AI/발송·계정 플랜 재확인·새 CPU 실측은 없다.

리팩토링 검증 명령:

```powershell
npm test -- tests/card-stamp.test.ts tests/core.test.ts tests/automation-product-do.test.mjs
npm test -- tests/automation-reference-evidence.test.mjs tests/automation-durable-evidence.test.mjs
npm run test:e2e -- tests/e2e/redesign.spec.ts tests/e2e/workflow.spec.ts --grep 'AI 자동 제작|실제 PNG 생성과|편집한 두 번째 카드|비교형·긴 문장'
npm run build
npm run check:free
node scripts/export-haru.mjs --target 'C:/Users/user/Documents/ChatGPT/하루단어'
```

하루단어에서 `node --experimental-strip-types --test tests/card-automation.test.mjs tests/card-studio.test.mjs`, `npm run typecheck`, `npm run build`로 내보낸 파일을 확인한다.

## 운영 반영 시 확인

1. 사용자 배포 승인과 현 설정·활성 버전·진행 중 제작을 확인한다. PNG 형식이 달라지므로 렌더/업로드 중인 실행이 없는 시점에 반영한다. 기존 실행을 초기화하지 않는다.
2. 검증한 자동화 DO와 내보낸 하루단어 화면을 같은 변경 묶음으로 반영한다. 기존 Site 식별자·Secret·Free 구성·매일 예약은 보존한다. DB 마이그레이션은 없다.
3. 새로 제작된 PNG의 날짜·요일색·원본 링크를 실제 기기에서 확인하고 새 DO 경로 CPU를 측정한다. 기존 버전의 CPU 관측값을 새 기능의 실측으로 대체하지 않는다.
4. 복구가 필요하면 이 변경 이전의 0021 호환 DO/화면을 사용한다. 이미 생성한 불변 PNG나 기존 이력은 덮어쓰지 않는다.

위 절차 작성 당시 후보는 미배포·미커밋이었다. 최신 반영 상태는 아래 실제 검증 기록을 따른다.

## 2026-10-07 실제 한 장 검증

**최신 사이트 상태:** 사용자 명시적 승인 후10:14 KST에 Site v122를 게시했다. 공개 manifest/5개 파일 해시와 비로그인 접근 보호를 확인했고 환경59·공개정책4·정규version37 설정·19개 테이블·활성Worker/Cron을 보존했다. 아래 미게시 설명은 승인 전 상태다. 이후 GitHub PR12/33은 열린 상태이며 병합하지 않았다.

자동화 DO `7f17ec46-e0eb-40a8-988b-4aee9e111ce3`를 배포하고 기존 기록·DB0021·무료 구성을 보존했다. 09:14 한 장 시험은 독립 검토·날짜 PNG·live 접수와 사용자 휴대전화 날짜/요일색/이미지/원본 링크 확인을 통과했다. 원본은 로컬의 동일 내용·예정 시각 렌더와 바이트까지 일치한다.

DO 이미지 생성590.185ms, 일반 Worker 집계상 관측 최고 주5.967ms·발송4.697ms, 오류0이다. 작성/검토/렌더/발송은 개별 로그와 집계에 대응한다. 원본 조회1건의 집계 공백은 tail2ms로 보완 관측했으며 전체 고정밀 집계나 새5장 부하의 검증으로 확대하지 않는다. 상세 수집 범위와 근거는 [검증 기록](VERIFICATION.md)을 따른다.

정규 예약은 version37·매일07:30/5장·다음10월8일07:30으로 재개했다. Site v122는 저장됐지만 공개 게시의 자동 승인 거절로 운영은 v121이다. 새 이미지 기능은 DO에 반영됐고 화면의 요일색 안내는 아직 게시되지 않았다. 현재 플랜 API403으로 계정 재확인은 못 했으며 기존 사용자 Free 확인과 live 구성 검사 근거를 유지한다. 커밋·푸시·새 PR은 실제 검증 후 진행하며 병합은 별도 요청 범위다.

## 2026-10-07 review

- 기준: EN_Card `origin/master@aea0d4c`, 하루단어 `github/main@34cdf03`. 같은 `codex/card-date-time`의 작업 트리와 미추적 파일을 포함했다. 별도 연결된 구현 플랜은 없어 사용자 요구와 이 문서의 표시 계약으로 범위를 대조했다.
- 결과: 주 검토와 별도 문맥의 적대적 검토에서 수정이 필요한 코드 지적 0개. 추가 제품 코드/테스트 수정은 없다. 적대적 검토는 테스트/fixture를 요약으로만 읽었고, 부모 검토는 테스트 소스와 실행 결과를 확인했다. 다른 모델의 검토로 설명하지 않는다. 외부 Claude Code CLI는 미설치로 미실시다.
- 이번 실행: 날짜/PNG 13개, 정규·추가 시험·5장 시각/번호 3개, 하루단어 연동 19개, Chromium/WebKit/아이폰 크기 에뮬레이션 5개 통과. 이미 통과한 전체 86개 결과와 중복 합산하지 않는다. 생성 파일 131개·런타임 해시 7개·기존 출시 상태 보존도 확인했다.
- 화면: 로컬 격리 저장소의 모바일 화면에서 7요일·설명·가로 넘침 없음·페이지 오류 0을 확인했다. 실제 아이폰 검사는 아니다. Git 제외 `backups/card-date-review-20261007/screenshots/automation-local.png`와 세로/가로 에뮬레이션 캡처를 보존한다.
- 도구 한계: 직접 Playwright 실행에서 npm PATH 누락으로 Wrangler를 찾지 못해 기존 npm 명령으로 재실행했다. 스킬 브라우저 데몬과 앱 브라우저 초기화도 실패해 설치된 Playwright로 실제 로컬 브라우저를 구동했다. 이 도구 실패는 성공으로 바꾸지 않는다.
- 출시 전 남은 검증: 새 날짜 PNG의 원격 CPU와 실제 카카오 썸네일·원본 링크, 현재 무료 계정 상태. 기존 PNG는 그대로이고 수동 재예약 시 최초 날짜가 유지된다. 날짜 표시를 수동 반복 예약 회차마다 바꾸는 기능은 이번 후보에 없다.

재현 명령:

```powershell
npm test -- tests/card-stamp.test.ts
npm test -- tests/automation-product.test.ts tests/automation-quantity.test.ts -t 'stamps the fixed|extra trial preserves|all five images'
npm run test:e2e -- tests/e2e/redesign.spec.ts tests/e2e/responsive.spec.ts --grep 'AI 자동 제작|아이폰 입력'
```
