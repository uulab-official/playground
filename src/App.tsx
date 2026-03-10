import { Routes, Route } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LandingPage } from './pages/LandingPage';
import { PlaygroundPage } from './pages/PlaygroundPage';
import { BenchmarkPage } from './pages/BenchmarkPage';
import { ResultPage } from './pages/ResultPage';
import { FractalPage } from './pages/FractalPage';
import { GameOfLifePage } from './pages/GameOfLifePage';
import { BoidsPage } from './pages/BoidsPage';
import { ReactionDiffusionPage } from './pages/ReactionDiffusionPage';
import { RayMarchPage } from './pages/RayMarchPage';
import { FallingSandPage } from './pages/FallingSandPage';
import { AudioVisualizerPage } from './pages/AudioVisualizerPage';
import { GalaxyPage } from './pages/GalaxyPage';
import { WaveEquationPage } from './pages/WaveEquationPage';
import { FluidSimPage } from './pages/FluidSimPage';
import { LeaderboardPage } from './pages/LeaderboardPage';
import { NotFoundPage } from './pages/NotFoundPage';
import './index.css';

function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/play" element={<PlaygroundPage />} />
        <Route path="/benchmark" element={<BenchmarkPage />} />
        <Route path="/result" element={<ResultPage />} />
        <Route path="/fractal" element={<FractalPage />} />
        <Route path="/life" element={<GameOfLifePage />} />
        <Route path="/boids" element={<BoidsPage />} />
        <Route path="/reaction" element={<ReactionDiffusionPage />} />
        <Route path="/raymarch" element={<RayMarchPage />} />
        <Route path="/sand" element={<FallingSandPage />} />
        <Route path="/audio" element={<AudioVisualizerPage />} />
        <Route path="/galaxy" element={<GalaxyPage />} />
        <Route path="/wave" element={<WaveEquationPage />} />
        <Route path="/fluid" element={<FluidSimPage />} />
        <Route path="/leaderboard" element={<LeaderboardPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </ErrorBoundary>
  );
}

export default App;
