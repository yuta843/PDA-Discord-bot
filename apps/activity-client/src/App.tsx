import { lazy, Suspense } from 'react';
import type { CharacterState } from '@miq/pachinko-shared';
import { useCharacterState } from './use-character-state';
import './styles.css';

const StlCharacter = lazy(() => import('./StlCharacter'));

const PHASE_LABELS: Record<CharacterState['phase'], string> = {
  idle: '待機中',
  listening: '聞いています',
  thinking: '考えています',
  speaking: '話しています',
};

function CharacterRenderer({ state }: { state: CharacterState }) {
  return (
    <Suspense fallback={<main className="model-skeleton" aria-label="3Dモデルを読み込み中" />}>
      <StlCharacter state={state} />
    </Suspense>
  );
}

export default function App() {
  const { state, connected, error } = useCharacterState();
  return (
    <div className="character-app">
      <CharacterRenderer state={state} />
      <aside className="character-status" aria-live="polite">
        <span className={`connection-dot ${connected ? 'connected' : ''}`} aria-hidden="true" />
        <strong>{PHASE_LABELS[state.phase]}</strong>
        {error ? <p className="status-error">{error}</p> : null}
      </aside>
    </div>
  );
}
