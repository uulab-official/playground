# WebGPU Playground — Claude Instructions

## 새 시뮬레이션 추가 시 필수 검증 절차

새로운 Page(.tsx) 또는 Shader(.wgsl)를 추가할 때는 반드시 아래 체크리스트를 서브에이전트로 실행할 것.

### 검증 체크리스트 (신규 파일 작성 후 즉시 실행)

**[1] Uniform 버퍼 필드 순서 검증**
- WGSL struct의 필드 순서와 CPU writeBuffer 코드를 1:1 비교
- u32 필드에 `new Uint32Array(buf.buffer)[N]` 사용 확인
- f32 필드에 `new Float32Array(buf.buffer)[N]` 사용 확인

**[2] Bind Group Layout 타입 검증**
- `var<storage, read>` → BGL에서 `read-only-storage`
- `var<storage, read_write>` → BGL에서 `storage`
- BGL 바인딩 인덱스 순서 = WGSL `@binding(N)` 순서

**[3] 마우스 Y좌표 검증**
- 렌더 셰이더가 `(1.0 - uv.y) * height`를 쓰면 CPU에서 Y 플립 금지
- CPU 마우스 핸들러: `y = (clientY - rect.top) / rect.height * GRID_H` 형태여야 함
- NDC 좌표계 사용 시 (Boids/Galaxy): `-(... * 2 - 1)` 형태는 정상

**[4] Ping-pong 버퍼 스왑 검증**
- compute → swap → render 순서 확인
- render가 swap 후 올바른 버퍼(output)를 읽는지 확인

**[5] CSS 클래스 구조 검증**
- `app-container dark > canvas-container + ui-overlay` 구조 사용
- `ui-header > header-left + header-right` 구조
- `ui-controls > control-group > preset-grid > preset-btn` 구조
- 임의 클래스명 사용 금지

**[6] TutorialOverlay props 검증**
- `id`, `steps: [{icon, title, desc}]`, `onClose` props 확인

**[7] 빌드 검증**
- `npm run build` 실행 → 에러 없음 확인

## 검증 방법

새 파일 추가 후 아래 명령으로 서브에이전트 검증 실행:
> "방금 추가한 [PageName]과 [shader.wgsl]을 검증해줘"

또는 직접 Explore 에이전트로:
- 셰이더 struct vs CPU 코드 필드 1:1 비교
- 바인딩 타입 불일치 탐색
- 마우스 핸들러 Y좌표 패턴 확인
