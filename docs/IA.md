# 실서비스용 IA 및 기획 정의서 (Information Architecture & Specification)

## 1. 메뉴 구조 (Menu Structure)
- **Home (Landing Page)**
  - 서비스 소개 및 메인 CTA (모드 선택으로 이동)
  - 최근 이슈/공지사항
- **플레이 모드 (Play Modes)**
  - Particle Drop (파티클 드롭)
  - Falling Sand (샌드박스)
  - Fluid Playground (유체 시뮬레이션)
- **성능 테스트 (Stress Test)**
  - 벤치마크 시작 (저/중/고/익스트림 프리셋)
  - 벤치마크 결과 리포트 (점수 및 기기 비교)
- **갤러리 & 커뮤니티 (추후 확장 가능성 대비)**
  - 공유된 시뮬레이션 환경 (시드/설정)
- **설정 및 안내 (Settings & Info)**
  - 브라우저 WebGPU 지원 여부 및 가이드
  - 설정 (다크모드, 디버그 오버레이, 해상도 조절 등)

## 2. 화면별 기능 (Features per Screen)

### A. 랜딩 페이지
- WebGPU 지원 여부 자동 감지 바 표시 (지원/미지원/WebGL 폴백 안내)
- 모드별 대표 썸네일/짧은 영상 플레이
- "지금 바로 시작" 메인 버튼

### B. 샌드박스 플레이 화면 (Particle, Sand, Fluid)
- **캔버스 영역**: 반응형 자동 해상도 캔버스, 사용자와 마우스 상호작용 (클릭 시 입자 생성, 드래그 시 밀기/반응).
- **좌측 툴바**: 재료 선택 (모래, 물, 불 등), 브러시 크기, 장애물 도구.
- **우측 패널**: 시뮬레이션 제어 (일시정지, 슬로모션, 배속), 입자 수 수동 조절 슬라이더, 현재 입자 수/FPS 실시간 표시.
- **하단 액션 메뉴**: 화면 지우기, 스크린샷 캡처, 시드값 복사(상태 공유용), 설정 저장.

### C. 벤치마크 진행 화면
- **시야 최소화된 UI**: 온전히 시뮬레이션 자체에 리소스를 집중하기 위해 UI를 숨김.
- **실시간 HUD**: 진행 시간(예: 30초/60초), 현재 입자 수, 실시간 FPS 및 Frame Time 그래프 (lightweight-charts 사용).
- **자동 부하 로직**: 정해진 스크립트에 따라 단계별로 입자를 투입하거나 장애물을 생성.

### D. 결과 리포트 화면
- **성능 서머리**: 기기 정보 (GPU 이름, 브라우저), 종합 점수, 평균/최소 FPS, 유지된 최대 입자 수.
- **결과 카드 생성 기능**: 소셜 미디어(유튜브 썸네일 등) 공유용 이미지 다운로드 버튼.

## 3. 데이터 구조 (Data Structure - Zustand Store)

```typescript
// 시뮬레이션 글로벌 상태
interface SimulationState {
  currentMode: 'PARTICLE' | 'SAND' | 'FLUID' | 'BENCHMARK';
  particleCount: number;
  fps: number;
  frameTimes: number[];
  isPaused: boolean;
  timeScale: number; // 0.5, 1.0, 2.0 등
  settings: {
    darkMode: boolean;
    useWebGPU: boolean;
    resolutionScale: number; // 0.5 ~ 1.0 (성능 타협용)
  };
}

// 벤치마크 결과 데이터
interface BenchmarkResult {
  userId: string; // 익명 세션 ID
  gpuModel: string;
  browserVersion: string;
  totalScore: number;
  avgFps: number;
  percentile1LowFps: number;
  maxParticlesMaintained: number;
  durationSeconds: number;
  timestamp: Date;
}
```

## 4. 점수 계산식 (Score Calculation Formula)

벤치마크의 종합 점수는 기기의 GPU 처리 능력과 렌더링 유지력을 균형 있게 반영해야 합니다.

* **최종 점수 (Total Score) = (안정화된 평균 FPS) × (유지 입자 수 계수) × (안정성 가중치)**

**세부 산식 예시:**
1. **성능 점수 (Base Performance) =** `(Avg FPS) * (Max Particles / 1000)`
2. **안정성 가중치 (Stability Weight) =** `1 - ((Avg FPS - 1% Low FPS) / Avg FPS)` 
   *(드랍이 클수록 점수가 깎임. 최소 0.5 최대 1.0)*
3. **최종 식 =** `Base Performance * Stability Weight`
   *(ex: 평균 60fps, 10만 개 유지, 1% Low가 45fps(안정성 0.75) => 60 * 100 * 0.75 = 4500점)*

## 5. MVP 일정 (Development Schedule - MVP 1단계)

* **1주차: 프로젝트 세팅 및 코어 렌더링 엔진 구축**
  - Vite + React + TypeScript 환경 구성
  - WebGPU 캔버스 초기화 및 WebGL 폴백 확인
  - Compute Shader 기초 작성 (2D 이동, 중력, 벽 충돌)
* **2주차: 기본 파티클 기능 구현 (Particle Drop 모드)**
  - 10만 개 단위 입자 렌더링 최적화
  - 마우스 상호작용 (입자 생성, 브러시 기능)
  - 기본 UI (상단 FPS/카운트 표시, 일시정지 버튼)
* **3주차: 상태 관리 및 샌드박스 기초 (UI/UX)**
  - Zustand 스토어 연결
  - 모드 선택 페이지 및 라우팅 (Home -> Sandbox)
  - 3가지 프리셋(폭발, 와류 등) 추가
* **4주차: 최적화 및 결과 검증, 배포**
  - 기기별 호환성 테스트
  - Cloudflare Pages 연동 및 정적 배포
  - 공유 가능한 초기 버전 릴리즈 (MVP 1 완성)

MVP 이후 `sandboxels` 수준의 다양한 재질(물, 불) 도입 및 벤치마크 모드 본격화를 순차적으로 진행합니다.
