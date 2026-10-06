# 검증 근거

**오늘 빠른 새5장 검증 — 2026-10-06:** 사용자가 내일까지 기다리지 않고 빠른 시험·CPU·휴대전화 이미지/원본 링크 확인 후 병합하도록 요청했다. **version30·trial5개,13:47 제작 →14:42 마감 →14:47부터 순차 발송**, 기존후속 `en-card-5`를 **오늘14:57 KST**로 앞당겼다. 운영0020·DO `941191a8`·Site v120을 유지하고 재배포하지 않았다. 기존 두 trial과 매일07:30/5장·종료2027-10-31 설정값을 보존했다. 등록 전 발송11/20·업로드12/100,진행중/미해결0·FK0을 확인했다. 일반 시험의 하루 한 번 제한은 변경하지 않고 승인된 관리자 검증 경로로 새5개만 등록했다.

시험 중 설정version30·enabled1·next_due_at=NULL이다. 종료/동일설정/미해결없음 조건을 확인해 원래10월7일07:30 정규 예약만version31로 재개한다. 부분 실패를 보충하지 않고 사용자 변경을 덮어쓰지 않는다. 재개 보호15개·등록중단 복구14개의 로컬 검사를 통과했고 제작 전5개 초안/AI0을 확인했다. 실제5장·새 버전CPU·휴대전화 확인은 대기다. 자연 추가 수정/제공자 대체/중복은 발생한 경우만 실측으로 남긴다. 두 PR은 검증 조건을 채운 뒤 병합한다. 아래 내일 첫 검증 계획은 이번 빠른 시험으로 대체됐다.

현재 도구는 `backups/automation-quality-trial-20261006/`다. 이전 폴더의 등록/재개 명령을 실행하지 않는다.

```powershell
node backups/automation-quality-trial-20261006/observe.mjs scheduled-trial
node backups/automation-quality-trial-20261006/verify.mjs 2026-10-06 5 scheduled-trial trial
node backups/automation-quality-trial-20261006/metrics.mjs <UTC_START> <UTC_END> scheduled-trial
# 종료 후 읽기 검사. ready=true이고 기존 intent/resumed가 없을 때만 --apply
node backups/automation-quality-trial-20261006/resume.mjs
node backups/automation-quality-trial-20261006/resume.mjs --apply
```

## 품질 추가 수정 배포 — 2026-10-06 13:31 KST

**품질 추가 수정 운영 반영 — 2026-10-06 13:31 KST:** D1 0020과 자동화 DO `941191a8`, 하루단어 Site v120을 배포했다. 첫 수정본이 품질 검토에서 다시 탈락하면 시간/호출 예산 안에서 한 번 더 수정하고 독립 검토한다. 총 수정2회·카드당 AI24회, 중복3회·원래 마감·PNG2분 대기를 유지한다. 새5장 추가 시험의 최소 준비 시간도60분(제작55분)으로 반영했다.

유지보수 차단 후 DB를 Windows DPAPI로 암호화하고 복호화 왕복·제한 ACL·평문 제거를 확인했다.0020 전체6문장과 이력 INSERT를 단일 원자 batch로 적용했으며 기존18개 데이터 테이블 해시·참조/FK 오류0을 확인했다. 주 Worker `b0b40667`·발송 Worker `ea59a0a0`·실제 배포 버전의 바인딩·매분 Cron과 Site 환경59/공개정책4를 보존했다.

공개 manifest와 JS/CSS/폰트 등5파일 SHA256이 배포 소스와 같고, 비로그인 API401·카드 진입307을 확인했다. 제작 전 조회는0개로 성공 판정이 아니다. 배포 직후13:30~13:32의 CPU 첫 조회와 같은 구간 재조회 모두 자료0개여서 무작업 CPU도 미관측으로 남겼다. 실제5장 부하·수신은 미완료다. 정확한 live 구성의 무료 검사와 DO dry-run은 통과했고 추가 유료 자원은 없다. Workers Free는 기존 사용자 확인 근거이며 구독 API403으로 새 계정 확인은 못 했다.

설정은 **version28·활성·매일07:30·5장·종료2027-10-31**, 다음은 **10월7일06:30 제작 →07:25 마감 →07:30 발송**이다. 기존 `en-card-5`를 **10월7일07:50 KST** 읽기 점검으로 갱신했다. 이번 추가 AI/카카오 호출·새 시험·설정 변경·과거 실패 재생성은0이다. 서버5건·CPU와 사용자5장 이미지/원본 링크 확인 후 PR11/PR32를 병합한다. 자연 추가 수정·제공자 대체·중복이 없으면 해당 분기 실측은 미검증으로 남긴다.

새 읽기 검증기는 `backups/automation-quality-rollout-20261006/`다. 최종 revision3의 작성 성공·반대 제공자 검토와 품질 추가 수정/같은 차수 제공자 대체/자연중복을 구분한다. 기존 등록·재개 도구는 실행하지 않는다. 같은 라벨이 있으면 새 라벨을 사용한다.

```powershell
node backups/automation-quality-rollout-20261006/observe.mjs scheduled-daily
node backups/automation-quality-rollout-20261006/verify.mjs 2026-10-07 5 scheduled-daily daily
# verify 결과의 실제 UTC 시작/끝 문자열을 사용한다.
node backups/automation-quality-rollout-20261006/metrics.mjs <UTC_START> <UTC_END> scheduled-daily
```

배포 적용 스크립트 검토에서 남은 지적은 없었다. 후속 읽기 검증기의 반대 제공자 성공 필드는 중복으로 거절된 응답도 집계할 수 있어 제거했다. 최종 검토·PNG·live 접수를 모두 통과한 추가 수정 슬롯만 성공으로 보고한다. 복원 뒤 `/settings`는 마지막 업로드인 유지보수 `dry_run`을 반환해 첫 바인딩 대조가 실패했다.100% 배포된 버전의 `resources.bindings`를 조회하니 원래 `live`·모든 바인딩과 일치했다. 검증기를 실제 배포 버전 기준으로 수정하고 재조회했다. 추가 운영 설정 변경은 없었다. Site 게시 이력은 기존 이력을 포함하는 게시용 merge로 보존했고 소스 트리는 `70a5ffc`와 동일하다. 첫 패키징은 자식 Node PATH 문제로 실패했으며 정식 helper를 번들 Node/Git Bash PATH로 실행해 성공했다. 도구·의존성을 설치/변경하지 않았다.

DPAPI 암호문·마이그레이션 intent/결과·배포/Cron 로그·최종 상태·공개 파일 결과는 위 Git 제외 폴더에 보관했다. 이전 CPU/수신 결과를 이번 버전 성공으로 계산하지 않는다. 아래 로컬 후보·이전 trial의 미배포/복구 명령은 당시 기록이며 현재 실행 지시가 아니다.

## 품질 불합격 추가 수정 — 2026-10-06 로컬 후보

- 기존 제품/제공자 대체/중복3파일75개와 신규 품질 재시도17개의 최종 결과가 통과했다(총92개, 여러 실행 합산의 고유 검사 수). 두 번째 수정의 반대 작성자·새 독립검토, 반복 불합격 종료,6분 경계,모든 실패/started 포함24회 상한,마지막 호출에서 최종 품질 실패 사유,인증/쿼터/설정 오류와 늦은 응답 차단을 확인했다.0020은 기존 revision/부모 ID/자식 참조·FK·고정 마감 보호를 유지하고3만 추가 허용한다.
- 최초4파일 실행은90통과/1실패, 최종 품질 파일 재실행은16통과/동일1실패였다. 원인은 daily의 `not_before=0`을 모의 시작 시각으로 사용한 테스트 오류다. `Math.max(NOW, initial.not_before)`로 시간 역행을 고친 후 해당 daily/trial2개가53.39초에 통과했다. 각5장이55분 제작창 안에 예약되고 각1회 모의 발송됐다. 실제 AI·1080 렌더·휴대전화 수신을 검증한 것으로 계산하지 않는다(PNG는 유효한1080 fixture).
- 타입·서식·웹/세Worker dry-run 및 마지막 종료사유 변경 후 DO dry-run, 기본/실제 운영 설정 무료 구성 검사 통과. live 구성 검사 첫 시도는 존재하지 않는 설정 파일명으로 실패했고 실제 `wrangler.delivery.deploy.jsonc`를 지정해 통과했다. 무료 계정·공유 잔여량·원격CPU를 새로 확인한 것은 아니다.
- 하루단어 연동19개·타입·빌드 통과. 정식 exporter129개 화면/2개 릴레이 파일, UI 원본 해시와 릴레이 메모리 재빌드를 대조했다. 릴레이 바이트 변경은 `ai_limit` 안내 문자열 추가뿐이다. UI 해시 `223256e3276ac1dff18279c316a611c38afde5831e7bdb9979e02345bb392f48`, 릴레이 원본 해시 `8add38baa25c57aecca0b0f86e9738ac75627a6e746e145a9329a43152234455`다. 레이아웃/입력 흐름 변경이 없어 이번에는 브라우저 검사를 추가하지 않았다.
- `review`의 테스트·보안/유지보수·마이그레이션 전문 검토와 독립 red-team/adversarial 후 남은 코드 지적0. 충돌 fixture·모의 시각·예산 부족 안내·최종 차수의 품질 실패 사유를 수정했다. 같은 모델의 독립 문맥이며 adversarial의 테스트 검토는 요약 모드다. 기존 보조CLI 비호환을 교차 모델 성공으로 계산하지 않는다.
- 코드/스키마는 미배포이며 운영0019·DO/Worker/Site·설정version28을 변경하지 않았다. Git 제외 현재 읽기 검증기의 최종 작성 조회만 revision3을 지원하도록 일반화하고 구문 검사했다. 과거 결과 파일·이미 끝난 등록/재개 도구는 실행/변경하지 않았다. 새 시험·AI·재발송·이력 변경0이다. 실제5장 수신과 새 재수정/자연중복 분기의 실측은 남아 있다.

재현 명령:

```powershell
node node_modules/vitest/vitest.mjs run tests/automation-quality-retry.test.ts tests/automation-revise-fallback.test.ts tests/automation-duplicate-retry.test.ts tests/automation-product.test.ts
npm run build
npm run check:free
node scripts/export-haru.mjs --target 'C:/Users/user/Documents/ChatGPT/하루단어'
```

로그: `backups/automation-quality-{tests,final-tests,five-tests,build,final-dryrun,typecheck,free-live,export}.log` 및 `automation-quality-artifacts.json`, 하루단어 `outputs/automation-quality-{proxy,typecheck,build}.log`.0020 원격 적용은 [설치](SETUP.md)·[복구](OPERATIONS.md)의 차단/백업/호환 DO 절차를 따른다. 아래 실제 시험 결과는 기존 운영 코드의 이력이다.

**12:41 시험 종료 — 4장 접수·1장 품질 검토 탈락:** 새trial version27의1·3·4·5번은 서로 다른 표현·독립검토·1080 PNG를 거쳐12:41~12:42 각1회 live접수됐다.2번은 수정 후 Groq 최종 검토에서 뜻/번역이 불합격이어서11:52:19에 `review_failed`로 종료됐다. 마감12:36까지 시간이 남았으며 현재 수정1회 후 재검토 실패는 추가수정/대체 없이 제외하는 정책이다.55분 준비만으로5장 성공이 검증된 것은 아니다. 사용자는 도착 및4장으로 추정한다고 보고했고 영어 문구를 대조 중이다. 정확한 수량·이미지/원본 링크 정상 확인은 아직 대기다.

AI17회 중 응답처리 성공16·Google503실패1이며 검토 응답 성공과 품질 통과는 다르다. 수정 제공자 전환과 자연중복은 발생하지 않았다. CPU 반환 그룹P99 최고는 주6.859ms·발송3.418ms·DO324.196ms,관측 런타임 오류0·sampleInterval1이다. 주Worker11:58/12:01 분별 자료는 좁은 재조회에도 없어 전체호출최대/완전관측으로 해석하지 않는다.

시험종료·동일설정·연결정상·진행중/미해결0을 확인한 뒤12:44에 **version28·매일07:30·5장·활성,다음10월7일07:30**으로 재개했다. 설정 외18개 D1테이블 해시와 FK를 보존했고 기존후속 `en-card-5`를 **10월7일07:50 정규 읽기 점검**으로 변경했다. 새 생성/재발송/배포/이력초기화는 없다. 이번 검증기는 `backups/automation-now-trial-20261006/`이며 완료한resume을 재실행하지 않는다. 아래version27/12:51 대기 설명은 등록 당시 기록이다.


**즉시 새5장 검증 등록 — 2026-10-06:** 사용자 요청에 따라 기존 하루 한 번 시험 기록을 보존하는 관리자 전용 검증 회차를 추가했다. **version27·trial5개,11:41 제작·12:36 마감·12:41부터 순차 발송·12:51 점검**이다. 일반 API의 하루 한 번 제한·일일 발송20회·PNG2분 대기는 유지한다. 저장된 매일07:30/5장·종료2027-10-31 설정값을 보존했고 시험 중next_due_at=NULL이다. 종료·동일설정·미해결없음 조건에서 원래10월7일07:30 정규 예약만 재개한다.

0019 인덱스를 원자적으로 적용하며 암호화 백업·복호화 검증, 기존18개 데이터 테이블 해시/FK 보존을 확인했다. 기존 DO가 저장된60분 준비/55분 제작을 처리하므로 Worker·Site 재배포는 없다. **사이트 일반 등록은 아직45분 정책**이며 이번 시험은 새 화면 배포 검증이 아니다. 제품23개·정규재개15개·등록중단복구14개 로컬 검사와 타입·무료 구성·DO dry-run을 통과했다. 검토에서 발견한 등록 중단 후 정규예약 복구 경로를 보완했다. 실제5장 접수·휴대전화 수신·CPU와 자연 제공자 대체/중복은 대기다. 아래 version25/내일 첫 점검은 이전 기록이다. **11:41:16 KST 실제 첫 AI 호출 후 초안 성공·검토 단계 진입**을 읽기 확인했다. 새5개만 조회됐고 운영 Worker/바인딩/Cron과 저장 설정 해시가 일치한다. 재개 도구는 현재 제작 중이므로 ready=false로 안전하게 거부했다.


## 이번 검증의 조회·재개 명령

같은 날 trial이 두 회차이므로 **day/kind/config_version=27**을 함께 사용한다. 기존09:49 시험 version24의4장과 섞지 않는다. 이전 디렉터리의 등록/복구 도구를 재실행하지 않는다. 파일 라벨이 있으면 새 라벨로 읽고 덮어쓰지 않는다.

```powershell
node backups/automation-now-trial-20261006/observe.mjs scheduled-trial
node backups/automation-now-trial-20261006/verify.mjs 2026-10-06 5 scheduled-trial trial
# verify 결과 suggestedCpuWindow의 실제 UTC 시작·끝 사용
node backups/automation-now-trial-20261006/metrics.mjs <UTC_START> <UTC_END> scheduled-trial
# 시험 종료 후 읽기 보호검사. ready=true이고 intent/resumed가 없을 때만 --apply
node backups/automation-now-trial-20261006/resume.mjs
node backups/automation-now-trial-20261006/resume.mjs --apply
```

재개는 version28·원래10월7일07:30인지 확인하고 `en-card-5`를10월7일07:50에 다시 예약한다. 재개 후에는 같은 폴더의 `verify.mjs 2026-10-07 5 scheduled-daily daily`를 사용한다. 현재 신규등록/재발송/추가AI/배포 명령은 실행하지 않는다. 서버5건 접수와 사용자5장 수신은 별도 조건이며 CPU는 microseconds÷1000, 그룹P99와 전체 최댓값을 구분한다. 실제 수정 대체·중복이 없으면 미관측으로 남긴다.

## 새5장 시험 준비창60분 — 2026-10-06 로컬 후보

- 공유 `trialLeadMinutes(5)`를45→60분으로 변경했다. 기본/지정 발송 시각과 시작 시각이 같은 함수를 사용하며 실제 제작창은55분이다. 1~4장, 기존 run의 저장 시각, 정규 예약과5분 마감·PNG2분 대기는 유지한다. 변경 전 새60분 기대값 검사는45분 실제값으로 실패했고, 수정 후 통과했다.
- Vitest3파일49개 통과: 시험 수량17개, 수정 제공자 대체와 중복 재생성 포함. 최소60분·분 정밀도·KST 당일/자정 경계·동시 등록·원자적 실패·기존 이력 보존을 확인했다. Google503·수정 제공자 대체·재검토·렌더1초 경과·고정 분 단위 tick을 섞은 daily/trial 모두5개 독립 검토·PNG·예약·각1회 모의 발송을 완료했다. 이것은 오늘 실제 데이터를 재실행한 결과나 모든 장애 패턴의 보장이 아니다.
- Chromium/WebKit2개에서5장 최소60분/제작 구간 안내·설정 저장/시작/중단·초안 보존을 확인했다. 최초 직접 Playwright 실행은 PATH에wrangler가 없어 시작 실패했고, package.json의 `npm run test:e2e`로 실행해 통과했다. 휴대전화 실기기 검사가 아니다.
- 타입·Prettier·웹/세Worker dry-run·무료 구성 검사, 하루단어 연동19개·타입·제품 빌드를 통과했다. 정식 exporter의화면129개·릴레이2개 파일 SHA256, UI 원본과 릴레이 메모리 재빌드를 대조했다. UI source SHA256 `cb6fe9a99003081597fed113957f734a23a4da98917df02ba2bc9d79184ae7da`; 릴레이 source SHA256 `3cc9b08b1304855f4af93fa5a8a19f5a872debc267df85454408311bd0178207`이다. 릴레이 생성 코드의 동작은 변경되지 않았다.
- `review`는 이전 전체 검토 HEAD `24238d4` 이후 변경을 대상으로 전문4개(testing/maintainability/performance/design)·독립 adversarial을 실행했다. 배포 순서를 DO 100% 확인→Site 게시→시험 등록으로 명확히 했다. 같은 모델의 독립 문맥이며 adversarial의 테스트/fixture는stat 요약 검토다. 기존 CLI0.132/model 비호환 때문에 교차 모델 검토로 집계하지 않는다. 미해결 코드 지적0이며 과거 전체PR 검토와 이번 증분 검토를 구별한다.
- 새 배포·마이그레이션·Secret/계정 변경·AI/카카오 호출·제품 예약 변경0이다. `check:free`는 구성 검사이며 계정 플랜 재확인이나 CPU 실측이 아니다. Site v119/기존DO의 추가시험45분과 정규version25 매일07:30/5장은 그대로다. 10월7일 정규5장 결과/CPU/실제 휴대전화 확인 후 PR 병합·후속 배포한다. 새60분 추가시험 실측, 제공자 교체/자연중복 발생 시 실측은 별도 미완료다.

```powershell
node node_modules/vitest/vitest.mjs run tests/automation-trial-quantity.test.ts tests/automation-revise-fallback.test.ts tests/automation-duplicate-retry.test.ts
npm run test:e2e -- tests/e2e/redesign.spec.ts --grep "자동 제작"
npm run build
npm run check:free
node scripts/export-haru.mjs --target 'C:/Users/user/Documents/ChatGPT/하루단어'
# 하루단어에서 실행
node --experimental-strip-types --test tests/card-studio.test.mjs tests/card-automation.test.mjs
npm run typecheck
npm run build
```

로그: Git 제외 `backups/trial-window-{before-fix,tests,e2e,build,free,export}.log`, `trial-window-artifacts.json`, 하루단어 `outputs/trial-window-{proxy,typecheck,build}.log`. 신규 배포 명령은 위 코드/화면 검증과 실제 수신 조건을 확인한 뒤 기존 절차로 실행한다.

## 빠른5장 시험 결과·실제4장 수신·정규 재개 — 2026-10-06 10:01 KST

- 10월6일trial·version24·5개중1~4번은최종작성/수정과반대제공자독립검토·내용해시·표현비중복·1080PNG·각1회live접수·예약완료를확인했다.카카오호출시각은09:49:18.726/09:49:21.175/09:50:18.519/09:50:20.606 KST다.사용자가**새4장모두이미지·원본링크정상**으로답해접수4건과수신4장이일치한다.전체5장성공은아니다.
- 5번은내용검토/PNG가정상이지만09:42:17.844이미지ready,예약단계retry_at09:44:18.071,deadline09:44:00이었다.09:44:16.027에`expired`로종료돼예약/카카오호출0이다.이미지전파대기2분이시험의제작창40분을넘겼다는코드/시각근거이며강제로마감이나기존run을바꾸지않았다.정규제작창55분의전체성공을대신입증하지않는다.
- AI17회중12성공·5실패다.Google초안503×4,수정503×1이며Google수정은같은제공자의2번째시도에성공했다.수정단계에서3회실패하지않아새수정대체분기는미관측,중복거절0으로재생성도미관측이다.그룹CPU의런타임오류0과AI503실패5회는다른지표다.
- CPU관측UTC00:03:16.701~00:52:20.606,현재버전주51요청·발송54요청·DO52요청.반환그룹P99최댓값은각**4.588/3.323/508.134ms**,오류0·sampleInterval1·일반Worker관측그룹10ms초과0이다.모든요청의최대값으로표현하지않는다.주Worker09:29/09:30 KST자료가없어UTC00:28~00:32를재조회했지만계속누락됐다.발송/DO는확인구간의완전한분48개에서분별누락이없었지만전체호출수집을증명하지는않는다.첫GraphQL401은공식Wrangler whoami갱신후해결했다.
- `resume.mjs`읽기검사ready=true후승인된`--apply`1회,10:01:38 UTC+9에version25 enabled1·next_due_at1791325800000을확인했다.저장원문해시/매일07:30/5장/종료2027-10-31은같다.재개전후19개D1테이블을대조해설정외18개행수·해시불변,FK0,진행중/미해결0,카카오connected와세Worker버전/바인딩/Cron동일을확인했다.부분실패이력·미발송PNG는보존했고재발송/보충생성하지않았다.
- 기존`en-card-5`를10월7일07:50 KST 1회ACTIVE로갱신했다.다음대상daily5장version25는06:30시작·07:25마감·07:30발송이다.`resumed.json`의observedDaily를쓰는검증기를실행해제작전0개/미검증상태를확인했으며성공으로집계하지않았다.미관측분기를강제로호출하거나새시험을등록하지않는다.
- 새배포/마이그레이션/계정변경0,기존Free확인과구성유지(신규계정플랜확인없음).무료공유한도·5장실제성공은미확인이다.다음개선검토대상은제작창과이미지대기/분단위처리의시간여유이며이번관측에서코드를변경하지않았다.원자료는`backups/automation-fast-trial-20261006/`의verify/metrics-scheduled-trial·metrics-coverage/trial-gap-recheck·audit-before/after-resume·resumed/observe-resumed·closeout다.출시기록에사용자4장확인을별도보존했다.

```powershell
# 다음 정규 예약 읽기 검증. 이미 실행한 trial 등록/resume은 다시 실행하지 않는다.
node backups/automation-fast-trial-20261006/observe.mjs scheduled-daily
node backups/automation-fast-trial-20261006/verify.mjs 2026-10-07 5 scheduled-daily daily
node backups/automation-fast-trial-20261006/metrics.mjs <UTC-start> <UTC-end> scheduled-daily
```

## 가장 빠른1시간 이내 새 AI5장 시험 — 2026-10-06

- 사용자 요청을 받아 09:49 KST 발송을 등록했다. 현재 배포 소스/버전/바인딩·무료 모드/Cron을 읽고 일시정지와 `registerTrial` 제품 트랜잭션을 사용했다. version22→23→24, day2026-10-06·kindtrial·item_index1~5/item_count5·09:04 시작·09:44 마감이다. 기존 매일07:30/5장 설정 원문 SHA256, 이전 run 행·등록 시 사용량 불변을 확인했다. 현재 시험만 활성이고next_due_at=NULL이다. 직접 AI/카카오를 호출한 등록 도구가 아니며 이후 제작/발송은 기존 클라우드 Cron이 수행한다.
- 제공자 실패와 자연중복을 강제 주입하지 않는다. 실제 추가시험 제작창40분은 정규55분보다 짧다. 준비 전 조회에서5개draft/AI시도0 확인은 등록 검증이며 제작/접수 성공이 아니다. 운영 코드·배포·DB마이그레이션·이력 초기화·기존 카드 재발송0, Free 계정은 기존 확인을 유지하고 새 청구 검증은 하지 않았다. OAuth401은 공식Wrangler whoami로 갱신했다.
- 읽기 검증기는 최종 draft/revise 차수·작성자와 독립 검토자·비중복·1080PNG·각live접수를 대조한다. 재개 도구는 실행 전 읽기 모드에서 `before_trial_due`·활성제작으로 정상 거부했다. 동일 실제 재개SQL의 로컬SQLite14사례가 통과했다: 정상/종료된부분실패만허용,version/설정변경·일시정지·이미재개·제작중·활성예약·전송중/결과불명·대기발송·취소·quota·연결해제거부,이전이력/무관한수동blocked보존. 이 검사는 실제 예약 재개가 아니다.
- 기존후속 `en-card-5`를09:59 KST 1회ACTIVE로 변경·파일확인했다. 시험 종료·설정보존·미해결없음·중대한중단없음이면 원래10월7일07:30·5장만재개한다. 이미resume-intent/resumed가있으면 현재상태를 먼저대조하고맹목재시도하지않는다. 부분시험성공과정규재개를구별하며빈수량보충/재발송하지않는다. 재개성공후같은후속을10월7일07:50 정규읽기검증으로복귀한다.
- 원자료: Git제외 `backups/automation-fast-trial-20261006/`의 registration-intent/registration·observe-registered·verify-registered·resume-guard-test·state-deployed. 공통기록: 하루단어 `docs/releases/2026-10-06-automation-fast-trial.json`. 휴대전화5개이미지/원본링크 확인전 전체목표미완료이며 이전3장수신·4/3차이 기록을보존한다.

```powershell
node backups/automation-fast-trial-20261006/observe.mjs scheduled-trial
node backups/automation-fast-trial-20261006/verify.mjs 2026-10-06 5 scheduled-trial trial
# verify 결과의 실제 UTC 구간을 사용한다. 그룹 P99는 전체 호출 최댓값이 아니다.
node backups/automation-fast-trial-20261006/metrics.mjs <UTC-start> <UTC-end> scheduled-trial
node backups/automation-fast-trial-20261006/resume.mjs
# ready=true이고 기존 intent/결과가 없는 것을 확인한 뒤에만 원래 정규 예약 재개
node backups/automation-fast-trial-20261006/resume.mjs --apply
```

## 두 저장소 PR 전체 변경 재검토 — 2026-10-06

- 범위: EN_Card `origin/master@b9e7d31` 이후 다중 trial·0017, 중복 재생성·0018, 수정 제공자 대체와 관련 검증/문서; 하루단어 `github/main@85a2fba` 이후 대응 생성물과 출시 기록. 기존 운영 반영과 GitHub 병합을 구분한다.
- `review`의 테스트·유지보수·보안·성능·마이그레이션·디자인 6개 전문 검토와 red-team·독립 적대적 검토를 완료했다. 현재 설치/복구 안내를0018로 정정하고 하루단어 README의 현재 배포v116 표시를v119/수정 제공자 대체 DO로 수정했다. 남은 구체적 코드 지적0이며 실제 운영 성공의 보증은 아니다.
- 같은 모델의 독립 문맥 검토다. 적대적 검토의 테스트/픽스처는 이름·통계 요약만 확인했다. API 전문 검토는 기존 helper의11회 지적0 기록에 따라 생략했고 주 검토자가 변경 API의 인증/하위 호환 경로를 확인했다. 보조 Codex CLI0.132.0은 앞선 모델 비호환 상태로 교차 모델 검토에 포함하지 않았다.
- 현재 UI129개·서버 릴레이2개 해시, 원본 지문, 릴레이 메모리 재빌드 일치. 제품 소스/테스트는 아래 최종140개 검증 및 배포본과 동일하며 전체 재실행으로 표시하지 않는다. 보안 전문 검토에서 릴레이19개를 추가 재실행해 모두 통과했고 기존140개와 중복으로 합산하지 않는다. 양쪽 `git diff --check` 통과.
- Git 제외 원자료: `backups/pr-ready-20261006/artifacts.json`과 리뷰 기록. 이번 작업의 배포·AI/카카오 호출·제품 설정/DB 변경은0이다. 새 코드의 실제 수정 대체·자연 중복·5장 제작 부하 CPU·휴대전화5장 확인은 기존10월7일 정규 예약 후속에서 확인한다.

## 수정 제공자 대체 운영 반영 — 2026-10-06 08:26 KST

- 사용자 후속 진행에 따라 제품 커밋 `c503210cdc60b4084fe5b5c1b423ae3aa0fbe11d`을 기존 자동화 DO에만 배포했다. 생성 시각 `2026-10-05T23:26:15.86407Z`, 버전 `54882e21-0e43-4f9c-8dfb-f0fb6cce5e47`100%를 API로 확인했다. 기존 주 `b0b40667-99de-4100-9aae-d0f345fe96bf`·발송 `ea59a0a0-fa1c-4e9d-9501-a1c66a261fa1`은 동일하다. Site v119는 재게시하지 않았다. DO의 폰트 자산도 새 업로드가 없었다.
- 아래140개 검증을 마친 source/tests/문서의 SHA256을 재대조하고 정확한 live 설정으로 DO dry-run·무료 구성 검사를 통과했다. 배포 전과08:26/08:28 최종 조회에서 D1 **19개 테이블의 전체 행 해시·행 수가 동일**했다. 설정 version22·enabled1·매일07:30·5장·종료2027-10-31·next_due_at1791325800000, 원문 해시, 오늘3장 접수·2장 skipped 이력과 사용량uploads3/sends3을 보존했다. 스키마0018·바인딩/Secret 이름·매분 Cron을 유지했다. 진행 중 제작/활성 개별예약/전송·미해결unknown/FK 오류0, 기존 별도blocked1·카카오connected는 그대로다.
- 계정 플랜 API는403/code10000으로 재확인하지 못했다. 기존 사용자 Workers Free·Google/Groq Free 확인과 동일한 free_only 구성을 사용했다. 유료 우회·새 리소스/모델·계정/Secret 변경0이며 잔여 무료 한도와 미래 청구를 보장하지 않는다.
- 배포 후 무작업 조회의 첫 결과는0그룹이었고, 후속 구간 `2026-10-05T23:26:22.000Z` 이후에는 현재 버전 주/발송/DO 각각1그룹·1요청·sampleInterval1·런타임 오류0이 반환됐다. 반환 그룹 P99는 **1.709/0.888/6.118ms**다(microseconds÷1000). 단일 표본과 최근 관측 지연을 고려해 전체 호출 최댓값·완전한 수집·실제5장 제작 부하 통과로 해석하지 않는다. Wrangler의 startup69ms는 호출별 CPU가 아니다.
- 다음 관측은 기존10월7일 정규5장이다. **06:30 제작·07:25 마감·07:30 발송**, `en-card-5`를 **07:50 KST 1회 ACTIVE**로 갱신하고 저장 상태를 확인했다. 제품 설정 변경/새 시험/추가 AI·카카오 호출/DB 이력 쓰기는0이다. 실제 제공자 대체·자연 중복은 각 분기의 시도 기록이 있을 때만 확인하며 발생하지 않으면 미관측이다. 서버5장 접수와 휴대전화5개 이미지/원본링크 확인도 구분한다.
- 새 읽기 검증기는 최종 writer의 stage/revision별 성공, 반대 제공자의 최종 검토, 내용 해시, 비중복, PNG, live1회 접수·미해결 여부를 대조한다. 제공자별 수정 시도와 순서를 별도 집계한다. 구문/운영 쿼리 확인과 제작 전0개 조회를 통과했으며0개는 예약 성공이나 실패 판정이 아니다. 과거 검증기·오늘3장 수신·10월5일 사용자4/서버3 차이를 덮어쓰지 않았다.

원자료는 Git 제외 `backups/automation-revise-rollout-20261006/`의 snapshot-preflight/deployed/final, deploy-automation.log, dry-run.log, free-config.log, observe/verify/metrics 파일이다. 공통 출시 기록은 하루단어 `docs/releases/2026-10-06-automation-revise-rollout.json`이고 로컬 후보 보고서는 당시 기록으로 보존한다.

```powershell
# 기존 정규 예약을 읽기만 한다. 같은 라벨 결과가 있으면 새 라벨을 사용한다.
node backups/automation-revise-rollout-20261006/observe.mjs scheduled-daily
node backups/automation-revise-rollout-20261006/verify-daily.mjs 2026-10-07 5 scheduled-daily
# verify 결과의 suggestedCpuWindow에 있는 실제 UTC 시작/끝을 사용한다.
node backups/automation-revise-rollout-20261006/metrics.mjs <UTC-start> <UTC-end> scheduled-daily
```

복구 후보는 직전0018 호환 DO `d485cf7e-9afc-42f4-949d-e8db185e6fc0`이다. 필요할 때 진행 중 작업을 확인한 뒤 `node node_modules/wrangler/bin/wrangler.js rollback d485cf7e-9afc-42f4-949d-e8db185e6fc0 --config wrangler.automation.live.jsonc`를 사용한다(도움말 확인, 실행하지 않음). 기존 시도·역할·카드/발송 이력을 재작성하거나 DB를 되돌리지 않는다. 이전 코드는 수정 제공자 대체가 없으므로 진행 중 작업의 동작 차이를 고려한다. GitHub push/PR/병합과 실제5장 전체 검증은 이 배포 완료와 별개다.

## 수정 제공자 대체 — 2026-10-06 로컬 검증·운영 미반영

- 대상: 새 `codex/automation-revise-fallback`의 `src/automation/engine.ts`, 기준 `a354e86`. Google/Groq 수정 예산 소진 후 역할 교체, 다른 제공자의 새 검토, 양쪽 시도 보존·무한 전환 차단을 구현했다. DB0018/마이그레이션·모델·의존성·Secret·API·화면·릴레이는 변경하지 않는다.
- 수정 전 회귀에서 Google 수정3회 실패가 `skipped`로 끝나는 것을 확인했다. 수정 후 양방향 복구·두 제공자 모두 실패/잘못된 응답·새 검토 실패/장애·중복과 오류 혼합/3회 거절 상한·무료 한도/인증/설정 중단·취소/claim 교체/마감 후 늦은 응답·발송 마감을 검사했다.
- 관련7파일 **138개 통과**. 이후 최종 작성자의 성공을 판정하는 문서 SQL을 양방향 사례에서 실행하고, trial 시간 역행을 없애며 단일 trial 만료1개를 추가한 **후속5개 통과**(13개 비선택은 이전 통과 범위). 별도 제품 SQLite DO의 실제1080 PNG 생성·검증·저장1개 통과. 중복 없이 합친 최종 결과는 **8파일140개**다. AI와 카카오 발송은 모의다.
- 정규5장의 고정 Cron·AI/렌더1초 경과 시나리오는 실제 관측했던1·3번 수정503 각3회와4·5번 초안503을 재현했다.5개 모두 독립 검토·서로 다른 표현·예약·모의1회 발송을 완료했다. 이는 제공사 장애가 지속되거나 호출/렌더 지연이 더 길어도 성공한다는 보장이 아니다.
- 같은 오류 패턴의 기존 추가5장 시험은40분 제작창에서3장 예약·2장 expired다. 한 장 시험의10분 창에서는 즉시 응답을 가정해도 수정3회 실패 후 대체·검토·렌더·전파 대기를 마감 전에 끝내지 못했다. 원래 deadline을 유지해 전송하지 않는 회귀를 통과했다. 제작창 확장은 이번 범위에 포함하지 않았다.
- 최종 writer와 최초 초안 작성자가 다를 수 있어 기존 운영 검증기의 `draft_successes`만으로 성공을 판단하면 오판한다. [수량 문서의 읽기 SQL](AI_CARD_AUTOMATION_QUANTITY.md#수정-제공자-대체)은 stage/revision별 최종 작성·검토 성공과 해시/역할 일치를 확인하며 로컬 D1에서 양방향 성공을 검증했다. 과거 검증기/원자료는 보존했고, 후속 운영 검증기에 이 기준을 적용했다.
- 타입·Prettier·웹 빌드·주/발송/자동화 Worker dry-run3개·기본 및 live 구성의 `check:free` 통과. 새 유료 경로는 없고 실제 계정 잔여 무료 한도·원격 CPU는 이번에 조회하지 않았다. Google/Groq의 공유 호출/토큰 한도 문서를2026-10-06 재확인했으며 대체 호출도 사용량을 소비한다.
- `review`의 테스트·유지보수·보안·성능4개 전문 검토, red-team, 독립 적대적 검토를 수행했다. 시험 시간창 지적을 문서/회귀로 처리하고 후속 검토 잔여 코드 지적0이다. 모두 같은 모델의 독립 문맥이다. 보조 Codex CLI0.132.0은 현재 모델을 지원하지 않아400으로 종료됐으며 검토 성공/교차 모델 검토로 집계하지 않는다. 스킬의 갱신 알림은 제품 변경과 분리했으며 도구 업그레이드는 하지 않았다.

초기 신규13개 실행은12개 통과와 다중 시나리오의 로컬 테스트30초 시간 초과1개였다. 해당 시나리오의 테스트 실행 제한만60초로 늘린 뒤 단독통과·관련 전체138개·최종5개 통과를 확인했다. 첫 무료 live 구성 명령은 없는 발송 설정 파일 경로로 실패했고, 실제 `wrangler.delivery.deploy.jsonc`로 재실행해 통과했다. 실패한 실행을 통과 횟수에 합산하지 않는다.

```powershell
node node_modules/vitest/vitest.mjs run tests/automation-revise-fallback.test.ts tests/automation-duplicate-retry.test.ts tests/automation-product.test.ts tests/automation-quantity.test.ts tests/automation-trial-quantity.test.ts tests/automation-relay.test.ts tests/automation-rpc.test.ts --file-parallelism --maxWorkers 2
node node_modules/vitest/vitest.mjs run tests/automation-product-do.test.mjs
npm run build
npm run check:free
node scripts/check-free.mjs --config wrangler.live.jsonc --mode live --delivery-config wrangler.delivery.deploy.jsonc --automation-config wrangler.automation.live.jsonc --automation-active
```

증빙: Git 제외 `backups/automation-revise-fallback-{before,tests,timing,regression,final-edges,do,build,typecheck,free,free-live-config,codex-review}.log`, `backups/automation-revise-fallback-record-proof.json`. 공통 후보 기록은 하루단어 `docs/releases/2026-10-06-automation-revise-fallback.json`이다. source/tests/동작 문서 SHA256과 이전 운영·수신 기록 보존을 대조했다.

이번 작업의 배포·실제 AI/카카오 호출·새 시험·제품 설정/이력·heartbeat 변경은0이며 양쪽 브랜치는 미커밋이다. 새 코드의 실제 수정 대체·중복 재생성·원격 CPU·5장 수신은 미검증이다. 다음 운영 반영 대상은 기존 `en-card-automation` DO다. 실제 반영 전 진행 중 작업·현재 버전·무료 조건을 확인하고, 이미 끝난 슬롯/원본 시도 이력을 재실행·초기화하지 않는다. 아래 오늘3장 결과는 개선 전 배포본의 실제 이력이다.

## 정규 5장 결과 — 2026-10-06 07:50 KST 점검·사용자 3장 수신 확인

대상은 이미 활성화된 설정 version22의 **2026-10-06 daily 5장**이다. 06:30 제작 시작·07:25 마감·07:30 발송을 읽기로 검증했다. 새 trial이나 보충 발송을 만들지 않았다. 5개 슬롯이 모두 종료됐으며 **3장 접수·수신 정상, 2장 제작 실패로 5장 전체 검증 미통과**다.

| 항목 | 관측 결과 |
| --- | --- |
| 1·3번 | 초안 작성·독립 검토 후 Google 수정 단계가 각각 3회 `unavailable`로 실패해 기존 제공자/단계 예산 소진. PNG·발송 없음 |
| 2·4·5번 | 최종 차수의 독립 검토 통과, 저장된 다른 카드와 최종 표현 비중복, PNG HTTP200·시그니처·1080×1080·버전 일치, 카드별 live 접수/발송 시도 각1회 |
| PNG 크기 | 2번 40,823바이트·4번 55,683바이트·5번 67,055바이트 |
| 발송 호출 시작(KST) | 4번 07:31:18.152·5번 07:31:21.571·2번 07:31:23.624 |
| AI 호출 | 총20회: 성공12·unavailable8. 실패 중 HTTP503 7회, HTTP 상태 없는1회. 마지막1회의 통신 실패 원인은 확인되지 않음 |
| 중복 재생성 | 거절 후보0건. 이번 실제 실행에서 해당 분기는 미관측이며 강제로 중복을 주입하지 않음 |
| 휴대전화 | 사용자가 오늘07:31경 받은 **3장 모두 이미지·원본 링크 정상**으로 확인. 서버 기록과 수량 일치. 5장 수신 확인으로 확대하지 않음 |

1·3번은 각각 수정3회 실패했다. 4·5번의 최초 초안503은 다음 시도에 성공했다. `src/automation/engine.ts`의 현재 제공자 대체는 초안 단계에만 적용되므로 수정 실패 소진은 해당 카드를 종료한다. 중복이나 제작 마감으로 실패한 결과가 아니며, 다음 개선 대상으로 남긴다. 원본 시도와 실패 이력을 수정하거나 실패 슬롯을 재실행하지 않았다.

CPU 조회 구간은 실제 AI 시작을 포함한 **2026-10-05 21:29:16.921Z~22:33:23.624Z**다. 원단위 microseconds를 milliseconds로 나누어 기록했다.

| 현재 버전 실행 환경 | 반환 그룹/요청 | 관측 런타임 오류 | 반환 그룹 P99의 최댓값(ms) |
| --- | ---: | ---: | ---: |
| 주 일반 Worker | 65/65 | 0 | 4.282 |
| 발송 일반 Worker | 68/68 | 0 | 4.321 |
| 자동화 DO | 67/67 | 0 | 573.855 |

모든 반환 그룹은 요청1개·sampleInterval1·P50=P99이며 예상 밖 버전이나 조회 행수 상한 도달은 없었다. 다만 완전한 분63개 중 주 Worker 06:43/06:50·발송 Worker 06:57 KST 자료가 없고, 좁은 구간 재조회에도 같은 공백이 남았다. 관측 누락과 실행 시점 차이를 구별할 근거가 없어 **전체 호출 관측·전체 호출 최대 CPU·5장 성공 부하는 미검증**으로 둔다. 공백만으로 Cron 실패를 단정하지 않는다. [Cloudflare CPU 통계](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/#cpu-time-per-execution)는 표본 분위수이며 전체 최댓값이 아니다. [호출 상태](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/#invocation-statuses)의 런타임 오류0과 AI 제공자 응답 실패8회를 구분한다.

최종 읽기에서 설정 원문 SHA256·version22·enabled1·매일07:30·5장·종료2027-10-31이 초기 관측과 일치했다. 다음 due는 **2026-10-07 07:30 KST**다. 진행 중 제작·활성 개별예약·claimed/sending/미해결 unknown·FK 오류0, 카카오 connected를 확인했다. 주 Worker `b0b40667-99de-4100-9aae-d0f345fe96bf`, 발송 `ea59a0a0-fa1c-4e9d-9501-a1c66a261fa1`, DO `d485cf7e-9afc-42f4-949d-e8db185e6fc0` 및 바인딩·Cron `* * * * *`은 배포 기록과 같았다. 무료 구성은 이전 승인된 구성 그대로이며 이번 점검에서 새 계정 플랜 확인이나 배포를 하지 않았다.

`en-card-5` 후속 확인만 **PAUSED**로 전환하고 실제 설정 파일을 재조회했다. 제품 정규 자동화는 enabled1로 유지한다. 점검이 새로 유발한 시험 등록·AI 호출·카카오 발송·DB 이력/설정 변경·배포는 모두0이며, 표의 AI/발송은 원래 정규 예약의 실행이다. 이전 10월5일 사용자 새4장/서버trial3건 차이는 별도로 보존한다. 오늘3장 수신 확인으로 이전 차이를 해소하거나 전체 목표를 완료하지 않는다.

재현용 읽기 명령(제품 상태 변경 없음):

```powershell
node backups/automation-duplicate-trial-20261006/verify-daily.mjs 2026-10-06 5 scheduled-daily
node backups/automation-duplicate-trial-20261006/metrics.mjs 2026-10-05T21:29:16.921Z 2026-10-05T22:33:23.624Z scheduled-daily
```

공통 결과는 하루단어 `docs/releases/2026-10-06-automation-duplicate-validation.json`, 원자료는 Git 제외 동일 backups 디렉터리의 `verify-scheduled-daily.json`, `final-state.json`, `metrics-scheduled-daily.json`, `metrics-coverage.json`, `metrics-gap-audit.json`이다. 후속 문서 검사와 사용자 확인 증빙은 `phone-receipt-record-proof.json`·`documentation-verification.json`에 보존한다. 이번 변경은 문서/증빙만이며 제품 테스트·빌드·배포를 새로 수행하지 않았다. 아래 실행 대기는 00:26 당시 기록이다.

## 중복 개선 후 새5장 실제 검증 — 2026-10-06 예약 관측·실행 대기

- 다음 미완료 단계 승인에 따라 읽기를 시작했다. 최초 Cloudflare401은 공식 Wrangler `whoami`로 갱신했다. 이전 version20을 전제로 한 등록 전 검사는 실제 version22를 발견하고 중단했으며 제품 DB 쓰기를 하지 않았다. 조회 SQL의 없는 인증 열을 제거하고 다시 읽어 현재 상태를 확인했다.
- 00:26 KST 설정은 **version22·enabled1·매일07:30·5장·2026-10-04~2027-10-31**, 다음 due는2026-10-06 07:30 KST다. 이미 활성화된 이 정규 설정을 보존한다. 신규 trial 등록·일시정지·원래07:00/1장 복구·추가 AI/카카오 호출·배포0이다. 이전 배포 시점의 비활성 상태를 현재 상태로 쓰지 않는다.
- Site v119·환경 기록과 공개정책4, D1 0018/FK0, 세 현재 Worker 버전/바인딩/Cron 일치를 확인했다. 카카오 connected, 진행 중 제작·활성 개별예약·claimed/sending/미해결unknown0, 자동화에 연결된 pending/blocked0이다. 과거 별도 blocked1건은 변경하지 않았다. 실제 live 구성 무료 검사 통과이며 계정은 기존 명시적 Free 확인을 유지했다.
- `verify-daily.mjs`는 day2026-10-06·kind=daily·수량5·설정22·예정/마감 시각을 대조한다. 카드/이미지 버전·작성/독립 검토·최종 표현의 다른 카드/거절 후보와 비중복·공개1080 PNG·live 접수1건·미해결0을 확인한다. 00:26 최초 실행은 `before_preparation`, 0장·미검증으로 기록했다. 제작 시작은06:30이며 시작 전0장을 실패나 완료로 판단하지 않는다.
- 후속 `en-card-5`를 **10월6일07:50 KST 한 번 ACTIVE**로 갱신하고 실제 automation.toml의 시각·횟수·대상 채팅을 확인했다. 같은 디렉터리의 CPU 도구는 현재 버전3개를 기준으로 실제 AI 시작~마지막 발송 구간을 조회한다. microseconds→milliseconds, 일반 Worker/DO 분리, 샘플링·누락·오류·반환 그룹P99를 확인하며 미래 최댓값으로 표현하지 않는다.
- 서버 접수·실제 휴대전화5장 이미지/원본링크·자연 발생 중복의 재생성은 별도 판정한다. 중복이 발생하지 않으면 실제 재생성 분기는 미관측이다. 중복을 강제로 주입하거나 과거 시험을 되살리지 않는다. 기존 사용자 새4장/서버trial3건 차이는 미해결로 보존한다. 아직 전체 목표 완료가 아니다.

읽기 명령: `node backups/automation-duplicate-trial-20261006/verify-daily.mjs 2026-10-06 5 scheduled-daily`. CPU는 같은 디렉터리 `metrics.mjs <실제시작UTC> <실제종료UTC> scheduled-daily`를 사용한다. 폴더명과 달리 이번 대상은 기존 **daily**다. 새 등록/재개/복구 명령은 없으며 후속 자동 점검을 마쳐도 제품 정규 설정은 그대로 둔다. 근거: 하루단어 `docs/releases/2026-10-06-automation-duplicate-validation.json`, Git 제외 `preflight.json`, `verify-initial-checked.json`, `observation-record-proof.json`.

## 중복 표현 재생성 — 2026-10-05 운영 배포·보존 검증

- 사용자 승인 범위는 암호화 백업·0018·호환 Worker/DO·기존 Site 게시다. 소스 EN_Card `ad2e125f09f669cfd5420064d819112e6cd2bf3e`, 하루단어 `40a4671dbcae07a4b82e03ca90fcc7322a02e1f8`를 커밋했다. GitHub push/PR/병합은 하지 않았다. 아래 로컬 검증은 이 코드에 해당한다.
- 유지보수 Worker로 요청/Cron 쓰기 중단 → D1 SQL 백업 → Windows DPAPI CurrentUser 암호화·복호화 SHA256 일치·제한 ACL·평문 제거 → 0018 적용을 확인했다. 백업149,436바이트, SQL SHA256 `39d145ea7799e566d0d5ac98957d099bf22cf796231337e7089247467c88c2f8`이다. 이력18개·FK 오류0, 새 거절 목록 기본[] 및 기존 모든 데이터 테이블의 원래 열/행 해시 보존을 적용 직후와 게시 후 두 번 확인했다.
- DO `d485cf7e-9afc-42f4-949d-e8db185e6fc0` → 주 Worker `b0b40667-99de-4100-9aae-d0f345fe96bf` 순서로 배포했다. 발송 Worker `ea59a0a0-fa1c-4e9d-9501-a1c66a261fa1`, 바인딩/Secret 이름과 매분 Cron1개를 보존했다. 실제 live 설정 두 dry-run·유지보수 dry-run·무료 구성 검사를 통과했다.
- 기존 Site **v119**, 게시 `appgdep_6ac3a8bea9088191a4e3a814da5a4aba`가 13:40:42 UTC에 succeeded다. 소스 `1656444de5e1a1b5cb0106577ca0e19b434decec`의 전체 tree `187b21d6605a88f304d3d1a9cbc77f63192b1f4e`는 검증한 하루단어 커밋과 같다. 환경 revision59·공개 정책4·학습 DB 마이그레이션/잠금 파일/사이트 식별자는 유지했다.
- 실제 공개 source manifest·JS/CSS/폰트/라이선스5파일 SHA256이 일치하고 `/`200, `/cards`307, Site `/api/state`·`/api/card-studio/automation` 및 EN_Card `/api/automation`401이다. 로그인 브라우저 조작·새 AI 제작·휴대전화 검증은 이 배포에서 수행하지 않았다. 로컬 UI129개·릴레이2개 해시와 기존 출시 기록 보존도 재확인했다.
- Sites 설치/빌드 helper의 기존 Windows npm 경로 오류는 동일 잠금 파일과 명령을 명시적 Node24/npm CLI로 실행해 통과했다. 최초 패키징은 WSL Bash 경로 오류, 다음 Git Bash는139 종료였고 Node24·Git Bash bin/usr-bin·`TAR_OPTIONS=--force-local`를 현재 프로세스에 지정한 공식 helper 재실행은 통과했다. 플러그인/전역 도구/소스 우회 수정은 없었다.
- 13:41 UTC 마지막 조회에서 설정은 version20·enabled0·complete·next_due_at=NULL이며 활성 예약/제작/전송 중·미해결 unknown은0이다. **새 AI/카카오 호출0, 종료 시험 재실행0, 정규 재개0**이다. 과거 blocked 기록과 사용자 새4장/서버trial3건의 차이를 그대로 보존했다. 과거 CPU를 새 재생성 경로 실측으로 재사용하지 않는다.
- 무료 구성은 통과하고 신규 유료 서비스0이다. 구독 API403으로 독립적인 계정 조회는 실패했으며 오늘 사용자의 Workers Free 확인을 근거로 유지한다. Worker/D1/KV/SQLite DO 공식 무료 구성 자료를 재확인했다. 실제 재생성 부하 CPU와 5장 전체 수신은 별도 미완료다.

단일 출시 근거는 하루단어 `docs/releases/2026-10-05-automation-duplicate-rollout.json` 및 `product-status.json`, 원자료는 Git 제외 `backups/automation-duplicate-rollout-20261005/`다. 로컬 재현: `npm test -- tests/automation-duplicate-retry.test.ts tests/automation-trial-quantity.test.ts`, `npm run check:free`. 원격 마이그레이션/배포를 검증 목적으로 반복하지 않는다. 장애 시 자동화를 중지하고 **0018 호환 수정본**으로 복구하며 이력을 초기화하지 않는다. 아래는 배포 전 로컬 검증 시점의 기록이다.

## 중복 표현 재생성 — 2026-10-05 로컬 검증·미배포

- 브랜치: EN_Card `codex/automation-duplicate-retry`(기준 `5bd3f88`), 하루단어 `codex/card-automation-duplicate-retry`(기준 `ae19be6`). 변경은 미커밋이며 기존 다중 시험 기능 위의 수정이다. 운영 0017/v118과 이전 시험/수신/CPU 근거는 보존했다.
- 변경: D1 0018의 `rejected_expressions` 기본 `[]`·최대3개. 중복 시 같은 자리에서 재작성하고, 거절 표현을 기존 최대50개 회피 목록에 우선 포함한다. 새 카드도 독립 검토한다. 수정 차수·AI/렌더 시도·원래 카드 번호와 수량·claim/설정/마감 보호를 초기화하지 않는다. 이미 생성/수정된 리소스는 재사용하지 않는다. 이전 종료 run을 재활성화하지 않는다.
- 수정 전 실패를 확인했다. 최초 중복 테스트는 기존 코드에서 `skipped`로 끝나 실패했고, 준비창 회귀는 매분 Cron·렌더1초·슬롯마다 중복2회에서 기존 35분으로 4/5·5/5가 마감됐다. 준비창을 45분으로 늘린 뒤 같은 회귀에서 5장 모두 독립 검토·이미지·예약까지 통과했다. 다른 장애/렌더 경합/지연 조합까지 보장하는 시험은 아니다.
- `node node_modules/vitest/vitest.mjs run tests/automation-product.test.ts tests/automation-quantity.test.ts tests/automation-trial.test.ts tests/automation-relay.test.ts tests/automation-durable.test.mjs --fileParallelism=false`: 4파일97개 통과. `tests/automation-trial.test.ts` 패턴은 일치 파일이 없었으며 시험 수량은 다음 명령에서 별도로 검증했다.
- `npm test -- tests/automation-duplicate-retry.test.ts tests/automation-trial-quantity.test.ts tests/automation-product-do.test.mjs tests/automation-rpc.test.ts --fileParallelism=false`와 동일한 Vitest CLI: 4파일33개 통과(신규14·다중시험11·실제 로컬 DO PNG1·RPC7). 새 테스트는 draft/revise/render 중복, 3회 종료, 오래된 표현 회피, 같은 설정에서 claim 재획득 후 늦은 응답, revision2 보존, 제공자 fallback 예산, 일시정지/마감/무료 한도 중단, 5장 모의 발송, 기존 행/FK 보존을 확인한다. 근거 `backups/automation-duplicate-regression.log`.
- `npm run test:e2e -- tests/e2e/redesign.spec.ts --grep "AI 자동 제작"`: Chromium/WebKit 2개 통과. 중복 재작성 대기·3회 한도 문구, 최소45분, 설정/시작/일시정지/시험·화면 이동을 가상 API로 확인했다. 최초 직접 Playwright CLI 호출은 자식 서버가 PATH에서 Wrangler를 찾지 못해 실패했으며 npm script로 재실행했다. 실제 카카오/휴대전화 검증이 아니다. 근거 `backups/automation-duplicate-e2e.log`.
- `npm run build`, `npm run check:free`, 변경 TS/TSX 서식 검사·타입 검사 통과. 웹 및 세 Worker dry-run이며 배포를 수행하지 않았다. 하루단어 정식 exporter 실행 뒤 서버/프록시19개와 타입·Node24 제품 빌드 통과. 빌드의 기존 큰 chunk 안내는 남아 있다. 근거 `backups/automation-duplicate-build.log`, 하루단어 `work/card-duplicate-retry-build.log`.
- `review`: testing·maintainability·security·performance·data-migration 및 red-team·별도 적대적 검토. 준비창 문제1건과 revision2/동일설정 claim 회수 검증 누락2건을 반영하고 testing 재검토에서 모두 해결·새 지적0이다. 동일 모델 독립 문맥이며 적대적 검토의 테스트/fixture는 요약 모드였다. 기존 보조 CLI0.132/모델 비호환은 새 성공 검토로 집계하지 않는다.
- 최종 내보내기 파일129개·릴레이2개의 SHA256 및 화면 원본 SHA256을 대조했고, 중앙 출시 기록에 로컬 후보를 추가하면서 기존 모든 출시 필드를 그대로 보존했다. 양쪽 `git diff --check` 통과, package/lock/운영 구성/기존 Site 식별자·학습 DB 변경0이다. `backups/record-automation-duplicate-20261005.mjs`는 이 로컬 기록/검증만 수행한다.
- 추가 유료 구성0, 실제 AI/카카오 호출0, 운영 DB/배포/설정 변경0. 무료 구성 검사는 계정 청구나 현재 무료 자격의 재확인이 아니며 기존 사용자 확인만 유지한다. 다음은 승인 범위에서 암호화 백업/쓰기 차단 후 0018·호환 DO/화면 적용 및 별도 실제 검증이다. 기존5장 시험 미완료·새 수신4장/서버3건 차이·정규 비활성·후속 PAUSED를 그대로 유지한다.

## 21:23 예약 후속 점검 종료 — 2026-10-05

- 실제 재조회: trial 1/5·3/5·4/5 각1회 live 접수/PNG/독립 검토 확인, 2/5 duplicate·5/5 expired 유지. 세 현재 Worker 버전 모두 배포 근거와 일치, FK 오류0·진행 중 제작0·활성 예약0·전송 중/결과 불명0이다. 과거 blocked1건은 유지된다. 설정은 version20·enabled0·next_due_at NULL, 원래 설정 해시와 같다. 재개 조건 미충족이므로 `--apply`를 실행하지 않았다.
- CPU 재조회는 실제 기록 기준 UTC11:27:45.015~12:06:50.087이다. 주 Worker43·발송 Worker41·DO41요청, 다른 버전0·오류0·모든 반환 그룹 단일 요청/표본간격1/P50=P99였다. 그룹 P99 중 가장 큰 값은 주4.783ms·발송3.931ms·DO487.336ms로 이전 관측과 같다. 데이터셋 그룹 수를 실제 전체 호출의 완전성이나 미래 최댓값 보장으로 해석하지 않는다. 5장 성공 부하는 검증되지 않았다.
- 최초 재조회에서 PowerShell의 JSON 날짜 자동 변환으로 UTC가 제거되어 과거 시간대를 조회했다. 해당 결과는 판정에서 제외했고 명시적인 ISO UTC 인자로 다시 조회했다. Git 제외 측정 도구에 ISO UTC 입력 검증을 추가하고 지역 날짜 입력이 네트워크 호출 전에 거부되는 것을 확인했다.
- 사용자 확인인 **21:03 이후 서로 다른 새4장 수신·클릭 정상**은 보존한다. 서버3건과의 수량 차이는 원인 미확정이며 네 번째 수신 카드와 원본 기록의 연결이 남았다. 추가 생성·발송·배포·운영 데이터 수정 없이 점검했다. 정규 제작과 내일07:00 발송은 활성화하지 않았다. 기존 Free 구성·확인 조건은 유지하며 계정 플랜을 새로 조회한 것은 아니다.
- `en-card-5` 후속 작업을 요청대로 PAUSED로 갱신하고 실제 설정에서 확인했다. [최종 점검 근거](evidence/AI_AUTOMATION_MULTI_TRIAL_RESULT_2026-10-05.json)의 `followup` 및 Git 제외 `heartbeat-final-check.json`, `metrics-heartbeat-trial-utc.json`, `heartbeat-record-verification.json`을 따른다. 목표는 미완료이며 자동 반복 점검은 종료했다.

## 새 AI 다중 시험 — 2026-10-05 실제 결과와 수신 수량 차이

- 사용자 확인: 카드 4장 수신·클릭 정상이며, 후속 질문에도 **21:03 이후 새로 4장**, **네 장 모두 서로 다른 카드**라고 확인했다. 오전 카드를 포함한 확인이나 같은 카드의 중복 표시로 해석하지 않는다. 이번 PC 종료 여부는 확인하지 않았다.
- 서버 대조: trial 1/5·3/5·4/5만 21:04경 각 1회 live 접수·발송 완료다. 검토 해시·독립 제공자 검토 통과, 공개 1080 PNG와 이미지/카드 일치도 통과했다. 2/5는 duplicate로 제외됐다. 5/5는 작성 503 두 차례 뒤 재시도 성공·검토·PNG 준비까지 완료했지만 20:57:46 이미지 전파 대기 해제 후 다음 tick이 20:58 마감을 넘어서 expired다. 35분 최소 준비창은 이번 제공자 재시도까지 흡수하지 못했다.
- 수량 불일치: 당일 D1 발송/시도/예산은 오전1+trial3, 21:04 발송 Worker의 외부 요청 포함 그룹도3개다. 사용자가 확인한 새4장과 1건 차이가 있어 **원인 미확정**이다. 별도의 과거 blocked1건은 9월30일 기록으로 이번 trial과 연결되지 않는다. 새 발송·기록 초기화·재활성화는 하지 않았다.
- CPU: UTC11:27~12:13, 현재 배포 버전의 주 Worker50요청·발송 Worker47요청·DO48요청을 조회했다. 모든 반환 그룹은 단일 요청/표본간격1/P50=P99, 오류0, 다른 버전0이었다. 그룹 P99 중 가장 큰 값은 주4.783ms·발송3.931ms·DO487.336ms다. 일반 Worker 관측은 10ms 이내이나 미래 실행 보장이 아니며 **완성5장 부하 검증도 아니다**. 이미지 생성4·시험 실제 발송3 경로의 관측이다.
- 상태: version20·enabled0·reason complete·next_due_at NULL. 읽기 전용 재개 검사는 `five_live_acceptances_unconfirmed`와 기존 blocked 발송에 따른 `active_or_unresolved_work`로 거부했다. `--apply`·배포·새 AI/카카오 호출 없이 읽기와 문서만 수행했다. 기존 Free 구성과 확인 기록은 유지한다.
- 근거: [사용자·서버·CPU 결과](evidence/AI_AUTOMATION_MULTI_TRIAL_RESULT_2026-10-05.json), Git 제외 `receipt-audit.json`, `receipt-discrepancy.json`, `verify-receipt-confirmed.json`, `metrics-receipt-trial.json`. 21:23 기존 후속 확인에서 수신 차이·최종 상태를 재확인한다. **5장 목표는 미완료**다.

## 새 AI 5장 추가 시험 — 2026-10-05 등록, 실제 결과 대기

- 요청: 사용자는 준비된 카드 발송이 아닌 **새 AI 5장**을 확인했고, 20:38 대신 검증 후 오늘 가장 빠른 시각을 선택했다. 운영 trial 5개를 **20:28 KST 제작 → 21:03 KST 순차 발송**, 제작 마감 20:58로 등록했다. 설정 version 20이며 최초 등록 시 모두 draft·카드 번호 1~5·총수 5·동일 시각을 재조회했다. 등록 시점 기존 run/usage 동일, 새 AI/카카오 호출 0이다. 이후 자동 실행은 별도 결과로 확인한다.
- 코드: EN_Card `f70b1d4`, 하루단어 `755b880`, Site **v118**, 게시 소스 `835efb82983d1cbd77339fb12356c128eeac87c8`이다. 게시 소스의 전체 tree가 하루단어 후보와 같다. 기존 Site·환경 revision 59·공개 범위를 유지했다. 본 단계에서는 GitHub push/PR을 하지 않았다.
- 데이터: 유지보수 동안 쓰기/Cron 중지 → D1 SQL DPAPI 암호화/제한 ACL/복호화 해시 일치/평문 제거 → 0017 → 기존 모든 데이터 테이블 행 해시·FK 오류 0을 확인했다. 부모 run ID·AI 시도/표현 참조·과거 단일/다중 수량을 보존한다. DO·주 Worker를 갱신했고 발송 Worker는 그대로다. 최종 바인딩·Cron 일치, 공개 source manifest/JS 해시 일치와 비인증 자동화 API 401을 확인했다.
- 검증: 기존 제품/수량 70개, 최종 신규 시험 11개+실제 로컬 DO PNG/API 1개, Chromium/WebKit 2개, 하루단어 프록시/릴레이 19개·타입·빌드·무료 구성. 0017은 기존 daily 5개와 trial 1개 및 자식 테이블 보존을 별도로 재현했다. 실제 D1 관리자 API의 batch는 격리 임시 테이블의 두 번째 INSERT를 실패시켜 첫 INSERT도 0행인 것을 확인하고 테이블을 제거했다. 기존 데이터·AI·카카오를 장애주입 대상으로 쓰지 않았다.
- `review`: 세 독립 검토에서 동일한 준비창 문제를 찾았다. 렌더 종료 후 2분 대기가 분 경계를 넘는 경우를 반영해 5장 실제 준비창을 25→30분으로 고쳤다. 렌더 1초 경과·고정 분 단위 Cron 회귀가 통과했다. 최종 인증/DB 함수 분리도 재검토했다. 보조 Codex CLI는 설치 버전이 현재 모델을 지원하지 않아 실패했으므로 교차 모델 성공으로 기록하지 않는다.
- 초기 검증 실패: 신규 fixture의 필수 만료값 누락을 수정한 뒤 11개 재통과, 중복 baseline 실행 중단 뒤 순차 70개 통과, 화면 PATH/접근성 이름/중복 텍스트 선택자를 수정한 뒤 두 브라우저 통과. Sites는 별도 깨끗한 소스 checkout·개별 의존성 설치·Git Bash·`TAR_OPTIONS=--force-local`로 Windows 빌드/패키징 오류를 해결했다. 원격 게시 전 성공한 산출물만 사용했다.
- 원래 매일 07:00·1장 설정 원문은 암호화 백업과 일치하게 되돌린 뒤 시험을 등록했다. 시험의 next_due_at은 NULL이다. 후속 `en-card-5`는 **오늘 21:23 KST, 1회 ACTIVE**다. 5장 live 접수·진행 중/결과 불명 없음·version 20과 원문 해시 일치일 때만 정규 운영을 재개한다. 정상 다음 시각은 10월 6일 07:00이며 오늘 trial을 정규 날짜로 소비하지 않는다. 아직 재개하지 않았다.

등록 직후 검증은 제작/접수 전이므로 `serverEvidenceVerified=false`였다. `resume-original.mjs`도 발송 시각 전·5장 접수 미확정·진행 중을 이유로 적용을 거부했다. 첫 읽기 쿼리의 복수 문장 바인딩 오류를 분리 쿼리로 수정하고 이 거부 결과를 다시 확인했다.

20:37 KST 읽기 검증에서는 1/5가 실제 작성·교차 검토·공개 1080 PNG(48,213바이트, HTTP 200)·예약까지 완료됐고, 2/5는 작성 1회 뒤 `duplicate`로 제외됐다. 3/5는 렌더 대기, 나머지 둘은 초안 대기였다. 현재 엔진은 중복 결과를 재작성하지 않고 해당 카드만 건너뛴다. 따라서 **이번 시험의 5장 전체 성공은 미달**이며 남은 카드의 실제 발송 결과를 따로 확인한다. 기록을 초기화하거나 제외된 슬롯을 수동 재활성화하지 않았다. 읽기용 Cloudflare OAuth 만료 401은 기존 Wrangler 갱신 후 해결했다. 근거는 `verify-preparation-progress.json`과 `preparation-state.json`이다. **실제 휴대전화 수신과 부하 CPU는 미검증**이며 모의 성공이나 과거 1장 수신으로 대체하지 않는다.

후속 명령: `node backups/automation-multi-trial-20261005/verify-five.mjs 2026-10-05 5 scheduled-trial`, 실제 실행 구간의 `metrics.mjs`, `node backups/automation-multi-trial-20261005/resume-original.mjs`(읽기 전용). 조건 통과 후에만 같은 도구에 `--apply`를 추가한다. 원자료는 Git 제외 `backups/automation-multi-trial-20261005/`, 공통 출시 근거는 하루단어 `docs/releases/2026-10-05-automation-multi-trial.json`이다.

## 20:38 시험 변경 요청과 이전 시험 중지 — 2026-10-05 19:45 KST

- 오늘 20:38 KST 요청에 따라 이전 10월 6일 00:00 시험을 중지했다. 기존 version 17·설정 해시·다음 시각 일치, 제작 시작 전, 활성 제작/예약·진행 중/결과 불명 없음 조건으로 version 18·enabled 0·reason paused를 저장하고 재조회했다. 기존 run/usage는 동일하며 신규 AI/카카오 호출 0이다.
- 후속 확인 `en-card-5`를 PAUSED로 갱신하고 실제 automation.toml 상태를 확인했다. 원래 매일 07:00·1장 설정의 암호화 백업은 보존했다. 현재는 정상 운영도 재개하지 않은 일시정지 상태다.
- `run-queue.ts`와 0016은 첫 정규 묶음의 날짜·수량·버전 고정을 유지하고, `trial.ts`와 0016은 추가 시험을 1장으로 제한한다. 따라서 오늘의 정규 기록을 수정해 새 5장을 만들지 않았다. 사용자에게 20:38에 준비된 5장 발송 또는 새 AI 1장 시험, 별도 새 AI 다중 시험 확장 중 범위를 확인했다. **대체 예약은 아직 미등록이며 실제 다중 검증도 미완료다.**
- 중지 근거는 Git 제외 `backups/automation-quantity-rollout-20261005/superseded-test-paused.json`이다. 아래 자정 등록과 00:20 확인은 중지 전 기록이며 실행 지시로 사용하지 않는다. 이후 선택에 맞춰 시험·후속 확인·복구 조건을 갱신해야 한다. 기존 복구 도구는 version 17만 허용하므로 현재 version 18에서는 적용하지 않는다.

## 빠른 5장 시험 등록 — 2026-10-05

- 사용자 승인: 테스트를 위해 빠른 시간으로 진행. 운영 첫 일일 run이 날짜별 수량을 고정하므로 이미 1장을 실행한 10월 5일을 보충하지 않고 가장 빠른 미사용 날짜 **10월 6일 00:00 KST**를 선택했다. 정규 제작 1시간 전 정책에 따라 준비는 10월 5일 23:00 KST다. 5장·시작/종료일 10월 6일로 한 번만 실행한다.
- 기존 설정 version 16 원문을 DPAPI CurrentUser로 암호화하고 제한된 ACL·복호화 SHA-256 일치를 확인했다. Windows PowerShell 5의 모듈 로딩 실패는 기존 번들 PowerShell로 해결했다. 이 최초 실패에서는 DB 설정을 변경하지 않았고 평문 파일도 만들지 않았다.
- 실제 앱 스키마와 `nextAutomationDue`로 검증한 뒤, 기존 설정/버전/다음 시각 일치·연결된 카카오·같은 날짜 제작 없음·활성 제작/예약/미해결 발송 없음 조건으로 version 17을 저장했다. 재조회 결과 5장·00:00·당일 종료·enabled=1, 이전 run/usage 동일, 신규 AI/카카오 호출 0이다. UI 조작 검증으로 표시하지 않는다.
- `backups/automation-quantity-rollout-20261005/fast-test-registration.json`에 등록 증거, `before-fast-test-settings.dpapi`에 복구 원문을 보관한다. `restore-existing-after-test.mjs`의 기본 읽기 검사에서는 아직 실행 시각 전·일일 묶음 미생성·5장 접수 미확정으로 복구를 거부했다. `--apply`는 실제 조건이 맞을 때만 허용하며 이후 사용자 설정과 기록을 덮어쓰지 않는다.
- 이 채팅의 후속 확인 `en-card-5`를 **10월 6일 00:20 KST, 1회**로 등록하고 ACTIVE·대상 채팅·시각·1회 조건을 확인했다. 카드별 live 접수와 부하 CPU·실제 휴대전화 수신을 구분하며 실패/결과 불명은 자동 재발송하지 않는다. 정상 복구 시 이미 소비한 10월 6일을 건너뛰어 다음 기존 1장은 **10월 7일 07:00 KST**다.

아직 실제 새 AI/PNG/발송·여러 장 휴대전화 수신·부하 CPU는 완료 전이다. 다음 확인은 `node backups/automation-quantity-rollout-20261005/verify-multiple.mjs 2026-10-06 5 fast-test`와 제작/발송 구간의 `metrics.mjs`다. 추가 배포나 마이그레이션은 필요 없다.

## 수량 확장 운영 반영 — 2026-10-05

- 암호화 D1 백업의 복호화 SHA-256 일치·접근 권한 제한·평문 제거를 확인했다. 유지보수 Worker와 Cron 중단으로 쓰기를 멈춘 뒤 기존 0016 SQL을 적용했다. 이전 18개 데이터 테이블의 원래 열/행 해시 일치, 과거 run의 번호/수량 1, 이력 16개, FK 오류 0을 확인했다. 원자료는 Git 제외 `backups/automation-quantity-rollout-20261005/`다.
- 수량 지원 DO·발송 Worker·주 Worker를 배포하고 세 버전 모두 100% 적용을 읽었다. 바인딩·Secret 이름·live/free_only 설정·매분 Cron 1개는 보존했다. 기존 학습 사이트는 **v117**, 환경 59·공개 정책 4다. Sites helper 게시 커밋 `b718f538d1ff10ed4bc1c05effb4458f3a1e21a5`의 추적 트리가 GitHub 제품 기준 `85a2fba`와 일치한다.
- `npm run build`, 운영 설정 3개 dry-run, `npm run check:free -- --config wrangler.live.jsonc --delivery-config wrangler.delivery.deploy.jsonc --automation-config wrangler.automation.live.jsonc --mode live --automation-active`, 하루단어 Sites 정식 빌드·패키징이 통과했다. Windows 설치 npm shim/Bash 선택 오류는 기존 절대 npm/Git Bash 경로로 해결했다. 플러그인·잠금 파일·전역 실행 환경은 수정하지 않았다.
- 게시된 source manifest와 JS는 로컬 SHA-256과 일치한다. `index.html`은 정규 `/card-studio/`로 307 이동하고, HTML에 삽입된 Cloudflare 스크립트 1개를 제외한 내용이 원본과 일치했다. HTML 원시 바이트 동일성으로 기록하지 않는다. 비로그인 Site 프록시·Worker 자동화 API는 각각 401이다.
- 09:43–09:53 UTC 대기 관측은 새 버전 Worker/DO의 오류 0이다. 적응형 집계이며 실제 다중 제작·발송 CPU 검증이 아니다. 신규 AI 호출 0·카카오 발송 0, 과거 run/usage 보존이다. 로그인 브라우저·실제 iPhone·여러 장 수신은 아직 미검증이다.
- 배포용 일시정지(version 15)를 마치고 기존 매일 07:00·1장 운영을 재개(version 16)했다. 현재 설정을 실제 앱 스키마로 검증하고 다음 예정 시각이 그대로 10월 6일 07:00 KST인지 계산했다. 기존 D1 관리 권한으로 설정 원문·버전·다음 시각 일치, 카카오 연결, 제작/활성 예약/진행 중·결과 불명 발송 없음 조건을 원자적 UPDATE에 넣었다. 설정 원문·과거 run/usage는 변경하지 않았다. 브라우저 조작으로 기록하거나 새 인증 우회를 추가하지 않았다.
- 오늘 기록을 수정하지 않고 다음 날짜 시험을 설정할 시각·이후 수량 선택이 남았다. 여러 장 시험은 아직 등록하지 않았다. 등록 후 실제 AI/교차 검토/PNG/예약, 현재 버전의 부하 CPU와 카드별 API 접수, 사용자 휴대전화의 이미지·원본 링크를 각각 확인한다. 운영 예전 DO로 단순 rollback하지 않고 **0016 호환 코드**로만 복구한다.

로컬 재현: `npm run build`, `npm run check:free`. 이미 적용한 원격 0016이나 배포를 검증 목적으로 반복하지 않는다. 배포 상태의 단일 기준은 하루단어 `docs/releases/product-status.json`과 `2026-10-05-automation-quantity-rollout.json`이다. 아래는 이전 시점 기록이다.

### 여러 장 실제 검증 준비 — 2026-10-05 19:10 KST

`backups/automation-quantity-rollout-20261005/verify-multiple.mjs`는 지정 날짜의 고정 수량/번호/버전/발송 시각, 작성·최종 교차 검토, 카드·이미지 버전, 카드별 live 접수 1건, 완료 예약과 미해결 발송, 공개 1080 PNG를 읽기 전용으로 대조한다. 기존 10월 5일의 실제 1장을 예상 5장과 비교해 `serverEvidenceVerified=false`를 확인했다. 기존 성공 한 장을 새 다중 시험 통과로 인정하지 않으며 실제 휴대전화 확인과 CPU는 별도 미검증으로 남긴다.

실행 예시는 `node backups/automation-quantity-rollout-20261005/verify-multiple.mjs 2026-10-06 5 multi-day`다. 날짜·수량은 실제 등록한 시험과 일치해야 하며 이 명령은 제작·예약·발송하지 않는다. 아직 10월 6일 다중 시험을 등록한 것은 아니다.

CPU 도구는 운영 GraphQL 스키마에서 microseconds 단위를 확인하고 1,000으로 나눈다. 15분의 겹치지 않는 구간으로 조회하고 행 상한 도달 시 중단하며, 다른 배포 버전·샘플링과 표본 없음(`null`)을 기록한다. 09:43–09:53 UTC 대기 관측의 가장 높은 그룹 P99는 주 Worker 2.544ms·발송 Worker 1.799ms·DO 1.951ms다. 이것은 **다중 부하 검증이나 전체 요청 최댓값이 아니다.** 집계 CPU와 호출 오류를 따로 확인한다. [공식 GraphQL 조회](https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-workers-metrics/)와 [CPU 표본·분위수 설명](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/#cpu-time-per-execution)을 기준으로 해석한다.

**2026-10-04 UI 개선 검증:** 웹·아이폰을 위한 `codex/card-studio-responsive-ui`의 최종 전체 E2E60/60, Site 프록시/릴레이15/15, 타입·웹/Worker/Site 빌드·기본/live 무료 구성 검사 통과. 화면 폭375/390/430/768/1440·844×390 회전·초안/실행 상태 구분을 확인했다. 모의 API와 로컬 PNG 결과이며 새 실제 AI/발송 시험은 아니다. Site v114/주 Worker 게시 성공·운영 자산 일치·로그인 UI·14개 테이블 해시 보존을 확인했다. 실제 iPhone·Windows WebKit 가변 폰트 및 계정 플랜 재확인 한계는 [상세 결과](UI_RESPONSIVE_2026-10-04.md), 정확한 버전/행 수는 [기계 판독 근거](evidence/UI_RESPONSIVE_2026-10-04.json)에 기록했다.

**2026-10-04 16:19 KST review 수정본 커밋·운영 반영:** `e088d61`을 커밋하고 DO→발송→주 Worker 및 하루단어 Site v113(소스 `22c2da2`)에 반영했다. 실제 live 설정의 세 Worker dry-run/무료 구성, Site 연동15개·타입·빌드, 공개 PNG/원본200·동일 해시·비인증 자동화401을 확인했다. 운영14개 주요 테이블의 행 수·해시, Secret 이름/바인딩/Cron, Site 공개 범위·환경 revision59를 보존했다. 화면도 **실행 중·10월5일07:00 제작·08:00 발송·당일 종료**를 확인했다. 추가 AI/카카오 시도·새 자원·마이그레이션0이다. 무료 계정 확인은 기존 기록을 유지하며 오늘 구독 API403·웹 로그인 만료로 재확인하지 못했다. 이 단계에서 새 코드의 실제 제작/발송 CPU나 내일 수신은 검증하지 않았다. [배포·보존 근거](evidence/AI_AUTOMATION_REVIEW_DEPLOY_2026-10-04.json). 아래 기록은 각 시점의 상태다.

**2026-10-04 15:52 KST review 후속(로컬):** 초기 전체 Vitest576개 후 변경부 제품/구성58개·인증/경합115개·복구/갱신/RPC67개를 재검증했고 최종 Playwright54/54가 통과했다. 각 집합은 중복되어 합산하지 않는다. 연결 해제/재연결과 늦은 AI 응답, 오래된 화면 조회, 운영 설정 인수 누락을 실패 테스트로 확인한 뒤 수정했다. 빌드/타입/무료 구성과 독립 fixture Site export는 통과했다. 실제 AI·카카오·운영 배포·미래 예약은 변경하지 않았다. 초기 E2E1건의 시간 초과, 잘못 준비한 인증 fixture3건, 동일 저장소 반복의 중복 제목2건은 [리뷰 기록](AI_CARD_AUTOMATION_REVIEW.md)에 실패와 재검증을 구분했다. CLI는 모델/설치 버전 불일치로 실행 실패했으므로 교차 모델 gate 통과가 아니다.

**2026-10-04 14:56 KST 다음 자동 제작 활성화:** 사용자 요청에 따라 저장된 영화 대사·초급·표현형·10월5일 하루 설정을 그대로 시작했다. 화면의 실행 중/다음 시각과 D1 enabled1·version6을 확인했다. **2026-10-05 07:00 KST부터 제작, 08:00 KST 발송 예정**이며 종료일은10월5일이다. 추가 AI/발송은 아직0회, 코드/배포 변경은 없다. 다음 제작·수신은 미래 작업으로 미실행이다. [활성화 근거](evidence/AI_AUTOMATION_NEXT_2026-10-05.json). 아래 비활성 표시는 이전 시점 상태다.

**2026-10-04 14:48 KST 남은 실제 토큰 갱신 검증 완료:** 기존 비공개 DO에서 카카오 토큰을 실제 갱신했고 version12→13·연결 정상·오류/잠금0을 확인했다. CPU는 실제 운영 갱신 DO **6.054ms**, 별도 검증용 주 Worker **2.250ms**다. 검증용 수치는 정상 예약 엔진 전체 갱신 회차의 CPU가 아니다. 기존 운영 버전/바인딩/Secret 이름/Cron을 복원·대조하고 인증 외18개 테이블의 행 수·해시를 보존했다. 추가 AI·카카오 메시지0회, 신규 유료 구성0개다. 관련59검증·타입·dry-run·무료 구성·review 후속 검증을 통과했다. 현재 자동 제작은 비활성이며 아래 미검증 표시는 각 이전 시점 기록이다. [실제 갱신·CPU·복원 근거](evidence/AI_TOKEN_REFRESH_VERIFICATION_2026-10-04.json).

**2026-10-04 14:14 KST 무인 제작·수신 확인:** 사용자가 PC·브라우저·Codex 종료 후 새 카드 제작과 휴대전화 이미지·원본 링크 확인 요청에 “정상 통과했다.”고 응답했다. 사용자 수행 확인으로 기록하며 기기 종료나 휴대전화를 에이전트가 직접 관찰한 것은 아니다. 서버에서 Gemini 작성13:46:20.914 → Groq 검토13:47:20.939 → 1080 PNG13:48:21.785 → 예약13:50:36.557 → live 발송1회·접수14:01:12.578을 대조했다. 카드 `What happens next?`, AI2회·재시도0·PNG64,621바이트이며14:01:38.362에 자동 종료됐다. 활성예약/미해결/FK0, 기존 기록·저장된 일일 설정·배포/Secret/무료 구성은 보존됐다. 다음 자동 제작은 비활성이다. 실제 발송 CPU는 주 Worker4.269ms·발송 Worker3.787ms·유효 토큰 DO RPC3.487ms, DO 이미지 생성404.606ms다. 이번 관측 구간 일반 Worker 표본은10ms 미만이지만 미래 최댓값 보장은 아니다. **새 RPC의 실제 토큰 갱신 CPU만 별도 미검증**이며 credential version12가 유지되어 이번에는 갱신이 없었다. [사용자·서버·CPU 근거](evidence/AI_AUTOMATION_TRIAL_2026-10-04.json). 아래 기록은 이전 시점 상태다.


**2026-10-04 추가 한 장 시험 등록:** 사용자의 오늘 새 카드 시험 요청에 따라 기존 하루 한 장과 별도인 KST 하루 한 번 시험을 구현·배포했다. 기존 데이터 보존·암호화 백업·0015·DO/주 Worker·Site v112 적용을 확인했다. 저장된 일일 설정은 유지하며 시험만 영화 대사/초급/표현형으로 2026-10-04 13:46 KST 제작 시작, 2026-10-04 14:01 KST 발송 예정이다. 새 run은 draft·내용 null·AI 시도0이며 미래 일일 제작 next_due_at=null이다. 기존 카드15·이미지6·정규 AI1건·발송 이력은 그대로다. 제품35·런타임/구성44·Site15·브라우저2개와 타입/빌드/무료구성/review를 통과했다. 실제 새 AI/카카오 호출과 PC 종료 검증은 아직 완료가 아니다. [등록·보존 근거](evidence/AI_AUTOMATION_TRIAL_2026-10-04.json). 아래 기록은 이전 시점 상태다.


## 갱신 CPU 사후 확인·DO 분리 반영 — 2026-10-04 12:50 KST

- 첫 시험의 발송 구간을 Cloudflare `workersInvocationsAdaptive`로 읽었다. API introspection으로 CPU 단위가 microseconds임을 확인하고 1,000으로 나눴다. 기존 주 Worker 버전의 10:45:25 갱신 tick은 요청1개·sampleInterval1·P50/P99 **14.004ms**, success였다. 10:46:25 발송 tick은4.776ms다. 발송 Worker의 같은 초 요청2개는P50 1.376/P99 4.890ms이며 개별 호출 최대값으로 해석하지 않는다. 수신 성공과 CPU 한도 적합성을 분리한다. [사후 원자료를 추가한 첫 시험 근거](evidence/AI_AUTOMATION_LIVE_2026-10-04.json).
- 인증 조회/갱신을 기존 비공개 SQLite DO `credentials` RPC로 옮겼다. 기존 D1 잠금/버전/오류 분류·갱신 후 다음 Cron 발송을 재사용하고 RPC 실패 후 로컬 갱신 우회를 금지했다. 입력/모드 차단, 오류 속성 복원, 응답 유실 전후 복구, 갱신 중 취소, 중복 실행, AI off에서도 수동 발송, 토큰 회전을 검증했다. 실제 workerd RPC 경계를 사용하는 테스트의 제공사 응답은 **모의**다.
- 검증: 인증/복구/자동화/실제 RPC 6파일116개, 입력 차단9개, 구성14개로 **8파일139개 통과**. `npm run build`의 타입·웹·주/발송/DO dry-run, 기본 및 실제 운영파일의 `check:free`, diff 검사를 통과했다. 독립 리뷰의 입력 차단 테스트 누락과 AI off/발송 모드 충돌을 수정했다. [리뷰 기록](AI_CARD_AUTOMATION_REVIEW.md#인증-cpu-분리-후속--2026-10-04).
- 실제 배포: DO `74a8c2ea-4bd7-49a7-9bf2-6c0a4769f24b` 먼저, 주 Worker `0dbb9b9b-c617-47ac-bb78-2e4022f624b2` 다음. 관리 API로 각각100% 적용을 확인했다. 발송 Worker 버전·D1/KV·Secrets 이름·일반 설정·Cron1개를 보존했다. 카드15·ready이미지6·AI시도2·활성예약0·미해결0·FK0·인증version12·당일발송1회가 그대로다. 이번 단계의 새 실제 AI/카카오 호출0회, D1 마이그레이션0회다.
- 배포 후 공개화면200, 기존 PNG200/image/png·48,869바이트·기존 해시 일치, 비인증 자동화 API401을 확인했다. 토큰 RPC는 HTTP 경로가 아니며 로컬 실제 DO/public worker HTTP 검증은404였다. 주 Worker의 임의 비API 경로는 기존 SPA HTML fallback을 반환한다. 새 버전의12:47~12:49 대기 Cron3개는success·CPU1.453~1.906ms, 발송 Worker 준비2개는1.478/2.371ms다. **이는 실제 인증 갱신/발송 CPU 재검증이 아니다.**
- 무료 구성은 기존 확인된 Workers/SQLite DO/D1/KV 및 Google/Groq Free를 유지했다. 마지막 계정 화면 확인은 Workers10월3일20:19전후, Google/Groq10월4일02:24전후다. 이번 구독 API 조회는403으로 계정 요금제를 새로 확인하지 못했다. 유료 상품·새Secret·로그 수집 상품은 추가하지 않았다.
- 다음 승인 시험 후보는10월5일07:00새제작·08:00본인발송·시작/종료일10월5일·1장이다. 그러나 브라우저 inventory가 비었고 Chrome/IAB 생성도 불가해 **예약/자동화 설정은 아직 변경하지 않았다.** 사용자가 연결된 Chrome을 열기를 요청했다. PC 종료부터 새 제작, 새 버전 실제 갱신/발송 CPU는 미완료다. [이번 변경·배포·보존 근거](evidence/AI_TOKEN_RPC_2026-10-04.json).

로컬 재현: `npx vitest run tests/refresh-cpu.test.ts tests/token-rpc-runtime.test.mjs tests/token-rpc-guards.test.ts tests/token-recovery.test.ts tests/auth.test.ts tests/automation-product.test.ts tests/automation-product-do.test.mjs tests/free-config.test.ts`, `npm run build`, `npm run check:free`. 추가 배포는 필요 없으며 다음은 브라우저에서 시험을 설정하는 단계다. CPU 해석은 [Workers GraphQL 예시](https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-workers-metrics/)와 [Workers 샘플링 설명](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/), RPC/DO 실행 환경은 [DO 메서드](https://developers.cloudflare.com/durable-objects/api/base/)와 [DO 제한](https://developers.cloudflare.com/durable-objects/platform/limits/)을 확인했다.

## 1장 실제 수신·시험 종료 확인 — 2026-10-04 10:53 KST

- 사용자는 직전의 PC·브라우저·Codex 종료 후 휴대전화 이미지와 원본 링크 확인 요청을 선택해 **“정상 동작 확인했다.”**고 답했다. PC 종료 상태의 카카오 수신·휴대전화 이미지·원본 링크 정상 동작을 **사용자 수행 확인**으로 기록한다.
- 10:53:32 읽기 전용 D1 대조: 해당 예약의 발송 1개가 `mode=live,state=sent,attempts=1`이며 실제 호출 이력도 1개·outcome=sent다. 예정 10:45:00 KST, 실제 호출 10:46:25.761·접수 저장 10:46:26.900 KST다. 자동 재시도·추가 메시지는 없었다.
- 1회 예약은 `enabled=0,reason=completed,cursor=1,next_run_at_utc=null`, 자동화는 10:47:25.198에 `enabled=0,reason=complete,next_due_at=null`로 종료됐다. 전체 활성 예약 0·처리 중/미해결 unknown 0·FK 오류 0. 카드 15·ready 이미지 6·AI 시도 2·일일 업로드 1·발송 시도 1·저장량 451,155바이트다. 기존 과거 blocked 이력은 변경하지 않았다.
- 주/발송/DO 버전·설정·Secret 이름·Cron 1개는 시험 전과 같고 free_only·확인된 Google/Groq Free 구성을 유지했다. 이 단계에서는 계정 요금 화면을 다시 확인하거나 새 배포·AI·카카오 호출·예약 변경을 수행하지 않았다. 최초 관리 조회 401은 기존 Wrangler OAuth 갱신 완료 후 복구했다.
- [실제 근거](evidence/AI_AUTOMATION_LIVE_2026-10-04.json)에 서버 발송/자동 종료 스냅샷과 사용자 확인의 출처·범위를 분리했다. 기록 생성기의 1회 발송·sent·기간 종료·배포 불변·PNG/교차 검토/CPU assertion을 통과했다. 제품 코드 변경이 없어 기존 단위/E2E는 반복하지 않았다.
- **검증 경계:** PC 종료 중 예약 발송은 확인됐지만 이 카드의 AI 제작은 PC가 켜져 있을 때 수행했다. PC 종료부터 새 AI 제작·검토·PNG까지의 별도 시험은 미실시다. 이번 카카오 발송 구간의 CPU 로그도 수집하지 않았으며, 기존 제작 4단계의 8개 로그로 대체하지 않는다. 새 실제 시험/반복 운영은 시작하지 않았다.
- 다음 서버 상태 읽기: `node backups/automation-live-20261004/progress.mjs`. 이번 확인을 위한 추가 배포 명령·설정 입력은 없다.

## 실제 1장 제작·검토·예약 — 2026-10-04 09:54 KST

- 사용자 승인 범위: 초급 일상 회화 표현형1장, 당일 종료, 본인 카카오 시험. 사이트에서 시작/종료일 `2026-10-04`·시각 `10:45`를 저장하고 시작을 한 번 실행했다. 설정version2이며 날짜별 실행1개, 예약1개다.
- 09:45 Gemini `gemini-3.1-flash-lite` 작성1회 성공,09:46 Groq `openai/gpt-oss-120b` 검토1회 성공. 표현 `How's it going?`, 의미·문법·번역 등을 포함한6항목true·issues0, 수정본1의 내용/승인 해시 일치. 모의 응답이 아니며 수정/역할 전환/재시도는 발생하지 않았다.
- 09:47 비공개DO에서1080×1080 PNG48,869바이트를 생성·KV 저장했다. 실제 공개 이미지 HTTP200·image/png, 한영 글자/여백을 직접 열어 확인했다. SHA256 `65e6d5135365564fc8a2259759376969ff97c795a2e0e27f4f580446425432ab`. 사이트의 PNG 다운로드 버튼도 같은 파일을 저장했다. 브라우저 도구의 download 이벤트 대기는 시간 초과했으나09:48:12에 저장된 `AI-2026-10-04.png`의 크기·해시가 원본과 같음을 파일로 확인했다.
- 이미지 저장179초 뒤09:50:25에 기존 예약 엔진의1회·1장 예약을 만들었다. `10:45 Asia/Seoul`과 `2026-10-04T01:45:00Z`가 일치한다. 화면 새로고침 후 활성1·예약 중·남은 목록1장을 확인했다. 자동화 종료일10월4일 및next_due_at=null이므로 다음 날 생성하지 않는다. 현재 설정enabled1은 이번 예약의 발송을 허용하기 위해 유지된다.

| 실제 단계 | 주 Worker CPU | SQLite DO CPU |
| --- | ---: | ---: |
| 작성 | 2ms | 11ms |
| 교차 검토 | 2ms | 7ms |
| PNG·저장 | 2ms | 505ms |
| 예약 등록 | 2ms | 4ms |

- 위8이벤트를 모두 확보했고ok·예외0·예상 버전 일치다. DO CPU와 일반 Worker10ms 한도를 구별한다. PNG DO의wall2219ms는CPU505ms와 다른 값이다. 사용자 화면/API·Site·향후 카카오 발송의 전체 CPU를 이8개로 증명하지 않는다. Site 최근20분 오류 조회는0건이었다.
- 09:51:40 사후 읽기: 카드15·ready이미지6·활성 예약1·미해결0·자동화 설정1/작업1/AI시도2/표현1·FK0. 일일 업로드1·발송 시도0, 전체 저장량451,155바이트. 주/발송/DO 버전·Secret 이름·기존Cron1개는 사전과 같다. 새 배포·유료 구성 변경·추가 AI 호출은 없다. 수집기는09:53 KST에 명시적으로 종료했고 해당 프로세스 종료를 확인했다.
- [검증 데이터와 CPU 원자료](evidence/AI_AUTOMATION_LIVE_2026-10-04.json). Git 제외`backups/automation-live-20261004/`에 사전/사후 조회·단계별 스냅샷·PNG·시작/예약 화면을 보존했다. 기록 생성기의 날짜/1장/교차 검토/PNG/버전/CPU 대조 assertion을 통과했다. 제품 코드를 수정하지 않았으므로 기존 단위/E2E 테스트는 반복하지 않았다.
- **남음:**10:45 이후 카카오API 접수·휴대전화의 이미지/원본·PC 종료 상태 수신 확인. 이번 제작 중PC가 켜져 있었으므로 PC 종료 상태의새 AI 제작은 별도 미검증이다. 첫1장 수신 확인 전에 다음 실제 시험을 임의로 추가하지 않는다. 조회 재현: `node backups/automation-live-20261004/progress.mjs`(읽기 전용). 추가 배포 명령은 필요 없다.

## 무료 키 확인 후 서버 활성 구성 — 2026-10-04 02:54 KST

- 사용자 “두 개가 맞다.”는 직전 질문의 Google `TESLA-TePilot`·Groq `하루영어`가 기존 Site Secret이라는 동일성 확인이다. 제공사 Free 화면 확인과 사용자 진술을 각각 근거로 기록했으며 키 원문은 조회·복사하지 않았다.
- 초기 Cloudflare 관리 조회401은 `wrangler whoami`의 기존 OAuth 갱신 뒤 성공했다. 추가 권한이나 새 Secret을 만들지 않았다. 사전 DB 조회에서 자동화4테이블·활성 예약·전송 중/미해결0을 확인한 뒤 DO만 배포했다.
- Git 제외 `wrangler.automation.live.jsonc`의 `SEND_MODE=live`, `AUTOMATION_MODE=live`, `AI_FREE_CONFIRMED=google_groq_free`를 설정했다. 이전 off 설정은 `backups/automation-activation-20261004/wrangler.automation.off.jsonc`에 보존했다. 추적되는 기본 설정의 off/dry_run/unconfirmed는 유지한다.
- `npm run check:free -- --config wrangler.live.jsonc --delivery-config wrangler.delivery.deploy.jsonc --mode live --automation-config wrangler.automation.live.jsonc --automation-active` 및 DO deploy dry-run 통과. 실제 DO `9b97ba69-b7f3-4bb5-bcc4-251b86956e7f`100%, private·추가Cron0. startup76ms는 호출 CPU가 아니다.
- 실제 상태 조회에서 `configured:true, available:true`, DO CPU6ms·wall5105ms·ok·예외0을 확보했다. 사이트 화면의 무료 설정 미준비 문구가 사라졌다. 저장된 자동화 설정이 없어서 시작 버튼은 아직 비활성이며 설정 저장 후 사용할 수 있다. 이는 제공사 생성 성공이 아닌 연결·설정 준비 검증이다.
- 02:53 KST 사후 조회: 카드14·준비 이미지5·활성 예약0·미해결0·자동화4테이블0행·FK0. 주/발송 Worker 버전·주 Cron1개·Secret 이름은 사전과 같다. AI/카카오 호출0, Site 재게시0, 제품 코드 변경0이므로 기존 코드 테스트는 재실행하지 않았다. 실제 시험1장 범위는 사용자 선택 대기다.
- [활성 구성·실측 근거](evidence/AI_AUTOMATION_ACTIVATION_2026-10-04.json): 운영 설정 해시·버전·DB 집계·실제 준비 응답. 02:55 KST 수집기를 정상 종료했다.

## 실제 무료 API 계정 확인 — 2026-10-04 02:27 KST

- 사용자 `확인 진행` 요청으로 로그인된 제공사 계정 화면을 읽었다. Google AI Studio API 키 목록에서 `TESLA-TePilot`이 `Default Gemini Project` (`gen-lang-client-0890699099`)의 **무료 등급** 행에 속한다. 키 표시/복사 버튼은 누르지 않았다.
- Groq API Keys에서 `하루영어`가 `Personal / Default Project`에 속하는 것을 확인하고 같은 조직의 Billing → Plans에서 **Free / $0 / Current Plan**을 확인했다. Upgrade·계정 설정·키 생성/변경은 수행하지 않았다.
- Sites 환경 메타데이터 revision59의 `google_api`·`groq_api` Secret 등록과 `google_ai_enabled=true`를 확인했다. Secret 값은 가려져 있어 제공사에서 본 두 키와 동일한지는 확인하지 못했다. 사용자에게 이름을 대조한 동일성 질문을 남겼으며 진행 승인 자체를 무료 키 소속 확인으로 해석하지 않았다.
- 코드/원격 설정/배포 변경0, AI 생성·카카오 호출0. 문서만 갱신하여 테스트 재실행은 하지 않았다. 자동 제작은 off/unconfirmed이며 실제 키 유효성·전체 제작·수신은 미검증이다. [기계 판독 근거](evidence/AI_API_FREE_ACCOUNT_2026-10-04.json).

## 실제 Site 연결 사전 점검 — 2026-10-03 22:15 KST

- `src/automation/relay-client.ts`, `worker.ts`: off 상태에서도 AI 호출·DB 쓰기 없는 signed status를 실행하며 자동 시작 차단은 유지한다. 로그에는 고정 이벤트/오류 코드·HTTP 상태·boolean만 남긴다.
- 최초 운영 연결 실패는 `httpStatus:null, code:unavailable`였다. 새로운 `tests/automation-relay-runtime.test.mjs`에서 실제 workerd가 `redirect: 'error'`를 거부함을 재현했다. Node 모의 fetch에서는 드러나지 않았다. relay와 Google/Groq provider를 `manual`로 바꾸고 3xx를 따라가지 않도록 했다.
- `npx vitest run tests/automation-relay-runtime.test.mjs tests/automation-relay.test.ts tests/automation-product.test.ts`: **3파일48개, 84.02초 통과**. 상태 확인 off/AI0/nonce0·비밀 로그 비노출·실제 Workers fetch의 Site/Google/Groq200 성공과302 거부를 포함한다. 외부 응답은 모의이며 실제 AI 요청이 아니다.
- EN_Card와 하루단어 타입 검사, 실제 ID의 비활성 `check:free` 통과. 하루단어 최신 원격 `5328253`의 보안 수정을 보존했고 `npm run install:ci` 후 Next16.3.6을 확인했다. 생성 번들/프록시/기존 braces 가드 **23개**와 새 잠금 파일 기준 build를 통과했다. 의존성 동기화 전 임시 빌드는 게시에 사용하지 않았다.
- DO `33eaf35a-75c8-4131-b818-1037ebc9bc85`에서 `configured:true, available:false`, CPU6ms·wall5099ms·outcome ok·예외0을 관측했다. 실제 HMAC 연결·Site 키 설정·nonce 테이블 조회 성공이며 AI 키 유효성/무료 계정 소속/생성 CPU를 입증하지 않는다. 중간 요청1건은 이벤트만 있고 세부 로그가 없어 성공으로 집계하지 않는다.
- Site v111 `d6b8f6654e1edce872c1134abe60b34a927e15ac`, 배포 `appgdep_6ac0ffede154819183920c4d1ee05d26`는22:15:44.489 KST succeeded. 기존public·환경59를 유지했고 이번 Site 소스 변경은 생성 서버 번들과 해시2파일이다. UI·DB 스키마·기존 설정은 변경하지 않았다.
- 같은 모델의 독립 review 문맥에서 수정·로그·리다이렉트 거부를 재검토해 NO FINDINGS. 교차 모델 검증은 아니다. 자동화 off/dry_run/unconfirmed, 실제 AI/카카오 호출0. 무료 키 소속 답변과 전체 무인 제작·수신 검증은 미완료다.
- 22:20 KST 최종 읽기 전용 조회에서 카드14·준비 이미지5·활성 예약0·전송 중/미해결0·자동화4테이블0행·FK 오류0을 재확인했다. 주/발송 Worker 버전·주 Cron1개·기존 Secret 이름은 그대로이며 DO만 새 버전100%다. 관리용 집계 SQL은 compound SELECT 제한 오류 뒤 개별 SELECT 묶음으로 바꿔 성공했다. DB 쓰기는 없다. 수집기는 모두 종료했다. v111 게시 후 재조회 시도의 tail 이벤트는 확보되지 않았으며 앞의 연결 성공 표본은 게시 전 v110 시점이다.
- [기계 판독 근거](evidence/AI_AUTOMATION_PREFLIGHT_2026-10-03.json): 배포 버전·설정·DB 집계·수집된4이벤트·변경6파일 SHA256. 로컬 재현 workerd 버전은1.20260926.1이다.

## 비활성 운영 반영 — 2026-10-03 21:40 KST

- EN_Card SQL94,432바이트를 제한 ACL·Windows DPAPI CurrentUser로 암호화하고 복호화 해시를 대조한 뒤 평문을 제거했다.0014 적용 전후 기존15테이블의 기존 열/행 해시는 이력 테이블 외 동일했다. 카드14·이미지5·활성 예약0·미해결0·FK 오류0, 자동화4테이블0행이다.
- DO `c8591f31-41b2-40bc-ba1f-1c872e7bf98f` off/dry_run/unconfirmed, 발송 `c20e9a02-b54a-40f3-bce6-6af5603c4c05`, 주 `00bb067b-4d23-459d-8eef-26c17941b5e2` 각100% 적용. 매분 Cron1개 복원, 기존D1/KV·Secret 이름 유지, 자식 공개/preview URL 비활성이다. boot200/live·비인증 자동화401을 확인했다.
- 비활성 Cron 실측5건1/4/1/2/3ms, 모두ok·예외0. 제품 AI/렌더 전체 CPU 표본이 아니며 수집기를 종료했다.
- Site v109·소스 `42eb484844bc3b78619ee392a162eb51365e5a31`·배포 `appgdep_6ac0f7a7df4081918072458cfb3fda5e`는21:40:27.796 KST succeeded다. 기존public·환경59를 유지했고 새 nonce0004와 서버 번들·UI를 포함했다. Native 결과로 게시 성공을 확인했으며 운영 학습 데이터를 QA로 수정하지 않았다.
- 첫 source-only 원격 빌드는 npm lockfile 불일치를 보고했다. 로컬 `npm ci --ignore-scripts --dry-run`은 통과했으며 오류 원인은 확정하지 않았다. 로컬 Node22 포장 도구의 접근 위반은 bundledNode24.19.0·Git Bash·TAR_OPTIONS=--force-local로 해결했다. 검증한 같은 소스를 공식 workflow로 포장/저장해 게시했고 의존성·잠금 파일은 바꾸지 않았다.
- 실제 AI/카카오 호출0, 자동 제작 비활성. 키의 무료 프로젝트 연결과 실제 제작·수신·PC 종료는 미검증이다. 관련relay16개·하루단어 번들/proxy15개·양쪽 타입/빌드·무료 구성·lint0오류/기존13경고·diff/서식을 통과했다. 일부 집계는 겹치며 합산하지 않는다.

## 기존 Site AI Secret 재사용 — 2026-10-03

- 기존 Site 환경 revision59에서 `google_api`, `groq_api` Secret 이름을 확인했다. 값은 조회·추출·복사·출력하지 않았다. 사이트 v108의 기존 소스 위에 서버 전용 relay를 추가했다.
- 기존 bridge Secret과 소유자 ID로 파생한 HMAC 키, 고정 출처/경로, 60초 서명, 5초/64KiB 본문, D1 UNIQUE nonce 소비를 적용했다. nonce 테이블이 없으면 준비 완료로 표시하지 않는다.
- 변경 영향 Vitest4파일53개 통과(89.77초, 최종 nonce/시각 수정 전), 이후 최종 relay16개 통과(0.50초). 하루단어 생성 번들+proxy15개와 타입 검사 통과. 두 집계는 중복되며 실제 AI 호출은 없다.
- 동시 서명 요청5회 중 제공사 모의 호출1회, 만료·위조·61초 지연·중단 본문·DB 실패·테이블 누락 차단을 검증했다. 보안 검토자가 별도 생성 번들에서 동시2회→200/409·호출1회와 지연본문403을 재현했다. 데이터 검토에서 Site0004는 기존 테이블 변경0·추가 테이블1/인덱스1임을 확인했다.
- EN_Card 타입·Vite·세 Worker dry-run·실제 ID의 off 구성 check:free를 통과했다. 별도 Claude/교차 모델 검증, 제품 원격 CPU·실제 AI/카카오 호출·수신은 이 결과에 포함하지 않는다.

아래 Secret 연결 대기 문구는 이전 설계의 기록이다. 현재는 키 재등록 없이 사이트의 Secret을 사용한다. 무료 계정과 해당 키의 연결은 별도 확인 대상이다.

## AI 자동 제작 제품 연결 — 2026-10-03

브랜치: 두 저장소 모두 `codex/ai-card-automation`. EN_Card 기준 HEAD `ad875e8`, 하루단어 기준 HEAD `2b00a8d325c54b3520b760a2d1580e0f78e1e984` 위의 작업 변경으로 검증했다. 이전 PNG 실험 수치를 제품 전체 검증으로 합산하지 않는다.

| 실행 | 확인 결과와 범위 |
| --- | --- |
| EN_Card 전체 `npm test` | 35파일·497개 통과, 1142.10초. 일부 후속 리뷰 수정 전의 전체 회귀 기준이다. |
| 이후 변경 영향 검증 | `automation-product`, `automation-product-do`, `free-config` 3파일·41개 통과, 91.84초. 실제 로컬 SQLite D1/KV·Wasm·124개 폰트로 1080 PNG 생성 포함. |
| 마지막 자동 예약 수정 보호 회귀 | `automation-product.test.ts -t "final schedule"` 선택한 1개 통과. 앞의 전체 집계에 더하지 않는다. |
| 브라우저 | 전체 Chromium 38개 통과. 새 자동 제작 흐름은 Chromium·WebKit 2개 통과(Chromium은 앞 집계와 중복). 390px 화면, 잘못된 검토 표시, 설정 초안 보존, 시작·중단 확인. |
| 하루단어 | 프록시 11개·전체 테스트·타입·빌드 통과. 기존 본인/Origin 검증과 경로·본문 크기 제한 확인. |
| 빌드·비용 구성 | 타입·Vite·주/발송/자동 제작 Worker dry-run·`check:free` 통과. SQLite DO의 비공개 접근과 기본 off/dry_run/unconfirmed 확인. |
| `review` | 데이터·보안/API·테스트·유지보수/성능·적대적 검토 및 수정 후 재검토. 별도 Claude CLI 교차 모델 검증은 미실시. |

AI 응답·카카오 발송은 모의 어댑터이며 실제 제공사 호출 0회다. 제품 DO 통합 테스트는 외부 AI/카카오 호출이 발생하면 실패하게 구성했다. 로컬 경과 시간은 원격 CPU 사용량의 증거가 아니다. 전체 497개와 후속 41개를 더해 최신 전체 통과 개수로 표현하지 않는다.

무료 계정은 20:19 KST 전후 로그인된 공식 대시보드에서 직접 확인했다. Cloudflare 계정의 Workers Free·US$0, Google **Default Gemini Project**의 무료 등급, Groq **Personal**의 Free $0가 대상이다. 다른 Google 프로젝트/결제 계정까지 무료라고 판단하지 않는다. 읽을 수 없는 기존 Sites Secret을 확인된 새 Worker Secret으로 간주하지 않으며 키가 어느 프로젝트에 속하는지 연결 확인이 남았다. 계정/구독/운영 DB·Worker·발송은 변경하지 않았다.

실제 제품 배포, AI 작성/교차 검토, 원격 CPU, 자동 예약 카드의 모바일 수신·원본 링크·PC 종료 제작은 미검증이다. 구현·운영 적용 절차·리뷰 수정 내역은 [제품 연결 문서](AI_CARD_AUTOMATION_IMPLEMENTATION.md)를 따른다. 아래는 이전 단계 검증 기록이다.

**20:38 KST 운영 사전 조회:** 같은 운영 D1에서 마이그레이션0001~0013 총13개, 활성 예약0·준비 이미지5·FK 오류0·저장 인증 상태connected/version11을 확인했다. 넓은 대기/보류 조회1건은 비활성 예약의 blocked/needs_reconnect 기록이며 sending/미해결unknown은0이다. 최초 API7403 오류 후 목록과 개별 쿼리 재시도는 성공했다. 후속 분류 조회의 잘못된 열 이름은 로컬 스키마와 맞춘 뒤 재실행했다. 성공한 쿼리는 모두 rows_written0·changed_db=false다. 토큰 유효성을 실제 카카오 API로 시험한 결과가 아니며 AI Secret 연결 대기는 유지한다.

최신 **중간 픽셀 복사 제거 — 2026-10-03**: [보고서](AI_CARD_AUTOMATION_REFERENCE.md). 관련5파일73테스트와 검증기1파일6회귀, 실제 로컬 workerd320개 새 측정 환경+별도4개 smoke에서 PNG4,200개 일치·거부32건을 확인했다. 원시320행·8집계·4짝비교·순서 균형·19소스/247자산 해시를 독립 재검증했다. 타입·제품 빌드/2개 dry-run·시험1개 dry-run·무료 구성 검사 통과. 리뷰의 빈/누락 해시 명세 통과 결함을 수정한 후 재검토했다. native 조립 반복4.707→4.271ms, 전체 반복40.055→41.534ms라 기본 미적용이다. 모두 로컬 경과 시간이며 원격 CPU·계정·AI/카카오 신규 검증이 아니다. 원격 PNG 누적88개·기존 CPU 초과와 로그 누락을 유지한다. 아래는 이전 단계 기록이다.

최신 **N3 작은 압축 블록 — 2026-10-03**: [결과 보고서](AI_CARD_AUTOMATION_BLOCKS.md). 관련5파일61테스트와 전체12,580원본페이지·글자780,504개/후보 대조를 통과했다. 실제 로컬 workerd의234개 새 측정 인스턴스와 별도21개 smoke에서 PNG1,200개·준비 프레임8,640개·페이지 해독 응답720개 일치, 거부51건을 확인했다.180개 경로/54개 페이지 측정행·15집계·소스23개 해시를 재대조했다. 타입·Vite·제품2개/시험4개 dry-run·무료 구성·리뷰를 통과했다. 전체 반복38.080→37.994/38.801ms로 일관된 개선이 없어 두 후보를 기본값에 채택하지 않는다. [시간 원자료](evidence/AI_PNG_BLOCK_LOCAL_2026-10-03.json), [작업량·연동](evidence/AI_PNG_BLOCK_WORKER_2026-10-03.json), [전체 글자 변환](evidence/AI_PNG_BLOCK_BUILD_2026-10-03.json). 원격 CPU·계정·실제 AI/카카오 신규 검증이 아니며 원격 PNG 누적88개는 유지한다.

이전 **N2 ATC 바이너리화 — 2026-10-03**: [로컬 비교](AI_CARD_AUTOMATION_BINARY.md)에서 관련 Vitest4파일53개, 타입·Vite·제품2개/시험2개 Worker dry-run, 무료 구성·변경 코드 서식 검사를 통과했다. 120개 새 측정 인스턴스와 별도 smoke에서 실제 계산 PNG1,080개·준비 프레임3,888개 일치, 잘못된 요청14건 거부를 확인했다. 120행·6집계·소스18개 해시를 대조했다. 메타데이터는67.9% 줄었지만 첫 조립17.432→21.581ms, 전체 반복41.110→44.076ms로 기본값에 채택하지 않았다. [원자료](evidence/AI_PNG_BINARY_LOCAL_2026-10-03.json), [실제 로컬 연동](evidence/AI_PNG_BINARY_WORKER_2026-10-03.json). 로컬 경과 시간이며 원격 CPU·계정·AI/카카오 신규 검증이 아니다. 원격 PNG 누적88개와 기존 제약은 유지한다.

이전 **N1 바이너리 RPC — 2026-10-03**: [로컬 비교](AI_CARD_AUTOMATION_RPC.md)에서 관련 Vitest48개, 타입·Vite·제품2개/시험2개 Worker dry-run, 무료 구성 검사 통과. 실제 로컬 바인딩20PNG·거부12건 및 두 모집단×두 방식×20새인스턴스의 첫/안정화/반복 응답을 검증했다. 최종 실행 합계1,060건 중 실제계산540·사전응답520건으로 모두 PNG 바이트가 같았다. 수집 분리 반복3.643→3.242ms와 달리 전체 생성39.659→42.064ms라 기본 경로에 채택하지 않았다. [원자료·소스 해시](evidence/AI_PNG_RPC_LOCAL_2026-10-03.json), [로컬 실제 연동](evidence/AI_PNG_RPC_WORKER_2026-10-03.json). 원격 CPU·계정·AI/카카오 신규 검증이 아니며 원격 PNG 누적88개는 그대로다. 아래는 이전 시점 기록이다.

최신 **조사 자료 검증 — 2026-10-03 11:13 KST**: [기존 25시도·추가 5후보](AI_CARD_AUTOMATION_PERFORMANCE.md)의 데이터 생성·공유 React 시각화 빌드·오프라인 HTML 내보내기를 완료했다. 원자료 19개 SHA256, 원격 34집계(기대858·확보615·누락243), 로컬785행, CSV 4개·snapshot 7질의를 대조했다. 5개 차트의 실제 SVG/막대·필터·검색·원자료 보기를 Chromium으로 확인했고, 1280px/390px에서 페이지 가로 넘침은 없었다. 단일 HTML은 HTTP 요청 없이 차트와 필터가 동작했다. 기록되지 않은 CPU는 null로 남겼으며 새 후보의 절감 ms도 미측정이다. [기계 판독 검증 결과·산출물 해시](performance/verification.json). 이번에는 새 벤치마크·원격 호출·계정 조회·AI/카카오 연동이 없었고 기존 제품 전체 테스트를 다시 실행하지 않았다.

최신 AI 실험은 **2026-10-03** [조립 함수 분리·native CRC 로컬 비교](AI_CARD_AUTOMATION_BLIT.md)다. 세 비교에서 새 로컬 workerd300개·PNG7,500개가 기준과 일치했다. 관련 Vitest3파일38개·타입/제품 빌드/두dry-run·무료 구성·새 시험 dry-run을 통과했다. 마지막 비교의 첫 중앙값13.82→12.74ms는 로컬 경과 시간이며 원격 CPU가 아니다. 반복 평균은4.30→4.29ms로 거의 같다. 이번 원격 호출은0이며 누적88 PNG, 기존 첫 조립13~22ms·준비/수집 초과·233/272로그와 누락39개는 [직전 실제 진단](AI_CARD_AUTOMATION_DIAGNOSTIC.md)을 따른다. 새 후보의 Free 적합성·전체 자동화2~5단계는 미완료다. 전체 Vitest/E2E·AI/카카오 연동 신규 검증은 아니다. 아래 기존 제품 검증은 해당 날짜 기록이다.

최신 검증: **2026-10-02 (KST)**. `ee229e6`의 전체 Vitest 334개·Chromium 22개와 0013 운영 반영·5장 실제 발송/CPU·사용자 수신·무료 계정 사용량을 문서 끝에 기록했습니다. PR #1은 09:33:26 KST에 `a26c81c`로 병합됐으며 두 제품 파일 트리가 같습니다. 이어 같은 `ee229e6`의 깨끗한 checkout에서 전체 Chromium E2E **22개·95.14초·종료 0**을 다시 확인했습니다. 개별 결과·환경·해시는 [보존 결과](evidence/E2E_2026-10-02_ee229e6.json), 실행·보존 절차는 마지막 절을 따릅니다.

아래 첫 표와 macOS 환경은 **2026-09-29의 과거 실행 기록**입니다. 이후 날짜별 실패·성공·미측정 기록을 보존하며 현재 결과와 섞거나 통과 개수를 합산하지 않습니다.

검증 환경: macOS arm64, Node.js 24.6.0, npm 11.5.1, Wrangler 4.142.0, Playwright 1.63.0. 라이브러리의 정확한 버전은 package-lock.json을 기준으로 합니다.

| 명령                                                                                                                             | 상태                  | 증명하는 범위                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                                                                                              | 통과                  | strict TypeScript, 프런트엔드·Worker·테스트 타입                                                                       |
| `npm run build`                                                                                                                  | 통과                  | Vite 정적 산출물, Worker dry-run 번들. 원격 배포 아님                                                                  |
| `npm run check:free` 및 `npm run check:free -- --config wrangler.live.jsonc --mode live`                                         | 모두 통과             | 기본 dry_run·명시적 live에 같은 허용 목록, 구성 경로·SHA 출력. live는 placeholder 임시 파일로 로컬 번들만 검사 후 제거 |
| `npm test -- tests/r3-r4.test.ts tests/pause-recovery.test.ts tests/png.test.ts tests/free-config.test.ts tests/storage.test.ts` | 62개 통과, 5개 파일   | R3·R4·live 구성 검사와 저장량 회귀                                                                                     |
| `npm test`                                                                                                                       | 177개 통과, 12개 파일 | 순수 로직과 실제 Miniflare D1/KV를 사용하는 통합 검증                                                                  |
| `npm run test:e2e`                                                                                                               | Chromium 10개 통과    | 실제 로컬 Worker, 데스크톱·390px 모바일, 실제 PNG·미발송 복구/제외·결과 불명 종료·토큰 복구 UI                         |
| `npm run db:migrate:local`                                                                                                       | 9개 마이그레이션 적용 | 개발 DB 백업 후 0009 적용, 독립 E2E·테스트 DB에 전체 스키마 적용                                                       |

## 테스트가 다루는 위험

- KST 00:05 전날 UTC, 월말·윤년 오류, 매일·요일 반복과 종료일.
- 동시 Cron, UNIQUE 회차, 한 번의 목록 소비, claim 경합과 만료 복구.
- 발송 준비 후 취소, 예약 동시 수정의 패자 차단, 이전 버전 미발송 취소. 편집 화면을 연 뒤 또는 저장 요청 처리 중 Cron이 카드를 소비하면 오래된 수정 요청을 거부하고, 최신 남은 목록으로 저장하면 각 카드가 한 번씩 발송됩니다.
- 일시정지 미발송 2장 새 예약/명시적 제외 + 기존 5장 재개, 접수 3장 재전송 없음, 중복 선택·동시 Cron·조회 후 sending 경합, 15분 경과, 역사적 접수/unknown·수신 확인·종료 제외, 고정 PNG 부재·원문 수정·취소 상태 보존.
- 일부 성공 뒤 unknown 대기, 성공 응답 뒤 DB 실패와 재시작, 15분 경과 missed.
- 미해결 unknown·sending 중 예약 재개/수정의 원자적 거부, 기존 수신 확인·명시적 재시도 유지. 이전 버전·취소 예약에서도 재전송 없이 종료하며 원래 결과·호출 기록·취소 상태를 보존합니다. 중복 종료와 동시 Cron, 회차 집계·이미지 참조 보호를 검사합니다.
- 명시적 거절 최대 3회, 401 최대 1회 추가 시도, 분당·일일 시도 상한.
- 최초 등록 토큰, 소유자 외 거부, OAuth 브라우저 바인딩·만료·재사용, 세션·CSRF·Origin.
- 로그아웃 후 예약·카카오 연결 유지, 재연결 후 현재 회차와 반복 일정 재개.
- 토큰 인증 암호화, 리프레시 누락 보존·회전·갱신 직렬화·재연결·연결 해제 경합. 이전 갱신의 거절·응답 유실·만료 판정이 새 OAuth 연결이나 새 갱신 잠금을 변경하지 않으며 다음 Cron에서 새 토큰을 사용합니다.
- 명시적 503 일시 오류 후 연결·미래 예약 유지, 영속 재시도 간격·3회 상한, 복구 뒤 발송, 대기 중 메시지 예산 불변. 인증 무효·실제 만료·응답 불명·설정 오류·동시 충돌을 구분하고 비밀값을 로그에서 제외합니다. 소진 후 명시적 재시작 API와 화면도 검증합니다.
- 동시 업로드 횟수/저장량 원자성, KV 실패 후 용량 보존·정리, 참조 이미지 보호, 공개 PNG 경로. 정리 후 늦은 업로드, 삭제 응답 유실·보상 삭제 실패, 삭제 소유권 경합, 반환한 용량의 재사용에도 재계상하고 신규 업로드 상한을 유지합니다.
- 재연결 대기 중 미래 이미지 삭제 보호, 원문 수정 후에도 고정한 이미지 버전 재개, 수동 재시도 시 원래 예정 시각 보존.
- 카드 편집→실제 1080×1080 PNG→저장·검토→예약→dry_run 기록 및 커서 불변. 저장·복원 응답을 지연시킨 상태에서 다른 카드로 편집 대상이 바뀌지 않으며 기존 카드 내용이 보존됩니다.
- 비교형 이미지, 한글 폰트, 긴 문장 초과 시 저장 차단, JSON 부분 오류, 모바일 가로 넘침 방지, PNG 백업 복원.

PNG 단위·통합 테스트는 실제 압축 해제가 가능한 4,613바이트 PNG를 사용합니다. 33바이트 헤더는 거부 테스트에만 남겼습니다. 청크 경계·순서·IHDR·IDAT/IEND·CRC·1MiB 상한과 오류 업로드의 KV/쿼터 불변을 확인합니다. 실제 PNG 생성·다운로드·복원은 Chromium E2E가 담당합니다. 카카오 응답은 주입된 HTTP 응답이며 실제 수신을 증명하지 않습니다. 테스트 결과 이미지는 로컬 `test-results/editor-desktop.png`, `test-results/editor-mobile.png`에 생성되며 Git에는 넣지 않습니다.

## 요구사항별 현재 근거

프로젝트 지침과 모든 src/worker·src/shared·src/web 파일, 마이그레이션·실행 설정·운영 문서를 대조했습니다. 테스트는 기존 성공 경로와 아래 실패·경합 경로를 함께 실행합니다. 이 표의 통과 범위는 로컬이며 원격 서비스의 실제 동작을 대신하지 않습니다.

| 요구사항                   | 실제 구현 경로                                     | 검증 근거                                                                                                                                                                                      |
| -------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0 전체 연결·운영 진입점   | index.ts, local.ts, wrangler.jsonc                 | 운영 구성 오류 거부, production scheduled의 dry_run 비소비, 브라우저 입력→PNG→KV→예약→기록                                                                                                     |
| 두 템플릿·폰트·줄바꿈      | web/canvas.ts, public/fonts, App.tsx               | 실제 1080×1080 PNG, 비교형·500자 긴 문장 차단, 390px 모바일, 미리보기·다운로드·저장 PNG 바이트 일치                                                                                            |
| 가져오기·백업·복원         | shared/model.ts, index.ts, catalog.ts              | 중복 ID·부분 오류·빈 백업·100개 파일 원자성, 205개 JSON 분할 백업/복원, 복원 PNG 다운로드 바이트 일치                                                                                          |
| 이미지 보관·정리·공개 범위 | storage.ts, assets 트리거                          | 1MiB 초과·잘못된 PNG 거부, 동시 횟수·용량 예약, KV 실패, KV 성공 후 D1 확정 실패, 삭제 응답 유실 후 단일 용량 반환, 참조 이미지 보호                                                           |
| 운영자·세션·CSRF           | auth.ts, crypto.ts, index.ts                       | 최초 등록 토큰, 소유자 외 로그인, state 브라우저 바인딩·만료·재사용, 세션 없는 API, CSRF·Origin, 로그아웃/연결 해제 구분, 세션 만료 후 화면 재로그인                                           |
| 인증 갱신과 경합           | auth.ts, engine.ts, kakao.ts                       | refresh 누락 보존·회전·직렬화, 연결 해제 중 갱신, 이전 인증의 늦은 401/권한 오류가 새 연결을 변경하지 않음, 권한 철회 시 미래 예약 중지                                                        |
| KST·반복·예약 변경         | shared/time.ts, schedules.ts                       | 자정 UTC·월말·윤년·요일·종료일, 잘못된 날짜 400, 준비 목록 소진, 재개/수정 경합, 소비 이미지 삭제 후 재개, 원문 편집 후 고정 이미지 유지                                                       |
| 발송·복구·중복 방지        | engine.ts, pause-recovery.ts, migrations/0001~0009 | 동시 Cron/claim, 예산 확보 후 연결 해제, 호출 전 claim/허용 시간 만료, sending 중단, 성공 후 DB 실패, 부분 성공, 취소 후 늦은 인증 오류·연결 해제에서도 취소 보존, unknown 수동 처리 경합·기록 |
| 카카오 어댑터              | kakao.ts, mock.ts                                  | native fetch 계약·form payload·result_code=0, 401/429/5xx/응답 유실 분류, 읽기 전용 사용자 조회의 제한된 재시도. HTTP 응답은 모의 주입                                                         |
| 무료 구성·처리량           | check-free.mjs, DB 제약, engine.ts                 | 허용 의존성/바인딩/외부 호스트·dry_run, 운영 번들의 로컬/모의 인증 제외, 활성 10·분당 3·일일 20, 실제 인증 함수+2회차/3장 경로의 호출당 50쿼리 이내                                            |
| 운영 화면·기록 접근        | catalog.ts, pagination.ts, App.tsx                 | 카드 205개·이미지/예약/발송 105개 연속 조회, 개별 발송의 전체 시도/사용자 확인 기록, 수동 수신 확인을 API 접수 집계와 구분                                                                     |
| M5 준비 산출물             | README, SETUP, OPERATIONS, .dev.vars.example       | 로컬 명령, Free 계정 확인 조건, 바인딩·Secrets·카카오 설정·마이그레이션·dry_run→live 절차, 백업/장애 복구 안내                                                                                 |

이번 수정에서 변경 테스트 62개가 10:40:13 KST 시작, 34.82초에 통과했습니다. 이후 전체 Vitest 12개 파일의 **177개**가 10:41:35 KST 시작, 91.16초에 통과했습니다. 이전 131개 결과를 현재 결과로 재사용하지 않았습니다. E2E는 최종 UI에서 Chromium **10개**, 23.6초에 통과했습니다. R3 복구·제외 후 기존 5장 재개, 취소 후 기록 접근, 실제 Canvas PNG 업로드를 포함하며 R1·R2 UI 2개도 유지했습니다. typecheck·build·기본/명시적 live 구성 검사도 통과했습니다. 모든 메시지 호출은 모의 응답이고 실제 카카오 수신은 미실시입니다.

R3·R4 정상 기대 테스트 2개는 구현 수정 전 실패하고 수정 후 통과했습니다. 초기 오류와 해결한 테스트 준비 문제, 로컬 PNG 구조·CRC 측정, 설정 SHA와 증거 로그는 [R3_R4_M5_READINESS.md](R3_R4_M5_READINESS.md)에 있습니다. 외부 검토에서 보고된 `uv_interface_addresses ... error 1`은 이 실행 환경에서 재현되지 않았습니다. 격리 DB·8787 포트·Chromium으로 실제 실행했으며 skip·assertion 약화를 사용하지 않았습니다.

개발 DB는 Git 제외 경로 `backups/pre-r3-r4-20260929.sql`에 내보낸 뒤 0009를 적용했습니다. 적용 이력 8→9, 카드·이미지·예약·저장량은 모두 0으로 유지했고 `PRAGMA foreign_key_check`는 빈 결과입니다. populated 업그레이드는 별도 Miniflare DB의 0001~0008에 접수 3장·취소 2장·남은 5장·사용량을 준비한 뒤 0009를 적용하여 원본 delivery·사용량·외래키를 보존하고 2장 복구를 확인했습니다. 신규 통합·E2E DB에는 전체 0001~0009를 적용했습니다. R1·R2 및 0006의 기존 데이터 업그레이드 테스트도 전체 실행에 포함했습니다. 기존 0001~0008과 잠금 파일, 기본 wrangler.jsonc는 변경하지 않았습니다.

쿼리 수 테스트는 지정된 대표 발송 경로를 검사합니다. 실제 계정의 행 읽기/쓰기 사용량과 CPU 10ms 충족 여부는 원격 측정 대상입니다. 2026-09-29에 Workers·D1·KV 요금, D1 제한, Cron, 카카오 인증·메시지 공식 문서를 재확인했으며 출처는 SETUP.md에 연결했습니다.

## 2026-09-29 원격 미실시 기록

- 실제 Cloudflare 계정 Free 플랜, 공유 사용량과 리소스 한도.
- Workers Free 호출당 실제 CPU 10ms 충족, 원격 장애·부하에서의 동작.
- 실제 카카오 앱 등록·동의·OAuth 로그인·토큰 갱신·메시지 접수.
- 카카오 서버의 이미지 URL 접근, KV 전파, 휴대전화 이미지 표시·원본 링크.
- PC·브라우저·Codex 종료 후 미래 예약 수신. 확인 주체와 기기·예정/수신 시각 기록 필요.

위 항목은 M0 원격 검증 및 M5 운영 검증으로 남습니다. 원격 리소스 생성·배포·실제 발송은 수행하지 않았습니다.

이 문단은 당시 상태이며 2026-09-30 후속 원격 결과는 아래 최신 기록을 따른다.

## Windows symlink EPERM 수정 — 2026-09-30 중간 결과

환경: DESKTOP-SS5CURC, Windows, Node 22.22.2, npm 10.9.7. 기준 HEAD: 55d63986afc3c06fb199f67a25715c6847da610b. 로컬 미커밋 수정이며 push·merge·배포·실제 발송은 수행하지 않았다.

원인은 테스트 beforeEach의 디렉터리 symlink 생성에 필요한 Windows 권한 부재였다. Windows에서는 Node의 junction 타입을 사용하고 다른 플랫폼에서는 dir 타입을 지정한다. 같은 설치된 node_modules를 가리키는지 realpath assertion을 모든 fixture 준비에 추가했다. symlink는 격리된 검사 프로세스에 의존성을 제공하기 위한 수단이며 검사 대상이 아니다. 기존 정상·오설정·유료 바인딩 거부 assertion을 삭제하거나 완화하지 않았다. Node API 근거: https://nodejs.org/docs/latest-v22.x/api/fs.html#fspromisessymlinktarget-path-type

- npm test -- tests/free-config.test.ts --reporter=verbose: 8개 모두 통과, 1.69초.
- npm test -- --reporter=verbose: 로그에 116개 통과, 실패 기록 없음. 실행 서버 연결 단절 뒤 로그가 2026-09-30T05:22:53Z에서 멈췄으며 05:24:29Z에 Vitest 프로세스 0개와 최종 요약 부재를 확인했다. 전체 통과로 보고하지 않는다. 중복 재실행하지 않았으며 전체 재검증은 대기 중이다.
- 최종 수정 후 타입·빌드·무료 구성 검사와 필요한 E2E는 아직 미실시다. 앞선 checkout 검증 결과로 대체하지 않는다.
- 근거 로그: C:/Users/user/Documents/Codex/2026-09-30/task/en-card-windows-focused.log 및 en-card-windows-all-final.log. 후자는 연결로 중단된 부분 기록이다.

OS 설정·관리자 권한·보안 정책·lockfile·제품 코드·마이그레이션은 변경하지 않았다. 45장 복구 결함과 원격 검증 미실시 항목은 유지한다.

### 최종 Windows 재검증 완료

최종 실행 ID: 20260930T053655Z. 종료 시각: 2026-09-30T05:44:53.5363590Z. 앞의 중간 기록 이후 같은 테스트 수정으로 재검증했으며, 다음 결과가 현재 완료 상태다.

| 명령                           | 최종 결과                                           | 종료코드 |
| ------------------------------ | --------------------------------------------------- | -------- |
| npm test -- --reporter=verbose | 12개 파일, 177개 모두 통과; Vitest 430.25초         | 0        |
| npm run build                  | strict TypeScript·Vite·Worker deploy --dry-run 통과 | 0        |
| npm run check:free             | 기본 dry_run 무료 구성·운영 번들 검사 통과          | 0        |
| npm run test:e2e               | Chromium 10개 통과, Playwright 40.4초               | 0        |

전체 테스트의 8개 무료 구성 검사는 junction 대상 realpath 일치와 기존 dry_run/live·유료 바인딩·외부 서비스·기본 모드 보호를 그대로 확인했다. 단계별 실행 시간과 종료코드는 C:/Users/user/Documents/Codex/2026-09-30/task/en-card-windows-validation-status.json에, 출력은 기존 en-card-windows-all-final.log의 VALIDATION_RUN_BEGIN 20260930T053655Z 이후에 기록했다. 앞의 116개 부분 결과 및 로그 기록 명령의 초기 오류는 이전 실행 기록으로 구분한다.

이번 결과는 로컬 Miniflare DB/KV·모의 HTTP와 로컬 Chromium에 대한 것이다. 실제 Free 계정·원격 CPU·OAuth·카카오 수신은 여전히 미검증이며, 45장 복구 결함은 수정하지 않았다. 제품 소스·lockfile·OS 설정은 그대로 유지했다. 커밋·push·merge·원격 리소스 변경·배포·발송은 수행하지 않았다.

## 최신 원격 시험 배포 — 2026-09-30

환경: Windows·Node 22.22.2·잠금 파일의 Wrangler 4.142.0, 기준 HEAD 222d750. 사용자는 Cloudflare 직접 진행과 카카오 연결을 허용했고, Wrangler와 카카오의 실제 동의는 본인이 완료했다. 이 기록은 위의 로컬 검증 및 당시 원격 미실시 기록 이후의 결과다.

### 계정·DB·배포

- Dashboard의 현재 Workers Free·US$0와 실제 Wrangler 로그인 계정의 일치를 확인했다. D1 `en-card`와 KV `CARD_IMAGES`를 새로 만들었다. 기존 Worker와 다른 카카오 앱, 구독·결제는 변경하지 않았다. 계정 전체 공유 사용량과 CPU는 미측정이다.
- 처음 비어 있는 원격 D1을 `backups/pre-first-deploy-20260930.sql`에 export했다. 0001~0005 적용 뒤 0006이 incomplete input으로 실패했다. 실패 후 적용 이력 5개, 기존 assets_quota 존재, 새 cleanup_owner·usage_counters_next 없음, 사용자 핵심 테이블 0행을 확인했다. LF로 정규화한 재시도도 실패했다.
- 원본 0006~0009 SQL과 각 파일의 이력 INSERT를 묶은 file import가 48개 쿼리·종료코드 0으로 완료됐다. import 파일 SHA-256은 `bb436b17e34d02308ad0f64a3f4510e3f32297a76d753db1481eeae8a2f17929`이다. Git HEAD와 원본 SQL을 대조했고 문장 변경은 없다. 적용 이력 9개, assets_quota·assets_restore_quota·assets_release·attempts_quota·schedule_unresolved_version·pause_decision_required 트리거와 FK 빈 결과를 확인했다. 재실행하지 않는다.
- `npm run build`, 실제 deploy 파일의 `wrangler deploy --dry-run`과 `npm run check:free -- --config wrangler.deploy.jsonc --mode dry_run`이 통과했다. 동일 파일로 실제 `wrangler deploy` 성공, SEND_MODE=dry_run·COST_MODE=free_only·Cron 한 개를 유지했다. 설정 SHA-256은 `a56cd3002ba26db972d25e20579ddade0929467854c5f00df936afa0e35828cf`이다. 최초 배포 버전은 `47c82676-c087-4406-bb5e-24eb9a23188a`이며 이후 Secret 등록으로 버전이 추가됐다.
- 익명 `/` 200 HTML, `/api/boot` 200·local=false·mode=dry_run, `/api/state` 401, 존재하지 않는 이미지 경로 404를 확인했다. 이미지 API가 SPA HTML로 가려지지 않았다. Worker 시작 시간 16ms는 요청 CPU 시간이 아니므로 CPU 10ms 충족 근거로 사용하지 않는다.

### 실제 카카오 연결

- 전용 EN_Card 앱을 만들고 카카오 로그인 ON, 정확한 callback, 웹 도메인과 talk_message 선택 동의를 설정했다. 친구 목록·프로필·이메일 동의는 요청하지 않았다. 사용자가 실제 메시지 전송 권한에 동의한 뒤 콜백에서 서버 토큰 교환·운영자 등록을 완료했다.
- Worker Secret 이름 5개가 존재한다. 실제 API 키·새 Client Secret·서버 난수는 출력하거나 Git에 기록하지 않는다. 현재 Windows 사용자 DPAPI로 암호화한 복구 파일은 Git 제외 backups에만 있다.
- 키 상세 DOM 출력의 초기 마스킹이 영문·숫자 시크릿을 가리지 못했다. 아직 사용하지 않던 새 앱의 시크릿 2개를 사용자 승인으로 재발급·저장했다. 추가 재발급 시도는 자동 승인 검토가 거부했고, 새로고침 후 두 값이 이전 값과 달라 추가 교체 없이 완료했다. 이후 출력은 전체 영문·숫자 형식을 가렸다. 새 값으로 실제 OAuth 교환이 성공했으며 비밀값 자체는 이 기록에 포함하지 않는다.
- 앱의 **카카오 연결: 연결됨**과 원격 credentials 1행·status=connected를 확인했다. 이 검증은 실제 카카오 OAuth이며 모의 응답이 아니다. 토큰 자동 갱신과 실제 메시지 접수·수신은 수행하지 않았다.

### 원격 카드·예약 미리검증

| 항목             | 실제 결과                                                                                                                    |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 표현형 PNG       | ready, 84,292바이트, 1080×1080, 한영·예문·메모 표시 확인                                                                     |
| 비교형 PNG       | ready, 87,785바이트, 1080×1080, 기본 표현·뜻·구분선·대체 표현 확인                                                           |
| 이미지·원본 경로 | 두 카드의 `/images`·`/original` 각각 로그인·Cookie 없는 GET 200, image/png, public max-age=86400, PNG 시그니처·가로세로 확인 |
| 미래 시험 예약   | Asia/Seoul 2026-09-30 17:08 → UTC 2026-09-30 08:08:00, 카드 2장·한 회차 2장                                                  |
| 미리검증         | dry_runs 1행, cursor=0, occurrences=0, deliveries=0, 실제 sends=0                                                            |
| 시험 후 상태     | 시험 예약 enabled=0·reason=cancelled, 저장된 예제 카드 2장·총 172,077바이트·업로드 2회, FK 빈 결과                           |

원격 이미지 자체를 내려받아 한영 렌더링을 확인했다. 예제 파일·메타데이터·스크린샷은 Git 제외 `backups/remote-expression-20260930.png`, `remote-comparison-20260930.png`, `remote-smoke-metadata-20260930.json`, `remote-smoke-final-20260930.json`에 있다. 검증 전용 미래 예약은 취소했으므로 live 전환 시 발송 대상으로 남지 않는다. 카드·예약 데이터는 실제 원격 DB/KV이며 전송 검증은 dry_run이다. 카카오 메시지 API를 호출하지 않았다.

앱 소스와 의존성·lockfile에 변경이 없어 전체 Vitest·E2E는 반복하지 않았다. 기존 Windows 최종 177개·10개 결과는 로컬 검증으로 구분한다. 이번 변경의 검증은 SQL 의미 동일성·실제 설정 무료 검사·원격 FK·OAuth·위 smoke 결과다. 커밋·push·merge는 수행하지 않았다.

### 남은 실제 운영 검증

- 40장 초과 누적 중지 이력의 복구·제외 결함 수정과 회귀 테스트. live 전환 전 보완한다.
- 호출당 실제 CPU, 계정 전체 공유 사용량, 실제 Cron의 due 회차 처리·장애·부하 관측.
- 카카오 토큰 정상 갱신, 본인 메시지 API result_code=0과 휴대전화의 이미지·원본 보기.
- 본인 테스트 범위를 정한 live 전환과 PC·브라우저·Codex 종료 후 미래 예약 수신. 무료 나에게 보내기는 푸시 알림·알림음이 없다.

최초 배포에는 이전 운영 버전이 없다. 오류 시 Cron을 중단하고 현재 스키마와 호환되는 dry_run 수정본을 배포한다. DB 복원은 백업을 별도 빈 DB에서 검증하고 원본 적용 파일을 재실행하지 않는다. Worker observability 설정은 기존 disabled이며 앱·DB 기록을 사용한다. M5 전체 완료나 정시 수신·무료 CPU 충족으로 보고하지 않는다.

## 누적 복구 수정과 실제 발송 시험 — 2026-09-30

### 로컬 회귀 검증

- 0008 이력 45장을 0009로 업그레이드한 fixture에서 40장 부분 제외가 RECOVERY_CHANGED로 실패하고 미리보기의 미결정 총량이 없는 것을 RED 2개로 재현했다. 수정 후 두 시나리오와 혼합 복구·동시 부분 결정 2개가 통과했다.
- `npm test`: 12개 파일 **181개 통과**, 16:37:26 KST 시작·472.59초·종료코드 0. 40/5장 순차 제외·전부 결정 전 재개/삭제 보호·35장 복구+5장 제외·후속 5장 복구·원본 payload/시도/예산 불변·동시 겹침/분리/오래된 ID 거부를 포함한다.
- `npm run test:e2e`: 첫 실행은 새 테스트의 잘못된 버튼 이름(일시정지 예약의 실제 이름은 재개)으로 timeout 후 fixture가 남아 기존 테스트도 중복 선택자로 실패했다. assertion을 완화하지 않고 선택자만 수정한 새 격리 DB의 최종 실행은 Chromium **11개 통과**, 45.3초·종료코드 0이다. 화면의 40/5장 순차 처리·확인란 초기화·마지막 재개를 포함한다.
- 실제 시험 뒤 발견된 OAuth 권한 누락은 RED 4개로 재현했다. 누락·빈 문자열·다른 권한·부분 일치값을 connected로 저장하던 결함이다. scope를 보존·검사한 수정 후 `npm test -- tests/auth.test.ts tests/core.test.ts` **37개 통과**, 16:59:56 KST 시작·38.70초·종료코드 0. 기존 state/소유자/토큰 회전과 미동의 시 기존 인증/세션 보존을 확인했다. 인증 보완 이후 전체 185개를 한 번에 실행했다고 주장하지 않는다.
- 인증 보완 뒤 `npm test -- tests/token-recovery.test.ts tests/reaudit.test.ts` **47개 통과**, 17:09:00 KST 시작·115.71초·종료코드 0. 기존 토큰 일시 오류·재시도 소진·원격 운영 진입점·예약 경합·실행 쿼리 상한을 재검증했다. UI가 추가로 바뀌지 않아 최종 11개 E2E를 반복하지 않았다.
- 최종 인증 보완 뒤 `npm run build`(strict typecheck·Vite·Worker dry-run), deploy/live 두 설정의 `check:free`, Prettier·git diff --check가 통과했다. 테스트 추가 중 unknown JSON spread의 TS2698은 fixture 객체 타입을 명시하여 해결했다. 잠금 파일과 SQL 의미는 변경하지 않았다.

### 원격 실행과 안전한 중단

시험 전 원격 조회는 일시적인 7403 오류 뒤 정상화됐다. 같은 계정·D1 식별자와 OAuth scope가 확인됐고 재로그인·권한 확장은 하지 않았다. 활성 예약·deliveries·미결정 복구는 모두 0, credentials는 connected, FK 결과는 비어 있었다. D1 전체 export 22,790바이트를 Windows 현재 사용자 DPAPI로 암호화해 `backups/pre-recovery-live-20260930.sql.dpapi`에 보관하고 평문 SQL을 제거했다. 백업 복원 시험은 수행하지 않았다.

| 항목                   | 실제 결과                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 복구 수정 dry_run 배포 | `55bbf303-32f5-4650-9c97-16a98bbe4977`                                                                                   |
| 실제 시험 live 배포    | `3979a701-9c85-4caa-8cda-f6a4f36f4510`, live 설정 SHA `4aaeecdca861c1fd39fdfa9f87e6ba18b019fdf18d358e30f92c1829632d3a95` |
| 시험 내용              | 기존 ready 표현형 Take your time 한 장·일회 예약·2026-09-30 16:54 KST = 07:54 UTC                                        |
| 실제 호출              | delivery_attempts.started_at 16:54:27 KST, 결과 기록 16:54:28 KST                                                        |
| 메시지 응답            | HTTP 403·code=-402, API 접수 0회. state=blocked, credentials/예약 needs_reconnect                                        |
| 보호 상태              | sends=1, 자동 재호출 없음·활성 예약 0·새 이미지 업로드 없음·FK 빈 결과                                                   |
| 안전 복귀              | 즉시 dry_run 버전 `b793ea50-9358-4834-a2a7-4a2db560dc2b` 배포                                                            |
| 최종 권한 확인 보완    | dry_run 버전 `f655beed-502d-46da-bad2-1bc8de66d5ec` 배포                                                                 |

`-402`는 필요한 동의항목이 부족한 경우의 공식 오류다. authorize 요청은 이미 talk_message를 지정하고 있었지만 당시 토큰의 실제 권한은 저장 전에 검증하지 않았다. 사용자의 기존 동의 완료 응답만으로 실제 메시지 권한을 완료로 표시하지 않는다. 콜백 보완은 토큰 scope에 talk_message가 확인되지 않으면 사용자에게 재동의를 안내하고 새 토큰·세션을 저장하지 않는다. [카카오 추가 동의·결과 확인](https://developers.kakao.com/docs/ko/kakaologin/utilize), [토큰 scope 응답](https://developers.kakao.com/docs/ko/kakaologin/rest-api)을 근거로 사용했다.

### 실제 CPU와 남은 조건

Wrangler tail은 로컬 로그 쓰기를 끄고 subprocess stdout에서 invocation 시각·트리거·CPU/wall·결과·예외 수·배포 버전만 선별했다. 요청 URL의 쿼리·헤더·Cookie·앱 로그·OAuth 응답은 출력하거나 보관하지 않았다. Git 제외 `backups/live-invocations-20260930.jsonl`이 근거다. 지속 Workers Logs/Traces 설정은 disabled를 유지했다.

- 시험 전 전체 배포의 24시간 CPU 집계는 P50 1.77ms·P90 4.4ms·P99/P999 7.91ms·CPU 제한 초과 오류 0이었다. 이 집계는 실제 발송 경로의 검증을 대체하지 않는다.
- 실제 예약 회차의 scheduledTime 16:54:24 KST, invocation timestamp 16:54:26.094 KST, CPU **24ms**, wall **3117ms**, outcome=ok·예외 0이었다. runtime의 ok는 메시지 성공이 아니며 CPU 10ms 충족도 아니다.
- Workers Free의 HTTP/Cron CPU 기준은 10ms다. 런타임의 일시적 초과 허용 때문에 이 호출이 중단되지 않았어도 운영 완료로 판단하지 않는다. CPU 경량화·작업 분할 검토와 Free 환경 재측정 전 live 확대를 보류한다. [CPU 제한과 관측](https://developers.cloudflare.com/workers/platform/limits/), [CPU 집계](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/)를 2026-09-30 재확인했다.
- 카카오 메시지 권한 재동의·성공 접수·휴대전화 이미지/원본 링크·정상 토큰 갱신·PC/브라우저/Codex 종료 시험·실제 복구 40장 CPU·계정 전체 공유 사용량은 미완료다. 이번 45장 회귀는 모의 HTTP와 격리 DB이며 원격에 45장 시험 이력을 만들지 않았다.

롤백은 현재 스키마와 호환되는 수정본을 dry_run으로 배포하는 경로다. 이전 live 버전의 무조건 rollback·DB 덮어쓰기·과거 회차 재발송은 하지 않는다. 새 마이그레이션이 없어 이번 수정의 스키마 이전 위험은 없으며 기존 실패·시도·복구 보호를 보존했다. 커밋·push·merge는 수행하지 않았다.

## 만료된 카카오 연결 재진행·CPU 경량화 시험 — 2026-09-30

### 실제 재연결 결과

- 사용자의 유효시간 만료 안내 후 앱에서 새 OAuth 요청을 시작했다. 카카오에 기존 동의가 남아 별도 승인 화면 없이 정상 콜백으로 돌아왔다. 새 콜백은 정확한 talk_message scope 확인 후에만 저장된다.
- 원격 D1의 credentials는 **connected/version 3**이며 앱 연결 및 설정 화면도 **연결됨**이다. 기존 needs_reconnect/version 2를 대체했다. 토큰·인가 코드·OAuth URL과 응답은 출력하거나 기록하지 않았다. 완료 화면은 Git 제외 `backups/kakao-reconnected-20260930.png`에 저장했다.
- 최종 원격 조회: 활성 예약 **0**, 실제 시도 누적 **1**, sent **0**. 이번 재연결 후 새 실제 메시지를 보내지 않았고 실패 기록·예산은 보존했다. 운영 배포는 `f655beed-502d-46da-bad2-1bc8de66d5ec`, dry_run 그대로다.

### 격리된 원격 CPU 실험

시험용 Free Worker `en-card-cpu-probe`, D1 `en-card-cpu-probe`와 고정 JSON 응답 Worker `en-card-cpu-response`를 사용했다. 운영 D1/KV·실제 카카오 토큰을 공유하지 않았고, 실제 카카오 API를 호출하지 않았다. 가짜 토큰의 암호화·복호화와 실제 D1 발송 보호 쿼리를 사용하되 결과는 mock_sent로 구분했다. 호출 CPU/wall·결과·예외 수·버전만 선별해 Git 제외 `backups/cpu-probe-*.jsonl`에 남겼다. 지속 로그와 Cron은 추가하지 않았다.

- 응답 스키마를 매번 생성하지 않고 재사용하도록 수정했다. 같은 invocation의 유효한 토큰 조회·복호화를 한 번으로 줄였으며, 매 카드의 D1 인증 버전/상태·claim·취소·순서·예산 검사는 유지했다. 만료 1분 전 또는 오류/버전 변경 이후에는 재사용하지 않는다. 글로벌 토큰 캐시는 없다.
- 준비/발송 분리, 1장 처리 제한과 minify도 실험했다. 공용 HTTP의 가짜 정상 응답으로 3장씩 처리한 분리 실험 5회의 발송 CPU는 **15/20/15/15/16ms**, 준비 CPU는 **5/3/5/5/3ms**였다. 실제 카카오 성공 경로의 수치가 아니다. 1장 실험에도 최대 14ms가 남았고, minify의 관측된 발송 호출도 16ms였다.
- 초기 self-fetch 및 별도 workers.dev fetch는 호환성 설정 때문에 404로 반환됐다. 그 호출의 unknown 결과와 CPU는 정상 발송 근거에서 제외했다. 서비스 바인딩 및 이후 공용 HTTP 경로의 정상 가짜 응답을 별도로 확인했다. [공용 fetch 호환성](https://developers.cloudflare.com/workers/configuration/compatibility-flags/)을 확인했다.
- Free CPU 10ms 충족을 증명하지 못했으므로 live 재시험은 보류했다. 준비/발송 분리·처리 속도 변경은 제품 코드에서 제외했다. 남긴 스키마 재사용·토큰 조회 감소 수정도 아직 운영에 배포하지 않았다.
- 시험 Worker 2개와 시험 D1은 삭제 성공을 확인했고 D1 목록에는 운영 en-card만 남았다. 시험 tail 프로세스도 종료됐다. 유료 리소스·요금제·결제·다른 앱을 변경하지 않았다.

### 남은 운영 조건

재연결은 완료했지만 정상 토큰 갱신, 실제 메시지 접수·모바일 이미지/원본 링크, PC/브라우저/Codex 종료 후 수신은 아직 검증하지 않았다. Free CPU 기준을 충족하는 발송 경로가 다음 선행 조건이다. 이번 구성 검사는 dry_run/live 모두 통과했으며 실제 계정 Free 상태는 같은 날 Dashboard 확인을 따른다. 계정 전체 공유 사용량은 미확인이다.

재검증 명령: `npm test`, `npm run build`, `npm run check:free -- --config wrangler.deploy.jsonc --mode dry_run`. CPU가 미해결인 동안 배포와 발송 명령을 실행하지 않는다.

### 최종 로컬 검증

- `npm test`: 제품 코드에서 준비/발송 분리·처리 속도 변경을 제외한 최종 상태로 **12개 파일 188개 통과**, 18:56:48 KST 시작·477.18초·종료코드 0. 인증/발송/복구 전체 회귀를 포함한다.
- 새 토큰 재사용 테스트 3개는 수정 전 RED, 수정 후 GREEN이었다. 같은 Cron의 인증 조회 1회, 새 연결 버전으로 바뀌면 옛 토큰의 호출·예산 차단, 만료 1분 경계의 재조회가 검증됐다.
- `npm run build`의 strict typecheck·Vite·Worker dry-run, dry_run/live 실제 설정의 `check:free`, Prettier 및 `git diff --check` 통과. 스키마·잠금 파일·예약 처리 속도는 변경하지 않았다.
- UI 실험은 제외되어 제품 화면은 이전 11개 Chromium E2E 통과 상태와 같으므로 E2E를 반복하지 않았다. 전체 Vitest는 모의 카카오/격리 DB 검증이며 실제 수신 완료를 뜻하지 않는다.

## 비공개 HTTP Service Binding으로 CPU 분리 — 2026-09-30

### 원인·구조·안전성

한 invocation에서 준비·claim·토큰 조회·세 장의 payload 검사·내구 예산 예약·메시지·결과 저장을 모두 처리하던 경로는 Free CPU 10ms를 초과했다. 준비와 카드별 발송을 비공개 Worker HTTP 요청으로 분리했다. 주 Worker는 매분 Cron·claim·인증을 담당하며 토큰은 invocation 안에서만 재사용한다. 자식은 같은 D1에서 payload·인증 버전·예약 버전·claim·순서·일일/분당 예산을 확인하고 호출 직전 sending과 결과를 저장한다. 처리량 3건/분·20시도/일은 변경하지 않았다.

자식의 HTTP 응답 유실은 실제 미발송을 증명하지 않는다. 주 Worker는 해당 tick을 멈추며 직접 발송으로 우회하지 않는다. 만료된 claimed는 안전 회수, sending은 unknown, 이미 저장된 sent는 그대로 유지한다. 같은 claim의 중복 요청이 첫 호출의 sending을 claimed로 되돌리지 않도록 보완했다. 운영 자식에는 공개·preview URL, Cron, KV, Secret이 없다. Service Binding만 접근 가능하며 실제 토큰은 요청 메모리에만 전달한다.

### 격리된 원격 CPU 측정

전용 Free 시험 Worker 두 개와 별도 D1에 가짜 암호화 토큰·고정 성공 HTTP 응답을 사용했다. 운영 D1/KV·실제 카카오 토큰은 공유하지 않았으며 카카오 API 호출은 없다. 성공은 mock_sent로 구별했다. RPC 실험의 주 Worker CPU 12~19ms, 준비가 주 Worker에 남은 HTTP 실험의 13~18ms는 기준 미달로 제외했다. 요청 연결 방식 전반의 CPU 계산 규칙을 이 결과만으로 일반화하지 않는다.

최종 HTTP 구조에서 3장씩 5회 모두 정상 처리했다. main 버전 `5f515267-9b1d-48cb-bcad-c4bbf56932b6`, child 버전 `2943b339-1ef2-4e07-82bf-554312fb7e0a`의 측정이다.

| 시험 | 주 Worker CPU | 준비 CPU | 카드별 발송 CPU |
| ---- | ------------- | -------- | --------------- |
| 1    | 8ms           | 5ms      | 9 / 3 / 3ms     |
| 2    | 9ms           | 7ms      | 9 / 5 / 3ms     |
| 3    | 9ms           | 5ms      | 10 / 3 / 2ms    |
| 4    | 6ms           | 4ms      | 6 / 2 / 2ms     |
| 5    | 6ms           | 2ms      | 2 / 4 / 4ms     |

각 호출 outcome=ok·예외 0이며 공급자 fixture CPU는 0ms였다. 기준을 충족한 것은 이 측정 호출이며 이후 모든 부하·토큰 갱신의 CPU를 보장하지 않는다. 근거는 Git 제외 `backups/cpu-stage-parent-final.jsonl`, `cpu-stage-child-final.jsonl`이며 헤더·Cookie·JSON 본문·토큰·OAuth URL은 보관하지 않았다. 운영 실제 카카오 결과는 다음 기록과 구분한다. [Free CPU 제한](https://developers.cloudflare.com/workers/platform/limits/), [Service Binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)을 재확인했다.

### 최종 로컬 검증

- `npm test`: **13개 파일 202개 통과**, 19:45:52 KST 시작·507.53초·종료코드 0. 기존 인증·예약·복구 회귀를 포함한다.
- 새 dispatch 장애 회귀는 수정 전 processed=1로 실패하고 수정 후 processed=0·claimed·예산 0으로 통과했다. 준비 장애·중복 claim·결과 저장 뒤 응답 유실·저장 payload 손상·순서/처리량의 엔진 테스트 6개를 추가했다.
- 운영 scheduled → Service Binding → 실제 자식 핸들러를 격리 Miniflare D1과 모의 카카오 fetch로 연결한 5개 테스트가 통과했다. 바인딩 누락·허용 경로·설정 거부·3장 호출·성공 뒤 응답 유실/손상에서 재발송 금지를 확인한다. 실제 메시지 수신 검증이 아니다.
- 무료 구성 테스트 11개가 통과했다. 추가 3개는 자식 공개/preview 주소·서로 다른 DB·유료 바인딩·추가 Cron을 거부한다.
- `npm run build`(strict typecheck·Vite·주 Worker dry-run), 자식 배포 dry-run, 두 실제 설정의 check:free·Prettier·git diff --check 통과. E2E는 화면 변경이 없어 이전 Chromium 11개 결과를 유지하며 반복하지 않았다.
- 마이그레이션·의존성·잠금 파일은 추가 변경하지 않았다. 기존 사용자 변경과 실패·예산 기록을 보존했다. 커밋·push·merge는 하지 않았다.

### 무료 계정·배포·백업

19:51 이후 Dashboard에서 현재 Workers 무료·US$0를 다시 확인했다. D1/KV는 기존 것을 재사용하고 `en-card-delivery`만 추가했다. 유료 상품·플랜·결제·다른 앱은 변경하지 않았다. 계정 전체 공유 사용량은 미측정이다.

운영 D1을 `backups/pre-private-delivery-20260930.sql.dpapi`로 현재 Windows 사용자 DPAPI 암호화·복호화 일치 확인 후 평문 파일을 삭제했다. SQL 복원 실행은 미실시다. Wrangler export의 기본 출력에 1시간짜리 다운로드 URL이 포함되어 도구 출력에 남았으며 이후 출력 필터가 필요한 항목으로 기록한다. 비밀값이나 평문 토큰은 문서에 포함하지 않는다.

| 설정        | SHA-256                                                            |
| ----------- | ------------------------------------------------------------------ |
| 주 dry_run  | `f28080c3b16f03ba48eff05f96c4ff0c7bbad8de1b9e42ba1770fb4803f70326` |
| 주 live     | `147312546ff1548a24d1896552d5a53f88bd04693942968c24dbb8584e504b10` |
| 비공개 발송 | `d57a2a40e2024cf982b0b0a9456f6be1121f50ebddc12352f600165385ec3abf` |

자식 버전 `aa8c160b-965d-43d3-b09b-c154efe941d2`는 No targets deployed로 배포됐으며 공개 POST도 404다. 주 dry_run 버전 `3ab53ceb-8eb0-4799-8993-110a2a3c1c64`에서 앱·연결 상태와 세션 없는 카드 API 401, 운영 local 인증 405를 확인했다. 실제 시험 live 버전은 `890613aa-8513-4170-b097-6cccb3d72a31`이다. 실패 기록·connected/version 3·활성 예약 0을 확인한 뒤 표현형 한 장을 20:06 KST = 11:06 UTC로 저장했다.

### 실제 카카오 한 장 결과·안전 복귀

| 항목        | 실제 결과                                                                      |
| ----------- | ------------------------------------------------------------------------------ |
| 시험 범위   | 기존 ready 표현형 Take your time 한 장·일회 예약·20:06 KST = 11:06 UTC         |
| 실제 호출   | 20:06:05 KST, attempt outcome=sent·delivery state=sent·mode=live·attempts=1    |
| 접수 근거   | 정상 메시지 응답 result_code=0에만 저장되는 API 접수 확인, confirmed_by_user=0 |
| Cron 호출   | CPU 5ms·wall 4763ms·outcome=ok·예외 0                                          |
| 비공개 준비 | CPU 5ms·wall 1723ms·outcome=ok·예외 0                                          |
| 비공개 발송 | CPU 10ms·wall 2289ms·outcome=ok·예외 0                                         |
| 예약 종료   | enabled=0·completed·cursor=1·다음 시각 없음                                    |
| 안전 복귀   | 주 dry_run 버전 `a753d8e4-4923-4273-9700-ff9c09a6a242`                         |
| 누적 보존   | 최초 403/-402 실패 포함 sends=2·실제 API 접수 1·connected/version 3            |

각 호출은 Free 기준 이내지만 발송 10ms에는 여유가 크지 않다. 다른 부하·정상 토큰 갱신·장애 경로의 CPU까지 완료로 표시하지 않는다. 메타데이터 근거는 Git 제외 `backups/live-private-main-20260930.jsonl`, `live-private-delivery-20260930.jsonl`이다. 사용자 토큰이 전달되는 비공개 요청의 헤더·본문·앱 로그는 저장하지 않았다. 지속 observability는 disabled를 유지했다.

앱의 실제 API 접수 1건·20:06 기록과 dry_run 복귀를 확인했다. 화면은 `backups/private-test-accepted-20260930.png`에 있다. 사용자에게 휴대전화의 카드 이미지·한영 글자·원본 링크 확인을 요청했으며 아직 답변 전이다. PC/브라우저/Codex 종료 후 수신, 정상 토큰 갱신, 계정 전체 공유 사용량과 실제 복구 40장 CPU는 미검증이다. API 접수를 실제 열람·모바일 정상 이미지·M5 전체 완료로 표시하지 않는다.

격리 시험 Worker `en-card-cpu-probe`, `en-card-cpu-parent`와 시험 D1 `en-card-cpu-probe`는 삭제 성공을 확인했다. 운영 비공개 Worker·D1·KV와 실패 기록은 보존했다.

## 휴대전화 수신 확인·23:45 종료 시험 준비 — 2026-09-30

### 사용자가 확인한 실제 수신

사용자가 제공한 사진 1.jpg의 20:06 EN_Card 피드에서 표현형 Take your time·한글 뜻·영어 예문·번역·메모가 정상 표시된다. 사용자가 카카오톡으로 왔다고 확인했으며 별도 질문에 원본 카드가 정상적으로 열린다고 답했다. 수신·이미지·원본 링크 검증은 실제 사용자 휴대전화 확인이다. 사진은 Git 제외 `backups/kakao-user-receipt-20260930.jpg`에 보관한다. 정확한 수신 초·휴대전화 기종·그때의 PC 종료 여부는 확인하지 않았다. 20:06 API 접수 결과와 confirmed_by_user=0은 보존하며 unknown 해결을 위한 사용자 확인 필드로 바꾸지 않는다.

### 다음 일회 시험의 저장·활성화 확인

| 항목          | 실제 확인·시험 계획                                                                 |
| ------------- | ----------------------------------------------------------------------------------- |
| 현재 인증     | connected/version 3·갱신 시도 0·오류/잠금 없음                                      |
| 액세스 만료   | 2026-09-30 23:40:27 KST = 14:40:27 UTC                                              |
| 리프레시 만료 | 2026-11-29 17:40:27 KST = 08:40:27 UTC                                              |
| 시험 예약     | PC 종료 · 자동 갱신 검증 · 비교형 1장, id `8a357a9d-ab24-4888-9292-64bc7c4da448`    |
| 카드          | 기존 ready 비교형 Don't rush → Take your time, 한 장·한 회차·반복 없음              |
| 예정 시각     | 2026-09-30 23:45 KST = 14:45 UTC, Asia/Seoul                                        |
| 저장 상태     | version 1·enabled 1·cursor 0, 활성 예약 총 1                                        |
| 모드·배포     | boot API live/local=false, 주 버전 `b760321e-2e8d-42f1-aab6-2d16c95745f0`           |
| 기존 자료     | 최초 실패+20:06 성공으로 누적 2시도/1접수 유지, 새 회차·시도 소비 없음·FK 오류 없음 |

제품 코드·설정 값·스키마·Secrets·의존성은 변경하지 않았다. 기존 전체 Vitest 202개·빌드 결과를 유지하며 테스트를 반복하지 않았다. 같은 실제 live/비공개 설정의 check:free와 원격 DB·boot·활성 예약 화면 검증이 통과했다. Free 계정은 같은 날 Dashboard 확인을 따르며 유료 구성 변경이 없다. 계정 전체 공유 사용량은 미측정이다.

만료 시각을 강제로 바꾸지 않고 자연 만료 후 갱신 경로를 검증할 예정이다. 현재 코드의 accessToken은 만료 1분 전부터 리프레시를 사용하며 성공한 토큰을 암호화 저장한 뒤 버전을 증가시킨다. 리프레시가 1개월 이상 남으면 새 refresh_token이 응답에 없을 수 있으므로 기존 값을 유지한다. [카카오 토큰 갱신](https://developers.kakao.com/docs/ko/kakaologin/rest-api#refresh-token)을 재확인했다. 이것은 앞으로 실행될 코드 경로이며 갱신 성공을 이미 관측한 것이 아니다.

기준 메타데이터는 Git 제외 `backups/pc-off-baseline-20260930.json`, 활성 예약 화면은 `backups/pc-off-scheduled-20260930.png`에 보관한다. 비밀값·Cookie·OAuth 응답은 포함하지 않는다. 로컬 tail이나 Codex 예약 작업에 운영 발송을 의존하지 않는다. 종료 시험 동안의 정확한 갱신 CPU는 아직 미측정이다.

### 사용자가 수행할 종료·수신 확인

1. 23:45 전에 Chrome·Codex를 종료하고 PC를 완전히 종료한다.
2. 휴대전화의 나와의 채팅에서 23:45 이후 비교형 카드·한영 이미지·원본 보기를 확인한다. 푸시 알림·알림음은 없다.
3. 다음 접속 때 `PC 종료 시각 / 실제 카드 수신 시각 / 이미지와 원본 링크 결과`를 알려준다. 사이에 카카오 재연결이나 예약 변경을 했다면 함께 기록한다.
4. 서버의 새 시도·result_code=0에 대응하는 sent·예약 completed·cursor 1과 credentials 버전/새 만료/갱신 오류·잠금을 대조한다. 수신 실패·unknown은 자동 재발송하지 않고 원인을 확인한다.

현재 PC 종료·23:45 메시지 접수·갱신·수신은 모두 **실행 전/미검증**이다. 예약 준비를 M5 완료로 표시하지 않는다. 시험 후 활성 예약은 정상 처리 시 0이 되어야 하며 실패 시 기록을 보존한다.

## review 검토·로컬 재현 — 2026-09-30

- 범위는 `origin/master` merge-base부터 현재 작업 트리까지와 새 비공개 발송 Worker 파일이다. 상세 결과와 승인 대기인 코드/테스트 제안은 [REVIEW_2026-09-30.md](REVIEW_2026-09-30.md)에 있다.
- 실제 소스·메모리 SQLite·mock 발송·Playwright 화면으로 일회 5장 중 3장 성공/2장 pending일 때 일시정지 버튼이 없고 재개가 `SCHEDULE_TIME`으로 실패함을 재현했다. 직접 pause API는 복구 2건, cancel API는 복구 0건이었다. 제공사 호출은 없다.
- 별도 Miniflare에서 두 번째 인증 조회를 지연시킨 결과 실제 갱신 호출은 1회지만 두 요청은 모두 fulfilled였다. 기존 30ms 테스트의 성공 1/실패 1 가정이 잘못된 경우를 재현했다. 제품의 중복 갱신 실패로 세지 않는다.
- 태블릿 561–900px 메뉴의 접근성 이름 소실은 DOM/CSS 소스로 확인했다. 제안한 800px 접근성 회귀 테스트는 아직 적용·실행하지 않았다.
- 본문 문단 CSS 14개 규칙을 16px로 확대한 뒤 `npm run test:e2e`의 Chromium 11개가 46.4초에 통과했다. `test-results/editor-desktop.png`, `editor-mobile.png`를 육안 확인했다.
- `npm run typecheck`, `npm run check:free`, CSS Prettier, `git diff --check`가 통과했다. 인증·비공개 발송·토큰 복구 focused Vitest 3개 파일 48개가 통과했고, 별도 새 로컬 D1에 9개 마이그레이션·FK 검사를 통과했다. 기존 전체 202개 테스트 결과는 이전 실행 기록이며 이번 검토에서 전체를 다시 실행하지 않았다.
- 별도 Codex CLI는 설정 모델을 현재 ChatGPT 계정에서 지원하지 않는 HTTP 400으로 종료했다. 해당 gate는 미실행이다. 독립 Codex app 에이전트 검토를 수행했으며 다른 모델의 검증으로 표시하지 않는다. Adversarial의 테스트/fixture 검토는 요약 범위였다.
- P2 3건과 해당 회귀 테스트 수정은 승인 대기이다. 이번 검토 중 실제 배포·카카오 발송·토큰 변경·예약 변경·커밋·푸시·PR 갱신은 하지 않았다. 23:45 종료 시험과 정상 갱신 CPU는 여전히 미검증이다.

## 승인된 리뷰 수정·회귀 검증 — 2026-09-30

사용자의 “수정 승인” 후 P2 3건과 테스트를 보완했다. 이전 절의 승인 대기는 이 기록으로 해소한다. 확인된 미해결 리뷰 항목은 0건이며 실제 배포 완료를 의미하지 않는다.

- `src/shared/model.ts`, `src/worker/schedules.ts`: 현재 예약 버전의 pending/claimed/retry_wait/blocked 건수를 `pending_delivery_count`로 제공한다. 표시된 첫 100개 발송 기록에 의존하지 않으며 DB 스키마 변경은 없다. `src/worker/engine.ts`는 새 조회 필드를 제외하는 행 타입만 수정했다.
- `src/web/App.tsx`: completed/content_shortage여도 미발송 건수가 있으면 일시정지·복구를 제공한다. 메뉴 버튼에 aria-label을 추가했다.
- `tests/auth.test.ts`: 30ms sleep 대신 갱신 진입/해제 Promise로 TOKEN_BUSY와 완료 후 새 토큰 재조회를 검증한다. 외부 transport 호출은 총 1회다.
- `tests/schedules.test.ts`: 실제 mock 엔진으로 일회·마지막 매일 5장 중 3장을 보낸 뒤 API 미발송 건수 2, 일시정지 후 0, 복구 후보 2, 성공 3장 보존을 검증한다.
- `tests/e2e/pause.spec.ts`, `workflow.spec.ts`: 일회 5장·마지막 매일 5장의 각각 복구/제외 4건과 800px 메뉴 검사 1건을 추가했다. 기존 매일 10장과 45장 분할 처리도 유지한다. 미발송 2장만 새 미래 예약으로 복구하거나 제외하고 성공한 3장은 보존한다.

| 실행                                                                                             | 결과                                                                               |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| 수정 전 새 E2E 2건                                                                               | 일회 일시정지·태블릿 이름 모두 버튼 개수 0으로 실패, 결함 재현                     |
| `npx vitest run tests/auth.test.ts tests/schedules.test.ts`                                      | 2개 파일 35개 통과, 82.32초                                                        |
| 첫 수정 후 전체 E2E                                                                              | 14개 통과·2개 실패. 확대한 모의 성공 fixture들이 같은 분의 3건 제한에 걸림         |
| fixture 기록 분 분리 후 `npm run test:e2e`                                                       | Chromium 전체 16개 통과, 1.1분                                                     |
| `npm run build`                                                                                  | strict typecheck·Vite·주 Worker dry-run 통과                                       |
| `npx wrangler deploy --config wrangler.delivery.jsonc --dry-run --outdir .worker-delivery-build` | 비공개 Worker dry-run 통과, 실제 배포 없음                                         |
| `npm run check:free`                                                                             | 두 추적 설정의 무료 구성 검사 통과, 계정 플랜·원격 CPU는 이 검사에서 확인하지 않음 |
| 변경 파일 Prettier·`git diff --check`                                                            | 통과                                                                               |

테스트 fixture만 분리했으며 실제 분당/일일 제한을 완화하거나 운영 예산을 초기화하지 않았다. 기존 전체 Vitest 202개는 이전 실행이며 이번 수정에서는 전체를 다시 실행하지 않았다. 이번 검증은 로컬/모의이고 실제 카카오 호출·운영 DB·토큰·23:45 live 예약·배포 버전·Git HEAD·원격 PR을 변경하지 않았다. 현재 계정 Free 조건은 앞선 같은 날 기록을 따르며 공유 사용량·실제 갱신 CPU·PC 종료 수신은 계속 미검증이다.

## R7 보완·R5/R6 최종 전체 회귀 — 2026-09-30

이번 사용자 승인 계획은 기존 로컬 수정 보존, R7 구현, 전체 검증, `codex/development` 커밋·일반 푸시와 PR #1 설명 갱신이다. 실제 배포·PR 병합·운영 키 변경은 제외한다. GitHub 비교 기준은 `222d7503d6a82b4f734675e6857cde6cdbf74572`이며 아래 결과는 그 이후의 승인된 로컬 변경 전체를 대상으로 했다. Windows x64·PowerShell·잠금 파일의 Wrangler/Playwright/Vitest를 사용했다.

| 실행                                                                                                | 실제 결과                                                                                               |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 수정 전 `npx vitest run tests/credential-storage.test.ts --testNamePattern 'R7 access의 wrong-key'` | 1건 실패, `OperationError` 전파로 R7 재현                                                               |
| `npm test`                                                                                          | **14개 파일 221개 통과**, 23:23:51 KST 시작, 568.66초                                                   |
| 첫 `npm run test:e2e`                                                                               | 18개 통과·1개 실패. 새 R7 테스트가 기존 API 응답 필드 `error`를 `code`로 잘못 확인                      |
| 필드명 수정 후 `npm run test:e2e`                                                                   | **Chromium 전체 19개 통과, 1.5분**. skip·상한 완화 없음                                                 |
| `npm run typecheck`, `npm run build`                                                                | strict 타입·Vite·주 Worker 배포 dry-run 통과                                                            |
| `npx wrangler deploy --config wrangler.delivery.jsonc --dry-run --outdir .worker-delivery-build`    | 비공개 발송 Worker 번들 통과, 실제 배포 없음                                                            |
| `npm run check:free`                                                                                | 두 추적 설정 통과. 주 Worker 기본 dry_run, 금지된 유료 구성 없음. 계정 청구를 차단/보장하는 검사는 아님 |
| 변경 파일 Prettier·`git diff --check`                                                               | 통과                                                                                                    |

- **R7 전용 14건:** 액세스·리프레시 경로 각각 정상 길이 잘못된 키, 잘못된 키 형식, 손상된 암호문. `needs_reconnect/configuration`, 안전한 오류, 버전 증가, 암호문 보존, blocked와 claim 정리, 반복 Cron의 외부 호출 0회·예산 불변을 확인했다.
- **수동 복구:** 원래 키 복원 후 두 토큰 검증, 실패 시 행 보존, 리프레시 만료 시 재연결, 새 연결 완료/다른 갱신 잠금과의 조건부 갱신 경합을 확인했다. 예약 자동 재개 없음. 외부 갱신 성공 응답 뒤 암호화 저장 실패는 기존 uncertain으로 처리한다.
- **R5:** 40·41·45건 부분 제외, 여러 번 복구/제외, 중복 요청·동시 처리, 미결정 잔여 항목의 재개 차단을 검사했다.
- **R6:** 일회·매일·요일 마지막 5장 중 성공 3장·대기 2장을 엔진과 화면에서 확인했다. 남은 2장만 일시정지 후 복구하거나 제외하고 앞 3장과 시도 이력을 보존했다. fixture의 날짜·분만 분리했으며 운영 한도·예산을 변경하지 않았다.

전체는 격리 Miniflare D1/KV·로컬 Chromium·가짜 인증정보/모의 HTTP를 사용한다. 실제 카카오 토큰 갱신·추가 메시지 발송의 성공 근거로 해석하지 않는다. `.worker-delivery-build/`·비밀값·백업·로컬 DB·생성 산출물은 Git 제외다. 마이그레이션 추가·스키마 변경은 없다.

운영 기준은 앞선 **20:06 사용자 수신 사진·원본 링크 정상·CPU 5/5/10ms·같은 날 Workers Free 확인**을 그대로 보존한다. 기존 **23:45 KST = 14:45 UTC 일회 예약**과 운영 버전·키·토큰·DB를 변경하지 않았다. PC 종료 상태의 수신, 정상 토큰 갱신과 갱신 CPU, 계정 전체 공유 사용량은 확인 전까지 미검증이다. 다음 미완료 단계는 해당 기존 예약의 사용자 확인과 서버 기록 대조다.

## R8 수정·전체 회귀·운영 재확인 — 2026-10-01

Windows/PowerShell의 현재 작업 트리에서 `e66d0afd39c8362428a547118a24df1dbe0cccb6`을 기준으로 재현·수정했다. 외부 보고서의 진단 통과 개수를 수정 검증으로 재사용하지 않았다.

| 실행                                    | 실제 결과                                                                                                                     |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 수정 전 R8 정상 기대 검사               | 미결정 후보 1건 대신 0건으로 실패해 누락 재현. 최초 중복 이미지 fixture 오류는 제품 결함 근거에서 제외                        |
| 초기 수정 후 `tests/pause-race.test.ts` | 10개 통과, 37.41초. 이후 소진·새 연결 경합 3건 추가                                                                           |
| 조회 개선 focused 실행                  | 34통과/1실패. Miniflare RPC 객체의 spy가 쿼리를 포착하지 못한 검사 준비 문제. DB Proxy로 실제 호출을 포착한 뒤 85건 검사 통과 |
| 전체 `npm test`                         | **15개 파일 235개 통과**, 00:23:36 KST 시작, 622.82초                                                                         |
| 전체 `npm run test:e2e`                 | **Chromium 19개 통과, 1.3분**. 45건 완료 이력 40/5 페이지·더 보기 포함                                                        |
| `npm run build`                         | strict 타입·웹·주 Worker와 발송 Worker dry-run 모두 통과. 표준 build에 두 번들을 통합                                         |
| `npm run check:free`                    | 두 추적 설정 통과. 기본 dry_run·유료 의존성 추가 없음                                                                         |
| 변경 파일 Prettier·`git diff --check`   | 통과                                                                                                                          |

R8의 13건은 확정 미접수 4종, 성공·unknown·취소 유지, 제한/401 소진 중 일시정지, production Cron→비공개 HTTP Worker→모의 429/-10·401/-401·403/-402, 새 연결 완료와의 경합을 검사한다. 미결정 재개 차단, 복구·제외 뒤 남은 카드 보존, claim 정리와 원래 모든 시도 기록을 확인한다. 응답 저장의 조건부 UPDATE와 기존 복구 트리거를 사용하며 추가 마이그레이션은 없다. 원격 카카오 호출은 하지 않는다.

조회 개선은 미결정 40건·선택한 요청 대상만 SQL에서 제한한다. 85건을 40/40/5로 처리하고 동일 decided_at의 완료 이력을 40/40/5 keyset 페이지로 중복·누락 없이 읽었다. 잘못된 커서·다른 예약 버전은 거부한다. 완료 이력 GET도 기존 세션 접근 제어를 통과해야 한다. 이 개선을 R5의 별도 미해결 결함으로 집계하지 않는다.

### 기존 23:45 예약의 읽기 전용 운영 확인

- 사용자 답변: **PC·Chrome·Codex를 종료하지 않았으며 마지막 카드 수신 시각은 23:45**. 이 결과를 PC 종료 시험으로 표시하지 않는다.
- D1: 예정 2026-09-30 23:45:00 KST, 호출 23:45:01.947, 저장 23:45:04.408. live/sent·attempts 1·시도 outcome sent. 원래 예약은 completed/disabled·cursor 1·next null이다.
- 사용자 원본 링크와 DB public_id가 일치한다. `/original/1e30986897f54acd96a0b5ab8d0f0ae5af94e9a94872498a932d32302eeb0a34`의 HTTPS 응답은 HTTP 200·image/png·87,785바이트로 DB bytes와 일치했다. 추가 메시지는 보내지 않았다.
- 인증은 version 4·connected·attempts 0·failure/retry null·잠금 없음이다. 액세스 만료는 2026-10-01 04:01:49.049 KST, 리프레시 만료는 2026-11-29 22:01:49.049 KST다. 이 값만으로 새 OAuth와 자동 갱신을 구분할 수 없으므로 **정상 토큰 갱신 성공은 미검증**이다. 만료 시각을 인위적으로 변경하지 않았다.
- 현재 활성 예약 0건, 일시정지 뒤 retry_wait/blocked/failed인데 복구 관계가 없는 R8 형태도 0건이다. 조회 결과 모두 rows_written=0·changed_db=false다. 운영 데이터 보정은 없다.
- 배포 목록과 Cloudflare 화면 모두 주 Worker `b760321e-2e8d-42f1-aab6-2d16c95745f0`(9월 30일 20:26 KST), 자식 `aa8c160b-965d-43d3-b09b-c154efe941d2`(19:57 KST)를 확인했다. R7 커밋은 23:38 KST이며 새 R7/R8 수정본은 아직 배포하지 않았다.
- 10월 1일 Cloudflare Workers 요금제 화면에서 **Free·US$0·현재 요금제**를 재확인했다. 기존 주 Worker에는 Logs/Traces가 비활성화돼 있어 지난 호출의 갱신 CPU를 소급 확정할 근거가 없다. 화면의 전체 기간 CPU 집계를 해당 갱신 호출 수치로 쓰지 않는다. 계정 전체 공유 사용량은 계속 미확인이다.

### 배포 전 운영 검증 계획

검증된 R7/R8 코드를 기존 두 Worker에 배포하는 단계는 이전 사용자 계획의 제외 범위였으므로 별도 승인을 받은 후 수행한다. 기존 D1/KV·Secrets·키·소유자·지연/횟수 상한·과거 예약/호출 이력은 보존한다. 신규 스키마 변경은 없다.

정상 갱신과 CPU는 자연 만료 이후의 첫 본인 한 장을 PC가 켜진 상태에서 로컬 tail의 안전한 CPU·시간·결과만 기록해 확인한다. 다음 한 장은 별도 미래 시각에 PC·브라우저·Codex를 종료하고 수신을 확인한다. 두 시험 모두 일회 예약과 일일 발송 예산을 사용하며 실제 접수·수신·CPU를 따로 기록한다. 위 계획 작성 시점에는 배포·새 시험 예약을 수행하지 않았고, 이후 아래 승인 범위를 적용했다.

## 승인 후 실제 배포·두 시험 예약 — 2026-10-01 08:02~08:10 KST

사용자는 두 Worker의 최신 수정 배포와 오늘 09:00 정상 갱신·CPU 시험, 09:10 PC 종료 수신 시험을 각각 본인 한 장으로 승인했다. 시험은 자연 만료 상태를 사용하며 키·암호문·만료값을 변경하지 않는다. 새 OAuth 연결이나 추가 메시지를 실행하지 않는다.

| 확인                            | 실제 결과                                                                                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 배포 코드                       | `a954ceda7248171a165e6069626a66ee795b3a4d` (R5~R8 포함)                                                                                                             |
| 실제 운영 구성 검사             | main SHA 147312546ff1548a24d1896552d5a53f88bd04693942968c24dbb8584e504b10, delivery SHA d57a2a40e2024cf982b0b0a9456f6be1121f50ebddc12352f600165385ec3abf, live 통과 |
| 실제 구성 dry-run               | 기존 두 Worker 바인딩·웹 자산 번들 통과                                                                                                                             |
| 비공개 발송 Worker 배포         | `4cd666e8-8f06-4135-a415-cbc900812c55`, 08:02:34 KST, 100%                                                                                                          |
| 주 Worker 배포                  | `1dbacb30-332c-40c1-8506-09b85ea0e996`, 08:02:47 KST, 100%, 기존 매분 Cron 1개                                                                                      |
| 배포 후 공개 경로               | boot HTTP 200·local false·mode live·카카오 설정 존재, 기존 원본 PNG 200/image/png·87,785바이트                                                                      |
| 자식 공개 접근                  | HTTP 404, Service Binding만 사용                                                                                                                                    |
| 09:00 일회 예약                 | `5ca71713-e8b8-4d6d-ba73-56a14f8461ed`, UTC 1790812800000, version 1·enabled·cursor 0·ready 이미지 1장                                                              |
| 09:10 일회 예약                 | `5e773613-b746-4fc2-8710-9c9f36d43b62`, UTC 1790813400000, version 1·enabled·cursor 0·ready 이미지 1장                                                              |
| 시험 전 DB                      | 시험 회차 0건, 오늘 sends 소비 0건, FK 오류 0건                                                                                                                     |
| 시험 전 인증                    | connected/version 4, 액세스 만료 04:01:49.049 KST, refresh 만료 2026-11-29 22:01:49.049 KST, refresh_attempts 0·failure null·잠금 없음                              |
| 정상 갱신·해당 호출 CPU         | **09:00 결과 대기**                                                                                                                                                 |
| 새 카드 실제 휴대전화 수신·원본 | **사용자 확인 대기**                                                                                                                                                |
| PC·Chrome·Codex 종료 후 수신    | **09:10 결과 대기**, 서버 접수와 사용자 종료/수신 증언을 함께 확인해야 함                                                                                           |

배포 목록과 읽기 전용 D1 조회로 위 상태를 확인했다. 카드 선택 검증의 첫 보조 SELECT는 잘못된 `schedule_version` 컬럼명으로 실패했고, 실제 스키마의 `schedule_items.version`으로 수정한 조회가 각 ready 이미지 1장과 시험 회차 0건을 확인했다. 실패한 SELECT로 운영 DB를 변경하지 않았다. 앱의 예약 저장 알림은 dry_run 동작도 설명하지만 실제 활성 모드는 boot와 화면 LIVE, 위 운영 설정에서 확인했다.

안전한 로컬 tail은 새 두 배포 버전에 한정해 Cron/준비/발송의 CPU·wall time·결과·예외 수만 저장한다. Wrangler 디스크 로그와 사용 통계 전송은 수집 프로세스에서 끈다. 요청 URL은 메모리에서 경로 분류만 하고 헤더·쿠키·본문·OAuth 응답·토큰·원래 예외는 저장하지 않는다. 초기 실행 세션이 사라진 것을 실제 PID와 도구 핸들로 확인한 후 숨김 백그라운드 프로세스로 다시 시작했다. Git 제외 `backups/live-cpu-en-card-20261001.jsonl`, `backups/live-cpu-en-card-delivery-20261001.jsonl`에 안전한 근거만 남기며 09:04 종료한다. 일회 후속 확인은 이 채팅에서 09:03 실행한다. 실제 발송 시각은 이 로컬 후속 작업이 아닌 Cloudflare Cron이 처리한다.

09:00 첫 시험 확인까지 PC·Chrome·Codex를 켜두고 정상 확인 뒤 09:10 전에 종료한다. 계정 Free·US$0은 같은 날 기존 화면 확인 기록을 유지하며 공유 사용량은 계속 미확인이다. 제품 코드는 전체 235개·Chromium 19개·타입/빌드가 통과한 그대로 배포했으며 문서·배포 변경에 전체 테스트를 반복하지 않았다. 전체 목표와 M5는 아직 완료하지 않았다.

## 09:00 정상 토큰 갱신·실제 접수·CPU 목표 미충족 — 2026-10-01 09:01 KST

08:58:14 KST의 시험 직전 조회에서도 version 4·connected·만료 04:01:49.049·refresh 유효·잠금/오류 없음이고 두 회차는 미생성이었다. 운영 키·토큰·만료값을 조작하거나 새 OAuth를 수행하지 않았다. 자연 만료 뒤 production Cron이 갱신을 수행한 결과를 새 인증 버전/만료와 실제 메시지 접수, 같은 배포의 tail 이벤트로 대조했다.

| 항목                                 | 실제 결과                                                                                                               |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| 첫 시험 delivery                     | `2d625475-af25-4b65-a262-875e2228908c-0`                                                                                |
| 예정 / 실제 호출 / 결과 저장         | 09:00:00 / 09:01:22.631 / 09:01:24.025 KST                                                                              |
| 발송 상태                            | live/sent, attempts 1, auth_retries 0, claim 없음, 시도 outcome sent                                                    |
| 원래 예약                            | completed/disabled, cursor 1, 새 재시도 없음                                                                            |
| 오늘 발송 예산                       | sends 1, 정상 갱신 대기는 메시지 시도 추가 소비 없음                                                                    |
| 새 인증                              | version 5·connected, 액세스 만료 15:01:19.985 KST, refresh 만료 기존 값 유지, refresh_attempts 0·failure null·잠금 없음 |
| 갱신 포함 주 Cron                    | **CPU 14ms**, wall 4369ms, outcome ok, 예외 0, 주 배포 `1dbacb30`                                                       |
| 비공개 회차 준비                     | CPU 4ms, wall 739ms, outcome ok, 예외 0, 발송 배포 `4cd666e8`                                                           |
| 비공개 실제 발송                     | CPU 10ms, wall 1606ms, outcome ok, 예외 0, 발송 배포 `4cd666e8`                                                         |
| 정상 토큰 갱신 / 카카오 API 접수     | **실제 성공 확인**                                                                                                      |
| CPU 10ms 목표                        | **Cron 초과로 미충족**. API 성공을 무료 CPU 검증 통과로 바꾸지 않음                                                     |
| 휴대전화 새 카드·원본 / PC 종료 수신 | 사용자 확인 대기, 09:10 종료 시험은 enabled/cursor 0·미소비로 유지                                                      |

Cron CPU 14ms에는 갱신과 claim/dispatch가 함께 포함된다. 별도 갱신 함수만의 CPU라고 주장하지 않는다. 약 1분 24초의 예정 대비 지연도 기록하며 정시·무중단을 보장하지 않는다. 09:00:33의 보조 D1 읽기는 일시적인 Cloudflare API 7403 오류였고 동일한 읽기 재시도가 성공했다. 제품의 토큰 갱신 실패나 추가 메시지 시도로 집계하지 않는다.

같은 날 공식 [Workers 가격](https://developers.cloudflare.com/workers/platform/pricing/)·[호출 한도](https://developers.cloudflare.com/workers/platform/limits/)에서 Free 100,000요청/일·HTTP와 Cron 호출당 CPU 10ms를 다시 확인했다. 외부 fetch/KV/DB 응답 대기는 CPU에 포함되지 않고 간헐적 초과에 실행 여유가 있어 outcome ok여도 10ms 충족 근거가 되지 않는다. [D1 가격](https://developers.cloudflare.com/d1/platform/pricing/)은 Free 읽기 500만/일·쓰기 10만/일·총 저장 5GB, [KV 가격](https://developers.cloudflare.com/kv/platform/pricing/)은 저장 1GB·읽기 10만/일·쓰기/삭제/list 각각 1,000/일·00:00 UTC 일일 초기화를 명시한다. 계정 Free 확인과 호출 CPU·공유 사용량 확인은 각각 구분한다.

후속 과제는 갱신 포함 CPU 경로를 경량화하거나 기존 무료 작업으로 분할하고 회귀·두 Worker 검증 및 실제 정상 갱신 CPU를 다시 확인하는 것이다. 추가 실제 발송은 기존 두 시험의 승인 범위를 넘어 자동 실행하지 않는다. 자연 만료 상태를 유지하며 다음 액세스 만료는 15:01:19.985 KST이다. 이 절은 09:01 결과이며 이후 종료 수신 확인은 아래 절을 따른다. M5·전체 목표는 CPU 보완이 남아 완료하지 않았다. 이 채팅에서 첫 결과를 직접 확보해 일회 09:03 확인 자동화는 PAUSED로 종료했다. 안전 CPU 수집기는 09:04 자동 종료했고 Git 제외 로컬 근거를 보존한다.

## PC·Chrome·Codex 종료 후 이미지·원본 수신 — 2026-10-01 09:11 KST

사용자가 PC·Chrome·Codex를 모두 종료했고 09:11에 카드가 도착했다고 확인했다. 제공한 카카오 사진은 Take your time 표현형 이미지와 오전 9:11 시각을 보여준다. 휴대전화에서 원본 보기도 정상적으로 열린다고 답했다. PC 종료의 정확한 시각은 별도로 제공하지 않았으며 추정값을 기록하지 않는다.

| 항목                      | 실제 결과                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 예약 / delivery           | `5e773613-b746-4fc2-8710-9c9f36d43b62` / `ae29ade8-b51d-4fb8-bcea-0c15beb05b5c-0`                             |
| 예정 / 호출 / 결과 저장   | 09:10:00 / 09:11:05.511 / 09:11:07.430 KST                                                                    |
| API 결과                  | live/sent, attempts 1, auth_retries 0, claim 없음, 시도 outcome sent                                          |
| 원래 예약                 | completed/disabled, cursor 1, next_run 없음                                                                   |
| 실제 수신                 | **사용자 확인: 세 프로그램/기기 종료 상태, 09:11 이미지 수신·원본 정상**                                      |
| 표현형 원본               | public ID `50d0803d255a490e8f59d1a411a4c2c98df1ccba043344a49f9f6d1e2e702e17`, HTTP 200·image/png·84,292바이트 |
| 09:42 읽기 전용 운영 조회 | 두 시험 종료, 활성 예약 0, 2026-10-01 sends 2, connected/version 5·오류/잠금 없음                             |
| 해당 회차 CPU             | 미측정. 안전 수집기는 09:04 종료됐으므로 09:00 수치를 재사용하지 않음                                         |

서버 접수와 휴대전화 수신을 각각 확인했으며 로컬 모의 테스트와 구분한다. 예정 대비 약 1분 7초 늦게 접수됐다. PC 종료 발송·이미지·원본 검증은 완료했고 정상 갱신 포함 CPU 14ms 보완·재측정은 남아 있다. 두 승인 시험은 각각 1회로 종료했으며 추가 예약·메시지·배포·키/토큰 변경은 하지 않았다. 계정 Free·US$0은 같은 날 확인 기록을 유지하고 공유 사용량은 미확인이다.

## 정상 갱신 CPU 분리의 로컬 검증 — 2026-10-01

`auth.ts`·`crypto.ts`는 정상 갱신 표시와 인증 작업 안의 AES 키 준비 1회를 적용한다. `engine.ts`·`index.ts`·`delivery-service.ts`는 갱신 성공 시 기존 비공개 Worker에 ID·claim 소유자만 보내 정리하고 메시지를 다음 분 실행으로 넘긴다. 토큰 원문·암호문·키는 정리 요청에 없다. claim 소유권·일시정지·취소·버전·15분 유예·원래 회차/커서와 메시지 한도를 유지한다. 기존 주·비공개 발송 Worker 두 개와 바인딩·Secret·DB 스키마는 그대로다. UI와 설정/운영 안내에 추가 대기를 반영했다.

| 검사                         | 결과                                                      |
| ---------------------------- | --------------------------------------------------------- |
| 새 갱신 분리 회귀            | **16개 통과**, 51.04초                                    |
| 전체 Vitest                  | **16개 파일 251개 통과**, 10:13:01 KST 시작·670.59초      |
| 전체 Chromium E2E            | **19개 통과**, 1.2분                                      |
| npm run build                | strict 타입·웹·주/발송 두 Worker dry-run 통과             |
| 실제 운영 설정 두 dry-run    | 기존 D1/KV·Service Binding·자산 번들 통과, 원격 배포 없음 |
| 무료 구성                    | 추적 기본 설정·실제 live 두 설정 모두 통과                |
| 변경 파일 Prettier·diff 검사 | 통과                                                      |
| 추가 실제 카카오 메시지·CPU  | 미실행, 기존 두 시험 승인 범위 밖                         |

16건은 실제 production Cron과 비공개 HTTP 진입점을 연결하되 격리 D1/KV·가짜 인증·모의 제공사 응답을 사용한다. 정상 갱신 첫 실행에 메시지 0회·예산 불변·claim 정리를 확인하고, 다음 실행들의 5장 3/2 처리와 유효 토큰의 즉시 처리를 확인했다. 401 뒤 갱신에도 분리를 적용하고 허용한 추가 메시지 1회·auth_retries 1을 확인했다. 잘못된 소유자·중복 정리, 정리 호출 전/후 응답 유실의 안전한 재개, 일시정지/취소·15분 경과, 새 OAuth·동시 갱신, R7 키 형식 오류, 회전 시 AES 키 준비 1회와 다른 키 격리를 포함한다. 정상 정리의 retry_at은 다음 분 경계이며, 정리 미접수 시 claim 만료 경계 자체에서는 회수하지 않고 이후 실행에서 회수한다.

이 회귀의 통과는 CPU 작업 분리·보호 동작을 검증한 것이며 실제 ms CPU 통과 근거가 아니다. 현재 운영 배포는 `a954ceda`·주 `1dbacb30`·발송 `4cd666e8` 그대로다. 새 분리 코드의 실제 배포와 자연 만료 후 정상 갱신/다음 발송의 CPU 재측정은 승인 후 수행한다. 현 액세스 만료는 15:01:19.985 KST이며 추가 키·토큰·만료 조작이나 자동 예약은 없다.

실제 live 설정 SHA-256은 주 `147312546ff1548a24d1896552d5a53f88bd04693942968c24dbb8584e504b10`, 발송 `d57a2a40e2024cf982b0b0a9456f6be1121f50ebddc12352f600165385ec3abf`로 배포 전 기록과 같다. 최종 무료 검사도 accountPlan/remoteCpu는 검사 자체로 확인하지 않는다고 표시한다. 같은 날 Dashboard의 Free·US$0 기록을 유지하고 계정 공유 사용량은 미확인이다. 다음 실행 명령은 `npm run build`, `npm run check:free -- --config wrangler.live.jsonc --delivery-config wrangler.delivery.deploy.jsonc --mode live`이며 승인 후 자식→주 순서로 `npx wrangler deploy --config wrangler.delivery.deploy.jsonc`, `npx wrangler deploy --config wrangler.live.jsonc`를 수행한다. CPU 측정은 새 배포 버전의 갱신 Cron·정리 요청·다음 발송 Cron·준비/발송 요청을 각각 확인해야 한다.

## CPU 분리 승인 배포·10:45 유효 토큰 시험 준비 — 2026-10-01

위 로컬 검증 절의 미배포·15:01 만료는 배포 전 시점 기록이다. 사용자 승인으로 제품 코드 `8638e2ab0023d0d9e5435ab98c574db854ab4c6a`를 같은 실제 live 설정으로 배포했다. 비공개 `en-card-delivery`를 먼저 배포했으며 버전 `42185de3-70c5-43b4-a4c3-cc81a0ffcff3`의 배포 시각은 10:32:48.877 KST, 주 `en-card` 버전 `fe54570a-9a08-4584-8ba4-837f07148a2b`는 10:33:04.267이다. 목록에서 각각 100% 적용을 확인했다. boot는 live·kakao_configured true, 비공개 자식의 공개 접근은 404, 기존 원본 PNG는 200·image/png·87,785바이트다. 기존 D1/KV·Secrets·스키마·바인딩·Cron 하나를 유지했고 PR은 병합하지 않았다. 배포 startup 20/28ms는 호출별 CPU 측정이 아니다.

최초 승인 시각 10:35를 넘겨 예약을 만들지 못했으며, 최소 2분 여유를 우회하지 않고 사용자에게 재선택을 요청했다. 사용자가 **10:45 유효 토큰 본인 한 장 시험**을 선택했다. 앱에서 예약 `083f9d84-f0bc-4486-bcbc-ae5b7a715025`를 once/version 1·10:45 KST로 저장했다. UTC 01:45·1790819100000, enabled 1·cursor 0·준비 이미지 한 장(비교형·87,785바이트), 시험 회차 0·오늘 sends 2·FK 오류 0을 읽기 전용 조회로 확인했다. 15:05 예약이나 추가 카드는 만들지 않았다.

인증 메타데이터는 이전 version 5에서 조회 중 version 6·7로 바뀌었다. 시험 전 최신은 version 7·connected, 액세스 만료 16:38:16.112 KST, refresh 만료 2026-11-30 10:38:16.112, 시도 0·오류/잠금 없음이다. 변경 원인을 OAuth/정상 갱신 중 하나로 단정하지 않는다. 이번 배포·예약 작업에서 로그인·재연결·키/토큰/만료 조작은 수행하지 않았다. 10:45 시험은 정상 갱신 CPU 검증을 대신하지 않는다.

두 새 배포 버전의 Cron·준비·발송·정리 호출을 안전 수집기로 구분한다. 저장 항목은 호출 시각·CPU/wall·결과·예외 개수·버전뿐이며 원문 요청/응답·토큰·키·쿠키는 보관하지 않는다. Wrangler 디스크 로그/사용 통계는 수집기에서 비활성화했고 산출물·화면은 Git 제외 backups에 둔다. 조회 준비 중 잘못된 열 이름 두 건(i.card_id/a.status)은 7500으로 실패했으며 스키마의 a.card_id/a.state로 정정한 읽기 전용 조회는 통과했다. 제품 실패나 발송 실패로 집계하지 않는다.

## 새 배포의 유효 토큰 실제 발송·CPU 결과 — 2026-10-01 10:45 KST

| 항목               | 실제 결과                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------- |
| 대상               | 위 10:45 once 예약, 기존 비교형 이미지 한 장, 본인 나와의 채팅                               |
| delivery           | `712a9dfd-89fd-4a93-b8f0-00b927b68c67-0`                                                     |
| 호출 / 결과 저장   | 10:45:55.209 / 10:45:57.583 KST (`1790819155209` / `1790819157583`)                          |
| 발송               | live·sent, attempts 1·auth_retries 0, claim_owner/claim_until 없음                           |
| 예약               | completed·enabled 0·cursor 1·version 1·next_run null                                         |
| 인증               | 시험 전후 version 7·connected·같은 액세스 만료 16:38:16.112, 갱신 시도 0·오류/잠금 없음      |
| 예산 / 활성 예약   | 오늘 sends 2→3, 활성 예약 0                                                                  |
| 주 Cron            | CPU **4ms**, wall 4356ms, 10:45:53.729 시작, 새 주 버전 일치                                 |
| 비공개 준비        | CPU **2ms**, wall 982ms, 10:45:53.730 시작, 새 자식 버전 일치                                |
| 비공개 발송        | CPU **7ms**, wall 2642ms, 10:45:55.209 시작, 새 자식 버전 일치                               |
| 호출 결과          | 세 호출 모두 outcome ok·예외 0                                                               |
| 모바일 이미지      | 사용자 사진의 **10:45 비교형 카드 수신·이미지 표시 확인**                                    |
| 원본               | 사용자 제공 기존 비교형 URL, 서버 200·image/png·87,785바이트. 휴대전화 열림은 명시 확인 대기 |
| 정상 갱신·정리 CPU | 이번 회차에는 실행되지 않아 미검증                                                           |

새 코드의 **이번 유효 토큰 발송 호출**은 모두 10ms 목표를 충족했다. wall은 네트워크/DB 응답 대기를 포함하며 CPU와 구분한다. 이전 갱신 포함 Cron 14ms를 이 4ms로 대체하지 않는다. 새 코드의 자연 만료 정상 갱신 Cron·정리 요청·다음 발송 호출을 각각 측정해야 한다. 키·토큰·만료를 조작하거나 추가 발송을 자동 예약하지 않는다. 제품 소스와 설정은 전체 251개·Chromium 19개·빌드·두 실제 설정 dry-run·무료 검사를 통과한 `8638e2a` 그대로이고 이번 후속은 문서 변경이다.

## 16:42 자연 만료 갱신 CPU 시험 승인·준비 — 2026-10-01

아래는 당시 준비 기록이며, 후속 사용자 승인으로 같은 예약을 11:30 조기 갱신 시험으로 대체했다. 16:42 추가 발송은 없다.

사용자의 **진행 승인**은 앞서 요청한 16:42 KST 본인 카드 한 장 추가 시험을 허용한다. 기존 Chrome 운영자 세션에서 로그인·재연결 없이 일회 예약을 저장했다. 추가 배포·키/토큰/만료 변경·반복 예약·PR 병합은 없다. 아래는 시험 전 기준이며 실제 갱신·API 접수·CPU·새 모바일 수신 완료 기록이 아니다.

| 기준        | 시험 전 확인                                                                           |
| ----------- | -------------------------------------------------------------------------------------- |
| 예약        | `30ba832f-8b4b-479b-a2e1-79bac0457a39`, once·2026-10-01 16:42 KST                      |
| UTC / 상태  | 07:42·1790840520000, version 1·enabled 1·cursor 0, 활성 예약 1                         |
| 준비 이미지 | 기존 비교형 asset `623d64a6-4c5e-4f2c-8965-aef1905fc386`, ready·87,785바이트·한 장     |
| 인증        | connected/version 7, 액세스 만료 16:38:16.112 KST·refresh 만료 2026-11-30 10:38:16.112 |
| 갱신 / 예산 | 시도 0·오류/잠금 없음, 시험 회차/발송 0·오늘 sends 3, FK 오류 0                        |
| 운영 코드   | 제품 `8638e2a`, 주 `fe54570a`·비공개 발송 `42185de3`, 기존 무료 구성 유지              |
| 수집 대기   | 실제 PID 38812/39964·node, 16:39 시작·16:52 자동 종료                                  |
| 수집기 검사 | node --check 통과, 준비 시 대기 이벤트 확인, CPU 실측은 아직 없음                      |
| 후속 확인   | 기존 이 채팅 heartbeat ACTIVE·오늘 16:40 사전 확인·16:46 결과 확인의 두 번 실행        |

수집기는 이전에 검증한 안전 parser를 사용하며 Cron·준비·발송·`/_internal/defer` 정리를 구분한다. 긴 시간 tail 연결을 유지하지 않고 시작 전 node 타이머로 대기한다. `backups/refresh-cpu-job-20261001-1642.json`의 PID와 현재 프로세스로 대기를 확인하며 관찰 timeout이나 파일만으로 실행 종료를 판단하지 않는다. 생존하지 않거나 명확한 종료가 확인된 경우에만 수집기를 다시 시작한다. 원문 요청/응답·쿠키·키·토큰은 저장하거나 출력하지 않고 산출물은 Git 제외 backups에 둔다. heartbeat는 새 발송이나 토큰 변경을 수행하지 않으며 승인된 한 장의 결과만 확인한다.

이번 변경은 제품 코드와 설정을 바꾸지 않아 기존 전체 Vitest 251개·Chromium 19개·두 Worker 빌드·무료 구성 통과 기록을 유지한다. 문서 서식·diff와 로컬 수집기 문법을 검사한다. 정상 갱신·CPU 결과는 시험 후 기록한다. 계정 Workers Free·US$0은 같은 날 확인 기록을 유지하며 계정 공유 사용량은 여전히 미확인이다. PC·Codex를 켜두고 카카오 다시 연결을 실행하지 않는 것이 이번 시험 조건이다.

## 11:30 조기 갱신 CPU 시험 변경 승인·결과 — 2026-10-01

사용자가 앱 저장 만료 시각 조정과 같은 본인 카드 한 장의 예약 앞당김을 승인했다. 기존 운영자 화면으로 예약 `30ba832f-8b4b-479b-a2e1-79bac0457a39`를 11:30 KST·UTC 02:30·1790821800000·version 2로 변경했다. 이미지 asset `623d64a6-4c5e-4f2c-8965-aef1905fc386`는 그대로 ready·87,785바이트이며 활성 예약 1·회차/발송 0·오늘 sends 3이다.

11:28:11.171 KST에 인증 version 7·connected·원래 만료·오류/잠금 없음·진행 중 claim 없음·예약 version 2를 조건으로 `expires_at`만 1790840296112에서 1790821631171로 변경했다. 한 행 변경을 확인했고 키·토큰 원문과 refresh 만료 1796002696112는 직접 변경하지 않았다. OAuth·재연결·추가 배포는 하지 않았다. 이는 앱의 조기 갱신 조건을 만드는 조작이며 카카오에 저장된 만료 변경이나 자연 만료가 아니다.

Git 제외 기준 파일은 `backups/refresh-baseline-20261001-early.json`, 갱신 직후 발송 전 조회는 `backups/refresh-checkpoint-20261001-early.json`이며 수집기/CPU 파일은 같은 early 접미사다. 안전 수집기 부모 30356/22644·자식 34172/36720에서 실제 Cron·준비 메타데이터를 확인했다. 이전 16:42 수집기를 종료했고 heartbeat를 11:34 결과 확인으로 변경했다. 앱 저장 화면 증거는 `backups/reservation-20261001-early.jpg`다.

| 단계 / 호출        | KST 시작 시각 | CPU | wall   | 결과 / 배포 버전            |
| ------------------ | ------------- | --- | ------ | --------------------------- |
| 실제 갱신 Cron     | 11:30:56.049  | 6ms | 4574ms | ok·예외 0 / 주 fe54570a     |
| 갱신 회차 준비     | 11:30:56.129  | 2ms | 985ms  | ok·예외 0 / 비공개 42185de3 |
| 갱신 후 claim 정리 | 11:30:59.961  | 2ms | 738ms  | ok·예외 0 / 비공개 42185de3 |
| 다음 발송 Cron     | 11:31:49.232  | 2ms | 3894ms | ok·예외 0 / 주 fe54570a     |
| 발송 회차 준비     | 11:31:49.234  | 1ms | 470ms  | ok·예외 0 / 비공개 42185de3 |
| 한 장 전송         | 11:31:50.213  | 3ms | 2686ms | ok·예외 0 / 비공개 42185de3 |

첫 단계에서 인증은 connected/version 8·새 액세스 만료 1790843456391(17:30:56.391 KST)·refresh 만료 기존 값 유지·시도 0·오류/잠금 없음이다. delivery `7f8b8d2a-69ff-4a3a-916a-be6bc9379e7f-0`는 retry_wait·attempts 0·auth_retries 0·claim 없음·retry_at 1790821860000(11:31)·오늘 sends 3으로 조회됐다. 실제 갱신 뒤 claim 정리 경로를 실행했으며 첫 단계 메시지 호출/예산은 0이다.

다음 Cron의 유일한 시도 `55b02b2e-907c-4985-b4e1-68c96d71b5fd`는 started_at 1790821910213·live/sent이며, 접수 저장은 1790821912621(11:31:52.621 KST)이다. 회차 `7f8b8d2a-69ff-4a3a-916a-be6bc9379e7f` 한 개·예약 version 2/completed/enabled 0/cursor 1·활성 예약 0·오늘 sends 4·claim/retry 없음·FK 오류 0을 확인했다. 이전 version 1의 delivery는 0건으로 16:42 추가 발송은 없다.

원본 경로는 서버에서 200/image/png·87,785바이트였고 사용자가 **수신·이미지·원본 모두 정상**이라고 답했다. 이는 사용자 휴대전화 확인이며 API 접수만으로 대신한 것이 아니다. 이번 시험은 PC·Codex를 켜둔 CPU 수집 시험이다. 종료 수신은 앞선 09:11 사용자 확인 기록으로 구분한다.

현재 수정본의 실제 조기 갱신·정리·후속 발송 호출은 모두 Free 10ms 목표 이내였다. 앞선 09시 Cron 14ms는 이전 코드 측정으로 보존한다. 앱 만료 시각을 조정한 이번 결과는 자연 만료 시험으로 기록하지 않는다. 한 장 실측으로 실제 다량 발송 CPU·계정 공유 한도·무중단을 보장하지 않는다. 결과 확인 후 수집기의 소유한 부모/자식 6개를 종료해 남은 프로세스 0이며 heartbeat는 PAUSED다. 제품 코드·설정·배포는 그대로이고 운영 문서만 변경한다. 로컬 251개·Chromium 19개·타입/빌드·두 Worker dry-run·무료 구성 검사 결과를 유지하며 문서 서식·diff를 검사한다.

## PR 재검토 수정의 로컬 검증 — 2026-10-01

위 실제 배포·수신·CPU 기록은 `8638e2a` 당시 결과다. 이번에는 사용자 승인으로 R9·R10·T1·A1을 로컬에서 수정했다. 검토 기준 HEAD는 `9b0b43f323e88541bef66163498487c97fee6455`이며 검증 종료 당시에는 미커밋 상태였다. 이후 사용자는 동일 검증본의 커밋·일반 푸시·PR #1 설명 갱신을 승인했다. 기존 0001~0009는 변경하지 않고 새 0010을 격리 테스트 DB에만 적용했다. 운영 배포·운영 마이그레이션·실제 카카오 호출은 수행하지 않았다.

| 검사                                          | 실제 결과                                                                  |
| --------------------------------------------- | -------------------------------------------------------------------------- |
| R9/R10 집중 Vitest                            | 2개 파일 **20개 통과**, 30개 제외·102.79초                                 |
| 페이지 조회 단독 Chromium                     | **1개 통과**, 15.1초·새 로컬 DB                                            |
| 전체 Chromium E2E                             | **19개 통과**, 1.4분                                                       |
| 전체 Vitest                                   | **16개 파일 266개 통과**, 14:26:53 KST 시작·762.43초                       |
| npm run build                                 | strict 타입·웹 빌드·두 Worker 배포 dry-run 통과                            |
| npm run check:free                            | 추적된 Workers Free/D1/KV와 두 Worker 구성 통과                            |
| 전체 src/tests/docs Prettier·git diff --check | 통과                                                                       |
| 기존 23개 파일 서식 정리의 검증               | 관련 TypeScript 20개 HEAD 대비 AST 변경 0·재빌드 통과, 나머지 Markdown 3개 |
| 수정 후 독립 적대적 소스 재검토               | 추가 확정 결함 0건, Codex app·fixture/test 요약 모드                       |

R9는 실제 예약 수정·대체 발송·일시정지 순서로 0008→0009의 잘못 편입된 관계를 재현하고, 0010 후 옛 카드가 복구 후보에서 제거되며 재개가 가능해짐을 검사했다. 진짜 일시정지 미결정 항목, 완료된 복구/제외 결정과 대상 목록, 원본 delivery·예산·FK를 보존했다. 기존 40·41·45장 경계와 중복·동시 부분 처리 검사도 최신 마이그레이션 경로에 유지했다.

R10은 발송 중 취소 뒤 retry·401·재연결·실패 거절에서 claim/retry 정리, 시도별 원래 결과 보존과 이미지 삭제 가능을 검사했다. production Cron→비공개 Worker를 연결한 모의 HTTP 429/-10·401/-401·403/-402와 새 OAuth 경합도 포함한다. 성공과 unknown은 원래 결과·이미지 보호를 유지하며 취소에서 일시정지 복구 후보가 생기지 않는다. 이미 이전 서버에서 생긴 취소 예약의 blocked를 소급 정리하는 마이그레이션은 없으며 운영 확인 후 수동 정리 절차는 `OPERATIONS.md`를 따른다.

T1은 테스트 자체가 추가 초안을 만들어 101개 이상을 확보하므로 앞선 테스트 데이터 없이 다음 페이지와 JSON 백업을 검증한다. A1은 세 확인 대화상자의 초기 포커스·Tab/Shift+Tab·배경 inert·Escape·닫힌 뒤 원래 버튼 복귀·처리 중 닫기 금지를 검사했다. 비동기 요청 전 opener를 보존하고 busy가 해제된 뒤 자동 닫기의 포커스를 복귀한다. 전체 Chromium에는 마지막 5장 회차의 미발송 2장 복구/제외와 성공 3장 보존도 포함된다.

서버 단위·통합 검사는 Miniflare D1/KV와 합성 인증·모의 제공사 응답이며 실제 메시지 수신을 증명하지 않는다. Chromium은 로컬 Worker와 실제 Canvas PNG를 사용한다. 수정 중 대화상자 포커스 실패와 테스트 선택자 실패를 수정한 뒤 최종 19개 전체 실행을 통과했으며, 실패 산출물은 Git 제외 backups에 보존했다. 상세한 최초 재현·수정 결과는 `REVIEW_2026-10-01.md`를 따른다. Codex CLI 모델 지원 오류와 Claude 부재 때문에 다른 모델의 교차 검증은 수행하지 못했다.

로컬 검증 종료 당시 수정본의 실제 배포·0010 운영 적용·원격 CPU는 미실시였다. 이후 별도 승인으로 아래 운영 적용을 완료했다. 기존 PC 종료 수신·이미지·원본과 조기 갱신 한 장 실측은 당시 기록으로 보존하며 새 수정본의 실측으로 재사용하지 않는다.

무료 구성 검사는 `deploymentPerformed=false`, `accountPlan=미확인`, `remoteCpu=미검증`, `billingGuarantee=false`를 출력했다. 기존 같은 날 계정 Free·US$0 기록은 보존했으며 이번 작업에서 계정 플랜·공유 사용량을 새로 조회하지 않았다. 구성·의존성·보호 상한은 변경하지 않았다. 이후 수정본을 운영에 적용할 때는 `SETUP.md`의 백업·미적용 0010·FK/이력 확인 후 두 Worker 순서로 진행한다.

처음 전체 서식 검사에서는 기존 23개 파일이 실패하여 서식을 정리했다. 관련 TypeScript 20개는 Prettier의 TypeScript parser로 HEAD/수정본 AST를 비교해 위치·주석·raw 메타데이터 이외의 변화가 없음을 확인했다. 전체 266개·19개 실행 후의 변화는 이 서식과 문서 기록뿐이며 빌드·전체 서식·diff를 다시 확인했다. 0010을 포함한 동작 변경은 전체 테스트 당시 코드와 같다. 독립 소스 검토도 서식 정리 후 추가 제품 로직 변경·확정 결함이 없음을 확인했다.

## 승인된 0010 운영 적용·최신 코드 배포 — 2026-10-01 15:36~15:42 KST

Git 반영을 완료한 제품 소스 **9965568bd0cefc7d8bc27f4f2b1a238d3cefd0fe**에 대해 사용자가 백업·0010 운영 적용·기존 두 Worker 배포를 승인했다. PR 병합·추가 실제 카카오 발송·새 예약·키/토큰/만료 변경은 수행하지 않았다. 이전 8638e2a의 실제 수신·CPU와 이번 배포 후 HTTP 검사를 구분한다.

### 계정·구성과 백업

- Cloudflare Dashboard에서 **Workers Free·현재 요금제·US$0**를 새로 확인했다. 배포 전 Workers 요청 스냅샷은 **804/100,000**, 관측 로그·빌드 사용은 0이다. 이는 당시 계정 집계이며 개별 발송 CPU 측정이 아니다.
- Wrangler 계정 일치를 확인했고 기존 권한만 사용했다. 기존 리소스는 Worker 3개(앱 두 개와 다른 기존 Worker), D1 en-card 1개·270,336바이트, KV CARD_IMAGES 1개다. 신규 리소스·유료 전환·추가 권한을 만들지 않았다. D1/KV 계정 전체의 일일 읽기·쓰기 사용량은 조회하지 않았다.
- 실제 live 구성의 무료 검사와 두 Worker dry-run이 통과했다. 메인 설정 SHA-256은 147312546ff1548a24d1896552d5a53f88bd04693942968c24dbb8584e504b10, 자식은 d57a2a40e2024cf982b0b0a9456f6be1121f50ebddc12352f600165385ec3abf로 기존과 같다. 구성 검사 출력의 accountPlan 미확인과 별도 Dashboard의 실제 플랜 확인을 구분한다.
- 15:36:57.315 KST에 메인 Cron을 잠시 제거하고 활성 예약·claimed/sending/unknown **0**을 확인했다. 운영 D1을 Git 제외 backups/deploy-20261001-a937d4765e7e4db1bf6943374449d849에 내보냈다. SQL은 **56,425바이트**, SHA-256 **d1997cf7bbaf5a7058569f6e539efab747c29203e4061d9d3c4ff1dceed2b7da**다.
- 백업 폴더는 현재 사용자와 SYSTEM만 접근하도록 ACL 상속을 차단했다. 15:37:54.121 KST에 Windows DPAPI CurrentUser로 암호화하고 복호화 후 SQL 해시 일치를 검증했다. 암호화본 pre-0010.sql.dpapi와 비밀값 없는 이력·해시 증거만 보관하고 평문 임시 SQL은 제거했다. 이 백업 복호화에는 같은 Windows 사용자 프로필의 DPAPI 키가 필요하다. 백업·토큰·키·로컬 도구는 Git에 포함하지 않는다.

### 실제 마이그레이션과 보존 확인

운영에 적용된 이력은 0001~0009였고 migrations list의 미적용 항목은 **0010 하나**였다. 15:38 KST에 migrations apply가 이를 정상 적용했고 이력 10개·PRAGMA foreign_key_check 빈 결과를 확인했다. 잘못 편입된 미결정 관계와 pause_recoveries 자체는 적용 전 0행이었으므로 실제 관계 삭제는 0행이다. 오류를 포함한 운영 데이터를 새로 만들어 재현하지 않았다. 해당 삭제 동작은 위 로컬 회귀에서 검증했다.

적용 전·직후·배포 후 **15개 앱/이력 테이블**의 모든 행을 프로세스 메모리에서 읽고 정렬한 SHA-256과 개수를 비교했다. 토큰·세션 값은 출력하거나 메타데이터에 저장하지 않았다. 바뀐 테이블은 d1_migrations 하나이며 나머지 14개는 일치했다.

| 보존 대상           | 배포 후 상태                                                                 |
| ------------------- | ---------------------------------------------------------------------------- |
| 카드·이미지·예약    | 카드 14, 이미지 2, 예약 8·활성 0; 행 내용 동일                               |
| 발송·시도·회차      | delivery 7(기존 sent 6·blocked 1), 시도 7, 회차 7; 결과·claim·호출 기록 동일 |
| 인증                | connected/version 8; 암호문 포함 행 해시 동일·오류/잠금 없음                 |
| 예산·저장량         | 오늘 sends 4·uploads 0, 저장량 172,077바이트; usage/tick 행 동일             |
| 복구 관계·수동 판단 | 기존 0행 보존; 새 결정/예약/메시지 없음                                      |
| FK·이력             | FK 오류 0, 0001~0010 10개 적용                                               |

최초 읽기 전용 상태 조회는 존재하지 않는 schedules.created_at 정렬로 7500 오류가 났다. 스키마의 id로 정정한 조회와 이후 해시 비교는 정상 완료했다. 이 조회 오류는 제품 실패·발송 실패로 집계하지 않는다.

### 실제 두 Worker 배포·HTTP 확인

비공개 발송 Worker를 먼저 배포하고 메인 Worker를 뒤에 배포했다. Cloudflare deployment metadata에서 다음 버전이 각각 **100%** 적용된 것을 확인했다.

| Worker           | 새 버전                              | 배포 시각 KST |
| ---------------- | ------------------------------------ | ------------- |
| en-card-delivery | f4584787-c98c-4869-bc2c-0ee21ba3f970 | 15:38:32.574  |
| en-card          | 898d18b3-d086-47f0-a68a-c290c9ffdc56 | 15:38:49.572  |

메인 매분 Cron 하나는 15:38:51.110 KST에 복원됐다. 같은 D1/KV·서비스 바인딩과 기존 Secret 이름, 두 Worker의 APP_ORIGIN·COST_MODE=free_only·SEND_MODE=live를 유지했다. Secret을 다시 입력하거나 변경하지 않았다. 자식의 workers.dev·preview URL은 모두 비활성화이고 Cron은 없다. 배포 출력의 startup 35ms/18ms는 개별 호출 CPU가 아니다.

| 원격 확인                  | 실제 결과                                            |
| -------------------------- | ---------------------------------------------------- |
| GET /api/boot              | 200·local false·mode live·kakao_configured true      |
| GET / 및 JS/CSS            | 200·로컬 dist와 SHA-256 일치; 최신 UI 자산 확인      |
| 로그인 없는 GET /api/state | 401                                                  |
| 운영 POST /auth/local      | 405·세션 쿠키 발급 없음                              |
| 자식 Worker 공개 GET       | 404                                                  |
| 기존 /original/1e3098…     | 200·image/png·87,785바이트·1080×1080                 |
| 기존 운영자 Chrome 화면    | 연결됨·LIVE·활성 예약 0·오늘 시도 4/20·저장량 0.17MB |

15:42:22.867 KST의 최종 DB 조회에서도 인증·예약·발송/호출 기록·예산 해시는 백업 전과 같았고 FK 오류는 0이었다. 기존 이미지 URL과 수신 이력은 보존됐다. 이번 HTTP·화면 확인은 실제 배포에 대한 검사이며 추가 카카오 메시지 성공을 뜻하지 않는다.

제품 코드가 같은 검증본이므로 앞선 **Vitest 266개·Chromium 19개·타입/빌드** 결과를 유지한다. 이번에는 운영 설정의 free 검사·두 dry-run·원격 백업/마이그레이션/배포·HTTP/화면 검사를 새로 수행했다. 운영 기록만 추가한 뒤 문서 서식·diff를 다시 검사한다. 최신 배포의 실제 발송·정상 갱신·다량 발송 CPU와 자연 만료 후 수신은 추가 승인된 시험에서 확인해야 하며, 기존 한 장 CPU를 최신 배포 수치로 재사용하지 않는다.

## R11 후속 마이그레이션·취소 원인 분리 — 2026-10-01

기준 HEAD는 03797ad4fb055129dd8868418f30af79c91d18ee다. 수정 전 회귀 1개가 8.81초에 실패해 옛 연결 해제 카드가 확정 미발송으로 표시되는 문제를 재현했다. 0011은 기존 0009/0010을 보존하고 잘못 편입된 미결정 관계만 정리하며 완료된 결정·원본/호출/예산/FK를 유지한다. 새 cancellation_reason 쓰기·트리거는 오류 문구와 독립적이다. 자세한 보존 검사와 코드 범위는 [R11_FIX_REPORT.md](R11_FIX_REPORT.md)를 따른다.

R8~R11 집중 **29개 통과**(22개 제외·154.99초), R11 및 최신 스키마의 40/41/45 경계 집중 **9개 통과**(25개 제외·52.40초), 전체 Chromium **19개 통과**(1.3분), strict 타입·Vite·두 Worker dry-run·무료 구성 검사를 새로 실행했다. 최종 전체 Vitest는 **17개 파일 272개 통과**, 16:32:30 KST 시작·806.43초다. 전체 src/tests/docs 서식·diff도 확인했다. Chromium의 Wrangler uv_interface_addresses 시작 오류는 이 Windows 환경에서 재현되지 않았다. 서버 검사는 합성 인증·모의 제공사 응답이며 실제 카카오 발송과 구분한다.

운영 조회의 연결 해제 cancelled·해당 미결정 복구 관계·전체 pause_recoveries는 각각 0행이고, 0001~0010 이력·FK 오류 0을 확인했다. 이 조회는 읽기 전용이며 비밀값을 조회하지 않았다. R11 코드·0011의 운영 적용·추가 카카오 메시지·새 예약·키/토큰 변경은 수행하지 않았다. 신규 의존성·리소스·설정 변경은 없고 기존 Free/CPU 기록은 이전 배포 결과로 보존한다. R11 배포 전에 SETUP.md의 0011 선행 조건을 충족해야 한다.

## 승인된 R11 운영 적용 — 2026-10-01 17:03~17:06 KST

사용자 승인 후 제품 소스 **6ec4579124f4d0d29dd34507f66ae7187476fb96**와 0011을 운영에 반영했다. 제품 코드는 위의 Vitest **272개·Chromium 19개** 통과본과 같으며 이번에는 타입·웹/두 Worker 빌드와 실제 live 설정의 무료 구성 검사·두 dry-run을 다시 실행해 통과했다. 전체 테스트를 다시 실행했다고 집계하지 않는다.

Cloudflare Dashboard에서 **Workers Free·US$0·현재 요금제**를 새로 확인했다. 당시 계정 Workers 요청은 **991/100,000**, Observability 이벤트와 빌드 시간은 0이다. 기존 D1 1개·270,336바이트, KV 1개, 앱 두 개를 포함한 Worker 3개를 재사용했다. Workers·D1·KV 요금/한도 공식 문서를 다시 확인했으며 유료 리소스·요금제·의존성·권한을 추가하지 않았다. D1/KV 계정 전체 일일 읽기·쓰기 집계는 미조회다.

### 쓰기 중단·백업·마이그레이션

- 17:03:18.929 KST에 매분 Cron을 제거했다. DB/API 호출을 전혀 하지 않는 임시 메인 Worker를 배포하고 API·POST·인증 콜백이 503 유지보수 응답인 것을 확인해 신규 쓰기를 차단했다. 백업 전 활성 예약·claimed/sending/unknown은 모두 0이었다.
- Git 제외 `backups/r11-deploy-20261001-94707f33ab3748f5afc9a9e834f4a0b2`에 전체 DB를 export했다. SQL은 **56,559바이트**, SHA-256 **d1246bab94f0034141eadea475dcebd308e625e12996f4af409986314c7b418d**다. 백업 폴더 ACL은 상속을 차단하고 현재 Windows 사용자만 접근하도록 제한했다.
- 17:04:15.512 KST에 DPAPI CurrentUser 암호화·복호화 왕복 해시 일치를 확인하고 평문 임시 SQL을 제거했다. 같은 Windows 프로필의 DPAPI 키가 필요하며 백업·로컬 도구는 Git에 포함하지 않는다.
- 기존 이력 0001~0010을 확인하고 원본 0011 SQL과 해당 이력 INSERT를 묶은 Git 제외 file import를 한 번 실행했다. 원본 0011 SHA-256은 **949e18eb1b7c563a14210a7ac2346ec97e1f98df33d1ae6eaef39acf34af1687**이다. 과거 Windows query 분할 문제를 피하는 file import 경로이며 원본 마이그레이션은 바꾸지 않았다. **6개 쿼리 성공**, 직후 17:04:40.390 KST에 이력 11개·FK 오류 0을 확인했다.

전·직후·배포 후 15개 테이블의 개수와 정렬한 행 SHA-256을 프로세스 메모리에서 비교했다. 토큰·세션은 출력하거나 상태 기록에 저장하지 않았다. delivery는 새 cancellation_reason 열을 제외한 원본 행과 따로 계산한 취소 원인 해시를 비교했다. 바뀐 원본 테이블은 **d1_migrations 하나**이며 나머지 14개는 모두 일치했다. 기존 delivery 7개는 새 원인이 모두 NULL이고 잘못 편입된 미결정·완료된 비일시정지 관계는 0건이어서 실제 관계 삭제·선택 취소는 없었다. 운영 DB에 결함 재현 데이터를 만들지 않았다. 새 paused 원인과 부모 paused 상태를 요구하는 실제 트리거 SQL도 확인했다.

### 두 Worker 배포·원격 확인

| Worker           | 운영 버전                            | 배포 시각 KST |
| ---------------- | ------------------------------------ | ------------- |
| en-card-delivery | dc80024f-646e-4d30-a982-8cf198943a9b | 17:04:44.492  |
| en-card          | 1f0fb02c-7259-45eb-935d-ddccda4ddc59 | 17:04:52.795  |

비공개 발송 Worker를 먼저 배포하고 메인을 뒤에 배포했으며 deployment metadata에서 각각 **100%** 적용을 확인했다. 메인 Cron 하나는 17:04:54.346 KST에 복원됐다. 기존 D1/KV·서비스·Secret 이름과 live/free_only 설정을 유지하고 Secret을 다시 입력하거나 변경하지 않았다. 자식의 workers.dev·preview URL은 비활성화이고 Cron은 없다. 임시 로컬 유지보수 설정은 원래 dry_run 설정으로 복원했다. 배포 startup 17ms/15ms는 개별 호출 CPU 측정이 아니다.

원격 GET /api/boot는 **200·local false·live·kakao_configured true**, /와 JS/CSS는 **200·로컬 dist 해시 일치**였다. 로그인 없는 /api/state는 **401**, POST /auth/local은 **405·쿠키 발급 없음**, 자식 공개 URL은 **404**다. 기존 /original/1e3098…는 **200·image/png·87,785바이트·1080×1080**이며 운영자 Chrome의 새로고침 뒤 **연결됨·LIVE·활성 0·오늘 시도 4/20·저장량 0.17MB**를 확인했다.

17:06:18.989 KST 최종 DB 대조에서도 인증 connected/version 8·암호문/만료/잠금, 예약 8·활성 0, delivery/시도/회차 각 7, 오늘 예산 sends 4·uploads 0, 이미지 저장량 172,077바이트와 FK 오류 0을 유지했다. 추가 실제 카카오 메시지·새 예약·키/토큰/만료 변경·PR 병합은 수행하지 않았다. 이번 원격 검사는 배포·데이터 보존·HTTP/화면 확인이며 최신 버전의 실제 발송·갱신·다량 CPU는 미측정이다. 이전 실제 수신·원본·PC 종료·한 장 CPU 기록을 새 버전 실측으로 재사용하지 않는다.

## 승인된 R12/R13/R14·A2/M1/D1 로컬 보완 — 2026-10-01

기준 HEAD·원격 브랜치·PR #1은 **0c34fff839d30a98079f9d972413ac5e3776e108**, 운영 제품은 **6ec4579·0011**이다. 사용자가 리뷰의 6건 모두 로컬 수정·검증을 승인했다. 0012의 미결정 출처 보호, 인증 대기 카드와 호출 전 원자적 중지 재확인, 세션+CSRF 또는 기존 등록 토큰의 OAuth 시작, 복구창 내부 오류·입력 보존, 순서에 무관한 엄격 서비스 비교와 안내 대비를 보완했다. 변경 근거와 회귀는 [배포 후 리뷰](REVIEW_2026-10-01_POST_DEPLOY.md)를 따른다.

| 실행한 검사          | 최종 결과                                                  |
| -------------------- | ---------------------------------------------------------- |
| `npm test`           | **17개 파일·299개 통과**, 18:08:40 KST 시작·892.86초       |
| `npm run test:e2e`   | **Chromium 19개 통과, 1.4분**                              |
| `npm run build`      | 타입·Vite·두 Worker 배포 dry-run 통과                      |
| `npm run check:free` | 기본 dry_run 구성 통과·배포 없음·계정/원격 CPU 미확인 표시 |
| 전체 Prettier·diff   | src/tests/docs·검사 스크립트·README 통과                   |
| 기존 마이그레이션    | 0001~0011 변경 0·신규 0012만 추가                          |

기존 272개에 새 단위 회귀 27개를 추가했다. R12는 수정 전 available=true로 실패한 뒤 수정 후 복구 거부·제외·재개와 전체 이력·예산·트리거·FK 보존을 확인했다. R12/R11/R9·40/41/45 경계 집중 20개(16개 제외, 155.33초), 최종 R14 인증 32개(53.18초), M1 무료 구성 12개(2.20초)가 통과했다. R13 마지막 조회 뒤 중지·버전 변경 7개와 R12 역사 shim 1개 집중 8개, 다른 Cron의 unknown 이력 보존 1개도 통과했다. 중간 R13 fixture는 sending의 버전 변경을 막는 기존 트리거에 의해 거부되어 실제 허용된 claimed 단계로 수정했다. 보완 중 중단한 전체 실행은 통과 결과로 집계하지 않았다.

A2는 모의 400 진단 이후 실제 격리 Worker의 RECOVERY_TIME 400을 Chromium에서 받아 내부 alert·카드 체크·날짜/시각 보존·수정 후 성공을 확인했다. D1 안내는 실제 로컬 브라우저의 computed style 16px·rgb(98,110,128)·흰 배경으로 대비 5.1706:1을 확인했다. 인증·발송 회귀는 합성 토큰과 모의 제공사·sender를 사용했으며 실제 카카오 성공이 아니다.

최종 소스의 독립 재검토에서 미해결 결함은 0건이다. GPT-5.5 CLI의 추가 계약 후보는 승인된 대체 인증·갱신 소진 정책과 대조해 제외했다. read-only sandbox 파일 읽기 오류는 권한 확장 없이 소스를 stdin으로 제공해 source-only 재검토를 완료했다. 최종 src/tests/migrations/scripts manifest SHA-256은 **BD1D7FA34EB13560210387E7159168636396EE1CE2DB781C1D66CFBAD58A91A2**이며 검증 중 소스가 바뀌지 않았다. 이는 미커밋 로컬 기준으로 새 GitHub SHA가 아니다.

18:18 KST GitHub 재조회에서도 PR #1은 OPEN·원격 HEAD 0c34fff였다. 이번 작업에서 커밋·푸시·PR 수정·0012 원격 적용·배포·실제 카카오 발송·병합·운영 키/토큰/예약 변경은 수행하지 않았다. 무료 구성·기존 리소스는 유지했고 계정 플랜은 이번 로컬 검사에서 새로 조회하지 않았다. 17:04 R11 배포 당시 Workers Free·US$0 확인과 이전 실제 수신·PC 종료·CPU 기록은 보존한다. 최신 운영과 보완본의 실제 발송·갱신·다량 CPU는 별도 운영 검증이 필요하다. 로컬 실행은 `npm run dev`, 미래 운영 반영은 [SETUP.md](SETUP.md)의 0012 선행·백업·쓰기 중단·두 Worker 순서를 따른다.

## 후속 Git 반영 승인 — 2026-10-01

검증한 제품 수정본을 **b24c2df9699d6428aad3b3c1549cfbee919bcfb5** (`fix: guard recovery provenance and OAuth admission`)로 커밋하고 기존 `codex/development`에 일반 푸시했다. 코드·회귀·신규 0012·문서 **19개**만 포함했으며 비밀값·백업·로컬 DB·생성 산출물은 제외했다. 강제 푸시는 하지 않았다. 18:37 KST 재조회에서 PR #1은 OPEN·HEAD b24c2df였고 제목 `feat: 영어 카드 제작·카카오 예약 발송 MVP 구현`은 그대로였다.

커밋 전 검증 manifest와 src/tests/migrations/scripts가 일치하여 전체 299개·Chromium 19개·타입/빌드·두 dry-run 결과를 같은 제품 소스에 연결했다. Git 단계에서 전체 테스트를 다시 실행했다고 집계하지 않는다. 게시 상태를 명확히 하기 위한 후속 문서 커밋에는 제품 소스를 변경하지 않는다. PR 설명은 승인된 6건·실제 로컬 검증·현재 운영 버전·미측정 CPU를 구분해 갱신한다.

이번 승인은 Git 반영 단계에 적용했다. 현재 운영 6ec4579·0011, 키·토큰·예약과 이전 실제 수신/CPU 기록은 유지하며 0012 원격 적용·두 Worker 배포·새 실제 카카오 발송·CPU 시험·PR 병합은 수행하지 않았다. 다음 운영 단계는 백업·쓰기 중단·0012·두 Worker 적용 후 승인된 실제 CPU 검증이다.

## 0012 운영 적용·최신 자연 만료 갱신·CPU 실측 — 2026-10-01

사용자가 0012 운영 적용·두 Worker 배포·최신 CPU 실측을 승인했다. 검증한 제품 소스는 **b24c2df9699d6428aad3b3c1549cfbee919bcfb5**, 배포 기준 HEAD는 **bf1726d8e9ff0e229836a006039ecb4a3452b8de**다. 후속 기록 커밋은 문서만 변경한다.

- **무료 계정·사전 검증:** 18:51~18:52 KST Dashboard에서 Workers **Free·현재 요금제 US$0**를 다시 확인했다. 기존 D1 1개·KV 1개·Worker 3개(이 앱 2개)를 재사용했다. 실제 live 설정 무료 검사·타입/Vite 빌드·두 기본 dry-run·두 실제 배포 설정 dry-run을 새로 실행해 통과했다. src/tests/migrations/scripts manifest는 앞선 전체 **299개·Chromium 19개** 검증본과 일치한다. 전체 테스트를 배포 단계에서 새로 실행했다고 집계하지 않는다.
- **백업·마이그레이션:** 18:53 KST Cron을 제거하고 API·OAuth 콜백 쓰기 503을 확인했다. 활성 예약·claimed/sending/unknown 0에서 전체 SQL **57,030바이트**를 개인 접근 제한 경로에 내보내 Windows DPAPI CurrentUser로 암호화했다. 복호화 SHA-256 일치를 확인하고 평문 파일을 제거했다. 18:54~18:55 KST 미적용 0012와 이력 INSERT만 file import하여 **12개 이력·FK 오류 0**을 확인했다. 기존 14개 데이터 테이블은 정확히 같고 d1_migrations만 변경됐다. 오류 재현 데이터를 운영 DB에 만들지 않았다.
- **배포:** 비공개 en-card-delivery **d6e4c28b-a570-48c8-bf8a-8f3f7d09126f**를 **18:55:21.466 KST**, 주 en-card **1bcc6eb4-9640-485b-9e26-3943c644b2f3**를 **18:55:29.264 KST**에 각각 100% 배포했다. **18:55:30.788**에 매분 Cron 하나를 복원했다. 기존 D1/KV·Secret 이름·서비스 바인딩·live 설정을 유지하고 자식 공개/preview URL·Cron은 비활성 상태다. 임시 로컬 유지보수 설정은 원래 dry_run으로 복원했다. startup **19/17ms**는 호출 CPU 수치가 아니다.
- **원격 확인:** boot 200·local false·live·kakao_configured true, 화면/JS/CSS 200·로컬 dist 해시 일치, 로그인 없는 state 401, 로컬 인증 POST 405·쿠키 없음, 자식 공개 URL 404를 확인했다. 기존 원본 PNG는 200·87,785바이트·1080×1080이다. 인증 없는 OAuth 시작은 **403/SETUP_TOKEN·쿠키 없음·auth_state 해시 불변**이다. Chrome의 API 직접 접근은 ERR_BLOCKED_BY_CLIENT로 차단되어 최신 운영자 화면 상호작용은 검증하지 못했다. 시험 예약은 승인된 Cloudflare D1 관리 API로 생성했으며 앱 HTTP 예약 저장을 검증한 것으로 집계하지 않는다.
- **실제 한 장 시험:** 기존 검토 완료 이미지의 새 일회 예약 **9e58d837-867b-4002-9543-df8208de4df8**, **19:03 KST / UTC 10:03 / 1790848980000**을 준비했다. 저장 액세스 만료 **18:30:56.391 KST**가 이미 지났으며 만료값·키·토큰 원문을 직접 조작하지 않았다. 실제 갱신으로 **version 8→9**, connected·잠금/오류 없음·refresh 만료 유지가 확인됐다. 갱신 직후 retry_wait·claim NULL·시도 0·예산 4회를 유지하고 다음 실행에서 **19:04:36.344 KST API 접수 1회**, delivery sent·live 시도 1·claim/retry NULL·오늘 sends **5/20**을 확인했다. 사용자가 **수신·이미지·원본 모두 정상**을 확인했다. 이번 측정은 PC를 켠 상태이며 이전 PC 종료 09:11 확인과 구분한다.

| 최신 배포 실제 호출 | Cron CPU | 준비 CPU | 정리/발송 CPU | 해당 호출 wall 시간 |
| ------------------- | -------- | -------- | ------------- | ------------------- |
| 자연 만료 갱신      | 6ms      | 3ms      | 정리 2ms      | 3753/868/651ms      |
| 다음 실행 발송      | 2ms      | 1ms      | 발송 8ms      | 4131/417/3048ms     |

위 호출은 모두 최신 배포 version ID·outcome ok·예외 0이며 **각 호출 CPU 10ms 이내**다. 정제 수집기는 요청/헤더/토큰/로그 원문을 저장하지 않고 호출 종류·시각·CPU·wall·결과·버전만 기록했다. 수집기와 자식 프로세스는 **19:05:51.732 KST 종료**했고 Codex 예약 자동화는 새로 만들지 않았다. 두 Worker의 Cron은 클라우드에서 유지된다. [공식 Workers 제한](https://developers.cloudflare.com/workers/platform/limits/)에서 네트워크·KV·DB 대기는 CPU와 구분하며, [D1](https://developers.cloudflare.com/d1/platform/pricing/)·[KV](https://developers.cloudflare.com/kv/platform/pricing/)의 현재 Free 정책도 재확인했다.

최종 DB는 카드 14·이미지 2·예약 9(활성 0)·회차/발송/시도 각 8·sent 7/과거 blocked 1·저장량 172,077바이트·업로드 0·FK 오류 0이다. 새 시험 행과 sends 증가 1을 제외한 **기존 14개 테이블 행 내용의 해시 일치**를 다시 확인했다. credentials는 승인된 정상 갱신으로 변경됐고 연결 version 9·오류/잠금 없음이다. 기존 실패·수신·원본·예산 이력은 삭제하거나 덮어쓰지 않았다.

완료 범위는 0012·최신 두 Worker 배포·자연 만료 갱신·본인 한 장 CPU/API 접수/휴대전화 확인이다. **실제 다량 발송 CPU, D1/KV 전체 계정 일일 사용량, Chrome의 최신 인증 화면 상호작용은 미검증**이다. 이 한 장 수치를 모든 부하의 보장으로 확대하지 않는다. PR #1은 설명만 갱신하며 병합하지 않는다. 비밀값·암호화 백업·수집기·운영 설정은 Git 제외를 유지한다.

## Chrome·최종 리뷰·5장 실제 CPU — 2026-10-02

기준 HEAD는 `7c82b18488f07a62ffc9d7396a88ebdd36d6dfdc`, 이전 운영 제품은 `b24c2df`·0012다. 사용자가 Chrome 확인·5장 실측·계정 사용량·리뷰 후 수정·Merge commit 병합을 승인했다. 첫 시험 5장과 수정 재검증 추가 5장 범위이며 새 수신 총량은 최대 10장, 실제 KST 일일 호출 상한은 20회다. 새 키·권한·토큰 만료값을 만들거나 직접 변경하지 않았다.

### Chrome 정상 흐름과 첫 CPU 실패

- 같은 Chrome에서 앱의 정상 OAuth를 완료해 인증 version 9→10으로 연결됐다. 기존 API URL 직접 탐색의 `ERR_BLOCKED_BY_CLIENT`를 앱 전체 차단·확장 프로그램 원인으로 확대했던 판단을 정정했다. 로그인·카드·예약 요청은 실제 앱 화면에서 성공했다.
- 08:02~08:04에 기존 초안 That makes sense·Let me check·I’m on my way를 검토하고 PNG로 저장했다. 새 이미지 78,331/75,972/75,906바이트와 기존 표현형·비교형을 합쳐 서로 다른 ready PNG 5개·402,286바이트를 확인했다. 이미지 수정은 새 asset/revision이며 기존 링크를 덮어쓰지 않았다.
- Chrome에서 08:11 KST/UTC 10월 1일 23:11에 일회 5장 예약을 저장했다. 08:11:36.117·38.009·39.852에 실제 접수 3회, Cron CPU 6ms·준비 4ms·발송 **14/5/4ms**였다. 첫 14ms는 실패로 기록하고 08:12:32.166에 화면에서 일시정지했다. 남은 2장은 cancelled/paused·시도 0, 성공 3장은 sent·각 시도 1이며 claim은 모두 해제됐다. 사용자가 3장 수신·이미지·원본 정상도 확인했다.
- 최초 남은 2장은 재검증 예약으로 자동 복구하지 않았다. 08:18 수집기 종료 후 별도 수정과 승인된 추가 5장을 준비했다.

### 수정·회귀·배포

고정 피드와 메시지 응답의 경량 가드, 로그인 전 boot 모드 표시, pause/unknown 창 내부 오류, JSON 503 환경 검증, 최대 4개 병렬 stream 존재 검사, 0013 이미지 역참조 인덱스와 복구 중 상한 rollback 회귀를 보완했다. 원인 확정 없이 first-use 비용을 줄인 선택이며 로컬 Node 경과 시간·Worker startup을 Cloudflare 호출 CPU로 표시하지 않는다. 상세 발견·수정·검토 한계는 [최종 리뷰](REVIEW_2026-10-02_FINAL.md)를 따른다.

| 최종 로컬 검사                          | 결과                                                                                             |
| --------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 전체 Vitest                             | **17개 파일·334개 통과**, 08:35:57 KST 시작·947.84초·종료 0                                      |
| 전체 Chromium                           | **22개 통과**, 1.9분·종료 0                                                                      |
| 타입·Vite·두 Worker dry-run             | 통과                                                                                             |
| 기본/실제 live 무료 구성·전체 서식·diff | 통과                                                                                             |
| 실제 배포 설정 두 dry-run               | 통과                                                                                             |
| 검증 소스 보존                          | 199개 파일 변경 0, manifest **EFF3473F2D6B96266E81D01565EBDEFD7DB24EB1828A8C020C1F2CA37BE0B6ED** |

로컬 제공사·인증 응답은 모의이며 실제 카카오 수신으로 집계하지 않는다. 독립 적대적 검토의 테스트·fixture는 요약 모드다. 설치된 CLI의 모델 호환성·sandbox 파일 읽기 오류와 5분 source-only 제한으로 추가 CLI 결과가 없으며 이를 clean 또는 structured gate pass로 기록하지 않았다. 완료한 전문 검토 7개·Red Team·독립 적대적 검토의 발견을 수정하고 재확인했다.

08:53:22 KST에 Cron을 제거했고 임시 메인의 API/POST/콜백 경로가 503인지 확인했다. 활성 예약·claimed/sending/미해결 unknown 0에서 전체 SQL **76,499바이트**를 접근 제한된 폴더에 내보내 **Windows DPAPI CurrentUser**로 암호화했다. 08:54:37에 복호화 왕복 SHA-256 **1EA8FED6A5988E7E7E668FFD28786FF67B78E55E1D53043E9DF0883AA391E829**·제한 ACL을 확인하고 평문 임시 파일을 제거했다. Secret·토큰·내보내기 다운로드 URL을 출력하지 않았다.

0013 원본 SHA-256 **b9b352b3cd9b732fc94b78f9e9eabe9ddeb86c5c5612dea7393ee8b535d7dfd7**와 이력 INSERT를 file import해 **2개 쿼리·13개 이력·FK 오류 0**을 확인했다. 기존 0001~0012는 변경하지 않았고 기존 데이터 14개 테이블은 정렬한 행 해시가 일치한다. d1_migrations만 1건 증가했다.

| Worker           | 100% 운영 버전                       | 배포 시각 KST |
| ---------------- | ------------------------------------ | ------------- |
| en-card-delivery | 6af1daf0-a247-4481-a52c-94b861361624 | 08:54:52.234  |
| en-card          | ef231abb-f646-43b0-80ed-f2953b063f96 | 08:55:11.454  |

자식→메인 순서로 적용하고 08:55:13.291에 매분 Cron 하나를 복원했다. 기존 D1/KV·Secret 이름·서비스·live/free_only를 유지하며 자식 workers.dev/preview·Cron은 비활성이다. 유지보수 로컬 설정은 원래대로 복원했다. 원격 boot 200/live/local false, 로그인 없는 state 401·로컬 인증 405·OAuth 시작 403과 쿠키 없음, 자식 공개 URL 404를 확인했다. 화면/JS/CSS 해시는 검증한 dist와 일치하고 기존 원본 PNG는 200·87,785바이트·1080×1080이다. HTTP 점검 중 잘못 지정했던 OAuth 경로의 기대 상태는 실제 `/auth/start`로 수정해 재검증했다. 제품 소스 변경이나 인증 우회가 아니다.

### 새 5장 실제 3→2 발송

최신 수집기가 두 운영 버전의 로그를 받는 것을 확인하고 Chrome에서 새 예약 **73d1c082-f304-4006-bbc0-fc7352f708f7**·`최종 CPU 재검증 · 본인 5장`을 **09:07 KST / 00:07 UTC / 1790899620000**에 저장했다. 앞선 09:04 시각은 입력 처리 중 최소 2분 조건으로 거부돼 새 회차/발송/시도 행이 없었다. 마지막 이미지 저장 후 약 63분, 수집기 첫 확인 로그 후 8분 이상 여유다. 카드 5개·순서·UTC값을 D1 읽기로 대조했으며 화면 저장을 SQL 쓰기로 대체하지 않았다.

| 실행     | API 접수 기록 KST          | Cron CPU / wall | 준비 CPU / wall | 발송 CPU / wall               |
| -------- | -------------------------- | --------------- | --------------- | ----------------------------- |
| 첫 3장   | 09:07:50.203·52.544·53.980 | 5ms / 7,785ms   | 4ms / 982ms     | 3/2/2ms / 2,516/2,070/1,168ms |
| 다음 2장 | 09:08:48.831·50.241        | 3ms / 4,269ms   | 1ms / 474ms     | 2/3ms / 1,651/1,140ms         |

정제 수집기의 각 이벤트는 해당 운영 version ID·outcome ok·예외 0이며 **모든 호출 CPU 10ms 이내**다. 모든 5개 delivery는 sent·시도 1·claim/retry NULL, live 시도 5개와 예산 증가 5가 일치한다. 첫 3장 뒤 미발송 2장이 남았을 때 화면의 일시정지 버튼도 유지됐다. 다음 Cron 이후 추가 발송 0이다. 사용자가 **5장 수신·각 이미지·원본 모두 정상**이라고 확인했다. [Workers CPU 설명](https://developers.cloudflare.com/workers/platform/limits/)에 따라 네트워크/DB/KV 대기와 CPU를 구분한다.

09:11~09:12 최종 대조에서 새 예약·회차·발송/시도 각 5·tick 3/2·예산 증가 5를 제외한 **기존 15개 테이블 행 해시가 모두 일치**한다. 인증은 connected/version 10·암호문/만료/잠금 불변, 카드 14·이미지 5·예약 11(활성 0)·회차 10·delivery 18·시도 16, 오늘 sends **8/20**·uploads **3/100**·저장 예약량 402,286바이트다. 미해결 unknown·claimed/sending·FK 오류는 0이다. 이전 실패 시험의 미발송 2장과 기존 모든 이력을 보존했다.

수집기 및 확인한 자식 프로세스 8개는 **09:12:32.090 KST에 종료**했고 남은 해당 프로세스는 0이다. 클라우드 Cron은 유지한다. 시험 예약은 한 번 처리 후 비활성/완료이며 이전 실패 시험은 일시정지 상태다. 새 Codex 자동화나 추가 실제 발송을 만들지 않았다.

### 무료 계정·전체 사용량

08:49~08:52 KST Dashboard의 현재 Workers 요금제는 **Free·US$0**였다. D1 1개·KV namespace 1개·기존 Worker 3개(이 앱 2개)를 유지했다. 새 유료 경로·플랜·결제·자원·Secret 설정은 없다. 기본 dry_run과 실제 live 설정 무료 검사도 통과했다.

| 집계 시각/기간                       | 공식 계정 측정                                                                           |
| ------------------------------------ | ---------------------------------------------------------------------------------------- |
| 08:51 KST·UTC 10월 1일 D1            | 읽기 26.65k/5M·쓰기 450/100k·총 저장 282.62kB/5GB·DB 1/10                                |
| 08:52 KST·UTC 10월 1일 KV Dashboard  | 읽기 22·쓰기 3·삭제 0·목록 2                                                             |
| 09:12 KST·UTC 10월 2일 D1 Dashboard  | 읽기 1.3k/5M·쓰기 171/100k·총 저장 286.72kB/5GB. 목록의 294.91kB와 집계 시각 차이를 구분 |
| 09:14:34 KST·GraphQL UTC 10월 1일 KV | 읽기 23·쓰기 3·목록 2, 삭제 행 없음                                                      |
| 같은 GraphQL·UTC 10월 2일 KV         | 읽기 5·목록 1, 쓰기/삭제 행 없음                                                         |
| 09:11 공식 API 실물 조회             | D1 현재 299,008바이트, KV PNG 5개·402,286바이트. D1 저장 예약량과 일치                   |

KV Dashboard의 새 UTC일 작업 0과 저장 0B, GraphQL 저장 dataset 빈 결과를 실제 빈 저장소로 해석하지 않았다. [공식 KV GraphQL](https://developers.cloudflare.com/kv/observability/metrics-analytics/)의 계정 전체 작업 결과는 errors 없음·HTTP 200으로 확인했고, 기존 권한으로 제한된 키 목록 1회와 값 길이 읽기 5회로 실제 저장량을 대조했다. 이 조회는 그 자체의 목록/읽기 사용량에 포함한다. 데이터 원문·키 이름·토큰은 저장하거나 출력하지 않았다. KV 읽기 100,000/일·쓰기/삭제/목록 각각 1,000/일·저장 1GB, D1 읽기 5M/일·쓰기 100k/일·저장 5GB의 현재 [KV](https://developers.cloudflare.com/kv/platform/pricing/)·[D1](https://developers.cloudflare.com/d1/platform/pricing/) 무료 정책과 대조했다. 제공사 일일 집계는 UTC이고 앱 sends/uploads는 KST다. 집계 숫자는 조회 시각 기준이며 미래 모든 사용량을 보장하지 않는다.

이 완료 범위는 최신 Chrome 정상 흐름·5장 실제 발송/CPU/휴대전화 확인·무료 사용량·최종 코드 리뷰와 수정이다. 기존 10월 1일 PC 종료 수신·자연 만료 갱신 기록은 그대로 보존하고, 이번 유효 토큰 5장을 새 자연 만료 또는 PC 종료 실측으로 표시하지 않는다. 최종 제품 커밋 `ee229e68d7ae55226f0799729d60a0777ebc37dc`를 일반 푸시하고 해당 HEAD를 지정해 [PR #1](https://github.com/zzocojoa/EN_Card/pull/1)을 **2026-10-02 09:33:26 KST**에 Merge commit `a26c81ce5e0c2cba83b2ec7c6e905d5d4a4758e4`로 병합했다. GitHub MERGED·master의 두 부모·제품과 같은 파일 트리 `f1cd6ad920f493d6bba5f0904639b989cfaec573`·개발 브랜치 보존·작업 트리 clean을 확인했다.

## 동일 커밋의 정상 개발 환경 E2E 재실행·결과 보존 — 2026-10-02

진행 문서의 과거 0012/OPEN 요약을 최신 0013/MERGED 상태와 구분하고, 병합 전 검증한 **동일 커밋 `ee229e68d7ae55226f0799729d60a0777ebc37dc`**의 E2E 결과를 보존했다. `master`의 병합 커밋 `a26c81ce5e0c2cba83b2ec7c6e905d5d4a4758e4`와 파일 트리가 동일함을 사전에 확인했다. 문서 정리는 이 재실행과 전후 소스 비교를 마친 뒤 수행했다.

| 항목                             | 실제 실행·결과                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------- |
| 환경                             | Windows x64·OS 10.0.26300·Node 22.22.2·npm 10.9.7                               |
| 도구                             | Wrangler 4.142.0·Playwright 1.63.0·Chromium 153.0.8010.12·Vite 8.3.1            |
| 대상                             | 깨끗한 `ee229e6` checkout, 파일 트리 `f1cd6ad920f493d6bba5f0904639b989cfaec573` |
| 시작/종료 KST                    | Playwright 09:57:48.499 시작, 실행기 09:59:23.791 종료                          |
| 전체 Chromium 결과               | **22개 통과·95.14초·종료 0**; 실행기 전체 경과 96.268초                         |
| 실패/skip/flaky/재시도/전역 오류 | **모두 0**                                                                      |
| 원래 실행 구성                   | worker 1·`http://127.0.0.1:8787`·새 서버·별도 `.wrangler/e2e-1790902668485`     |
| 실행 전후 보존                   | 추적 파일 **219개 변경 0**·HEAD 동일·작업 트리 clean                            |

기존 `npm run test:e2e`를 그대로 사용하고 CLI의 `--reporter=line,json,html`·`--output`과 보고서 위치 환경변수만 추가했다. 기존 `playwright.config.ts`·`wrangler.local.jsonc`·테스트·잠금 파일을 수정하지 않았고 Node 런타임 패치나 `NODE_OPTIONS`를 적용하지 않았다. 테스트는 원래 config의 build:web → 로컬 마이그레이션 → Wrangler 로컬 서버를 시작하고 별도 D1/KV에서 실행됐다. 기존 서버를 재사용하거나 제공사 오류를 우회하는 shim, skip, assertion 약화는 없다. `NO_COLOR`/`FORCE_COLOR` 표시 경고는 보존하며 테스트 실패로 집계하지 않는다. 이 실행은 모의 인증·로컬 dry_run E2E이며 실제 카카오 발송·운영 DB 변경·원격 CPU 측정·새 배포가 아니다.

원본 결과는 `backups/e2e-ee229e6-20261002/`와 ZIP에 보존했다. JSON 보고서에는 22개 개별 결과가 있고 HTML 보고서·전체 실행 로그·환경 정보·전후 219개 파일 SHA-256·실행기·산출물 manifest·종합 결과를 함께 보관했다. ZIP **10개 파일·284,427바이트**의 각 압축 해제 내용 해시가 원본과 일치한다. ZIP SHA-256은 **`e276a90607c44761e2c640852e6a2d73f97441cb5524d8ac06e516737e82036c`**다. 원본 보고서·로컬 DB·생성 산출물은 기존 Git 제외 정책을 유지하고, 개인 경로·토큰·DB 원문을 제외한 [보존 결과](evidence/E2E_2026-10-02_ee229e6.json)를 문서와 함께 추적한다.

정상 개발 환경에서 대상 커밋의 깨끗한 checkout과 잠금 의존성·Chromium이 준비된 경우 재현 명령은 다음과 같다. 해당 환경에서 설치가 이미 끝났으면 `npm ci`·브라우저 설치를 반복할 필요가 없다.

```powershell
git rev-parse HEAD
# ee229e68d7ae55226f0799729d60a0777ebc37dc인지 확인
npm ci
npx playwright install chromium
npm run test:e2e
```

보존된 HTML은 `backups/e2e-ee229e6-20261002/html/index.html`, 원본 JSON은 `backups/e2e-ee229e6-20261002/report.json`, 압축본은 `backups/e2e-ee229e6-20261002.zip`이다. 이후 문서만 정리한 작업을 새 제품 커밋의 E2E 성공으로 표시하지 않는다. 전체 Vitest 334개·빌드·CPU·수신·무료 계정 조회는 앞선 실제 실행 기록을 유지하며 이번 작업에서 다시 실행한 것은 동일 제품 커밋의 전체 Chromium E2E다.

## UI·UX 개편 — 2026-10-02 로컬 검증

브랜치 `codex/ui-ux-refresh`, 기준 `29c758d`, 커밋 전 작업 트리에서 실행했다. 위의 운영 배포·수신 기록과 구분한다. 승인 범위·완료 대응은 [계획](UI_UX_REDESIGN_PLAN.md)과 [리뷰](UI_UX_REVIEW.md)를 따른다.

| 실행                                   | 실제 결과                                                                                      |
| -------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `npm run test`                         | 기존 **17개 파일·334개 통과**, 11:41:55 시작·925.51초                                          |
| `npx vitest run tests/catalog.test.ts` | 추가 **3개 통과**, 최종 12:03:54 시작·26.31초. sending 필터 보완 후 실행                       |
| `npm run test:e2e`                     | 최종 **52개 통과·2.2분**: Chromium 37개, WebKit 15개                                           |
| `npm run build`                        | 타입 검사·Vite·주 Worker와 발송 Worker의 dry-run 통과. 실제 배포 없음                          |
| `npm run check:free`                   | passed. 기존 Workers/D1/KV, 기본 dry_run, deploymentPerformed=false. 계정 플랜·원격 CPU 미확인 |
| Prettier·`git diff --check`            | 변경 소스·테스트·문서 검사 통과                                                                |

Vitest는 기존 334개를 먼저 실행한 뒤 새 조회 테스트 3개를 별도로 실행했다. 337개를 한 번의 전체 실행으로 통과했다고 집계하지 않는다. 브라우저 검증 중 기존 locator/확인창 동선 불일치와 실제 UI 문제를 수정했으며 중간 실패 실행은 최종 통과 수에 포함하지 않는다. 최종 실행에는 추가된 지연 응답 경합 회귀도 포함된다.

### 확인한 사용자 흐름

- 로컬 Worker/D1에서 카드 작성→실제 1080×1080 PNG 다운로드·업로드·검토→**이 카드 예약하기**→예약 저장·수정→비소비 미리검증. 기존 일시정지·중지 복구·결과 불명·세션 만료 회귀를 유지했다.
- 실제 D1 테스트에서 205개 카드의 검색·필터·100개 커서, 105개 발송의 첫 페이지 밖 결과 불명·종료 제외·집계, 카드 수정 뒤 불변 발송 제목, 응답 확인 중 포함, 다음 활성 예약을 확인했다.
- 격리된 모의 API UI에서 늦은 검색 응답 무시, 필터/커서 초기화, 빈 결과·조회 오류 재시도, 101번째 카드 선택·검색·순서·제거·재진입, 재저장 실패 뒤 이전 예약 버튼 제거를 확인했다.
- 주소·뒤로/앞으로·새로고침, 화면 이동 중 초안, 본문 바로가기, 필드별 오류 연결, 대화상자 Tab/Escape·포커스 복귀, 최신 요약·펼친 호출 기록 유지, 이전 예약 이미지 재선택, 진입 조회와 추가 페이지의 경합을 확인했다.
- Chromium과 WebKit에서 375·390·430·768·1440px의 6개 작업 화면을 검사했다. 가로 넘침 없음, 주요 텍스트 대비 4.5:1 이상, 입력 16px 이상, 요일 선택 영역 44px 이상, 모바일 5개 메뉴·미리보기·첫 화면의 다음 예약/확인할 결과를 확인했다. 최대 길이의 끊기지 않은 영문 제목도 포함했다.
- 실제 Canvas와 파일 다운로드는 두 브라우저에서 실행했다. WebKit의 서버 응답은 모의 데이터이며 운영 카카오 연동 검증이 아니다. 스크린샷은 Git 제외 `test-results/redesign-*`에 저장된다.

### 미실시 항목과 재실행

실제 아이폰 Safari의 키보드·날짜 선택·파일 앱 저장은 미실시다. 운영 계정 요금제·원격 CPU·실제 카카오 발송·배포도 이번 개편에서 다시 확인하지 않았다. 기본 설정·Secret·운영 리소스는 변경하지 않았다. 별도 CLI 리뷰 probe는 실패해 결과가 없고 전문/독립 검토로 대체한 범위는 리뷰 문서에 명시했다.

```sh
npm run dev
npx playwright install chromium webkit
npm run test:e2e
npm run build
npm run check:free
```

E2E 실행 시 개발 서버를 종료해 8787 포트를 비운다. 배포 dry-run은 `npm run build`에 포함된다. 실제 배포·발송은 별도 작업이다.

## UI·UX 운영 반영·조회 CPU 보완 — 2026-10-02

사용자 진행 승인 후 PR #3 병합본과 후속 조회 경량화를 기존 [운영 홈](https://en-card.kmksla4.workers.dev/#/home)에 반영했다. 메인 Worker만 교체했고 비공개 발송 Worker `6af1daf0-a247-4481-a52c-94b861361624`, D1·KV·Service Binding·Secret 이름·live/free_only·매분 Cron 하나를 유지했다. 신규 리소스·마이그레이션·발송 예약·메시지 호출은 없다.

| 단계                               | 메인 버전                              | 결과                                                                                |
| ---------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------- |
| 개편 최초 배포 · 13:23:30 KST      | `457ecb89-a96e-4f13-b21f-8fdca265baea` | HTTP 정상이나 상태 조회 CPU 11ms 두 번. 무료 CPU 검증 실패로 보존                   |
| 전체 상태 읽기 배치 · 13:32:53 KST | `7b9621c4-fd4c-4568-bf8a-f78254781d90` | 상태 조회 개선. 발송 필터 CPU 11ms 한 번을 추가 발견                                |
| 목록·건수 배치 · 13:37:12 KST      | `42f7a460-dbd4-425a-a221-371d441d2af5` | 최종 제품 `cdaff10fcb8852cb574a13fb0c436f8a49221678`, 100% 배포·아래 조회 실측 통과 |

원인은 새 조회에서 별도로 수행하던 D1 응답 처리 비용을 줄일 필요가 있다는 운영 관측이다. 정확한 CPU 프로파일로 모든 비용을 분해한 것은 아니다. `/api/state`는 인증 확인 뒤 12회 읽기를 9개 SELECT의 한 배치로 줄였다. 카드·발송 페이지는 목록과 총 건수를 한 배치로 읽는다. SQL·목록 디코더·100개 커서 생성은 공통 구현을 사용하며 인증·CSRF·발송 엔진·응답 계약은 유지한다.

### 최종 측정과 보존 확인

| 최종 버전의 관측 경로  | 표본 수 | CPU 범위                          |
| ---------------------- | ------- | --------------------------------- |
| `/api/state`           | 7       | 0~6ms · 비인증 접근 검사 1건 포함 |
| `/api/page/cards`      | 3       | 1~3ms                             |
| `/api/page/deliveries` | 2       | 1~4ms                             |
| 무작업 Cron            | 2       | 0~3ms                             |

위 14개 호출의 outcome은 모두 ok·예외 0이며, 보안 검사의 HTTP 401을 로그인된 조회 성공으로 계산하지 않는다. Chrome의 기존 운영자 세션으로 홈(준비 5장), 보관함 14장, `Take your time` 검색 3장→검토 완료 필터 2장, 발송 확인 필요 1건, 예약 목록과 설정 이동을 확인했다. 확인 필요 1건은 9월 30일 기존 HTTP 403/-402 실패 이력이다. 본 측정은 현재 소량 데이터·짧은 관측 구간이며 전체 부하·향후 모든 요청의 CPU 보장이 아니다. 발송·갱신 CPU와 실제 수신은 이번 측정에 포함하지 않는다. 수집기는 종료했다.

- 배포 전 활성 예약·claimed/sending/미해결 unknown은 0이다. 신규 마이그레이션이 없어 Cron·DB 쓰기 설정을 변경하지 않고 메인 코드를 교체했다.
- 전체 D1 91,369바이트 내보내기를 접근 제한된 디렉터리에서 Windows DPAPI CurrentUser로 암호화했다. 복호화 왕복 SHA-256 일치 후 평문을 삭제했다. 백업·증거는 Git 제외 `backups/ui-refresh-20261002/`에 있다.
- 최초 배포 전과 최종 배포 후 15개 테이블의 행 수·해시가 모두 같다. 0013까지 13개 이력·FK 오류 0, 인증 connected/version 10·잠금/오류 없음, 카드 14장·준비 이미지 5장/402,286바이트·오늘 시도 8/20·업로드 3/100을 유지했다.
- `/api/boot` 200/live/local=false, 비인증 `/api/state` 401, 운영 `/auth/local` POST 405, Origin 없는 `/auth/start` POST 403, 비공개 자식 공개 URL 404를 확인했다. 새 로그인·토큰 회전·메시지 전송을 실행한 검사가 아니다.
- 원격 HTML·JS·CSS 바이트 해시가 검증한 dist와 일치한다. 기존 원본 PNG는 쿠키 없이 HTTP 200·image/png·1080×1080·87,785바이트다. Chrome 운영 홈 캡처는 `backups/ui-refresh-20261002/deployed-home.png`다.

### 로컬 수정 검증

- `npx vitest run tests/catalog.test.ts tests/reaudit.test.ts`: 29개 통과·97.52초. 기존 205개 카드/105개 발송 fixture에서 배치 상태 응답의 전체 집계·커서·불변 제목·예약 카드 순서와 기존 복구 경로를 검증했다.
- `npm run test:e2e -- tests/e2e/workflow.spec.ts tests/e2e/recovery.spec.ts tests/e2e/pause.spec.ts --project=chromium`: 22개 통과·1.5분. 실제 로컬 Worker/D1/Canvas와 일부 모의 오류 응답을 사용했다.
- 필터 배치 후 `npx vitest run tests/catalog.test.ts`: 3개 재통과·26.26초. `npm run test:e2e -- tests/e2e/workflow.spec.ts --project=chromium -g '100개|카드 작성'`: 2개 재통과·16.6초.
- 최종 `npm run build`, 실제 live 설정 `wrangler deploy --dry-run`, `check:free -- --config wrangler.live.jsonc --delivery-config wrangler.delivery.deploy.jsonc --mode live`, Prettier와 diff 검사 통과. 최종 메인 번들 SHA-256은 `3b68ade68ea06b5883a89dc4920888b16731a7167c837531c0e229e460dc8110`이다.
- 첫 타입 검사에서 미사용 import·배치 결과 nullability를 수정했다. Playwright 바이너리를 직접 실행한 시도는 하위 `wrangler` PATH 오류로 서버 시작 전에 종료했으며, 정상 npm script로 재실행해 통과했다. 이 중간 실패를 통과 횟수에 넣지 않는다. 이전 전체 334+3개와 Chromium/WebKit 52개를 이번에 전부 재실행한 것은 아니다.

### 무료 구성과 남은 실제 기기 확인

13:20 전후 Cloudflare Dashboard의 현재 Workers 플랜은 Free·US$0였다. D1은 전체 계정 데이터베이스 1/10, UTC 10월 2일 읽기 약 6.22k/5M·쓰기 171/100k·저장 299.01kB/5GB였다. KV는 읽기 5·쓰기/삭제 0·목록 1·저장 약 403kB로 표시됐다. 이는 표시 시각의 집계이며 이후 이 작업의 읽기 검사는 별도 소비한다. 운영 앱 카운터만으로 계정 한도를 판단하지 않았다. 기존 Wrangler 권한으로 진행했고 권한 확대·유료 플랜·결제 변경은 없다.

[Workers 요금](https://developers.cloudflare.com/workers/platform/pricing/), [CPU 제한](https://developers.cloudflare.com/workers/platform/limits/), [D1 요금](https://developers.cloudflare.com/d1/platform/pricing/), [KV 요금](https://developers.cloudflare.com/kv/platform/pricing/)을 당일 다시 확인했다. 이번 구성은 기존 Workers/D1/KV만 사용한다.

실제 아이폰 Safari 확인은 사용자 응답 대기다. [운영 홈](https://en-card.kmksla4.workers.dev/#/home)에서 다음을 확인한다. 입력을 수정할 필요는 없으며 실제 예약을 활성화하지 않는다.

1. 입력 필드에 포커스했을 때 자동 확대·키보드에 의한 버튼 가림이 없는지 확인한다.
2. 예약 작성 화면의 날짜·한국 시간 선택, 하단 메뉴·안전 영역을 확인하고 저장하지 않는다.
3. 준비된 표현형·비교형 PNG를 파일 앱에 내려받아 한글·줄바꿈·1080×1080을 확인한다.

비밀값·인증 코드는 채팅에 입력하지 않는다. 실제 기기 확인 결과가 없으므로 WebKit 자동화나 Chrome 결과를 아이폰 검증 완료로 대체하지 않는다.

## 하루단어 통합 로컬 검증 — 2026-10-02

검증 범위와 실제 운영 반영 체크리스트는 [HARU_INTEGRATION.md](HARU_INTEGRATION.md)를 따른다.

- `npx vitest run tests/studio-bridge.test.ts tests/auth.test.ts`: 37개 통과.
- `npx vitest run tests/catalog.test.ts tests/reaudit.test.ts`: 29개 통과.
- 하루단어 `npm test`: 714개 통과. 새 체크아웃의 work 폴더 누락을 준비한 뒤 전체 재실행했다.
- `npx playwright test --config playwright.haru.config.ts`: Chromium·WebKit 각 1개 통과. 실제 두 로컬 서버·로컬 D1/KV, 모의 ChatGPT 계정, dry_run이다. 표현형/비교형 PNG 1080×1080 다운로드·검토 저장·예약 생성·학습 기록 불변·모바일 메뉴/가로 넘침을 확인했다.
- 기존 workflow의 로그인 모드/PNG·예약/100개 이상 조회 Chromium 3개는 별도 E2E DB에서 통과했다. 통합 미리보기 DB와 혼용한 첫 실행의 선택자 중복 실패는 제품 성공으로 집계하지 않는다.
- 양쪽 타입·빌드, 하루단어 lint 오류 0·기존 경고 13, EN_Card 무료 구성 검사 통과. 전체 EN_Card 337개·기존 E2E 52개를 이번에 모두 재실행한 것은 아니다.
- 기존 운영 서비스·Secret·DB·카카오 동의·발송은 변경하지 않았다. 새 통합 경로의 운영 CPU와 실제 iPhone Safari는 미검증이다.

## 하루단어 통합 운영 검증 — 2026-10-02

- 로컬 단계 이후 사용자 승인으로 두 앱 배포·본인 매핑을 완료했다. 하루단어 v101/환경48, 제품 `abd915346cbe3dce8d982c2d0a8b0da8ec6b197a`, 최종 배포 `appgdep_6abf589d577081918af7fee44d8f3435` succeeded. EN_Card 제품 `cd8d2232e6164e1023e6925ec4fdb9f4359fd703`, 최종 메인 버전 `a51bde4f-24d9-4fab-ba82-a2393d0cb334` 100%.
- 배포용 Sites 빌드는 로컬 `.env`를 제외하고 기존 npm CLI 경로로 통과했다. 본인 식별자 표시 보완 후 타입·빌드를 다시 통과했다. EN_Card Vite·실제 운영 설정 dry-run·check:free live 통과. 앞선 테스트780개와 로컬 브라우저 검증은 재사용했으며 이번에 전체를 다시 실행한 것으로 표시하지 않는다.
- 실제 Chrome 로그인 계정 선택 → 홈의 영어 카드 버튼 → 통합 카드14장·기존 카드 미리보기·예약 화면을 확인했다. PNG 다운로드 이벤트 대기는 도구 시간 초과로 종료됐지만 실제 Downloads/english-card.png가 저장돼 있었고 PNG 시그니처·78,331바이트·1080×1080·SHA256 `8a8719ad7ad7484bd6e47a5aed0262573e56bb0c626f5d1b390e909e198f0d4d`를 확인했다.
- 인증된 서버 연결의 state/cards/deliveries200, 두 앱 익명401, Sites 위조 인증 헤더401, 서버 연결의 다른 사용자 ID403을 확인했다. 실제 다른 사람의 로그인 계정으로 시험하지 않았다. 기존 독립 앱 HTML/JS/CSS가 로컬 빌드와 해시 일치, 기존 공개 원본 PNG200·87,785바이트·1080×1080, 비공개 발송 Worker404, 운영 모의 인증405도 확인했다.
- 본인 브라우저의 API 직접 탐색이 Chrome ERR_BLOCKED_BY_CLIENT로 차단돼 보호된 /cards 페이지에 현재 로그인한 계정의 식별자 표시를 추가했다. 브라우저 보호를 해제하지 않았다. Cloudflare 인증 만료401은 기존 Wrangler 권한의 갱신으로 해결했다. Windows 입력 도우미의 줄바꿈 대기를 수정했다. 비밀값·개인 학습 답안은 진단에 기록하지 않았다.
- `backups/haru-deploy-20261002/`의 before/after-table-hashes.json은 15개 테이블 전부 일치한다. DPAPI DB 백업90959바이트의 복호화 해시 검증 완료. 인증11/connected·카드14·이미지5·402286바이트·활성0·진행 중/미해결 unknown0·발송8/20·업로드3/100을 유지했다. DB 스키마 이전·운영 QA 쓰기·카카오 재연결·새 발송 없음.
- 안전 tail에서 본인 조회 CPU2~5ms, 무작업 Cron1~3ms·예외0·버전 일치를 확인했고 수집기는 종료됐다. 비인증 요청 CPU0ms를 본인 조회 최솟값에 섞지 않았다. 발송/토큰 갱신 CPU·실제 iPhone·새 재연결 흐름은 이번에 실행하지 않았다.
- 현재 Workers Free·US$0, Dashboard의 일일 요청926/100000·D1 읽기20.11k/5M·쓰기182/100k·299.01kB/5GB, GraphQL의 KV UTC 10/02 읽기9·목록1·저장403116바이트/5키를 확인했다. 집계 지연과 앱 PNG 바이트 합계의 차이를 보존했다. 새 유료 의존성·리소스·AI 호출은 없다. 상세 공식 근거·운영 설정·복구 절차는 [HARU_INTEGRATION.md](HARU_INTEGRATION.md)를 따른다.

## 하루단어 최종 통합 회귀 — 2026-10-02

- `npm test`: EN_Card 19파일/342개 통과(1091.59초). `npm run build`, 기본/live `check:free`, 서식·diff 검사 통과. 전체 검사는 `backups/haru-deploy-20261002/premerge-tests.log`, 빌드는 `premerge-build.log`에 있다.
- 하루단어 GitHub main 기준 전체500, 운영 소스 전체722와 v103 추가 후 최신 평가/카드19개 통과. 타입·빌드 성공, lint 오류0/기존 경고13. 환경별 생성 번들 경로가 포함된 기존 진단 해시 비교 실패는 현재 소스 provenance 검증과 역사 판정 결과 전체 비교로 보완했다. 제품 판정 로직·평가 자료는 변경하지 않았다.
- 새 `draft-navigation.spec.ts`: Chromium/WebKit 2/2(39.4초), 로컬 합성 계정+dry_run. 저장 지연/503에서 이동 차단, 복구 백업, 재시도, 학습/문법 초안 왕복·reload 보존, 기존 카드/예약 불변·학습 상태 복원·AI 요청0 확인. 최초 fixture/기능설정/선택자 준비 실패를 통과로 집계하지 않았다.
- WebKit 첫 포인터 재개가 기존 시계 준비 잠금과 겹치는 관찰은 [통합 문서](HARU_INTEGRATION.md)에 남겼다. 재열기 보조 단계만 Enter를 사용하며 실제 iPhone·첫 마우스 재개 자체를 통과로 주장하지 않는다.
- 전문/Red Team/독립 적대적 검토를 완료했고 계정 전환·접근성 이름·초안 회귀 보완을 반영했다. 보조 Codex CLI 검토는 버전/모델 호환 오류로 미실행이다.
- v104 소스 `c2457b7`, 배포 `appgdep_6abf653ed81481919afaccb27116f9b6` succeeded(17:03:29 KST). 원본/생성129개 해시 일치, 원격 익명·위조401/다른 서버사용자403, 승인 전 쓰기0/발송0 재확인. 원격 접근 확인 로그와 CPU 기록에는 토큰·헤더·원문을 저장하지 않는다.
- 별도 승인 후 17:16 KST/08:16 UTC 1회 예약을 하루단어 UI로 저장했다. `That makes sense` 정확히1장, 17:17:00.898 KST live/sent·attempts1, 예약completed·활성0·미해결0·일일8→9/20 확인. 실제 원격 API 연동이며 모의 발송이 아니다. 사용자가 “1장 수신했고 이미지·원본 보기 정상”이라고 직접 확인했다. 별도 실제 iPhone Safari 로그인·PNG 파일 앱 저장은 미확인이다. 이번 실행 중 PC는 켜져 있었다.
- 해당 회차 안전 tail: 메인 Cron CPU5ms/wall3783ms, delivery prepare3ms/wall712ms, send4ms/wall2487ms, 모두 ok/예외0/기대 버전 일치. 인증connected/version11·카드14·이미지5·402286바이트 유지. 기록은 `final-send-cpu-en-card.jsonl`, `final-send-cpu-en-card-delivery.jsonl`, `test-send-latest.json`이다.
- 후속 실제 기기 결과: 사용자가 **“로그인·미리보기·파일 앱 저장 모두 정상”**이라고 iPhone Safari 검사 결과를 확인했다. 자동 WebKit 결과와 구분한 사용자 수동 검증이다. 키보드/날짜/VoiceOver 모든 조작이나 새 카카오 재연결을 완료한 뜻은 아니다.
- EN_Card PR #5 `cd56013`·하루단어 PR #13 `06fbd83` 병합 완료. EN 병합 트리는 로컬 검증한 `d03648f`와 동일하고 Site main의 카드 파일도 검증 HEAD와 동일하다. 최신 운영 화면을 새로고침해 `하루단어 홈` 접근성 이름과 실제 발송 기록을 확인했다. CPU 수집기는 정상 종료했다.

## AI 자동화 PNG 무료 실행 검증 — 2026-10-02

브랜치 `codex/ai-card-automation`, 기준 `8e4bf67`. 전체 자동화 구현 완료 검사가 아니라 [계획](AI_CARD_AUTOMATION_PLAN.md) 3절의 선행 실험이다. 기존 사용자 문서 변경을 보존했다.

### 로컬 구현·검증

| 명령·검사                                                                                                                                    | 결과                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `npm run bench:automation:png`                                                                                                               | 네 예제의 SVG·1080 PNG, Wasm/native 압축 생성·CPU/메모리 스냅샷 기록 |
| `npm run bench:automation:worker:dry-run`                                                                                                    | 비공개 시험 렌더러 패키징 통과                                       |
| `npm run bench:automation:probe:dry-run`                                                                                                     | 인증 시험 입구 패키징 통과                                           |
| `npm run bench:automation:worker` 후 `npm run check:automation:worker`                                                                       | 로컬 workerd PNG 8건·거부 5건 통과. 서버 종료                        |
| `npx vitest run tests/core.test.ts tests/automation-png.test.ts tests/automation-probe.test.ts tests/free-config.test.ts --reporter verbose` | 4개 파일·68개 통과, 5.82초                                           |
| `npx vitest run tests/catalog.test.ts --reporter verbose`                                                                                    | 기존 조회 3개 통과, 26.74초                                          |
| `npm run typecheck`, `npm run build`                                                                                                         | 타입·Vite·기존 두 운영 Worker 배포 dry-run 통과                      |
| `npm run check:free`                                                                                                                         | 기존 운영 설정의 무료 구성 검사 통과. 계정 청구·시험 CPU 검사는 아님 |

PNG 자동 검사에는 기본/대체 압축의 RGBA 픽셀 일치, 구조·CRC·규격·용량, 넘치는 내용·누락 글리프 거부와 사용자 태그의 비실행이 포함된다. 입구 검사는 Secret 미설정·길이가 다른/같은 오인증·잘못된 방법/경로 거부와 하위 호출 없음, 고정 정상 경로 전달을 확인한다. 보안/테스트 리뷰 후 새 테스트 8개를 다시 실행해 통과했다. 네 예제 이미지를 열어 한글·영문·줄바꿈·하단 여백을 확인했다.

전체 `npm test`는 약 14분간 완료되지 않아 중단했다. 전체 통과로 보고하지 않는다. 조회 테스트의 진단용 `--testTimeout 10000 --hookTimeout 10000`에서는 2건이 시간 초과했으나, 설정을 바꾸지 않은 기본 30초 제한 재실행에서 3건 모두 통과했다. 제품 코드가 변경되지 않았다는 이유만으로 중단 원인을 확정하지 않는다. 이번에 E2E나 기존 전체 테스트 통과를 새로 확보한 것은 아니다.

### 승인된 임시 Cloudflare 시험

사용자가 시험 Worker 두 개의 임시 무료 배포·예제 최대 40회 생성·측정·정리를 허용했다. 18:31 KST 전후 Dashboard에서 현재 Workers **무료 / US$0**, 요청 **1,333/100,000**, 기존 Worker 3개와 이름 충돌 없음을 확인했다. 이 사용량은 확인 당시 집계다.

- `en-card-png-feasibility`: 비공개 렌더러, 버전 `fd639f9b-690d-4183-a14e-235c0e692968`.
- `en-card-png-probe`: Secret 인증 입구, 측정 버전 `b9627b49-4098-4ac9-94b3-62a7354f311d`.
- 서버 바인딩은 입구→시험 렌더러 하나다. D1·KV·Cron·AI·카카오 연결이 없다. 인증 없는 요청은 401, 렌더러 공개 주소는 404였다.
- 18:34 KST에 실제 PNG를 **24회** 생성했다. HTTP 200·outcome ok·예외 0이고 SHA-256은 각 인코더의 로컬 workerd PNG와 24개 모두 같다.
- 렌더러 CPU: Wasm **49~258ms**, native 압축 **35~142ms**, **10ms 이내 0/24회**. 입구 CPU 0~1ms와 혼동하지 않는다. 실제 PNG 생성은 성공했지만 무료 실행 적합성은 실패다.
- SVG 생성·KV 저장·예약 연결 이전 경로가 이미 초과해 해당 전체 경로와 원격 최고 메모리는 미검증으로 남겼다. 반복 요청의 isolate 동일성도 확인하지 않았다.

원자료: [로컬 Node](evidence/AI_PNG_LOCAL_2026-10-02.json), [로컬 workerd](evidence/AI_PNG_WORKER_2026-10-02.json), [원격 invocation](evidence/AI_PNG_REMOTE_2026-10-02.jsonl), [원격 응답·해시](evidence/AI_PNG_REMOTE_RESPONSES_2026-10-02.json). 원격 이벤트는 24개 렌더러·25개 입구(비인증 1개 포함), 합계 49개다. 당시 입구의 encoder 메타데이터 오류와 클라이언트/제공사 시계 차이는 [실측 보고서](AI_CARD_AUTOMATION_FEASIBILITY.md)에 설명했다. 원자료를 수정해 성공으로 보이게 만들지 않았다.

측정 후 두 임시 Worker를 삭제하고 Dashboard에서 원래 세 Worker만 남았음을 확인했다. 로컬 DPAPI 시험 Secret 파일과 임시 실행 세션도 정리했다. 운영 코드·DB·KV·Cron·예약·기존 Secret은 변경하지 않았으며 실제 AI 호출·카카오 발송은 수행하지 않았다.

### 무료 조건·리뷰·다음 단계

[Workers 한도](https://developers.cloudflare.com/workers/platform/limits/#cpu-time)의 Free CPU 10ms와 일시 초과 유연성을 확인했다. HTTP 200만으로 CPU 기준 통과를 주장하지 않는다. Google/Groq 모델·무료 tier·구조화 출력은 공식 문서를 확인했지만 실제 사용자 AI 계정 자격과 공유 예산은 미확인이다. 새 의존성은 실험용 devDependencies이며 운영 소스에서 import하지 않는다. 유료 전환은 없다.

`review`로 계획 대조·테스트/유지보수/성능/보안 전문 검토·독립 adversarial 검토를 수행했다. 코드 결함과 단계 미완료를 구별한 [리뷰 기록](AI_CARD_AUTOMATION_REVIEW.md)을 남겼다. 별도 Codex CLI는 모델 미지원으로 실패했고 Claude 검토는 실행할 수 없어 교차 모델/CLI gate 통과로 보고하지 않는다.

**판정: 전체 자동화 미완료.** 압축 방식을 바꾼 뒤에도 무료 기준을 넘었다. 계획에 따라 2~5단계와 무인 활성화를 보류한다. 다음은 무료 PNG 경로 재설계·재검증이며 기존 브라우저 선제작은 매일 무인 생성의 대체 완료로 처리하지 않는다.

### 19:30 KST 후속: 저압축·구간 분리

- `npm run bench:automation:png -- --profile`로 압축·래스터·복사·구간·합성의 로컬 50회 평균을 분리했다. 원래 벤치마크로 SVG를 먼저 생성한다. [단계별 증거](evidence/AI_PNG_PROFILE_2026-10-02.json)는 전체 Cloudflare 요청 CPU가 아니다.
- `npx vitest run tests/automation-png.test.ts tests/automation-probe.test.ts --reporter verbose`: **17개 통과**, 최종 2.56초. 초기 새 테스트의 callback·Buffer 타입 오류와 viewport 이동 픽셀 차이를 수정한 뒤의 결과다. 원본 픽셀 비교 조건을 완화하지 않았다.
- 두 로컬 Wrangler 서버(8792·8793)와 `node scripts/check-automation-bands.mjs`: 저압축·분할 **8개 PNG의 전체 픽셀 일치**, 비인증 401. [결과](evidence/AI_PNG_BANDS_WORKER_2026-10-02.json).
- `npm run build`, `npm run check:free`, 두 시험 Worker dry-run 통과. esbuild의 JS/binary 불일치를 `0.28.1` 고정으로 해결했고 `npm ls esbuild`에서 루트·Vite·Wrangler의 일치를 확인했다. 기존 npm 잠금 파일 정리 경고 때문에 사용자의 프로세스를 종료하지 않았다.
- 실제 계정 Free·US$0, 요청 집계 1,483/100,000을 재확인하고 기존 승인 범위에서 같은 두 시험 이름을 사용했다. 추가 PNG **8장**, 누적 **32/40장**이다. 이미지당 12개 구간이므로 내부 구간 요청은 96회다. 8/8 HTTP 200·해시 일치.
- 렌더 버전 `b4694cf9-298c-4a58-822e-de8c28ed9c47`, 인증·합성 버전 `4e12410e-2400-4abb-a607-d5299d1a1da8`. 수집된 구간 55회 중 **41회가 10ms 초과(6~72ms)**, 합성 8회 중 **6회가 초과(6~17ms)**했다. startup 20ms/13ms는 별도 지표다. 구간 이벤트 41개를 확보하지 못한 원인은 확정하지 않았으며 전체 CPU 검증이라고 보고하지 않는다.
- [원격 구간 원자료](evidence/AI_PNG_BANDS_REMOTE_2026-10-02.jsonl)와 [응답·해시](evidence/AI_PNG_BANDS_RESPONSES_2026-10-02.json)를 보존했다. 두 Worker·DPAPI Secret·수집기·로컬 서버를 다시 정리하고 기존 세 Worker만 확인했다.
- 테스트·성능·보안 후속 리뷰에서 구체적 코드 결함은 발견되지 않았다. 전체 자동화와 무료 CPU 기준은 계속 미완료다. 운영 DB·KV·예약·Cron·기존 Secret·AI·카카오 변경은 없다.

### 독립 리뷰 수정의 오프라인 검증 — 2026-10-02

`pwsh -File scripts/check-automation-trial-ledger.ps1` **5개 시나리오 통과**: 첫 요청 응답 유실, 응답 이후 로컬 파일 실패, 진행 중 두 번째 실행, 빈 중단 표식, 이전 결과 파일. 실제 runner 복사본에 모의 네트워크 함수를 적용했다. 요청 전에 `started`가 파일에서 읽히고, 실패는 한 번만 호출한 뒤 `unknown`을 보존하며, 재실행은 네트워크에 도달하지 않음을 확인했다. 정상 모의 실행은 8번의 시작/완료 기록을 남겼다. 오류 원문과 인증값을 출력·시도 기록에 넣지 않도록 확인했다. 추가 Cloudflare·AI·카카오 호출은 없다.

검증 중 테스트 자체의 PowerShell 스코프 카운터 오류를 공유 상태 객체로 수정한 뒤 다시 통과했다. 기존 원격 수집 자료는 그대로 유지한다. 55개 관측 구간은 표현형 0~10 두 묶음과 나머지 세 예제 0~10 각 한 묶음이며 11번이 전부 없는 비균일한 표본이다. 누락 원인을 확정하거나 누락 호출을 무료 기준 통과로 집계하지 않는다.

### 글자 조립·준비 분리 후속 검증 — 2026-10-02 20:40 KST

- full atlas 자료 11,478자·34스타일·476페이지 및 라이선스 파일을 빌드했다. 예제 문자만 준비한 subset 검사는 원격 적합성 근거로 사용하지 않는다. 공통 글자 번들 도입으로 유효한 비교형의 50페이지 제한 실패를 수정했다.
- 실제 Workers Free·US$0 확인 후 마지막 승인분 8 PNG를 생성했다. 모두 HTTP 200·로컬 해시 일치, renderer CPU 17~54ms·10ms 이내 0/8회. 누적 40장. renderer 8·입구 9 이벤트를 확보했다. Worker 두 개와 DPAPI Secret·수집기를 정리하고 원래 자원 3개만 확인했다. [원격 CPU](evidence/AI_PNG_ATLAS_REMOTE_2026-10-02.jsonl), [응답](evidence/AI_PNG_ATLAS_RESPONSES_2026-10-02.json), [시도 기록](evidence/AI_PNG_ATLAS_ATTEMPTS_2026-10-02.jsonl).
- 새 분리 후보: `npx vitest run tests/automation-atlas.test.ts tests/automation-png.test.ts tests/automation-probe.test.ts` **32개 통과**. indexed PNG 구조·31단계 투명도 오차·동적 내용/번호·누락 문자·범위 오류·5예제 조립 결과·프로토콜 순서/키/잘린 프레임·중복·상한 거부를 포함한다. 테스트 전문 리뷰에서 atlas 15개를 별도 재실행해 통과했다.
- `pwsh -File scripts/check-automation-trial-ledger.ps1` **7개 시나리오 통과**. 기존 실패·동시 실행 방어 5개와 atlas/atlas_chunks 각각 5예제·8회 제한을 모의 네트워크로 검사했다. 원격 호출은 없다.
- `node scripts/check-automation-atlas.mjs --chunks`: 로컬 5 PNG가 단일 atlas 결과와 전체 바이트 일치. 비인증 401·글자 파일 경로 404. [결과](evidence/AI_PNG_ATLAS_CHUNKS_WORKER_2026-10-02.json).
- `npm run typecheck`, `npx wrangler deploy --config experiments/automation-png/wrangler.atlas.jsonc --dry-run --outdir .automation-png/atlas-worker-build`, `npx wrangler deploy --config experiments/automation-png/wrangler.atlas-probe.jsonc --dry-run --outdir .automation-png/atlas-probe-build` 통과. gzip 각각 약 1,227KiB. 원격 배포 명령이 아니다.
- 로컬 분리 비용 평균은 준비 0~0.64ms·조립 2.18~3.44ms. 사전 파일 읽기·startup·I/O 제외 및 Windows CPU 해상도 한계를 명시했다. [자료](evidence/AI_PNG_ATLAS_CHUNKS_LOCAL_2026-10-02.json). 무료 통과로 판정하지 않는다.
- 추가 원격 PNG 8장 시험은 새 승인 대기다. 전체 Vitest·E2E·실제 AI·자동 예약·PC 종료 검증은 이번 변경에서 새로 완료하지 않았다.
- 20:42 KST 최종 재검증: 관련 Vitest **32/32, 5.63초**, `npm run build`(타입·웹·두 운영 Worker dry-run), `npm run check:free`, `git diff --check` 통과. 정적 무료 검사는 실제 계정·원격 CPU를 대신하지 않는다. 기존 웹 산출물 파일명은 `index-C9LanUcB.js`로 유지됐다.

### 기존 하루단어 통합 기반 병합 후 — 2026-10-02 20:50 KST

- `git fetch origin master` 후 현재 브랜치를 `ad875e8`까지 fast-forward했다. 기존 통합을 포함하는 기준 갱신이며 새 제품 기능을 배포하지 않았다. 실험 시작 기준 `8e4bf67`의 과거 검증 기록은 그대로 유지한다.
- autostash 복원 시 `docs/PROGRESS.md`, `docs/VERIFICATION.md`의 추가 부분이 충돌했다. 두 기록을 모두 남겼으며, 백업한 기존 문서의 모든 줄이 순서대로 보존되는지 검사했다. README·package.json·잠금 파일·tsconfig 내용은 CRLF/LF 차이를 제외하고 동일하다. 복구용 autostash `76da6b5`와 `.automation-png/before-base-refresh/`를 남겼다.
- `npx vitest run tests/studio-bridge.test.ts tests/automation-atlas.test.ts tests/automation-png.test.ts tests/automation-probe.test.ts`: **4파일 37개, 11.06초 통과**. `npm run build`, `npm run check:free`, `git diff --check` 통과. 기본 웹 산출물은 통합 코드가 포함된 `index-Ct3MJjK9.js`다. 통합 export나 운영 게시를 수행한 결과가 아니다.
- `git diff --name-only origin/master -- src migrations wrangler.jsonc`는 비어 있다. 새 변경은 실험·검증·문서·개발 의존성 범위다. 하루단어 저장소 HEAD `939f9149`의 작업 트리도 읽기 전용 확인 전후 깨끗하다.
- 학습 시도 카운터가 제공자별 공유 무료 잔량을 증명하지 못함을 코드로 확인했다. 실제 Google/Groq 계정의 무료 조건·현재 잔량은 미검증이며, 별도 원격 AI 호출이나 기존 키 복사는 없다. 추가 PNG 승인 대기와 2~5단계 미완료 상태를 유지한다.
- 하루단어 저장소에서 `node --experimental-strip-types --test tests/card-studio.test.mjs` **10/10, 187ms** 통과. 로그인·본인 확인·서버 헤더 교체·출처·허용 경로·본문 상한·불명 쓰기 무재시도·redirect 거부를 모의 transport로 검사했다. 실행 뒤 해당 저장소의 `git status --porcelain`은 비어 있다.

### 승인 후 atlas_chunks 실제 검증 — 2026-10-02 21:34 KST

- 사용자 추가8장 승인을 받고 Free·US$0·요청1,858/100,000·기존자원3개를 확인했다. 준비renderer 버전 `14f4e893-2329-4826-bc64-f7c73ce55e24`, Secret 설정 후 probe버전 `d3f0aa9c-08e1-449b-84e3-84466a4bd3d5`를 시험했다.
- `pwsh -File experiments/automation-png/run-remote.ps1 -Mode atlas_chunks`: 정확히8회, HTTP200·로컬5예제별SHA256 모두일치. 원장17행(run_started1,started8,completed8),unknown0. 응답 유실이나 자동 재호출은 없다.
- tail 생성경로66행: 글자준비58회1~11ms(10ms초과1),조립8회13~28ms(전부초과). 비인증 요청은 HTTP401로 확인했으나 tail에는 수집되지 않았다. private공개경로404. 원격PNG성공이며 무료실행검증은 실패다.
- 두별도config로 정확한시험이름을 지정해삭제했고 DPAPI Secret도삭제했다. tail세션은종료했고 Dashboard의원래세Worker를 확인했다. 누적48장이며 추가 원격호출을 승인한 기록은 없다. [CPU](evidence/AI_PNG_ATLAS_CHUNKS_REMOTE_2026-10-02.jsonl),[응답](evidence/AI_PNG_ATLAS_CHUNKS_RESPONSES_2026-10-02.json),[원장](evidence/AI_PNG_ATLAS_CHUNKS_ATTEMPTS_2026-10-02.jsonl).

### 조립 계획 재사용·로컬 비용 진단 — 2026-10-02 21:50 KST

- `npm run typecheck`: 통과. `npx vitest run tests/automation-atlas.test.ts tests/automation-png.test.ts tests/automation-probe.test.ts tests/studio-bridge.test.ts`: **4파일 37개, 11.48초 통과**. 계획 재사용의 5예제 PNG 및 동적 문장·번호의 동일성 assertion을 포함한다.
- `node scripts/benchmark-automation-png.mjs --atlas-assembly-profile`: 5예제 모두 수정 전후 PNG 바이트 일치. 각 단계 5회 준비 후 100회 평균, 자산·startup·네트워크 제외. 중복 포함 대비 재사용 CPU가 3예제 증가·2예제 감소했다. 원격 무료 적합성 근거로 사용하지 않는다. [프로파일 원자료](evidence/AI_PNG_ATLAS_ASSEMBLY_PROFILE_2026-10-02.json).
- 변경된 시험 입구 `npx wrangler deploy --config experiments/automation-png/wrangler.atlas-probe.jsonc --dry-run --outdir .automation-png/atlas-probe-build`: 통과, gzip 1,227.07KiB. `npm run check:free`: 통과. 두 명령 모두 원격 배포·실측이 아니다.
- 성능 전문 재리뷰는 구체적 결함 없음. 새 원격 요청은 없고 누적 48장으로 유지한다. 전체 Vitest·E2E·실제 AI·자동 예약·PC 종료 수신을 이번 변경에서 완료하지 않았다.

### pipeline 로컬·실제 Free 검증 — 2026-10-02 22:12 KST

- `npx vitest run tests/automation-atlas.test.ts tests/automation-png.test.ts tests/automation-probe.test.ts tests/studio-bridge.test.ts`: **4파일 45개, 15.50초 통과**. 신규 8개는 별도 테스트 전문 리뷰에서도 **8/8, 2.24초** 통과했다. 프레임 크기·순서·손상 픽셀 거부, 하위 오류 무재시도, 두 페이지 호출 상한, PNG 동일성을 포함한다.
- `pwsh -File scripts/check-automation-trial-ledger.ps1`: 네트워크 모의 **8시나리오 통과**. 새 `atlas_pipeline`도 5예제·정확히 8회 시작/완료를 기록하고 반복 실행을 막는다.
- `node scripts/benchmark-automation-png.mjs --atlas-pipeline`: 5예제 해시 일치. 로컬 평균 조립 프로세스 CPU 2.50~6.24ms, 수집 0.62~2.18ms. 준비된 자산·모의 transport를 사용해 원격 적합성 판단에는 쓰지 않는다. 초기 벤치마크 `frames` 타입 누락은 명시적 배열 타입으로 수정했고 이후 `npm run typecheck`가 통과했다.
- 두 `wrangler.atlas-pipeline*.jsonc` deploy dry-run 통과, gzip 각각 1,228.35/1,225.17KiB. 로컬 8792/8793의 실제 service binding으로 `node scripts/check-automation-atlas.mjs --pipeline` **5 PNG 바이트 일치·401·404** 통과. 서버는 종료했다. `npm run check:free`, `git diff --check` 통과.
- 실제 Free·US$0·요청 2,008/100,000 확인 후 두 시험 Worker만 배포했다. 준비/조립 버전 `2679aecc-b0cc-49f7-8ab7-fc1fa14f832f`, Secret 설정 후 입구 `11b218da-4429-4c9b-90e8-f28cae3b4187`. 코드 최초 배포 startup 55/59ms는 요청 CPU와 별도다.
- `pwsh -File experiments/automation-png/run-remote.ps1 -Mode atlas_pipeline`: **8/8 HTTP 200·기존 5예제별 SHA256 일치**, 원장 started 8·completed 8·unknown 0. 실제 AI·카카오 호출은 없다.
- 원격 생성 이벤트 예상 100개 중 69개 확보: 준비 58/84(3~28ms, 11회 초과), 조립 3/8(16/35/29ms, 모두 초과), 입구 8/8(12/5/9/18/9/10/8/10ms, 2회 초과). 비인증 401 이벤트 1개를 합쳐 파일은 70행이다. 확보한 이벤트 outcome ok·예외 0. 미수집 31개는 균일한 표본이 아니며 원인 미확인이다.
- 두 시험 Worker와 DPAPI Secret을 삭제했고 tail을 종료했다. Dashboard에서 원래 세 Worker를 재확인했다. 누적 **56 PNG**. [CPU](evidence/AI_PNG_ATLAS_PIPELINE_REMOTE_2026-10-02.jsonl), [응답](evidence/AI_PNG_ATLAS_PIPELINE_RESPONSES_2026-10-02.json), [원장](evidence/AI_PNG_ATLAS_PIPELINE_ATTEMPTS_2026-10-02.jsonl), [로컬 비용](evidence/AI_PNG_ATLAS_PIPELINE_LOCAL_2026-10-02.json), [로컬 Worker](evidence/AI_PNG_ATLAS_PIPELINE_WORKER_2026-10-02.json).
- 새 전체 Vitest·E2E·AI 계정·자동 예약·PC 종료 수신 검증은 하지 않았다. 무료 CPU와 전체 자동화는 미완료다.

## 통합 최적화 검증 — 2026-10-02 23:45 KST

- 브랜치 codex/ai-card-automation, 기반 ad875e8. 관련 Vitest 4파일 56개 통과(부모 54.28초), 신규 최적화 11개는 전문 검토자가 33.48초에 독립 통과했다. 전체 Vitest/E2E 재실행은 아니다.
- 실제 로컬 workerd Static Assets·Service Binding의 800/720×5예제, PNG 10개 전체 바이트 및 크기 일치. 401/405/임의 경로 404/손상 조립 400 통과. `scripts/check-automation-trial-ledger.ps1` 모의 9시나리오에서 신규 모드 10회 상한·2해상도·5예제·사전 기록·재실행 거부 확인.
- `npm run build`, 두 시험 config의 deploy dry-run, `npm run check:free` 통과. 운영 배포는 수행하지 않았다. 신규 본문 읽기는 헤더 누락·허위 길이·중단·실제 초과도 검증했다. 기본 1080 운영 PNG 검증은 유지한다.
- 현재 Free·US$0 및 일일 2,257/100,000을 Dashboard에서 확인했다. 승인 범위에서 시험 두 Worker만 배포. renderer d40571e1-a3d1-4818-84df-a07fe708c2d9, Secret 설정 후 probe 7d92b290-be74-4899-83db-44da1b07bfb9, 최초 startup 각 66ms(요청 CPU 아님).
- `run-remote.ps1 -Mode atlas_optimized`: 실제 10 PNG, started 10/completed 10/unknown 0. 모두 HTTP 200·로컬 SHA256 일치, 비인증 401·비공개 렌더러 공개 주소 404. 누적 66 PNG.
- 생성 CPU 이벤트 160개 중 100개 확보(사전 비인증 1개 별도). 800 준비 45/70에서 2~13ms·2회 초과, 조립 1/5에서 11ms, 수집 5/5에서 8~22ms·3회 초과. 720 준비 43/70에서 2~13ms·1회 초과, 조립 1/5에서 9ms, 수집 5/5에서 6~27ms·2회 초과. outcome ok·예외 0이며 무료 CPU 합격은 아니다.
- 누락 60개(준비 52·조립 8). 파서 오류·버퍼 폐기·stderr·sampling 경고 0. 종료 시 잔여 버퍼 카운터 미기록은 도구에서 후속 수정하고 구문 검사했다. 추가 원격 호출 없음. 제공사 누락 원인 미확정·분위수 미산출.
- 실제 원장·응답·CPU 로그·로컬 원자료·빌드·바인딩·tail 진단을 docs/evidence/AI_PNG_OPTIMIZED*에 보존했다. 수집기 200회 모의 하위 응답 프로파일은 별도 파일이며 원격 CPU로 해석하지 않는다.
- 두 시험 Worker와 DPAPI Secret 삭제, tail·로컬 서버 종료, Dashboard 기존 3 Worker 확인. 실제 AI·카카오·운영 DB/KV·예약 변경 없음. 실제 휴대전화 이미지 품질·AI 무료 계정·전체 무인 경로·PC 종료 수신은 미검증. [해석과 재현](AI_CARD_AUTOMATION_OPTIMIZATION.md).


## SQLite DO 전체 이미지 경로 — 2026-10-03

- 실제 Free 계정 확인 후 격리 Worker2개·SQLite DO·임시 D1/KV를 배포했다. 카드 JSON부터 폰트·배치·1080 PNG·검증·기존 업로드 저장까지 DO에서 실행한다. AI·카카오 호출은 없고 운영 DB/KV·예약은 변경하지 않았다.
- 실제20장 모두 기준 PNG 바이트/SHA256 일치. DO 생성 CPU78~474ms(중앙133), 첫 생성4회252~474ms·후속16회78~187ms. 일반 입구 생성 CPU0~1ms, 전체 경과996~2273ms. CPU와 경과 시간을 구별한다.
- 이미지 생성/회수 CPU 로그80/80. 전체90개 중89개이며409 충돌 거부의 입구 로그1개는 미확인이다. 원격 cards/assets/KV각20개, ready20, 예약/발송0, 저장량1,213,920바이트, 외래키 오류0을 대조했다.
- 로컬 DO 동작8개·구성9개·증거12개 검증을 수행했다. 타입/Vite/운영2Worker dry-run·무료 구성·시험2Worker dry-run도 통과했다. 기존 전체 Vitest/E2E는 이번 재실행 대상이 아니다.
- 리뷰에서 내용/번호 검증 분리·완료 기록 실패 재업로드 방지 검증·실패 단계 기록을 보완했다. 후속 증거 리뷰에서 배포 버전 혼합과 첫 실행 표시 변경을 거부하도록 수정했다. 수집기의 JSON 모드 연결 배너 오인도 수정했고 최초 실패는 요청0·생성0이었다.
- 시험 Worker/Secret·DO 클래스/상태·D1·KV·로컬 토큰 삭제를 확인했다. Dashboard DO없음·기존 Worker3개, D1/KV 기존1개씩으로 복귀했다. DO 사용량 표시는44요청·3.19GB-s였다.
- [실측 보고서](AI_CARD_AUTOMATION_DURABLE.md)와 [원장·CPU·해시·정리 증거](evidence/AI_PNG_DURABLE_2026-10-03.json). 메모리 최고 사용량, 이번 PNG의 휴대전화/카카오 표시, AI무료조건·제품 자동화·PC종료 신규 제작/수신은 미검증이다.


## 비공개 DO 실제 토큰 갱신 — 2026-10-04 14:48 KST

- 14:45:35의 검증 Cron과 14:45:36의 credentials DO RPC는 각각 요청1·sampleInterval1·success·오류0, P50=P99였다. Cloudflare GraphQL 원자료의 2,250/6,054µs를 1,000으로 나눈 수치다. 제공사 대기 시간과 구분한다.
- 토큰 만료 메타데이터를 현재 version12/만료 시각 일치 조건으로 한 번만0으로 바꾸고 실제 시각을 사용해 운영 RPC를 호출했다. version13·20:45:35.200 KST 만료·연결 정상·갱신 오류/잠금0이며 리프레시 토큰 만료 시각은 유지됐다. 토큰 자체를 출력하거나 과거 값으로 복원하지 않았다.
- 주 Worker는14:45:51에 기존1082abeb 버전100%로 복원했다. DO/발송 버전은 변경하지 않았다. /settings는 마지막 업로드의 비활성 시험 변수를 계속 보여 주므로, 활성 배포가 가리키는 immutable version의 bindings로 재검증했다. 활성 버전에는 시험 코드/변수가 없고18개 비인증 테이블의 행 수·SHA256은 일치한다.
- 모의 검증은 신규15개·기존 갱신/입력차단43개·실제 workerd RPC 경계와 모의 제공사1개로59개다. 기존 실제 PC 종료 제작/발송 시험은 사용자 확인과 서버 기록을 함께 근거로 한다. 이번 시험은 추가 AI·메시지 발송을 만들지 않았다.
- 무료 구성 검사를 통과했고 기존 무료 리소스를 유지했다. 계정 구독 API의 최신 조회는403이라 이번에 플랜을 새로 확인했다고 표시하지 않는다. 이전 실제 Free 계정 확인과 이번 구성 보존을 구별한다. 미래 CPU 최고치/무중단/영구 무료를 보장하지 않는다.
- 재검증 명령: `npx vitest run tests/token-refresh-verification.test.ts tests/refresh-cpu.test.ts tests/token-rpc-guards.test.ts tests/token-rpc-runtime.test.mjs`, `npm run typecheck`. 실제 재시험은 [검증 절차](../experiments/token-refresh-verification/README.md)에 따라 현재 상태를 새로 확인하며 자동 반복하지 않는다. 정상 운영 배포 명령은 `npx wrangler deploy --config wrangler.live.jsonc`이고 이번에는 기존 버전 복원으로 종료했다.

핵심 무인 제작·교차 검토·1080 PNG·예약·본인 수신 및 실제 인증 갱신 검증을 완료했다. 정상 예약 엔진 전체 갱신 회차의 원격 CPU는 이번 별도 probe 측정과 구분한다. 다음 자동 제작은 켜지 않았으며 사용자가 일정을 정해 시작할 수 있다.
