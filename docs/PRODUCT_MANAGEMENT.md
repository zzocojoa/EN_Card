# 하루단어 제품 안에서 EN_Card 관리

두 저장소를 하나의 제품으로 출시한다. 공통 관리 원본은 하루단어의 [PRODUCT_MANAGEMENT.md](https://github.com/zzocojoa/haru-word/blob/main/PRODUCT_MANAGEMENT.md), 커밋·PR·배포 상태의 원본은 [출시 기록](https://github.com/zzocojoa/haru-word/blob/main/docs/releases/product-status.json)이다. 해당 문서가 병합되기 전에는 하루단어 `codex/card-release-reconciliation` 브랜치의 같은 경로를 확인한다. 상태표를 두 저장소에서 따로 갱신하지 않는다.

## 작업 경계

- 카드 편집·자동 제작 화면, Worker/DO, 검토·PNG·예약·카카오 발송은 EN_Card 원본에서 수정한다.
- 하루단어의 학습 화면·로그인·카드 진입·프록시는 하루단어 원본에서 수정한다.
- 하루단어 `public/card-studio/`, `lib/server/card-automation.generated.*`는 생성물이다. 직접 수정하지 않고 EN_Card exporter로 갱신한다.
- 각 저장소의 기본 브랜치는 EN_Card `master`, 하루단어 `main`이다. 이름이 같은 작업 브랜치도 저장소별로 별개다.
- 기존 Worker·D1·KV·DO·Cron·Site와 공개 이미지 URL은 유지한다. 저장소 관리 정리는 인프라 이전이나 유료 구성 추가를 뜻하지 않는다.

## 반복할 절차

변경 파일이 없는 것을 확인하고 최신 기본 브랜치에서 목적별 브랜치를 만든다.

```powershell
git status --short --branch
git fetch origin master
git switch --no-track -c codex/카드-작업명 origin/master
npm run typecheck
npm test
npm run build
npm run check:free
```

관련 브라우저 검증과 리뷰 후 EN_Card PR을 병합한다. 화면/릴레이 변경이 있으면 확정 원본 커밋을 기록하고, 깨끗한 하루단어 작업 브랜치로 내보낸다.

```powershell
node scripts/export-haru.mjs --target 'C:/Users/user/Documents/ChatGPT/하루단어'
```

하루단어 PR에는 EN_Card 커밋·PR, 생성 명세, 통합 검사 결과를 연결한다. 실제 체크아웃 위치가 다르면 `--target`을 바꾼다. exporter가 Site ID 또는 수동 변경 불일치로 중단하면 원인을 확인하고 생성물 보호를 우회하지 않는다.

병합 이후 필요한 구성 요소만 기존 배포 절차로 반영하고 공통 출시 기록을 갱신한다. 문서만 변경했다면 배포하지 않는다. DB 변경이 있으면 데이터 호환·복구를 별도 확인한다. 실제 카카오 수신·CPU·무료 계정 확인은 로컬 테스트와 구분한다.

## 이번 기준

2026-10-04 EN_Card PR7의 자동화와 PR8의 UI는 `master@98832db`에 포함됐다. 하루단어는 `main@76883e5`와 Site v114 소스 `c65b66d`가 달라 카드 변경과 실험을 분리해 정리한다. 원래 브랜치·실측 자료를 보존하고 전체를 일괄 병합하지 않는다. 상세 차이와 후속 항목은 공통 관리 문서에만 유지한다.
