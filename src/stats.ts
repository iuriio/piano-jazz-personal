const KEY = 'pjt:stats'

export type Entry = { attempts: number; correct: number; totalMs: number }
export type Stats = Record<string, Record<string, Entry>> // voicingId -> pitchClass -> entry

// Shell A and Shell B traded names to match the lesson (A is the third below
// the seventh). Scores are kept under the voicing id, so the ones saved before
// the trade move with their shape — once, marked by this key.
const SHELLS_TRADED = 'pjt:stats:shells-traded'

/** Swaps the two shells' scores. Pure, so the one-time move can be tested. */
export function tradeShells(stats: Stats): Stats {
  const { 'shell-a': a, 'shell-b': b, ...rest } = stats
  return { ...rest, ...(b ? { 'shell-a': b } : {}), ...(a ? { 'shell-b': a } : {}) }
}

export function loadStats(): Stats {
  try {
    let stats = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Stats
    if (!localStorage.getItem(SHELLS_TRADED)) {
      stats = tradeShells(stats)
      localStorage.setItem(KEY, JSON.stringify(stats))
      localStorage.setItem(SHELLS_TRADED, '1')
    }
    return stats
  } catch {
    return {} // corrupt storage must not take the app down
  }
}

export function recordAttempt(voicingId: string, pitchClass: number, correct: boolean, ms: number): Stats {
  const stats = loadStats()
  const byPc = (stats[voicingId] ??= {})
  const entry = (byPc[pitchClass] ??= { attempts: 0, correct: 0, totalMs: 0 })
  entry.attempts++
  if (correct) {
    entry.correct++
    entry.totalMs += ms
  }
  localStorage.setItem(KEY, JSON.stringify(stats))
  return stats
}

export function summaryFor(stats: Stats, voicingId: string) {
  const byPc = stats[voicingId] ?? {}
  const entries = Object.values(byPc)
  const attempts = entries.reduce((s, e) => s + e.attempts, 0)
  const correct = entries.reduce((s, e) => s + e.correct, 0)
  const totalMs = entries.reduce((s, e) => s + e.totalMs, 0)
  return {
    attempts,
    correct,
    accuracy: attempts ? correct / attempts : 0,
    avgMs: correct ? totalMs / correct : 0,
  }
}

export function clearStats() {
  localStorage.removeItem(KEY)
}
