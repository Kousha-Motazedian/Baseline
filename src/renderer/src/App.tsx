import { createRng } from '../../core/shared/rng'

/** Placeholder home screen; proves the UI can call into the headless core. */
export function App() {
  const sampleRoll = createRng(42).nextInt(1, 100)

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 32 }}>
      <h1>Baseline</h1>
      <p>Basketball management sim — project scaffold is running.</p>
      <p>Seeded RNG check (seed 42): {sampleRoll}</p>
    </main>
  )
}
