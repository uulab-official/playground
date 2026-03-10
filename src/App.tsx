import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PageLoader } from './components/PageLoader';
import { LandingPage } from './pages/LandingPage';
import './index.css';

const PlaygroundPage       = lazy(() => import('./pages/PlaygroundPage').then(m => ({ default: m.PlaygroundPage })));
const BenchmarkPage        = lazy(() => import('./pages/BenchmarkPage').then(m => ({ default: m.BenchmarkPage })));
const ResultPage           = lazy(() => import('./pages/ResultPage').then(m => ({ default: m.ResultPage })));
const FractalPage          = lazy(() => import('./pages/FractalPage').then(m => ({ default: m.FractalPage })));
const GameOfLifePage       = lazy(() => import('./pages/GameOfLifePage').then(m => ({ default: m.GameOfLifePage })));
const BoidsPage            = lazy(() => import('./pages/BoidsPage').then(m => ({ default: m.BoidsPage })));
const ReactionDiffusionPage = lazy(() => import('./pages/ReactionDiffusionPage').then(m => ({ default: m.ReactionDiffusionPage })));
const RayMarchPage         = lazy(() => import('./pages/RayMarchPage').then(m => ({ default: m.RayMarchPage })));
const FallingSandPage      = lazy(() => import('./pages/FallingSandPage').then(m => ({ default: m.FallingSandPage })));
const AudioVisualizerPage  = lazy(() => import('./pages/AudioVisualizerPage').then(m => ({ default: m.AudioVisualizerPage })));
const GalaxyPage           = lazy(() => import('./pages/GalaxyPage').then(m => ({ default: m.GalaxyPage })));
const WaveEquationPage     = lazy(() => import('./pages/WaveEquationPage').then(m => ({ default: m.WaveEquationPage })));
const FluidSimPage         = lazy(() => import('./pages/FluidSimPage').then(m => ({ default: m.FluidSimPage })));
const LeaderboardPage      = lazy(() => import('./pages/LeaderboardPage').then(m => ({ default: m.LeaderboardPage })));
const NotFoundPage         = lazy(() => import('./pages/NotFoundPage').then(m => ({ default: m.NotFoundPage })));

function App() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/"           element={<LandingPage />} />
          <Route path="/play"       element={<PlaygroundPage />} />
          <Route path="/benchmark"  element={<BenchmarkPage />} />
          <Route path="/result"     element={<ResultPage />} />
          <Route path="/fractal"    element={<FractalPage />} />
          <Route path="/life"       element={<GameOfLifePage />} />
          <Route path="/boids"      element={<BoidsPage />} />
          <Route path="/reaction"   element={<ReactionDiffusionPage />} />
          <Route path="/raymarch"   element={<RayMarchPage />} />
          <Route path="/sand"       element={<FallingSandPage />} />
          <Route path="/audio"      element={<AudioVisualizerPage />} />
          <Route path="/galaxy"     element={<GalaxyPage />} />
          <Route path="/wave"       element={<WaveEquationPage />} />
          <Route path="/fluid"      element={<FluidSimPage />} />
          <Route path="/leaderboard" element={<LeaderboardPage />} />
          <Route path="*"           element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}

export default App;
