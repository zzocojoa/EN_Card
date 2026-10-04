# 바이너리 RPC 구현·로컬 비교

후속 N2 메타데이터 바이너리화도 구현·비교했다. 최신 결과는 [N2 보고서](AI_CARD_AUTOMATION_BINARY.md)를 따르며, 아래는 N1 당시의 측정과 판단이다.

2026-10-03 / `codex/ai-card-automation` / 기반 `ad875e8`

**RPC 후보를 구현했으나 전체 생성 경로에는 채택하지 않는다.** 수집만 분리한 로컬 비교에서는 반복 평균이 3.643→3.242ms로 감소했지만, 실제 페이지를 읽고 PNG까지 계산한 경로는 39.659→42.064ms로 증가했다. 모든 값은 로컬 경과 시간이며 Cloudflare CPU가 아니다. 원격 호출·배포·AI·카카오·운영 DB 변경은 없다. 기존 원격 PNG 누적88개와 무료 CPU 미충족 상태를 유지한다.

## 구현과 비교 조건

- [atlas-rpc.ts](../experiments/automation-png/atlas-rpc.ts): 제한된 `glyphs(size, fixture, index)`와 `assemble(size, fixture, bundle)` 함수, `ArrayBuffer` 반환, 인증 수집기.
- [atlas-rpc-worker.ts](../experiments/automation-png/atlas-rpc-worker.ts): 비공개 `WorkerEntrypoint`. 비교용 HTTP 경로도 함께 제공한다. 외부 URL·사용자 문장·파일 경로는 받지 않는다.
- [atlas-rpc-probe.ts](../experiments/automation-png/atlas-rpc-probe.ts): Secret 인증 뒤 고정된 HTTP/RPC 후보를 선택한다. 실제 Secret은 코드에 넣지 않았다.
- [atlas-pipeline.ts](../experiments/automation-png/atlas-pipeline.ts): 기존 글자 준비 계산을 `preparePipelineFrame`으로 추출해 두 경로가 같은 계산·검증을 사용한다. 운영 소스와 기본 배포 설정은 이번 단계에서 변경하지 않았다.

두 후보 모두 **800/720, 64슬롯, 호출당6페이지, 기존 scalar 그리기·JS CRC·Z_RLE**다. 이전 native CRC 후보를 섞지 않았다. 같은 예제10종에서 준비72호출과 조립10호출을 유지하며, ATC/ATB 형식과 조립용 연속 버퍼 복사도 그대로다. 따라서 RPC가 모든 복사를 없앤 실험은 아니다.

송신·수신 양쪽의 프레임1MiB, 조립4MiB, 최대29묶음 제한을 유지한다. 크기·예제·인덱스를 자산 조회 전에 검사하며, 조립에서 프레임 순서·요청 글자·오프셋·알파·PNG 검증을 그대로 수행한다. RPC 예외는 공개 입구에서 고정된502 응답이 되며 자동 재시도하지 않는다. RPC 직렬화는 수신 함수 실행 전에 일어나므로 수신측 길이 검사만으로 전송 중 메모리 사용을 차단한다고 주장하지 않는다. 비공개 바인딩과 제한된 송신 함수가 전제다.

Cloudflare의 RPC는 `WorkerEntrypoint`와 Service Binding으로 사용할 수 있으며 구조화 복제 가능한 값을 전달한다. 현재 호환 날짜는 공식 요구 날짜 이후다. 제공사 직렬화 한도32MiB와 앱의4MiB 상한은 다르다. [RPC 문서](https://developers.cloudflare.com/workers/runtime-apis/rpc/), [Service Binding RPC](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/)를 확인했다.

## 측정 결과

각 모집단·방식마다 새 로컬 workerd20개를 생성했다. 예제5개×해상도2개×2라운드이며, 매 인스턴스에서 첫1회·안정화2회·반복10회를 실행했다. 두 번째 라운드에서 예제 순서와 같은 예제의 fetch/RPC 실행 순서를 반전했다. 프로파일러는 연결하지 않았다.

시간 범위는 호스트의 요청 전달부터 전체 응답 읽기까지다. PNG 바이트 비교는 시간 측정 뒤에 수행했다. `mf.ready`까지의 프로세스·자산 준비는 별도 `setup_wall_ms`로 기록하며 표에서 제외했다. 첫 요청을 전체 플랫폼 cold start 시간이라고 부르지 않는다.

| 모집단    | 방식  | 첫 실행 중앙값 ms | 첫 실행 범위 ms | 반복 평균 ms | 반복 표본 |
| --------- | ----- | ----------------: | --------------: | -----------: | --------: |
| 수집 분리 | fetch |             8.764 |    7.461~12.617 |        3.643 |       200 |
| 수집 분리 | RPC   |             8.351 |    6.360~10.159 |        3.242 |       200 |
| 전체 생성 | fetch |            52.856 |   35.786~99.730 |       39.659 |       200 |
| 전체 생성 | RPC   |            53.634 |  36.128~161.690 |       42.064 |       200 |

**수집 분리**는 미리 준비한 실제 글자 프레임72개·PNG10개를 로컬 workerd의 시험 렌더러가 반환한다. Worker 간 HTTP/RPC 전달은 실제지만 글자·PNG 계산과 자산 읽기는 제외한다. 이전 Node 콜백 모의 바인딩의 시간과 직접 비교하지 않는다.

**전체 생성**은 실제 로컬 Static Assets에서 페이지를 읽고 글자·PNG를 계산한다. 두 Worker와 로컬 자산 처리·응답 전달을 합친 경과 시간이다. 원격 호출당 CPU10ms와 비교할 수 없다.

수집 분리는 같은 입력·라운드20쌍 중 첫 실행15쌍·반복 평균16쌍에서 RPC가 짧았다. 전체 생성은 첫 실행10쌍·반복 평균9쌍에 그쳤다. 전체 RPC의 긴 coverage 표본도 제외하지 않았다. 작은 로컬 표본의 변동과 자산·런타임 처리를 포함하므로 RPC가 항상 느리거나 빠르다는 결론은 내리지 않는다. 다만 **현재 근거로 전체 성능 개선을 주장하거나 기본 경로를 바꿀 수 없다.**

수집·전체 시간을 더하거나 이전 조립 비교와 합산하지 않는다. 원격 준비/수집/조립 CPU와 로그 확보율은 이번 실험에서 측정하지 않았다.

근거: [원시80행·반복 측정·요약·소스 해시](evidence/AI_PNG_RPC_LOCAL_2026-10-03.json), [실제 로컬 바인딩 검증](evidence/AI_PNG_RPC_WORKER_2026-10-03.json).

## 검증과 리뷰

- Vitest 관련3파일48개 통과: 새 RPC 계약7개와 기존 atlas/최적화41개. 인증 실패, 고정 입력, 타입·크기·순서·알파, 자산 실패, 재시도 없음, HTTP/RPC PNG 일치를 검사했다.
- 실제 로컬 workerd에서 HTTP/RPC의 20개 PNG가 보존된 기준과 같고, 잘못된 요청12건이 거부됐다. Miniflare 자산 라우터의 `has_user_worker` 설정 누락을 수정한 뒤 측정했다. 거부 시험도 workerd 내부에서 RPC를 호출해 Node 메서드 프록시의 미해제 stub 경고를 제거했다.
- 최종 실행에서 **PNG 응답1,060건 바이트 일치**. 실제 계산540건과 사전 준비 응답520건을 구분한다. 입력 준비 단계의 Node PNG나 앞선 smoke 재실행을 이 수치에 더하지 않았다.
- `npm run build`의 타입·Vite·제품 두 Worker dry-run, `npm run check:free`, 새 시험 두 Worker dry-run 통과. 새 렌더러 gzip1,568.93KiB·입구1,565.27KiB였다. 계정 자격이나 CPU 적합성의 증명은 아니다.
- `review`의 테스트·성능·보안·유지보수 전문 검토와 독립 적대적 검토에서 미수정 결함은 발견하지 못했다. 테스트 전문 검토는 테스트 원문을 읽었고, 독립 적대적 검토는 테스트·fixture 요약만 확인했다. 별도 모델/Claude 검토로 주장하지 않는다.

전체 제품 Vitest/E2E·원격 CPU·실제 AI/카카오 연동을 이번에 새로 검증한 것은 아니다. 현재 계정 플랜·공유 쿼터도 재조회하지 않았다. 유료 상품·새 의존성은 추가하지 않았다.

## 재현과 다음 단계

아래 명령은 저장소 루트에서 실행한다. `.automation-png` 자산이 없는 환경은 [최적화 재현 명령](AI_CARD_AUTOMATION_OPTIMIZATION.md#재현-명령)의 전체 atlas→common→optimized-build→자산 복사→optimized 기준PNG 생성 순서를 먼저 실행한다. 이 전제 파일은 Git 제외이며 명령이 원격에서 내려받는 비밀값은 없다.

```powershell
npm test -- tests/automation-rpc.test.ts tests/automation-atlas.test.ts tests/automation-optimized.test.ts
node experiments/automation-png/research-rpc-workerd.mjs --smoke
node experiments/automation-png/research-rpc-workerd.mjs
npm run build
npm run check:free
npx wrangler deploy --config experiments/automation-png/wrangler.atlas-rpc.jsonc --dry-run
npx wrangler deploy --config experiments/automation-png/wrangler.atlas-rpc-probe.jsonc --dry-run
```

측정 중에는 다른 테스트·빌드·CPU 부하를 실행하지 않는다. 측정기는 인스턴스를 `finally`에서 정리하고 원자료를 저장한다. 같은 명령은 해당 날짜의 로컬 결과 파일을 다시 작성하므로 비교 기록을 보존하려면 기존 파일을 별도로 보관한다. 실제 원격 시험 원장은 건드리지 않는다.

다음 후보는 **ATC JSON 메타데이터의 바이너리화(N2)**다. fetch 기준을 유지한 채 첫 조립·준비에서 JSON 인코딩/해독을 줄이는 효과를 분리한다. N1은 실험 코드로 보존한다. 무료 CPU와 로그 누락이 해결되기 전까지 전체 AI 자동화2~5단계는 미완료이며 운영 활성화하지 않는다.
