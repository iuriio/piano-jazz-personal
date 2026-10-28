import { describe, expect, it } from 'vitest'
import { followAttack, followBeat, localGrid, newFollow, resumeFits, type FollowState } from './follow'
import { heldNotes, scaleBars, scaleRun, swingEighths, syncopated, timeOf, tune, type StreamOpts } from './fixtures'
import type { PlayedNote } from './played'

/**
 * Plays a band against a player, exactly as the accompanist drives the
 * follower: every note-on is an attack (a chord's notes arrive one by one), each
 * beat is scheduled ~100 ms ahead, and the transport moves as told. The band
 * starts on the player's beat `startBeat` at the player's tempo there.
 */
function band(notes: PlayedNote[], opts: StreamOpts, o: { startBeat: number; beats: number; locked?: boolean; startBeatMs?: number }) {
  const playerBeat = (k: number) => timeOf(k, opts)
  const first = playerBeat(o.startBeat)
  const sorted = [...notes].sort((a, b) => a.on - b.on).filter((n) => n.on > first - 50)
  let s: FollowState = { ...newFollow(o.startBeatMs ?? playerBeat(o.startBeat + 1) - first, !!o.locked), anchor: first }
  let next = first
  let i = 0
  const beats: { t: number; beatMs: number; nudge: number }[] = []
  for (let b = 0; b < o.beats; b++) {
    while (i < sorted.length && sorted[i].on < next - 100) s = followAttack(s, sorted[i].on, sorted[i++].velocity)
    const r = followBeat(s, next)
    s = r.state
    beats.push({ t: next, beatMs: r.beatMs, nudge: r.nudgeMs })
    next = next + r.nudgeMs + r.beatMs
  }
  const truth: number[] = []
  for (let k = 0; k < o.startBeat + o.beats + 16; k++) truth.push(playerBeat(k))
  /** The player's beat length at time t. */
  const playerBeatMs = (t: number) => {
    const k = truth.findIndex((x) => x > t)
    return truth[k] - truth[k - 1]
  }
  /** How far a band beat is from the player's nearest beat, ms. */
  const phaseOf = (t: number) => Math.min(...truth.map((x) => Math.abs(x - t)))
  const tempoErr = (p: { t: number; beatMs: number }) => Math.abs(p.beatMs / playerBeatMs(p.t) - 1)
  return { beats, tempoErr, phaseOf, playerBeat }
}

/** Beats (from `fromBeat` of the player's) until the band stays within `tol` of the player's tempo. */
function lockAfter(r: ReturnType<typeof band>, fromBeat: number, tol = 0.02): number {
  const from = r.playerBeat(fromBeat)
  const after = r.beats.filter((b) => b.t > from)
  return after.findIndex((_, j) => after.slice(j).every((x) => r.tempoErr(x) < tol))
}

describe('follow', () => {
  it('a jump from 100 to 115 is followed within a bar, on the beat', () => {
    const o: StreamOpts = { bpm: 100, jitterMs: 10, bpmAt: (b) => (b < 24 ? 100 : 115) }
    const r = band(scaleBars(60, 'major', { ...o, bars: 18 }), o, { startBeat: 8, beats: 56 })
    // Before: 25 beats (six bars) at 2% a bar, ~100 ms off the beat meanwhile.
    const lock = lockAfter(r, 24)
    expect(lock).toBeGreaterThanOrEqual(0)
    expect(lock).toBeLessThanOrEqual(4)
    for (const b of r.beats.slice(-16)) expect(r.phaseOf(b.t)).toBeLessThan(20)
  })

  it('and a drop from 100 to 88', () => {
    const o: StreamOpts = { bpm: 100, jitterMs: 10, bpmAt: (b) => (b < 24 ? 100 : 88) }
    const r = band(scaleBars(60, 'major', { ...o, bars: 18 }), o, { startBeat: 8, beats: 52 })
    expect(lockAfter(r, 24)).toBeLessThanOrEqual(4)
    for (const b of r.beats.slice(-16)) expect(r.phaseOf(b.t)).toBeLessThan(20)
  })

  /**
   * Through a ramp: never more than 6% off your tempo and, at worst, a
   * sixteenth off your beat (`maxPhaseMs`; the band trails a ramp by a beat or
   * two, and a ritardando's beats keep getting longer under it); a bar after
   * it, with you.
   */
  function ramp(r: ReturnType<typeof band>, start: number, end: number, maxPhaseMs: number) {
    for (const b of r.beats.filter((b) => b.t > r.playerBeat(start))) {
      expect(r.tempoErr(b)).toBeLessThan(0.06)
      expect(r.phaseOf(b.t)).toBeLessThan(maxPhaseMs)
    }
    for (const b of r.beats.filter((b) => b.t > r.playerBeat(end + 4))) expect(r.tempoErr(b)).toBeLessThan(0.02)
  }

  it('a ritardando from 120 to 96 over four bars', () => {
    const o: StreamOpts = { bpm: 120, jitterMs: 10, bpmAt: (b) => (b < 16 ? 120 : b < 32 ? 120 - (24 * (b - 16)) / 16 : 96) }
    const r = band(tune(60, 'major', { ...o, bars: 20 }), o, { startBeat: 8, beats: 64 })
    // Before: never caught up; 5% off and 156 ms off the beat at the end, and
    // growing. Now: 137 ms at worst, mid-ramp; 2 ms a bar after it.
    ramp(r, 16, 32, 150)
  })

  it('an accelerando from 100 to 120 over four bars', () => {
    const o: StreamOpts = { bpm: 100, jitterMs: 10, bpmAt: (b) => (b < 16 ? 100 : b < 32 ? 100 + (20 * (b - 16)) / 16 : 120) }
    const r = band(scaleBars(60, 'major', { ...o, bars: 20 }), o, { startBeat: 8, beats: 64 })
    ramp(r, 16, 32, 90)
  })

  it('follows 5% faster over 8 bars, never overshooting', () => {
    const o: StreamOpts = { bpm: 100, jitterMs: 6, bpmAt: (b) => 100 / (1 - 0.05 * Math.min(1, b / 32)) }
    const r = band(scaleBars(60, 'major', { ...o, bars: 14 }), o, { startBeat: 0, beats: 48 })
    const last = r.beats[r.beats.length - 1]
    expect(r.tempoErr(last)).toBeLessThan(0.01)
    for (const b of r.beats) expect(b.beatMs).toBeGreaterThan(570 * 0.98)
  })

  it('a change of 40% (100 → 140) is re-estimated, not chased at 2:3', () => {
    const o: StreamOpts = { bpm: 100, jitterMs: 10, bpmAt: (b) => (b < 24 ? 100 : 140) }
    const r = band(scaleBars(60, 'major', { ...o, bars: 22 }), o, { startBeat: 8, beats: 72 })
    expect(lockAfter(r, 24)).toBeLessThanOrEqual(12)
    expect(r.tempoErr(r.beats[r.beats.length - 1])).toBeLessThan(0.02)
  })

  it('a single late note moves neither the tempo nor, much, the phase', () => {
    const notes = scaleBars(60, 'major', { bpm: 100, bars: 12 }).map((n, k) => (k === 40 ? { ...n, on: n.on + 90 } : n))
    const r = band(notes, { bpm: 100 }, { startBeat: 4, beats: 40 })
    for (const b of r.beats) {
      expect(b.beatMs).toBe(600)
      expect(Math.abs(b.nudge)).toBeLessThan(10)
    }
  })

  it('what is not a tempo change does not move it: syncopation, held notes, swing, triplets, sixteenth fills', () => {
    const cases: [PlayedNote[], StreamOpts][] = [
      [syncopated(60, { bpm: 100, jitterMs: 12, bars: 16 }), { bpm: 100 }],
      [heldNotes(60, { bpm: 90, jitterMs: 12, bars: 16 }), { bpm: 90 }],
      [swingEighths(60, { bpm: 120, ratio: 2 / 3, jitterMs: 10, beats: 72 }), { bpm: 120 }],
      [scaleRun(60, 'major', { bpm: 80, perBeat: 3, repeats: 3, jitterMs: 10 }), { bpm: 80 }],
      [
        [
          ...scaleBars(60, 'major', { bpm: 100, jitterMs: 12, bars: 4 }),
          ...scaleBars(60, 'major', { bpm: 100, jitterMs: 12, bars: 2, perBeat: 4, startMs: 9600 }),
          ...scaleBars(60, 'major', { bpm: 100, jitterMs: 12, bars: 6, startMs: 14400 }),
        ],
        { bpm: 100 },
      ],
    ]
    for (const [notes, o] of cases) {
      const r = band(notes, o, { startBeat: 4, beats: 40 })
      for (const b of r.beats) expect(r.tempoErr(b)).toBeLessThan(0.015)
      for (const b of r.beats.slice(-8)) expect(r.phaseOf(b.t)).toBeLessThan(30)
    }
  })

  it('a sloppy player (±30 ms) does not drag the band around', () => {
    const o: StreamOpts = { bpm: 100, jitterMs: 30 }
    const r = band(tune(60, 'major', { ...o, bars: 24 }), o, { startBeat: 8, beats: 80 })
    for (const b of r.beats) expect(r.tempoErr(b)).toBeLessThan(0.025)
  })

  it('a chord pulls the phase once, not once per note', () => {
    const late = (size: number) => {
      const notes: PlayedNote[] = []
      for (let k = 1; k <= 12; k++) for (let j = 0; j < size; j++) notes.push({ midi: 60 + j * 4, velocity: 80, on: k * 300 + 30 + j * 6, off: 0, lowest: j === 0 })
      return band(notes, { bpm: 100 }, { startBeat: 0, beats: 6, locked: true, startBeatMs: 600 }).beats
    }
    const one = late(1)
    const three = late(3)
    // Before: three notes pulled three times as hard.
    for (let b = 0; b < one.length; b++) expect(Math.abs(three[b].nudge - one[b].nudge)).toBeLessThan(12)
    expect(one[one.length - 1].nudge).toBeGreaterThan(0)
  })

  it('lock keeps the tempo; only the phase follows', () => {
    const o: StreamOpts = { bpm: 100, jitterMs: 6, bpmAt: (b) => (b < 16 ? 100 : 110) }
    const r = band(scaleBars(60, 'major', { ...o, bars: 12 }), o, { startBeat: 4, beats: 40, locked: true })
    for (const b of r.beats) expect(b.beatMs).toBe(600)
    expect(r.beats.some((b) => b.nudge < 0)).toBe(true)
  })

  it('never moves the phase more than 5% of a beat per beat, outside a jump', () => {
    const o: StreamOpts = { bpm: 100, jitterMs: 15 }
    const r = band(tune(60, 'major', { ...o, bars: 16 }), o, { startBeat: 4, beats: 48 })
    for (const b of r.beats) expect(Math.abs(b.nudge)).toBeLessThanOrEqual(0.07 * 600)
  })
})

describe('localGrid', () => {
  it('reads your eighth and leaves out what falls between them', () => {
    const at = [0, 300, 600, 750, 900, 1200, 1500].map((t) => ({ t, velocity: 80, size: 1 }))
    const g = localGrid(at, 290, 1600, 2400)!
    expect(g.step).toBeCloseTo(300, 0)
    expect(g.used).toBeCloseTo(6 / 7, 5) // the sixteenth at 750 is not on an eighth
    expect(g.residual).toBeLessThan(0.01)
  })

  it('needs four attacks on eighths', () => {
    expect(localGrid([0, 300, 450].map((t) => ({ t, velocity: 80, size: 1 })), 300, 500, 2400)).toBeNull()
  })
})

describe('resumeFits', () => {
  it('three attacks back in the old time: pick up', () => {
    expect(resumeFits([10000, 10300, 10905], 600)).toBe(true)
  })
  it('back at another tempo: estimate again', () => {
    expect(resumeFits([10000, 10240, 10480], 600)).toBe(false)
  })
  it('two attacks are not enough to tell; a chord is one', () => {
    expect(resumeFits([10000, 10300], 600)).toBeNull()
    expect(resumeFits([10000, 10004, 10008, 10300], 600)).toBeNull()
  })
})

describe('comping chords over the band', () => {
  /**
   * Chords of 3–4 notes struck together (rolled: 12–30 ms between notes, up
   * to ~90 ms in all), held 1/2 to 2 beats in a syncopated comping rhythm,
   * at the band's own tempo. Before, the stragglers of a roll counted as
   * attacks of their own, nothing fit a grid, and the "lost" re-estimate moved
   * the band from 120 to as low as 83 within a minute.
   */
  function comping(seed: number, bpm: number, offsetBeats: number): PlayedNote[] {
    let x = seed
    const rnd = () => ((x = (x * 16807) % 2147483647) / 2147483647)
    const beatMs = 60000 / bpm
    const rhythm = [1, 2, 1.5, 2, 1, 0.5, 2, 2, 1, 1]
    const chords = [[48, 64, 67, 72], [53, 65, 69], [55, 62, 65, 71], [43, 59, 62, 66], [50, 54, 57, 60]]
    const out: PlayedNote[] = []
    let at = offsetBeats
    for (let i = 0; at < 140; i++) {
      const t0 = at * beatMs + (rnd() - 0.5) * 40
      let t = t0
      const held = rhythm[i % rhythm.length]
      for (const midi of chords[i % chords.length]) {
        out.push({ midi, velocity: 55 + Math.round(rnd() * 40), on: t, off: t0 + held * beatMs * 0.95, lowest: false })
        t += 12 + rnd() * 18
      }
      at += held
    }
    return out
  }

  for (const [seed, offset] of [
    [3, 0],
    [11, 0.3],
    [29, 0.5],
  ] as const) {
    it(`keeps the band's tempo through a minute of comping (seed ${seed}, ${offset} beat off)`, () => {
      const o: StreamOpts = { bpm: 120 }
      const r = band(comping(seed, 120, offset), o, { startBeat: 4, beats: 120 })
      const worst = Math.max(...r.beats.map((b) => Math.abs(b.beatMs / 500 - 1)))
      expect(worst).toBeLessThan(0.05)
    })
  }

  it('a rolled chord is one attack', () => {
    let s: FollowState = { ...newFollow(500, false), anchor: 0 }
    for (const t of [1000, 1025, 1055, 1080]) s = followAttack(s, t, 80)
    s = followAttack(s, 1500, 80)
    expect(s.attacks).toHaveLength(1)
    expect(s.attacks[0].size).toBe(4)
  })
})
