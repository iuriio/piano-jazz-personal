import { describe, expect, it } from 'vitest'
import { estimateKey, keyLabel, type KeyEstimate } from './keyEstimate'
import { endOf, rubato, scaleRun } from './fixtures'
import {
  GIVE_UP_MS,
  INITIAL,
  OFFER_WINDOW_MS,
  OFFER_QUIET_MS,
  SNOOZE_MS,
  keyOptions,
  reduce,
  tempoOptions,
  type Context,
  type Phase,
  type MachineState,
  type Tick,
} from './machine'
import { estimatePulse, type Pulse } from './pulseEstimate'
import { activityOf } from './listener'
import type { PlayedNote } from './played'

const bb = scaleRun(58, 'major', { bpm: 92, repeats: 2 })
const BB: KeyEstimate = estimateKey(bb, endOf(bb))!
const PULSE: Pulse = estimatePulse(bb)!
const eb = scaleRun(51, 'major', { bpm: 92, repeats: 2 })
const EB: KeyEstimate = estimateKey(eb, endOf(eb))!

type Over = Partial<Omit<Tick, 'type'>> & { now: number }

/** A tick as if you had been playing steadily up to `now`. */
function tick(over: Over): Tick {
  return {
    type: 'tick',
    context: 'free',
    offers: true,
    transportRunning: false,
    activity: { activeMs: 12000, attacks: 60, lastAttack: over.now - 100 },
    key: BB,
    pulse: PULSE,
    barMs: 2600,
    ...over,
  }
}

/** Ticks every 250 ms from `from` to `to`. */
function run(s: MachineState, from: number, to: number, over: Partial<Over> = {}): MachineState {
  for (let now = from; now <= to; now += 250) s = reduce(s, tick({ ...over, now }))
  return s
}

describe('the offer', () => {
  it('waits for the key to hold 3 s before offering', () => {
    let s = run(INITIAL, 0, 2500)
    expect(s.phase).toBe('listening')
    s = run(s, 2750, 3250)
    expect(s.phase).toBe('offer')
    expect(keyLabel(s.offer!.key)).toBe('B♭ major')
  })

  it('needs 8 s of playing and 20 attacks, not just a key', () => {
    let s = run(INITIAL, 0, 6000, { activity: { activeMs: 5000, attacks: 60, lastAttack: 0 } })
    expect(s.phase).not.toBe('offer')
    s = run(INITIAL, 0, 6000, { activity: { activeMs: 12000, attacks: 12, lastAttack: 0 } })
    expect(s.phase).not.toBe('offer')
  })

  it('does not need a pulse: without one the offer is free time', () => {
    const notes = rubato(58, 'major', { count: 60 })
    const s = run(INITIAL, 0, 4000, { pulse: estimatePulse(notes) })
    expect(s.phase).toBe('offer')
    expect(s.choice!.pulse).toBeNull()
  })

  it('stays up while you keep playing, and goes after 15 s of silence', () => {
    let s = run(INITIAL, 0, 3500)
    expect(s.phase).toBe('offer')
    // A minute of playing: the offer is still there.
    s = run(s, 3750, 63500)
    expect(s.phase).toBe('offer')
    // You stop at 64 s: still up just before 15 s of quiet, gone after.
    const quiet = { activity: { activeMs: 8000, attacks: 40, lastAttack: 64000 } }
    s = run(s, 64000, 64000 + OFFER_QUIET_MS - 250, quiet)
    expect(s.phase).toBe('offer')
    s = run(s, 64000 + OFFER_QUIET_MS, 64000 + OFFER_QUIET_MS + 500, quiet)
    expect(['listening', 'idle']).toContain(s.phase)
    expect(s.offer).toBeNull()
  })

  it('may offer the same key again after the silence took it away', () => {
    let s = run(INITIAL, 0, 3500)
    const quiet = { activity: { activeMs: 8000, attacks: 40, lastAttack: 4000 } }
    s = run(s, 3750, 4000 + OFFER_QUIET_MS + 250, quiet)
    expect(s.phase).not.toBe('offer')
    const back = 4000 + OFFER_QUIET_MS + 500
    s = run(s, back, back + 4000)
    expect(s.phase).toBe('offer')
  })

  it('does not offer a key again after the band played it and stopped', () => {
    let s = run(INITIAL, 0, 3500)
    s = reduce(s, { type: 'accept', now: 3500 })
    s = reduce(s, { type: 'started', now: 3700 })
    s = reduce(s, { type: 'stop', now: 5000 })
    s = run(s, 5250, 60000)
    expect(s.phase).toBe('listening')
  })

  it('follows the key and the tempo while it is open, instead of going away', () => {
    let s = run(INITIAL, 0, 3500)
    expect(keyLabel(s.choice!.key)).toBe('B♭ major')
    // One wavering reading of another key, or an unconfident one: nothing changes.
    s = reduce(s, tick({ now: 3750, key: EB }))
    s = reduce(s, tick({ now: 4000, key: { ...BB, correlation: 0.5 } }))
    s = run(s, 4250, 5000)
    expect(s.phase).toBe('offer')
    expect(keyLabel(s.choice!.key)).toBe('B♭ major')
    // E♭ for 3 s: the offer now says E♭, and it never left the screen.
    for (let now = 5250; now <= 8500; now += 250) {
      s = reduce(s, tick({ now, key: EB }))
      expect(s.phase).toBe('offer')
    }
    expect(keyLabel(s.choice!.key)).toBe('E♭ major')
    // A new tempo reading updates the label too.
    const faster = { ...PULSE, bpm: 120, beatMs: 500, alts: [60, 240] }
    s = reduce(s, tick({ now: 8750, key: EB, pulse: faster }))
    expect(s.phase).toBe('offer')
    expect(Math.round(s.choice!.pulse!.bpm)).toBe(120)
  })

  it('keeps the reading you cycled to while the key holds', () => {
    let s = run(INITIAL, 0, 3500)
    s = reduce(s, { type: 'cycleKey' })
    const picked = s.choice!.key
    s = run(s, 3750, 20000)
    expect(s.phase).toBe('offer')
    expect(s.choice!.key).toEqual(picked)
  })

  it('× snoozes for 5 minutes, unless the key changes', () => {
    let s = run(INITIAL, 0, 3500)
    s = reduce(s, { type: 'dismiss', now: 3500 })
    expect(s.phase).toBe('listening')
    expect(s.snoozeUntil).toBe(3500 + SNOOZE_MS)
    // A new key is a new offer, snooze or not.
    s = run(s, 3750, 8000, { key: EB })
    expect(s.phase).toBe('offer')
    expect(keyLabel(s.offer!.key)).toBe('E♭ major')
  })

  it('never offers in the voicings drill', () => {
    const s = run(INITIAL, 0, 20000, { context: 'voicings' as Context })
    expect(s.phase).toBe('idle')
  })

  it('in shred, only with the exercise running', () => {
    expect(run(INITIAL, 0, 6000, { context: 'shred' }).phase).toBe('listening')
    expect(run(INITIAL, 0, 6000, { context: 'shred', transportRunning: true }).phase).toBe('offer')
  })

  it('stays quiet when offers are turned off', () => {
    expect(run(INITIAL, 0, 20000, { offers: false }).phase).toBe('listening')
  })

  it('goes idle 15 s after the last note', () => {
    const s = run(INITIAL, 0, 1000, { activity: { activeMs: 2000, attacks: 5, lastAttack: 0 } })
    expect(s.phase).toBe('listening')
    expect(run(s, 15250, 16000, { activity: { activeMs: 0, attacks: 0, lastAttack: 0 } }).phase).toBe('idle')
  })

  it('the dot summons an offer straight away', () => {
    const s = reduce(INITIAL, { type: 'summon', now: 10, key: BB, pulse: PULSE })
    expect(s.phase).toBe('offer')
  })

  it('cycles the key reading and the tempo inside the offer', () => {
    let s = run(INITIAL, 0, 3500)
    const keys = keyOptions(s.offer!.key)
    const tempos = tempoOptions(s.offer!.pulse)
    expect(tempos).toHaveLength(3)
    s = reduce(s, { type: 'cycleKey' })
    expect(s.choice!.key).toEqual(keys[1])
    s = reduce(s, { type: 'cycleTempo' })
    expect(Math.round(s.choice!.pulse!.bpm)).toBe(Math.round(PULSE.bpm / 2))
  })
})

describe('playing and waiting', () => {
  function playing(): MachineState {
    let s = run(INITIAL, 0, 3500)
    s = reduce(s, { type: 'accept', now: 3500 })
    expect(s.phase).toBe('starting')
    s = reduce(s, { type: 'started', now: 3700 })
    expect(s.phase).toBe('playing')
    return s
  }

  it('accept carries the chosen key and tempo', () => {
    const s = playing()
    expect(s.choice!.key.center).toBe(10)
    expect(Math.round(s.choice!.pulse!.bpm)).toBe(92)
  })

  it('waits after 1.5 bars of silence, and comes back when you do', () => {
    let s = playing()
    const last = 4000
    s = run(s, 4000, 4000 + 2600 * 1.5 - 250, { activity: { activeMs: 8000, attacks: 40, lastAttack: last } })
    expect(s.phase).toBe('playing')
    s = run(s, 4000 + 3900, 8500, { activity: { activeMs: 8000, attacks: 40, lastAttack: last } })
    expect(s.phase).toBe('waiting')
    s = reduce(s, tick({ now: 9000, activity: { activeMs: 8000, attacks: 41, lastAttack: 8900 } }))
    expect(s.phase).toBe('playing')
  })

  it('keeps waiting while the accompanist says your return is not readable yet', () => {
    let s = playing()
    s = run(s, 4000, 8500, { activity: { activeMs: 8000, attacks: 40, lastAttack: 4000 } })
    expect(s.phase).toBe('waiting')
    s = reduce(s, tick({ now: 9000, activity: { activeMs: 8000, attacks: 41, lastAttack: 8900 }, resume: false }))
    expect(s.phase).toBe('waiting')
    s = reduce(s, tick({ now: 9500, activity: { activeMs: 8000, attacks: 43, lastAttack: 9400 }, resume: true }))
    expect(s.phase).toBe('playing')
  })

  it('gives up after 20 s of silence', () => {
    let s = playing()
    s = run(s, 4000, 4000 + GIVE_UP_MS - 500, { activity: { activeMs: 0, attacks: 0, lastAttack: 4000 } })
    expect(s.phase).toBe('waiting')
    s = run(s, 4000 + GIVE_UP_MS, 4000 + GIVE_UP_MS, { activity: { activeMs: 0, attacks: 0, lastAttack: 4000 } })
    expect(s.phase).toBe('listening')
    expect(s.choice).toBeNull()
  })

  it('stop goes back to listening', () => {
    expect(reduce(playing(), { type: 'stop', now: 5000 }).phase).toBe('listening')
  })

  it('leaving free play stops it', () => {
    expect(reduce(playing(), tick({ now: 5000, context: 'voicings' })).phase).toBe('listening')
  })
})

describe('the offer keeps listening', () => {
  it('takes a steadier pulse that arrives while it is open', () => {
    const shaky = { ...PULSE, steadiness: 0.3 }
    let s = run(INITIAL, 0, 3500, { pulse: shaky })
    expect(s.phase).toBe('offer')
    expect(s.choice!.pulse).toBeNull()
    s = reduce(s, tick({ now: 3750 }))
    expect(Math.round(s.choice!.pulse!.bpm)).toBe(92)
  })
})

describe('comping over the band', () => {
  /** Chords of 3–4 notes, rolled a little, each held `beats[i]` beats at 120. */
  function chords(from: number, list: number[][], beats: number[], until: number): PlayedNote[] {
    const out: PlayedNote[] = []
    let t = from
    for (let i = 0; t < until; i++) {
      const held = beats[i % beats.length] * 500
      list[i % list.length].forEach((midi, j) => out.push({ midi, velocity: 70, on: t + j * 15, off: t + held * 0.95, lowest: j === 0 }))
      t += held
    }
    return out
  }

  /** Runs the machine from `playing` over a stream, the way the accompanist ticks it. */
  function over(s: MachineState, notes: PlayedNote[], from: number, to: number): Phase[] {
    const seen: Phase[] = []
    for (let now = from; now <= to; now += 250) {
      const played = notes.filter((n) => n.on <= now).map((n) => (n.off > now ? { ...n, off: Number.NaN } : n))
      const key = estimateKey(played, now)
      s = reduce(s, tick({ now, activity: activityOf(played, now, OFFER_WINDOW_MS), key, pulse: estimatePulse(played), barMs: 2000 }))
      seen.push(s.phase)
    }
    return seen
  }

  function playing(): MachineState {
    let s = run(INITIAL, 0, 3500)
    s = reduce(s, { type: 'accept', now: 3500 })
    return reduce(s, { type: 'started', now: 3700 })
  }

  it('keeps playing through chords held 1–2 beats, a key change, and two-bar chords', () => {
    const C = [[48, 64, 67, 72], [53, 65, 69, 72], [55, 62, 65, 71], [48, 60, 64, 67]]
    const G = [[43, 59, 62, 67], [50, 54, 57, 60], [43, 59, 62, 66], [48, 52, 55, 59]]
    const notes = [
      ...chords(4000, C, [1, 2, 1.5, 2, 1, 0.5, 2], 34000),
      ...chords(34000, G, [2, 1, 1, 2, 1.5, 0.5], 64000),
      // Whole notes held for two bars each: still playing.
      ...chords(64000, G, [8], 84000),
    ]
    const seen = over(playing(), notes, 4000, 84000)
    expect(new Set(seen)).toEqual(new Set(['playing']))
  })

  it('a held chord still counts for only so long: then it waits', () => {
    const notes = chords(4000, [[48, 64, 67]], [40], 5000)
    const seen = over(playing(), notes, 4000, 16000)
    expect(seen[seen.length - 1]).toBe('waiting')
  })
})
