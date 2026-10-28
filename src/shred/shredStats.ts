import { ABS_MIN_BPM, DEFAULT_RAMP, LOCKED } from './ramp'

const KEY = 'pjt:shred'

export type Pr = { bpm: number; date: string }

export type ShredStats = {
  /** exerciseId -> pitchClass -> best clean BPM. */
  prs: Record<string, Record<string, Pr>>
  /**
   * exerciseId -> deviation accumulated per group index. Sum and count instead
   * of a ready-made average, so a new average does not erase the history.
   */
  perGroup: Record<string, { sum: number[]; count: number[] }>
  sessions: { date: string; exerciseId: string; reps: number; passed: number; bestBpm: number }[]
}

const EMPTY: ShredStats = { prs: {}, perGroup: {}, sessions: [] }

export function loadShredStats(): ShredStats {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<ShredStats>
    return { ...EMPTY, ...raw, prs: raw.prs ?? {}, perGroup: raw.perGroup ?? {}, sessions: raw.sessions ?? [] }
  } catch {
    return { ...EMPTY } // corrupt storage must not take the app down
  }
}

function save(stats: ShredStats): ShredStats {
  localStorage.setItem(KEY, JSON.stringify(stats))
  return stats
}

export function recordRep(
  exerciseId: string,
  pitchClass: number,
  bpm: number,
  passed: boolean,
  perGroupDevMs: (number | null)[],
): ShredStats {
  const stats = loadShredStats()

  if (passed) {
    const byPc = (stats.prs[exerciseId] ??= {})
    const current = byPc[pitchClass]
    if (!current || bpm > current.bpm) {
      byPc[pitchClass] = { bpm, date: new Date().toISOString().slice(0, 10) }
    }
  }

  // The diagnosis only makes sense with the absolute deviation: what matters is
  // WHICH note is off, not whether it dragged or rushed on this particular rep.
  const acc = (stats.perGroup[exerciseId] ??= { sum: [], count: [] })
  perGroupDevMs.forEach((dev, i) => {
    if (dev === null) return
    acc.sum[i] = (acc.sum[i] ?? 0) + Math.abs(dev)
    acc.count[i] = (acc.count[i] ?? 0) + 1
  })

  return save(stats)
}

export function recordSession(
  exerciseId: string,
  reps: number,
  passed: number,
  bestBpm: number,
): ShredStats {
  const stats = loadShredStats()
  if (reps > 0) {
    stats.sessions.push({
      date: new Date().toISOString().slice(0, 10),
      exerciseId,
      reps,
      passed,
      bestBpm,
    })
    // History is for spotting a trend, not for becoming a dead archive.
    if (stats.sessions.length > 200) stats.sessions = stats.sessions.slice(-200)
  }
  return save(stats)
}

export function prFor(stats: ShredStats, exerciseId: string, pitchClass: number): Pr | null {
  return stats.prs[exerciseId]?.[pitchClass] ?? null
}

export function bestPrFor(stats: ShredStats, exerciseId: string): number {
  const byPc = stats.prs[exerciseId] ?? {}
  const all = Object.values(byPc).map((p) => p.bpm)
  return all.length ? Math.max(...all) : 0
}

/** Mean absolute deviation per note index. This is the "which note you fumble". */
export function diagnosisFor(stats: ShredStats, exerciseId: string): (number | null)[] {
  const acc = stats.perGroup[exerciseId]
  if (!acc) return []
  return acc.sum.map((s, i) => {
    const c = acc.count[i] ?? 0
    // Fewer than 3 passes is not data, it is noise.
    return c >= 3 ? s / c : null
  })
}

/** The worst indices, so the UI can say what to look at without dumping the whole vector. */
export function worstGroups(
  diagnosis: (number | null)[],
  count = 3,
): { index: number; devMs: number }[] {
  return diagnosis
    .map((devMs, index) => ({ index, devMs }))
    .filter((d): d is { index: number; devMs: number } => d.devMs !== null)
    .sort((a, b) => b.devMs - a.devMs)
    .slice(0, count)
}

export function clearShredStats() {
  localStorage.removeItem(KEY)
}

// --- keyboard configuration -------------------------------------------------

const SETTINGS_KEY = 'pjt:shred:settings'

export type ShredSettings = {
  low: number
  high: number
  /**
   * Latency of your input chain, in ms, subtracted from the instant of each note.
   * It does not change evenness (a constant offset does not affect the interval) —
   * it changes where the note appears against the grid and in the piano roll.
   */
  latencyMs: number
  /** How permissive the verdict is. A practice preference, so it is saved. */
  strictness: string
  /**
   * Lowest BPM the buttons, the slider and the ladder can reach. A practice
   * preference and not a property of the exercise: the same arpeggio that one
   * player drills at 80 another wants to take apart at 20.
   */
  minBpm: number
  /** Click volume, 0 to 1. Metronome only — the "Listen" piano does not go through here. */
  clickVolume: number
  /**
   * How many clean reps in a row raise the tempo. 1 raises it as soon as you nail
   * one; LOCKED (0) freezes the tempo entirely and keeps grading.
   */
  advanceReps: number
  // What was selected. Stored raw: the component is what validates against the
  // tables, so renaming an exercise here does not break anyone's storage.
  exerciseId: string
  rootPc: number
  handMode: string
  /**
   * Set once the player picks the hands themselves. Until then the exercise opens
   * with one hand: both hands is a choice, not where practice starts — and older
   * builds saved their 'as-is' default, which this lets us tell apart from a pick.
   */
  handModeChosen: boolean
  order: string
  mode: string
  qwerty: boolean
  /** Finger number on the piano roll notes. */
  showFingers: boolean
  /** Piano playing the exercise along with you, the whole time. */
  guide: boolean
  /** Guide volume, 0 to 1. Separate from the click. */
  guideVolume: number
}

// Settings saved by an older build can carry a strictness value that no longer
// exists (the labels used to be in Portuguese). Anything unknown falls back to
// the default instead of reaching toleranceFor() and matching no case.
const STRICTNESS_VALUES = new Set(['learning', 'loose', 'standard', 'strict'])

/** A-49: 49 keys, C2..C6. The default until the player detects their own. */
export const DEFAULT_SETTINGS: ShredSettings = {
  low: 36,
  high: 84,
  latencyMs: 0,
  strictness: 'standard',
  minBpm: DEFAULT_RAMP.minBpm,
  clickVolume: 0.8,
  advanceReps: 2,
  exerciseId: '',
  rootPc: 0,
  handMode: 'rh',
  handModeChosen: false,
  order: 'fourths',
  mode: 'ladder',
  qwerty: false,
  showFingers: true,
  guide: false,
  guideVolume: 0.6,
}

/**
 * Fills in whatever is missing. Runs on both read and write: that way an object
 * saved by an older version of the app — without a field that only came to exist
 * later — never reaches the UI as undefined and turns into NaN in an input.
 */
function normalize(raw: Partial<ShredSettings>): ShredSettings {
  const low = Number.isFinite(raw.low) ? (raw.low as number) : DEFAULT_SETTINGS.low
  const high = Number.isFinite(raw.high) ? (raw.high as number) : DEFAULT_SETTINGS.high
  // An inverted or too-small range renders no keyboard at all.
  if (high - low < 24) return { ...DEFAULT_SETTINGS }
  return {
    low,
    high,
    latencyMs: Number.isFinite(raw.latencyMs) ? (raw.latencyMs as number) : DEFAULT_SETTINGS.latencyMs,
    minBpm: Number.isFinite(raw.minBpm)
      ? Math.max(ABS_MIN_BPM, Math.min(DEFAULT_RAMP.maxBpm - DEFAULT_RAMP.stepBpm, Math.round(raw.minBpm as number)))
      : DEFAULT_SETTINGS.minBpm,
    strictness: STRICTNESS_VALUES.has(raw.strictness as string)
      ? (raw.strictness as string)
      : DEFAULT_SETTINGS.strictness,
    clickVolume: Number.isFinite(raw.clickVolume)
      ? Math.max(0, Math.min(1, raw.clickVolume as number))
      : DEFAULT_SETTINGS.clickVolume,
    advanceReps: Number.isFinite(raw.advanceReps)
      ? Math.max(LOCKED, Math.min(3, Math.round(raw.advanceReps as number)))
      : DEFAULT_SETTINGS.advanceReps,
    exerciseId: typeof raw.exerciseId === 'string' ? raw.exerciseId : '',
    rootPc: Number.isFinite(raw.rootPc)
      ? Math.max(0, Math.min(11, Math.round(raw.rootPc as number)))
      : 0,
    handMode:
      raw.handModeChosen === true && typeof raw.handMode === 'string'
        ? raw.handMode
        : DEFAULT_SETTINGS.handMode,
    handModeChosen: raw.handModeChosen === true,
    order: typeof raw.order === 'string' ? raw.order : DEFAULT_SETTINGS.order,
    mode: typeof raw.mode === 'string' ? raw.mode : DEFAULT_SETTINGS.mode,
    qwerty: raw.qwerty === true,
    showFingers: raw.showFingers !== false, // on by default
    guide: raw.guide === true,
    guideVolume: Number.isFinite(raw.guideVolume)
      ? Math.max(0, Math.min(1, raw.guideVolume as number))
      : DEFAULT_SETTINGS.guideVolume,
  }
}

export function loadSettings(): ShredSettings {
  try {
    return normalize(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<ShredSettings>)
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(s: Partial<ShredSettings>): ShredSettings {
  const complete = normalize(s)
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(complete))
  return complete
}
