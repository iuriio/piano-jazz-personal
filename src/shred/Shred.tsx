import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { keyById } from '../analysis'
import { type KeyMark } from '../keyboard'
import { rootAt, type Order } from '../keys'
import { useMidiEvents, type MidiEvent } from '../midi'
import { midiToName, pitchClassName, type Spelling } from '../theory'
import { Transport, type Beat } from './clock'
import {
  EXERCISES,
  EXERCISE_BY_ID,
  FAMILY_LABEL,
  LEVEL_LABEL,
  STRICTNESS_HELP,
  STRICTNESS_LABEL,
  toleranceFor,
  type Level,
  type Strictness,
} from './exercises'
import { grade, type Grade, type PlayedNote } from './grade'
import { HAND_MODE_LABEL, applyHandMode, expandPattern, type HandMode } from './pattern'
import { PianoRoll, type PlayedMark } from './PianoRoll'
import { TrainingCard } from './TrainingCard'
import {
  ABS_MIN_BPM,
  DEFAULT_RAMP,
  LOCKED,
  MODE_HELP,
  MODE_LABEL,
  bpmAtBeat,
  newRamp,
  nextRamp,
  rampTargets,
  type Mode,
} from './ramp'
import {
  DEFAULT_SETTINGS,
  bestPrFor,
  clearShredStats,
  diagnosisFor,
  loadSettings,
  loadShredStats,
  prFor,
  recordRep,
  recordSession,
  saveSettings,
  worstGroups,
  type ShredStats,
} from './shredStats'
import { QWERTY_HELP, useComputerKeyboard } from './qwerty'
import { FULL_HIGH, FULL_LOW } from '../stage/LiveInput'
import { useSettings } from '../stage/settings'
import { Workspace } from '../stage/Workspace'
import { isTextEntryTarget } from '../computerPiano'
import { Presence } from '../ui/Presence'
import { Select } from '../ui/Select'
import { Slider } from '../ui/Slider'
import { Switch } from '../ui/Switch'
import './transport.css'

/**
 * Grace at each end of the rep, as a fraction of a beat. A quarter of a beat is
 * generous enough for a boundary note and short enough not to spill into the
 * next rep.
 */
const GRACE_BEATS = 0.25
const graceMs = (bpm: number) => (60000 / bpm) * GRACE_BEATS

/**
 * How far before the end of the rep the boundary with the next one sits, in beats.
 *
 * The exercise loops, so the next rep's first note lands exactly on repEnd. A
 * trailing grace therefore swallowed it: counted "extra" here, and — because the
 * window is also what gets discarded — "missing" over there, on every rep after
 * the first. Two guaranteed errors a rep, which is more than the whole budget of a
 * short exercise: the broken triad has 12 notes and a budget of 1, so playing it
 * perfectly failed every time.
 *
 * The cut belongs halfway between the last onset of this rep and the first of the
 * next, never further out than GRACE_BEATS. Both reps use the same cut, so every
 * note is graded exactly once.
 */
export function boundaryBeats(repBeats: number, lastBeat: number): number {
  return Math.min(GRACE_BEATS, Math.max(0, (repBeats - lastBeat) / 2))
}
/** How many reps accel mode takes to go from the start tempo to the target. */
const ACCEL_REPS = 8

type Phase = 'idle' | 'countin' | 'playing' | 'resting' | 'demo'

const ORDERS = ['fourths', 'chromatic', 'random'] as const
const MODES = ['ladder', 'burst', 'accel', 'free'] as const
const HAND_MODES = ['rh', 'lh', 'both', 'as-is'] as const

/** A saved value that no longer exists (old version, edited storage) falls back to the default. */
function pick<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback
}

/** Short list of pitches, without dumping 60 names into the bar. */
function noteNames(midi: number[], spelling: Spelling): string {
  const unique = [...new Set(midi)]
  const shown = unique.slice(0, 6).map((n) => midiToName(n, spelling)).join(' ')
  return unique.length > 6 ? `${shown} +${unique.length - 6}` : shown
}

export function Shred() {
  const { settings } = useSettings()
  // Shred's note names take a flat/sharp preference; the page key decides it.
  const spelling: Spelling = keyById(settings.keyId).accidentals > 0 ? 'sharp' : 'flat'

  // Everything you pick is saved: reloading the page must not cost you rebuilding
  // the whole setup. Storage keeps it raw and validation happens here, so a
  // renamed exercise falls back to the default instead of breaking.
  const [range, setRange] = useState(loadSettings)
  const persist = useCallback((patch: Partial<typeof DEFAULT_SETTINGS>) => {
    setRange((prev) => saveSettings({ ...prev, ...patch }))
  }, [])

  const exerciseId = EXERCISE_BY_ID.has(range.exerciseId) ? range.exerciseId : EXERCISES[0].id
  const rootPc = range.rootPc
  const order = pick(range.order, ORDERS, 'fourths')
  const mode = pick(range.mode, MODES, 'ladder')
  const handMode = pick(range.handMode, HAND_MODES, 'rh')
  const qwerty = range.qwerty
  const [detecting, setDetecting] = useState<{ low: number; high: number } | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [lastGrade, setLastGrade] = useState<Grade | null>(null)
  const [repLog, setRepLog] = useState<{ n: number; bpm: number; passed: boolean }[]>([])
  const [stats, setStats] = useState<ShredStats>(loadShredStats)
  const [audioError, setAudioError] = useState<string | null>(null)
  /** Big notice over the piano roll when the tempo changes. */
  const [announce, setAnnounce] = useState<{ kind: 'up' | 'down'; text: string } | null>(null)

  const exercise = EXERCISE_BY_ID.get(exerciseId) ?? EXERCISES[0]
  const [ramp, setRamp] = useState(() => newRamp(exercise.tempos.start))

  const spec = useMemo(() => applyHandMode(exercise.pattern, handMode), [exercise, handMode])
  const expansion = useMemo(() => expandPattern(spec, rootPc, range), [spec, rootPc, range])

  const repBars = Math.max(1, Math.ceil(expansion.beats / exercise.beatsPerBar))
  const repBeats = repBars * exercise.beatsPerBar
  const cycleBeats = mode === 'burst' ? repBeats * 2 : repBeats

  // --- run-time refs ---------------------------------------------------------
  // Grading runs inside timers and must not read stale state: everything it needs
  // goes through here.
  const transportRef = useRef<Transport | null>(null)
  const playedRef = useRef<PlayedNote[]>([])
  const rollRef = useRef<PlayedMark[]>([])
  /** Real instant of each beat, from the transport itself. Holds for all 4 modes. */
  const beatsRef = useRef<{ index: number; perf: number }[]>([])
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const sessionRef = useRef({ reps: 0, passed: 0, bestBpm: 0 })
  /** Demo: the transport runs, the piano plays, nothing is graded. */
  const demoRef = useRef(false)
  const orderIndexRef = useRef(0)
  const rangeRef = useRef(range)
  rangeRef.current = range
  const bpmRef = useRef(ramp.bpm)
  bpmRef.current = ramp.bpm

  const strictness = (range.strictness ?? 'standard') as Strictness
  const tolerance = toleranceFor(exercise.level, strictness)
  /**
   * Tempo locked: the reps are still graded, the verdict and the records still
   * come, only the automatic move stops. Drilling one tempo until it is yours is
   * a normal way to practise, and the ladder deciding for you gets in the way.
   * Both directions freeze — a floor that drops on two bad reps is not "one tempo".
   */
  const tempoLocked = range.advanceReps === LOCKED
  const rampConfig = useMemo(
    () => ({
      ...DEFAULT_RAMP,
      // The ladder is never consulted while locked; keep the config sane anyway so
      // the dots and the targets have something to render.
      repsToAdvance: Math.max(1, range.advanceReps),
      minBpm: range.minBpm,
    }),
    [range.advanceReps, range.minBpm],
  )
  const rampConfigRef = useRef(rampConfig)
  rampConfigRef.current = rampConfig
  const rampRef = useRef(ramp)
  rampRef.current = ramp

  // 0.28 is the ceiling: above that the guide drowns out the real keyboard.
  const guideGain = range.guideVolume * 0.28

  /** Last onset of the rep. The boundary with the next rep hangs off it. */
  const lastBeat = useMemo(
    () => expansion.notes.reduce((m, n) => Math.max(m, n.beat), 0),
    [expansion],
  )

  const cfgRef = useRef({
    exercise, expansion, repBeats, cycleBeats, mode, rootPc, strictness, lastBeat,
    tempoLocked, guide: range.guide, guideGain,
  })
  cfgRef.current = {
    exercise, expansion, repBeats, cycleBeats, mode, rootPc, strictness, lastBeat,
    tempoLocked, guide: range.guide, guideGain,
  }

  const expectedBeats = useMemo(
    () => [...new Set(expansion.notes.map((n) => n.beat))].sort((a, b) => a - b),
    [expansion],
  )
  const expectedBeatsRef = useRef(expectedBeats)
  expectedBeatsRef.current = expectedBeats

  const later = (fn: () => void, delayMs: number) => {
    // The timer removes itself from the list when it fires: a long session has
    // thousands, and the list only exists to cancel what has not happened yet.
    const id: ReturnType<typeof setTimeout> = setTimeout(() => {
      timersRef.current = timersRef.current.filter((t) => t !== id)
      fn()
    }, Math.max(0, delayMs))
    timersRef.current.push(id)
  }

  /** Instant of beat `beat`, interpolating between the beats already scheduled. */
  const perfAtBeat = useCallback((beat: number): number => {
    const list = beatsRef.current
    const i = Math.floor(beat)
    const a = list.find((b) => b.index === i)
    if (!a) return Number.NaN
    if (beat === i) return a.perf
    const b2 = list.find((b) => b.index === i + 1)
    return b2 ? a.perf + (beat - i) * (b2.perf - a.perf) : a.perf
  }, [])

  /** The inverse: which beat an instant falls on. Used to draw what was played. */
  const beatAtPerf = useCallback((ms: number): number => {
    const list = beatsRef.current
    if (list.length < 2) return Number.NaN
    for (let i = list.length - 2; i >= 0; i--) {
      if (list[i].perf <= ms) {
        const span = list[i + 1].perf - list[i].perf
        return span > 0 ? list[i].index + (ms - list[i].perf) / span : list[i].index
      }
    }
    return list[0].index
  }, [])

  // --- grading one rep -------------------------------------------------------
  const evaluateRep = useCallback(
    (r: number) => {
      const c = cfgRef.current
      const startBeat = r * c.cycleBeats
      const repStart = perfAtBeat(startBeat)
      if (!Number.isFinite(repStart)) return

      const repEnd = perfAtBeat(startBeat + c.repBeats)

      // Expected time comes from the instants the transport actually scheduled,
      // instead of recomputing the grid — that way accel is no special case and the
      // two calculations cannot diverge.
      const localMsAt = (beat: number) => {
        const t = perfAtBeat(startBeat + beat)
        return Number.isFinite(t) ? t - repStart : beat * (60000 / (transportRef.current?.currentBpm ?? 120))
      }
      const oneBeat = localMsAt(1)
      const bpm = oneBeat > 0 ? 60000 / oneBeat : (transportRef.current?.currentBpm ?? 120)

      // Grace proportional to the tempo. A fixed value in ms was the flaw: at
      // 80 BPM a beat is 750ms, and 120ms of grace threw away a note that landed right.
      // The window is [repStart - cut, repEnd - cut): the same boundary the next rep
      // starts from, so a note belongs to exactly one of them.
      const cut = (60000 / bpm) * boundaryBeats(c.repBeats, c.lastBeat)
      const end = Number.isFinite(repEnd) ? repEnd - cut : Number.POSITIVE_INFINITY
      const notes = playedRef.current
        .filter((n) => n.onTime >= repStart - cut && n.onTime < end)
        .sort((a, b) => a.onTime - b.onTime)

      const tol = toleranceFor(c.exercise.level, c.strictness)
      const g = grade(c.expansion.notes, notes, {
        bpm,
        originMs: repStart,
        maxErrorRate: tol.maxErrorRate,
        maxIoiCv: tol.maxIoiCv,
        maxBpmDeviation: tol.maxBpmDeviation,
        timingGates: tol.timingGates,
        expectedMsAt: localMsAt,
      })

      setLastGrade(g)

      // A rep with nothing played does not count as a failure: it does not enter the
      // session, does not become a statistic and, above all, does not lower the tempo.
      // Fiddling with the keyboard for half a minute used to drop the BPM to the floor silently.
      if (!g.attempted) return

      setRepLog((prev) => [...prev.slice(-11), { n: (prev.at(-1)?.n ?? 0) + 1, bpm: Math.round(bpm), passed: g.passed }])
      sessionRef.current.reps += 1
      if (g.passed) {
        sessionRef.current.passed += 1
        sessionRef.current.bestBpm = Math.max(sessionRef.current.bestBpm, Math.round(bpm))
      }
      setStats(recordRep(c.exercise.id, c.rootPc, Math.round(bpm), g.passed, g.perGroupDevMs))

      // In accel the tempo is dictated by the curve, not by the result.
      if ((c.mode === 'ladder' || c.mode === 'burst') && !c.tempoLocked) {
        const next = nextRamp(rampRef.current, g.passed, rampConfigRef.current)
        rampRef.current = next.state
        setRamp(next.state)

        if (next.event === 'hold') {
          transportRef.current?.setBpm(next.state.bpm)
        } else {
          // The tempo changed: announce it and give a count-in bar at the new tempo,
          // instead of swapping the speed under your hand with no warning.
          setAnnounce({
            kind: next.event,
            text: `${next.event === 'up' ? '↑' : '↓'} ${next.state.bpm} BPM`,
          })
          void restartAtTempoRef.current(next.state.bpm)
        }
      }

      // Everything inside the window has been resolved — matched or counted extra.
      // Keeping part of it for the next rep was what made the same note count twice:
      // right here, extra there.
      playedRef.current = playedRef.current.filter((n) => n.onTime >= end)
    },
    [perfAtBeat],
  )

  /**
   * Schedules the exercise notes that land on the next beat.
   *
   * The same path serves the demo and the continuous guide: the only difference is
   * that the demo plays one rep and stops, while the guide runs along with you.
   * Scheduling only one beat at a time avoids creating 300 oscillators forty
   * seconds before they are needed.
   */
  const schedulePiano = useCallback((b: Beat, gain: number) => {
    const t = transportRef.current
    if (!t || b.index < 0 || gain <= 0) return
    const c = cfgRef.current
    const perBeat = 60 / (t.currentBpm || 120)
    const dur = Math.max(0.08, Math.min(0.6, perBeat / c.exercise.pattern.subdivision) * 0.9)
    // Where we are INSIDE the rep: the shape repeats every cycle.
    const local = ((b.index % c.cycleBeats) + c.cycleBeats) % c.cycleBeats
    for (const n of c.expansion.notes) {
      if (n.beat >= local && n.beat < local + 1) {
        t.note(n.midi, b.audioTime + (n.beat - local) * perBeat, dur, gain)
      }
    }
  }, [])

  // --- transport -------------------------------------------------------------
  const handleBeat = useCallback(
    (b: Beat) => {
      beatsRef.current.push({ index: b.index, perf: b.perfTime })
      if (beatsRef.current.length > 256) beatsRef.current.splice(0, 64)

      const c = cfgRef.current

      if (demoRef.current) {
        schedulePiano(b, c.guideGain)
        if (b.index >= c.repBeats) {
          later(() => {
            stopRef.current()
          }, b.perfTime - performance.now())
        }
        return
      }

      if (c.mode === 'accel' && b.index >= 0) {
        const total = c.cycleBeats * ACCEL_REPS
        transportRef.current?.setBpm(
          bpmAtBeat(c.exercise.tempos.start, c.exercise.tempos.target, total, b.index + 1),
        )
      }

      // Continuous guide: the piano plays the exercise along, rep after rep.
      if (c.guide) schedulePiano(b, c.guideGain)

      const delay = b.perfTime - performance.now()

      if (b.index === 0) {
        later(() => {
          setPhase('playing')
          setAnnounce(null)
        }, delay)
      }

      // End of a played window: grade after a grace period so the last note arrives.
      if (b.index >= c.repBeats && (b.index - c.repBeats) % c.cycleBeats === 0) {
        const r = (b.index - c.repBeats) / c.cycleBeats
        // Grade after the grace period, otherwise the last note has not arrived yet.
        const wait = graceMs(transportRef.current?.currentBpm ?? 120) + 30
        later(() => {
          evaluateRep(r)
          if (c.mode === 'burst') setPhase('resting')
        }, delay + wait)
      }

      // Start of a played window (burst: coming out of the rest).
      if (b.index > 0 && b.index % c.cycleBeats === 0) {
        later(() => setPhase('playing'), delay)
      }
    },
    [evaluateRep, schedulePiano],
  )

  const restartAtTempoRef = useRef<(bpm: number) => Promise<void>>(async () => {})

  /**
   * Restarts the transport at a new tempo, with one count-in bar.
   * Unlike start(): it keeps the session, the history and the records — only the
   * timeline restarts, because the beat grid changed.
   */
  const restartAtTempo = useCallback(async (bpm: number) => {
    const t = transportRef.current
    if (!t) return
    t.stop()
    for (const id of timersRef.current) clearTimeout(id)
    timersRef.current = []
    playedRef.current = []
    rollRef.current = []
    beatsRef.current = []
    setPhase('countin')
    try {
      await t.start({
        bpm,
        beatsPerBar: cfgRef.current.exercise.beatsPerBar,
        countInBars: 1,
      })
    } catch (e) {
      setPhase('idle')
      setAudioError(`Could not start audio: ${(e as Error).message}`)
    }
  }, [])
  restartAtTempoRef.current = restartAtTempo

  const stopRef = useRef<() => void>(() => {})

  const stop = useCallback(() => {
    demoRef.current = false
    setAnnounce(null)
    transportRef.current?.stop()
    for (const t of timersRef.current) clearTimeout(t)
    timersRef.current = []
    setPhase('idle')
    const s = sessionRef.current
    if (s.reps > 0) {
      setStats(recordSession(cfgRef.current.exercise.id, s.reps, s.passed, s.bestBpm))
    }
    sessionRef.current = { reps: 0, passed: 0, bestBpm: 0 }
  }, [])

  stopRef.current = stop

  /** Listen to the exercise before trying it. The same tempo you picked. */
  const listen = useCallback(async () => {
    setAudioError(null)
    const t = (transportRef.current ??= new Transport())
    t.onBeat = handleBeat
    t.setVolume(rangeRef.current.clickVolume)
    demoRef.current = true
    beatsRef.current = []
    setLastGrade(null)
    setPhase('demo')
    try {
      await t.start({ bpm: ramp.bpm, beatsPerBar: exercise.beatsPerBar, countInBars: 1 })
    } catch (e) {
      demoRef.current = false
      setPhase('idle')
      setAudioError(`Could not start audio: ${(e as Error).message}`)
    }
  }, [handleBeat, exercise, ramp.bpm])

  const start = useCallback(async () => {
    setAudioError(null)
    const t = (transportRef.current ??= new Transport())
    t.onBeat = handleBeat
    t.setVolume(rangeRef.current.clickVolume)

    playedRef.current = []
    rollRef.current = []
    beatsRef.current = []
    sessionRef.current = { reps: 0, passed: 0, bestBpm: 0 }
    setLastGrade(null)
    setRepLog([])
    demoRef.current = false
    setAnnounce(null)
    setPhase('countin')

    const bpm = mode === 'accel' ? exercise.tempos.start : ramp.bpm
    try {
      await t.start({ bpm, beatsPerBar: exercise.beatsPerBar, countInBars: 1 })
    } catch (e) {
      setPhase('idle')
      setAudioError(`Could not start audio: ${(e as Error).message}`)
    }
  }, [handleBeat, mode, exercise, ramp.bpm])

  // Leaving the tab or switching exercise mid-run must not leave the click running.
  useEffect(() => () => stop(), [stop])
  useEffect(() => {
    if (phase !== 'idle') stop()
    setRamp(newRamp(exercise.tempos.start))
    setLastGrade(null)
    setRepLog([])
    // Switching exercise resets the ramp: the BPM of one does not apply to another.
  }, [exerciseId])

  // --- space bar -------------------------------------------------------------
  // Space starts the exercise and stops it, so the hands never leave the keys for
  // the mouse. Listened in the capture phase on window, before anything else: a
  // focused button (the Start you just clicked, a switch, a mode tab) would
  // otherwise take the same Space as a click — a second toggle. Fields you type
  // into and an open dropdown keep their Space.
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const startRef = useRef(start)
  startRef.current = start
  useEffect(() => {
    const isOurs = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.metaKey || e.ctrlKey || e.altKey) return false
      if (isTextEntryTarget(e.target)) return false
      const el = e.target instanceof Element ? e.target : null
      return !el?.closest('[role="listbox"], [role="option"], [role="menu"], [role="dialog"]')
    }
    const down = (e: KeyboardEvent) => {
      if (!isOurs(e)) return
      e.preventDefault()
      e.stopPropagation()
      if (e.repeat) return
      if (phaseRef.current === 'idle') void startRef.current()
      else stopRef.current()
    }
    // A button clicks on Space's keyup, so that one is swallowed as well.
    const up = (e: KeyboardEvent) => {
      if (!isOurs(e)) return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', up, true)
    return () => {
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keyup', up, true)
    }
  }, [])

  // --- note input ------------------------------------------------------------
  const onNote = useCallback(
    (e: MidiEvent) => {
      if (e.kind === 'off') {
        // Closes the last open note at this pitch, to measure legato/detached.
        for (let i = playedRef.current.length - 1; i >= 0; i--) {
          const p = playedRef.current[i]
          if (p.midi === e.note && p.offTime === undefined) {
            p.offTime = e.time
            break
          }
        }
        return
      }

      setDetecting((d) =>
        d ? { low: Math.min(d.low, e.note), high: Math.max(d.high, e.note) } : d,
      )

      // Subtract the input chain latency before any arithmetic.
      const onTime = e.time - rangeRef.current.latencyMs
      playedRef.current.push({ midi: e.note, velocity: e.velocity, onTime })
      if (playedRef.current.length > 2000) playedRef.current.splice(0, 1000)

      // Mark for the piano roll: position in time and how far off the grid it was.
      const beat = beatAtPerf(onTime)
      if (Number.isFinite(beat)) {
        const c = cfgRef.current
        const local = ((beat % c.cycleBeats) + c.cycleBeats) % c.cycleBeats
        const near = expectedBeatsRef.current.reduce(
          (best, b) => (Math.abs(b - local) < Math.abs(best - local) ? b : best),
          expectedBeatsRef.current[0] ?? 0,
        )
        const beatMs = 60000 / (transportRef.current?.currentBpm ?? 120)
        rollRef.current.push({ midi: e.note, beat, devMs: (local - near) * beatMs })
        if (rollRef.current.length > 400) rollRef.current.splice(0, 200)
      }
    },
    [beatAtPerf],
  )

  useMidiEvents(onNote)
  useComputerKeyboard(qwerty, Math.max(range.low, 48))

  /**
   * Tempo set by hand. Resets the streaks: if you have just changed the tempo, the
   * previous clean reps do not count as progress toward promoting from this point.
   */
  const setTempo = useCallback((bpm: number) => {
    // An empty field or a "-" mid-typing becomes NaN, and NaN goes through
    // Math.min/max without complaint all the way to the input value.
    if (!Number.isFinite(bpm)) return
    const floor = rangeRef.current.minBpm
    const target = Math.max(floor, Math.min(DEFAULT_RAMP.maxBpm, Math.round(bpm)))
    // Updates the ref immediately: two clicks in the same frame would read the same
    // ramp.bpm from the render and the second would not move.
    bpmRef.current = target
    setRamp((prev) => ({ ...prev, bpm: target, cleanStreak: 0, failStreak: 0 }))
    transportRef.current?.setBpm(target)
  }, [])

  /**
   * Moves the tempo floor. Raising it above the current tempo would leave the BPM
   * outside the range the controls can express, so the tempo comes up with it.
   */
  const setFloor = useCallback(
    (bpm: number) => {
      if (!Number.isFinite(bpm)) return
      const floor = Math.max(
        ABS_MIN_BPM,
        Math.min(DEFAULT_RAMP.maxBpm - DEFAULT_RAMP.stepBpm, Math.round(bpm)),
      )
      persist({ minBpm: floor })
      if (bpmRef.current < floor) setTempo(floor)
    },
    [persist, setTempo],
  )

  // --- derived for the view --------------------------------------------------
  const getPosition = useCallback(() => transportRef.current?.position() ?? Number.NaN, [])
  const getPlayed = useCallback(() => rollRef.current, [])

  const marks = useMemo(() => {
    const m = new Map<number, KeyMark>()
    for (const n of expansion.notes) m.set(n.midi, 'missing')
    return m
  }, [expansion])

  const pr = prFor(stats, exercise.id, rootPc)
  const best = bestPrFor(stats, exercise.id)
  const diagnosis = diagnosisFor(stats, exercise.id)
  const worst = worstGroups(diagnosis)
  const bpmNow = phase === 'idle' ? ramp.bpm : Math.round(transportRef.current?.currentBpm ?? ramp.bpm)
  const targets = rampTargets(ramp, rampConfig)
  // The last clean rep needed: this is the rep worth warning about before, not after.
  const aboutToClimb =
    !tempoLocked &&
    (mode === 'ladder' || mode === 'burst') &&
    (phase === 'playing' || phase === 'countin') &&
    ramp.cleanStreak === rampConfig.repsToAdvance - 1

  const progress: { text: string; dots: { on: number; total: number; kind: 'up' | 'down' } | null } =
    mode === 'accel'
      ? { text: 'the curve sets the tempo', dots: null }
      : mode === 'free'
        ? { text: 'free tempo — nothing moves it', dots: null }
        : tempoLocked
          ? { text: `locked at ${ramp.bpm} — still graded`, dots: null }
          : ramp.failStreak > 0
            ? {
                text: `${DEFAULT_RAMP.repsToRetreat - ramp.failStreak} more miss → ${targets.down}`,
                dots: { on: ramp.failStreak, total: DEFAULT_RAMP.repsToRetreat, kind: 'down' },
              }
            : {
                text: `${rampConfig.repsToAdvance - ramp.cleanStreak} more clean → ${targets.up}`,
                dots: { on: ramp.cleanStreak, total: rampConfig.repsToAdvance, kind: 'up' },
              }

  const noteDiff =
    lastGrade && (lastGrade.missedNotes.length > 0 || lastGrade.extraNotes.length > 0)
      ? [
          lastGrade.missedNotes.length > 0 ? `missing ${noteNames(lastGrade.missedNotes, spelling)}` : '',
          lastGrade.extraNotes.length > 0 ? `extra ${noteNames(lastGrade.extraNotes, spelling)}` : '',
        ]
          .filter(Boolean)
          .join(' · ')
      : null

  return (
    <Workspace
      sidebar={
        <div className="shred-side">
      <div className="rig">
        <section className="rig-group">
          <h3>Exercise</h3>
          <div className="rig-fields stack">
            <label className="wide">
              <span>Pattern</span>
              <Select
                value={exerciseId}
                onValueChange={(v) => persist({ exerciseId: v })}
                options={([1, 2, 3, 4, 5] as Level[]).map((lvl) => ({
                  group: LEVEL_LABEL[lvl],
                  options: EXERCISES.filter((e) => e.level === lvl).map((e) => ({ value: e.id, label: e.label })),
                }))}
              />
            </label>

            <label>
              <span>Key</span>
              <Select
                value={String(rootPc)}
                onValueChange={(v) => persist({ rootPc: Number(v) })}
                options={Array.from({ length: 12 }, (_, pc) => ({
                  value: String(pc),
                  label: pitchClassName(pc, spelling),
                }))}
              />
            </label>

            <label>
              <span>Hands</span>
              <Select
                value={handMode}
                onValueChange={(v) => persist({ handMode: v, handModeChosen: true })}
                options={(Object.keys(HAND_MODE_LABEL) as HandMode[]).map((h) => ({
                  value: h,
                  label: HAND_MODE_LABEL[h],
                }))}
              />
            </label>

            <label>
              <span>Order</span>
              <Select
                value={order}
                onValueChange={(v) => persist({ order: v })}
                options={[
                  { value: 'fourths', label: 'Fourths' },
                  { value: 'chromatic', label: 'Chromatic' },
                  { value: 'random', label: 'Random' },
                ]}
              />
            </label>

            <button
              className="field-action"
              onClick={() => {
                orderIndexRef.current += 1
                persist({ rootPc: rootAt(order, orderIndexRef.current) })
              }}
            >
              Next key
            </button>
          </div>
        </section>

        <section className="rig-group">
          <h3>Protocol</h3>
          <div className="rig-fields stack">
            <label>
              <span>Mode</span>
              <Select
                value={mode}
                onValueChange={(v) => persist({ mode: v })}
                options={(Object.keys(MODE_LABEL) as Mode[]).map((m) => ({ value: m, label: MODE_LABEL[m] }))}
              />
            </label>

            <label>
              <span>Strictness</span>
              <Select
                value={strictness}
                onValueChange={(v) => persist({ strictness: v })}
                options={(Object.keys(STRICTNESS_LABEL) as Strictness[]).map((k) => ({
                  value: k,
                  label: STRICTNESS_LABEL[k],
                }))}
              />
            </label>

            <label title="How many clean reps in a row raise the tempo. One bad rep resets the count. Set it to never to drill one tempo for as long as you like — the reps are still graded.">
              <span>Raise after</span>
              <Select
                value={String(range.advanceReps)}
                onValueChange={(v) => persist({ advanceReps: Number(v) })}
                options={[
                  { value: '1', label: '1 clean' },
                  { value: '2', label: '2 clean' },
                  { value: '3', label: '3 clean' },
                  { value: String(LOCKED), label: 'never' },
                ]}
              />
            </label>
          </div>
        </section>
      </div>

      <div className="rig">
        {mode !== 'accel' && (
          <section className="rig-group">
            <h3>Tempo</h3>
            <div className="rig-fields tempo-row">
              <span className="tempo-picker">
                <button
                  onClick={() => setTempo(bpmRef.current - DEFAULT_RAMP.stepBpm)}
                  aria-label="lower tempo"
                >
                  −
                </button>
                <input
                  className={`bpm ${phase}`}
                  type="number"
                  min={range.minBpm}
                  max={DEFAULT_RAMP.maxBpm}
                  step={1}
                  value={ramp.bpm}
                  onChange={(e) => setTempo(Number(e.target.value))}
                />
                <span className="dim">BPM</span>
                <button
                  onClick={() => setTempo(bpmRef.current + DEFAULT_RAMP.stepBpm)}
                  aria-label="raise tempo"
                >
                  +
                </button>
              </span>
              <label className="tempo-slider">
                <Slider
                  min={range.minBpm}
                  max={Math.max(DEFAULT_RAMP.maxBpm, exercise.tempos.target)}
                  step={1}
                  value={ramp.bpm}
                  onValueChange={setTempo}
                  aria-label="tempo"
                />
                <span className="dim">
                  {exercise.tempos.start} start · {exercise.tempos.target} target
                </span>
              </label>
              <label
                className="tempo-floor"
                title="Lowest BPM the slider, the − button and the ladder can reach. Taking an arpeggio apart slowly wants a floor well under the default 40."
              >
                floor
                <input
                  type="number"
                  min={ABS_MIN_BPM}
                  max={DEFAULT_RAMP.maxBpm - DEFAULT_RAMP.stepBpm}
                  step={5}
                  value={range.minBpm}
                  onChange={(e) => setFloor(Number(e.target.value))}
                />
                BPM
              </label>
            </div>
          </section>
        )}

        <section className="rig-group">
          <h3>Audio</h3>
          <div className="rig-fields audio-row">
            <label className="click-volume" title="Click volume. Does not affect the piano.">
              click {Math.round(range.clickVolume * 100)}%
              <Slider
                min={0}
                max={100}
                step={5}
                value={Math.round(range.clickVolume * 100)}
                onValueChange={(n) => {
                  const v = n / 100
                  persist({ clickVolume: v })
                  transportRef.current?.setVolume(v)
                }}
                aria-label="click volume"
              />
            </label>

            {/* The slider sits outside the label: a click on its track would
                otherwise count as a click on the label and flip the switch. */}
            <div
              className="click-volume"
              title="The piano plays the exercise along with you, rep after rep — not only in Listen."
            >
              <label className="switch-label">
                <Switch checked={range.guide} onCheckedChange={(on) => persist({ guide: on })} />
                guide {Math.round(range.guideVolume * 100)}%
              </label>
              <Slider
                min={0}
                max={100}
                step={5}
                value={Math.round(range.guideVolume * 100)}
                disabled={!range.guide}
                onValueChange={(n) => persist({ guideVolume: n / 100 })}
                aria-label="guide volume"
              />
            </div>
          </div>
        </section>
      </div>

      <p className="mode-help">
        {MODE_HELP[mode]}
        {' '}
        {STRICTNESS_HELP[strictness]}
      </p>
      <p className="limits">
        This rep passes with up to{' '}
        <strong>
          {Math.max(1, Math.round(tolerance.maxErrorRate * expansion.notes.length))} error
          {Math.max(1, Math.round(tolerance.maxErrorRate * expansion.notes.length)) > 1 ? 's' : ''}
        </strong>{' '}
        in {expansion.notes.length} notes
        {tolerance.timingGates ? (
          <>
            {' '}· unevenness up to <strong>{(tolerance.maxIoiCv * 100).toFixed(0)}%</strong> ·
            tempo ±<strong>{(tolerance.maxBpmDeviation * 100).toFixed(0)}%</strong>
          </>
        ) : (
          <> · timing measured only, does not fail you</>
        )}
      </p>
      <details className="shred-settings">
        <summary>Keyboard and input</summary>
        <div className="controls">
          <span>
            Range: {midiToName(range.low, spelling)} to {midiToName(range.high, spelling)}
          </span>
          {detecting ? (
            <>
              <span className="dim">
                play the lowest and the highest note ({detecting.low <= detecting.high
                  ? `${midiToName(detecting.low, spelling)}–${midiToName(detecting.high, spelling)}`
                  : 'waiting'})
              </span>
              <button
                onClick={() => {
                  if (detecting.high - detecting.low >= 24) {
                    persist({ low: detecting.low, high: detecting.high })
                  }
                  setDetecting(null)
                }}
              >
                Use
              </button>
              <button onClick={() => setDetecting(null)}>Cancel</button>
            </>
          ) : (
            <button onClick={() => setDetecting({ low: 127, high: 0 })}>Detect</button>
          )}
          <label title="Subtracted from the instant of each note. Raise it until the grid deviation drops.">
            latency {range.latencyMs}ms
            <Slider
              min={-50}
              max={200}
              step={5}
              value={range.latencyMs}
              onValueChange={(n) => persist({ latencyMs: n })}
              aria-label="input latency"
            />
          </label>
          <label className="switch-label" title="Finger number on each note of the piano roll.">
            <Switch checked={range.showFingers} onCheckedChange={(on) => persist({ showFingers: on })} />
            fingering
          </label>
          <label className="switch-label">
            <Switch checked={qwerty} onCheckedChange={(on) => persist({ qwerty: on })} />
            computer keyboard
          </label>
        </div>
        {qwerty && <p className="dim">{QWERTY_HELP}</p>}
      </details>

      <div className="stats">
        {sessionRef.current.reps > 0 && (
          <>
            session: {sessionRef.current.passed}/{sessionRef.current.reps} clean ·{' '}
          </>
        )}
        {best > 0 ? `record ${best} BPM` : 'no record yet'}
        <button
          onClick={() => {
            clearShredStats()
            setStats(loadShredStats())
          }}
        >
          reset
        </button>
      </div>
        </div>
      }
      banner={
        <div className="shred-banner">
      <div className="exercise-head">
        <div>
          <span className="badge">{FAMILY_LABEL[exercise.family]}</span>
          <span className="badge">{LEVEL_LABEL[exercise.level]}</span>
          <strong>{exercise.label}</strong> in {pitchClassName(rootPc, spelling)}
          <span className="focus"> · {exercise.focus}</span>
          {handMode !== 'as-is' && (
            <span className="badge override">{HAND_MODE_LABEL[handMode]}</span>
          )}
        </div>
        <div className="tempo">
          {/* In accel the curve controls the tempo, so there is nothing to set —
              the reading lives here. Otherwise the picker sits in the Tempo group. */}
          {mode === 'accel' && <span className={`bpm ${phase}`}>{bpmNow} BPM</span>}
          <span className="dim">
            target {exercise.tempos.target} · {repBars} bar{repBars > 1 ? 's' : ''} per rep
          </span>
          {best > 0 && <span className="pr"> record {best}</span>}
          {pr && <span className="dim"> ({pitchClassName(rootPc, spelling)}: {pr.bpm})</span>}
        </div>
      </div>

      {expansion.warning && <p className="warn">{expansion.warning}</p>}
      {audioError && <p className="error">{audioError}</p>}

        </div>
      }
      roll={
      <div className="roll-stack">
        <Presence ms={300}>
          {announce && <div className={`roll-announce ${announce.kind}`}>{announce.text}</div>}
        </Presence>
        <Presence ms={300}>
          {!announce && aboutToClimb && <div className="roll-warn">a clean rep here climbs to {targets.up} BPM</div>}
        </Presence>
        <PianoRoll
          expected={expansion.notes}
          low={FULL_LOW}
          high={FULL_HIGH}
          getPosition={getPosition}
          getPlayed={getPlayed}
          beatsPerBar={exercise.beatsPerBar}
          cycleBeats={cycleBeats}
          showFingers={range.showFingers}
          phase={phase}
          fumbleGroups={worst.map((w) => w.index)}
        />
      </div>

      }
      quiet
      marks={marks}
      card={
        <TrainingCard
          phase={phase}
          bpm={bpmNow}
          grade={lastGrade}
          repLog={repLog}
          progress={progress}
          noteDiff={noteDiff}
          transport={
            <div className="shred-transport" role="group" aria-label="transport">
              {phase === 'idle' && <button onClick={listen}>Listen</button>}
              {/* One element for Start and Stop, so a click keeps focus on it. */}
              <button className="primary" onClick={phase === 'idle' ? start : stop} aria-keyshortcuts="Space">
                {phase === 'idle' ? 'Start' : 'Stop'}
                <kbd className="kbd-hint" aria-hidden="true">
                  space
                </kbd>
              </button>
            </div>
          }
        />
      }
      aside={
        <section className="panel coach">
          <header className="panel-head">
            <h3>coach</h3>
            <span className="panel-meta">
              {best > 0 ? `record ${best} bpm` : 'no record yet'}
            </span>
          </header>
          <p className="coach-note">{exercise.note}</p>
          {worst.length > 0 && (
            <div className="coach-fumble">
              <h4>where you fumble</h4>
              <ul>
                {worst.map((w) => {
                  const target = expansion.notes.find((n) => n.group === w.index)
                  return (
                    <li key={w.index}>
                      <span className="fumble-note">
                        {target ? midiToName(target.midi, spelling) : `note ${w.index + 1}`}
                      </span>
                      {target?.finger && <span className="dim"> finger {target.finger}</span>}
                      <span className="fumble-dev">±{w.devMs.toFixed(0)}ms</span>
                    </li>
                  )
                })}
              </ul>
              <p className="dim">ringed in amber on the roll</p>
            </div>
          )}
        </section>
      }
    />
  )
}
