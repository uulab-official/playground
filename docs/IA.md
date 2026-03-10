# GPU Playground (가칭: Particle Lab) - 기획 및 아키텍처 정의서

## 1. 서비스 개요
- **목표**: 서버 없이 정적 웹으로 운영되는 WebGPU 기반 물리 시뮬레이션 놀이터 겸 PC 성능 테스트 기능
- **방향성**: "Sandboxels의 재미 + WebGPU 파티클 데모의 기술력 + Basemark류의 점수 UX" 결합 (Playground + Benchmark)
- **수익 모델**: Google Adsense (상단, 측면, 결과 화면) 배너 광고
- **유입 전략**: 극단적 벤치마크 점수와 바이럴 요소를 통한 유튜브 쇼츠, 틱톡, 레딧, 트위터 공유

## 2. 전체 서비스 구조 (IA)

```text
Home (Landing)
 ├ Playground (놀이터 모드)
 │   ├ Particle Drop (기본 1만~20만 입자 중력/충돌)
 │   ├ Sand Simulation (모래, 물, 불 등 재질 상호작용)
 │   ├ Fluid Simulation (유체 역학, 압력 분사)
 │   └ Chaos Mode (극단적 환경 설정, 예: 블랙홀+폭발 연쇄)
 │
 ├ Benchmark (PC 성능 테스트 모드)
 │   ├ Quick Test (입자 50K, 30초 지속)
 │   ├ Extreme Test (입자 200K, 60초 지속)
 │   └ Ultimate Test (점진적 입자 자동 증가, 120초 지속)
 │
 ├ Gallery (추후 MVP 확장 가능)
 │   ├ Popular Simulations
 │   └ Community Creations
 │
 ├ Learn
 │   ├ How GPU Physics Works
 │   └ WebGPU Info
 │
 └ Settings
     ├ Graphics (Ultra, High, Medium, Low)
     └ Performance (Auto Scaling)
```

## 3. 핵심 게임 / 시뮬레이션 모드 상세

### 3.1. Particle Drop (기본 모드)
- 입자 수: 1만 ~ 20만 개
- 물리 효과: 중력, 개별 충돌, 바닥 반사, 장애물
- 인터랙션: 마우스 드래그를 통한 밀기, 폭발, 블랙홀 생성
- 주요 프리셋: 10K / 50K / 100K / 200K balls

### 3.2. Falling Sand (샌드박스)
- 재료 목록: sand, water, smoke, fire, lava, oil, stone, plant, metal
- 화학 반응 예시:
  - 불 + 기름 → 폭발 (Explosion)
  - 물 + 용암 → 돌 (Stone)
  - 불 + 식물 → 연기 (Smoke)
- 유튜브/쇼츠에서 가장 바이럴이 쉽게 일어나는 코어 콘텐츠입니다.

### 3.3. Fluid Simulation
- 유체 전용 동역학 (Compute Shader 기반)
- 사용자 조작: Water Cannon(물 분사), Drain(배수구), Gravity Change.

### 3.4. Chaos Mode
- 스트레스 테스트 전용 Playground.
- 50만 입자, 중력 반전, 입자 폭풍(Particle Storm), 연쇄 폭발 등 극단 환경.

## 4. Benchmark (성능 테스트) 상세

벤치마크는 점수 및 수치화를 통한 PC 성능 비교 툴로 작용합니다.

- **출력 정보**: GPU Name, Browser, 해상도, 입자 수, Average FPS, Minimum FPS (1% Low), Frame Time
- **점수 산출/공유**:
  ```text
  [결과 예시]
  Device : RTX 4070
  Browser : Chrome
  Particles : 200000 
  Average FPS : 82 
  Minimum FPS : 44
  Score : 12500 (Rank: A+)
  ```
- **공유 액션**: 결과 이미지 생성(Share Image), 링크 복사, 다운로드.

## 5. 바이럴 요소
1. **극단적 테스트**: "내 노트북은 100만 파티클 버틸까?" 자극.
2. **마우스 인터랙션**: 드래그 시 입자 폭풍 발생 등 시각적 쾌감.
3. **프리셋**: Black Hole, Sand Volcano, Water Tornado 등의 원클릭 시연.
4. **녹화 기능**: 10초 클립 Export 기능을 통한 쇼츠/릴스 생성 유도.

## 6. 기술 스택 및 렌더링 아키텍처
- **도메인/배포**: Cloudflare Pages / GitHub Pages 등 정적 서버 구조 (100% 클라이언트 연산)
- **상태 관리/프론트엔드**: React, TypeScript, Vite, Zustand
- **렌더링 파이프라인**: 
  - `Browser(React UI) -> Input -> WebGPU Compute Shader(Physics) -> WebGPU Render Shader`
- **폴백(Fallback)**: WebGPU 미지원 기기를 위한 WebGL2 지원(제한된 파티클).

### WebGPU 데이터 파이프라인 개념
입자(Particle) 정보는 매 프레임 CPU를 거치지 않고 오직 GPU 내부 `Storage Buffer`에서만 핑퐁(Ping-Pong)되며 위치(Position)와 속도(Velocity)가 연산됩니다. UI 오버레이만이 React와 Zustand 상태를 읽어 화면에 FPS 차트(`lightweight-charts`)를 그립니다.

## 7. 개발 마일스톤 (MVP 일정)
* **1단계 (1주차) [완료]**: 코어 엔진 구축, MVP WebGPU 환경, UI 구조 세팅, Particle Drop 기본 렌더링.
* **2단계 (2주차)**: Sandbox 모드 (Sand, Water, Fire 등 재질 상호작용 및 브러시 도구).
* **3단계 (3주차)**: Benchmark 모드 로직 (FPS 기반 점수 측정 및 결과 리포트 화면 UI).
* **4단계 (4주차)**: 바이럴 기능 (스크린샷, 짧은 GIF/WEBM 녹화, 프리셋 시스템).
