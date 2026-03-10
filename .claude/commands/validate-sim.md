새로 추가된 WebGPU 시뮬레이션 페이지와 셰이더를 검증해주세요.

검증 대상 파일: $ARGUMENTS

아래 항목을 서브에이전트(Explore)로 체크하고, 각 항목마다 ✅ PASS / ❌ FAIL / ⚠️ WARN 로 결과를 출력하세요.

## [1] Uniform 버퍼 필드 순서
- WGSL struct 각 필드(이름, 타입, 순서)를 읽어서 목록화
- CPU writeBuffer 코드의 각 인덱스 할당을 읽어서 목록화
- 1:1 비교: 모든 필드가 같은 인덱스에, 같은 타입(u32/f32)으로 쓰여지는지 확인

## [2] Bind Group Layout 타입
- WGSL의 각 @binding 선언 타입 확인:
  - `var<storage, read>` → CPU BGL에서 `read-only-storage` 이어야 함
  - `var<storage, read_write>` → CPU BGL에서 `storage` 이어야 함
- BGL 바인딩 인덱스가 WGSL @binding(N) 순서와 일치하는지 확인
- 바인딩에 실제로 연결된 버퍼가 올바른지 확인

## [3] 마우스 Y 좌표
- 렌더 셰이더에서 Y 좌표 처리 확인: `(1.0 - uv.y) * height` 패턴이면 CPU에서 Y 플립 금지
- CPU 마우스 핸들러에서 `1 -` 또는 `1.0 -` 를 Y에 적용하는지 확인
- 그리드 기반 시뮬(sand, GOL, RD, wave): Y 플립 없어야 함
- NDC 기반 시뮬(boids, galaxy): `-(... * 2 - 1)` 형태는 정상

## [4] Ping-pong 버퍼 스왑
- compute pass 실행 후 currentBuffer 스왑 위치 확인
- render pass가 스왑된 올바른 버퍼(output)를 읽는지 확인

## [5] CSS 구조
- `app-container dark` 최상위 컨테이너 확인
- `canvas-container > canvas` 구조 확인
- `ui-overlay > ui-header + ui-controls` 구조 확인
- `preset-grid > preset-btn` 사용 확인
- 존재하지 않는 임의 클래스명 사용 여부

## [6] TutorialOverlay
- `id`, `steps: [{icon, title, desc}]`, `onClose` props 모두 존재하는지 확인

## [7] 빌드
- `npm run build` 실행 후 에러 없음 확인

## 최종 출력
- 각 항목 결과를 표로 출력
- FAIL 항목은 구체적인 수정 방법 제시
- 모두 통과시 "검증 완료 ✅" 출력
