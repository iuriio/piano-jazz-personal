// What a speed drill remembers about each item: was the last answer right, and
// how long did it take. "Known" means the last answer was right and under the
// goal — the two seconds the lesson asks for.

export const GOAL_MS = 2000

/**
 * Past this, the player was not answering — adjusting the bench, reading the
 * screen. A right answer that late is not recorded as slow; it just comes back.
 */
export const IDLE_MS = 10000

export type SpeedEntry = {
  attempts: number
  correct: number
  lastOk: boolean
  lastMs: number
  bestMs: number | null
  /** Focus mode only (see focus.ts): how well it is known. Missing = not introduced yet. */
  level?: number
  /** Focus mode only: when it is due again, in Date.now() time. */
  dueAt?: number
}

/** Item id -> entry. An item id is "row:pitchClass", e.g. "m7:6". */
export type SpeedStats = Record<string, SpeedEntry>

export type Level = 'new' | 'miss' | 'slow' | 'fast'

export const itemId = (row: string, pc: number) => `${row}:${pc}`

export function splitItem(id: string): { row: string; pc: number } {
  const i = id.lastIndexOf(':')
  return { row: id.slice(0, i), pc: Number(id.slice(i + 1)) }
}

export function levelOf(e: SpeedEntry | undefined, goalMs: number = GOAL_MS): Level {
  if (!e || e.attempts === 0) return 'new'
  if (!e.lastOk) return 'miss'
  return e.lastMs <= goalMs ? 'fast' : 'slow'
}

/** Returns new stats with the answer added; never mutates. */
export function recordAnswer(stats: SpeedStats, id: string, ok: boolean, ms: number): SpeedStats {
  const prev = stats[id] ?? { attempts: 0, correct: 0, lastOk: false, lastMs: 0, bestMs: null }
  return {
    ...stats,
    [id]: {
      ...prev,
      attempts: prev.attempts + 1,
      correct: prev.correct + (ok ? 1 : 0),
      lastOk: ok,
      lastMs: ms,
      bestMs: ok ? Math.min(prev.bestMs ?? Infinity, ms) : prev.bestMs,
    },
  }
}

/** The score over the items currently switched on. */
export function summarise(stats: SpeedStats, ids: readonly string[], goalMs: number = GOAL_MS) {
  let fast = 0
  let attempts = 0
  let correct = 0
  let timed = 0
  let totalMs = 0
  for (const id of ids) {
    const e = stats[id]
    if (!e) continue
    attempts += e.attempts
    correct += e.correct
    if (levelOf(e, goalMs) === 'fast') fast++
    if (e.lastOk) {
      timed++
      totalMs += e.lastMs
    }
  }
  return { fast, total: ids.length, attempts, correct, avgMs: timed ? totalMs / timed : 0 }
}

export function loadSpeed(key: string): SpeedStats {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key) ?? '{}')
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as SpeedStats) : {}
  } catch {
    return {} // corrupt or blocked storage must not take the drill down
  }
}

export function saveSpeed(key: string, stats: SpeedStats): void {
  try {
    localStorage.setItem(key, JSON.stringify(stats))
  } catch {
    // Private window: the drill still runs, it just forgets.
  }
}

export function clearSpeed(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // See saveSpeed.
  }
}
