import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  limit as firestoreLimit,
  serverTimestamp,
  type Firestore,
} from 'firebase/firestore';
import type { BenchmarkResult } from '../stores/useSimulationStore';

/* ── Config (fill in via .env.local) ─────────────────────── */

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY            || '',
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN        || '',
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID         || '',
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET     || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId:             import.meta.env.VITE_FIREBASE_APP_ID             || '',
};

/* ── Helpers ──────────────────────────────────────────────── */

export function isFirebaseConfigured(): boolean {
  return !!(
    firebaseConfig.apiKey &&
    firebaseConfig.projectId &&
    firebaseConfig.appId
  );
}

let _app: FirebaseApp | null = null;
let _db: Firestore | null = null;

export function initFirebase(): Firestore | null {
  if (!isFirebaseConfigured()) return null;

  try {
    // Reuse existing app if already initialized
    if (getApps().length > 0) {
      _app = getApps()[0];
    } else {
      _app = initializeApp(firebaseConfig);
    }
    _db = getFirestore(_app);
    return _db;
  } catch (err) {
    console.warn('[Firebase] Initialization failed:', err);
    return null;
  }
}

function getDb(): Firestore | null {
  if (_db) return _db;
  return initFirebase();
}

/* ── Leaderboard Collection Type ─────────────────────────── */

type LeaderboardDoc = Omit<BenchmarkResult, 'fpsHistory' | 'particleHistory'> & {
  // fpsHistory / particleHistory omitted to keep Firestore docs small
  createdAt: ReturnType<typeof serverTimestamp>;
};

/* ── Public API ───────────────────────────────────────────── */

/**
 * Save a benchmark result to the global Firestore leaderboard.
 * Silently no-ops if Firebase is not configured.
 */
export async function saveGlobalScore(result: BenchmarkResult): Promise<void> {
  const db = getDb();
  if (!db) {
    console.info('[Firebase] Not configured – skipping saveGlobalScore.');
    return;
  }

  try {
    const doc: LeaderboardDoc = {
      gpuModel:               result.gpuModel,
      browserVersion:         result.browserVersion,
      totalScore:             result.totalScore,
      avgFps:                 result.avgFps,
      minFps:                 result.minFps,
      percentile1LowFps:      result.percentile1LowFps,
      maxParticlesMaintained: result.maxParticlesMaintained,
      durationSeconds:        result.durationSeconds,
      timestamp:              result.timestamp,
      createdAt:              serverTimestamp(),
    };
    await addDoc(collection(db, 'leaderboard'), doc);
  } catch (err) {
    console.warn('[Firebase] Failed to save score:', err);
  }
}

/**
 * Fetch the global leaderboard from Firestore.
 * Returns an empty array if Firebase is not configured or on error.
 */
export async function getGlobalLeaderboard(
  limitCount: number = 50,
): Promise<BenchmarkResult[]> {
  const db = getDb();
  if (!db) {
    console.info('[Firebase] Not configured – returning empty leaderboard.');
    return [];
  }

  try {
    const q = query(
      collection(db, 'leaderboard'),
      orderBy('totalScore', 'desc'),
      firestoreLimit(limitCount),
    );
    const snapshot = await getDocs(q);

    return snapshot.docs.map((docSnap) => {
      const d = docSnap.data() as LeaderboardDoc;
      return {
        gpuModel:               d.gpuModel               ?? 'Unknown',
        browserVersion:         d.browserVersion         ?? 'Unknown',
        totalScore:             d.totalScore             ?? 0,
        avgFps:                 d.avgFps                 ?? 0,
        minFps:                 d.minFps                 ?? 0,
        percentile1LowFps:      d.percentile1LowFps      ?? 0,
        maxParticlesMaintained: d.maxParticlesMaintained ?? 0,
        durationSeconds:        d.durationSeconds        ?? 0,
        timestamp:              d.timestamp              ?? Date.now(),
        // These large arrays are not stored in Firestore
        fpsHistory:             [],
        particleHistory:        [],
      } satisfies BenchmarkResult;
    });
  } catch (err) {
    console.warn('[Firebase] Failed to fetch leaderboard:', err);
    return [];
  }
}
