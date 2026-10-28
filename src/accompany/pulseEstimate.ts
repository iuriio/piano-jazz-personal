import { percentile } from './played'

// Where the beat is, from when you strike the keys.
//
// Tatum first, beat second. The tatum is the smallest regular gap between
// attacks (the sixteenth of a Hanon, the triplet of a shuffle); every attack
// should sit on a whole number of them. The beat is then a small multiple of the
// tatum, chosen by a prior around 100 bpm, by how many beats actually carry an
// attack, and by which positions you lean on harder.
//
// Fitting every gap against every candidate beat at once was tried first: it
// grouped sixteenths at 92 in threes and said 123. Finding the tatum first is
// what fixed it. The doubling/halving error (Dixon) still happens, which is why
// the estimate carries its ½× and 2× and the offer lets you pick.

/** Attacks closer than this are one attack: a chord, or a sloppy unison. */
export const SAME_ATTACK_MS = 50
/** A gap longer than this is a pause, not a slow note: it breaks the grid. */
const BREAK_MS = 2000
const MIN_ATTACKS = 8
/** Weight of a beat of three tatums against two or four, before accents. */
const TERNARY = 0.85
/** No tatum is finer than this: sixteenths at 200 bpm. */
const MIN_TATUM_MS = 70
/** A finer tatum must leave less than this share of the coarser one's residual to be taken. */
const FINER = 0.6
const MIN_BPM = 40
const MAX_BPM = 240
/** Prior on the beat: log-normal around 110 bpm (where people tap, McKinney & Moelants), σ = 0.6 octave. */
const PRIOR_BPM = 110
const PRIOR_SIGMA = 0.6
/** Grid residual (in tatums, worst tenth trimmed) under which the playing counts as in time. */
export const STEADY = 0.12
/** Long/short ratio from which eighths count as swung. */
export const SWING_FROM = 0.6

export type Attack = {
  /** performance.now() of the first note in it. */
  t: number
  velocity: number
  /** Notes in the attack: 1 for a melody note, 3+ for a chord. */
  size: number
}

export type Pulse = {
  bpm: number
  beatMs: number
  tatumMs: number
  /** Tatums per beat. */
  perBeat: number
  /** RMS distance of the attacks from the grid, in tatums. Under STEADY = playing in time. */
  steadiness: number
  /** Where the off-beat eighth falls inside the beat: 0.5 straight, 0.67 triplet swing. */
  swing: number
  swung: boolean
  /** performance.now() of a beat: the grid is anchor + n × beatMs. */
  anchor: number
  /** Half and double time, for the offer to cycle to. */
  alts: number[]
}

/** Folds attacks closer than SAME_ATTACK_MS into one. Pure. */
export function mergeAttacks(notes: { on: number; velocity: number }[]): Attack[] {
  const sorted = [...notes].sort((a, b) => a.on - b.on)
  const out: Attack[] = []
  for (const n of sorted) {
    const last = out[out.length - 1]
    if (last && n.on - last.t < SAME_ATTACK_MS) {
      last.size += 1
      last.velocity = Math.max(last.velocity, n.velocity)
    } else {
      out.push({ t: n.on, velocity: n.velocity, size: 1 })
    }
  }
  return out
}

type Fit = {
  /** One tempo through everything, ms per tatum: what the beat level is chosen on. */
  tatum: number
  /** The tatum over the last few attacks: the tempo now, after a ritardando or an accelerando. */
  tatumNow: number
  /** RMS distance of the attacks from the grid around them, in tatums. */
  residual: number
  pos: number[]
  segment: number[]
  /** The grid over the last attacks: time = at + tatumNow × (p − pAt). */
  at: number
  pAt: number
}

/** Attacks on each side of one that the local grid is fitted over. */
const LOCAL = 6
/** Local and long-run tempi closer than this are one tempo. */
const SAME_TEMPO = 0.03
/** How fast the counting tatum follows the gaps, so a gradual tempo change does not miscount steps. */
const ADAPT = 0.15

/** Least squares t = a + T·p over attacks [from, to). */
function line(ts: number[], pos: number[], from: number, to: number): { a: number; T: number } | null {
  const n = to - from
  if (n < 2) return null
  let mp = 0
  let mt = 0
  for (let i = from; i < to; i++) (mp += pos[i]), (mt += ts[i])
  mp /= n
  mt /= n
  let num = 0
  let den = 0
  for (let i = from; i < to; i++) {
    num += (pos[i] - mp) * (ts[i] - mt)
    den += (pos[i] - mp) ** 2
  }
  if (den <= 0) return null
  const T = num / den
  return { a: mt - T * mp, T }
}

/**
 * Puts every attack on a tatum grid. Grid positions are counted gap by gap,
 * with a counting tatum that follows the playing a little, so a ritardando
 * from 120 to 90 still counts one eighth as one; a pause starts a new segment.
 *
 * The residual is measured on the attacks, against a grid fitted over the
 * dozen attacks around each one: a late note followed by an early one is one
 * mistake, not two, and a tempo that changes smoothly is still in time. One
 * straight line through 15 s of a ritardando read it as 115 bpm and rubato.
 */
export function fitGrid(attacks: Attack[], tatum: number): Fit {
  const ts = attacks.map((a) => a.t)
  let T = tatum
  const pos = [0]
  const segment = [0]
  for (let i = 1; i < ts.length; i++) {
    const gap = ts[i] - ts[i - 1]
    if (gap > BREAK_MS) {
      pos.push(0)
      segment.push(segment[i - 1] + 1)
      continue
    }
    const steps = Math.max(1, Math.round(gap / T))
    pos.push(pos[i - 1] + steps)
    segment.push(segment[i - 1])
    const r = gap / steps
    if (steps <= 2 && Math.abs(r / T - 1) < 0.2) T += ADAPT * (r - T)
  }

  // Segments: [start, end) index ranges.
  const segs: [number, number][] = []
  for (let i = 0; i < ts.length; i++) {
    if (i === 0 || segment[i] !== segment[i - 1]) segs.push([i, i + 1])
    else segs[segs.length - 1][1] = i + 1
  }

  // One tempo through all of it, each segment with its own offset.
  let num = 0
  let den = 0
  for (const [a, b] of segs) {
    const fit = line(ts, pos, a, b)
    if (!fit) continue
    let d = 0
    let mp = 0
    for (let i = a; i < b; i++) mp += pos[i]
    mp /= b - a
    for (let i = a; i < b; i++) d += (pos[i] - mp) ** 2
    num += fit.T * d
    den += d
  }
  const global = den > 0 ? num / den : T

  // Local residuals.
  const sq: number[] = []
  for (const [a, b] of segs) {
    for (let i = a; i < b; i++) {
      const from = Math.max(a, Math.min(i - LOCAL, b - 2 * LOCAL - 1))
      const to = Math.min(b, from + 2 * LOCAL + 1)
      const fit = line(ts, pos, from, to)
      if (!fit || !(fit.T > 0)) continue
      sq.push(((ts[i] - fit.a - fit.T * pos[i]) / fit.T) ** 2)
    }
  }
  sq.sort((x, y) => x - y)
  // Trimmed: the worst tenth of the attacks is left out, so one fumbled note (or
  // the browser hiccuping once) does not turn a steady player into rubato.
  const kept = sq.slice(0, Math.max(1, Math.ceil(sq.length * 0.9)))
  const residual = sq.length ? Math.sqrt(kept.reduce((x, y) => x + y, 0) / kept.length) : Infinity

  // The tempo now: the grid over the last attacks of the last segment.
  const [la, lb] = segs[segs.length - 1]
  const from = Math.max(la, lb - 2 * LOCAL - 1)
  const end = line(ts, pos, from, lb)
  // Within a few percent of the long fit is the same tempo, measured worse.
  const tatumNow = end && end.T > 0 && Math.abs(end.T / global - 1) > SAME_TEMPO ? end.T : global
  const pAt = pos[lb - 1]
  const at = end && end.T > 0 ? end.a + end.T * pAt : ts[lb - 1]
  return { tatum: global, tatumNow, residual, pos, segment, at, pAt }
}

function prior(bpm: number): number {
  const x = Math.log2(bpm / PRIOR_BPM)
  return Math.exp(-(x * x) / (2 * PRIOR_SIGMA * PRIOR_SIGMA))
}

/** The pulse, or null with too little to go on. Pure. */
export function estimatePulse(notes: { on: number; velocity: number }[]): Pulse | null {
  const attacks = mergeAttacks(notes)
  if (attacks.length < MIN_ATTACKS) return null
  const gaps = attacks
    .slice(1)
    .map((a, i) => a.t - attacks[i].t)
    .filter((g) => g <= BREAK_MS)
  if (gaps.length < MIN_ATTACKS - 1) return null

  // The tatum: searched in a narrow band around the 25th percentile gap, so it
  // can neither halve itself (everything fits a grid fine enough) nor swallow
  // the shortest notes. Syncopation (dotted eighths, 3-3-2) puts the true
  // tatum at a half or a third of that gap, so those bands are tried too; a
  // finer grid has to fit clearly better to win, or it would win on rubato.
  const p25 = percentile(gaps, 0.25)
  let fit: Fit | null = null
  for (let div = 1; div <= 4; div++) {
    const base = p25 / div
    if (base < MIN_TATUM_MS && div > 1) break
    let best: Fit | null = null
    for (let T = base * 0.8; T <= base * 1.25; T += Math.max(0.5, base / 200)) {
      const f = fitGrid(attacks, T)
      if (!best || f.residual < best.residual) best = f
    }
    if (!fit || best!.residual < FINER * fit.residual) fit = best
  }
  fit = fit!

  // The beat: k tatums. Each phase of each k is scored on the prior, on
  // coverage (a real beat has something on most beats) and on accent (the beat
  // is where you lean). Chords count as accents too.
  const strength = attacks.map((a) => a.velocity * (1 + 0.5 * (a.size - 1)))
  const meanStrength = strength.reduce((a, b) => a + b, 0) / strength.length
  const segs = fit.segment[fit.segment.length - 1] + 1
  const span = Array.from({ length: segs }, (_, s) => {
    const ps = fit.pos.filter((_, i) => fit.segment[i] === s)
    return [Math.min(...ps), Math.max(...ps)]
  })
  const occupied = new Set(fit.pos.map((p, i) => `${fit.segment[i]}:${p}`))

  // The tempo that counts is the one at the end, if it has been drifting.
  const lastSeg = segs - 1
  const lastPos = span[lastSeg][1]
  const tatumNow = fit.tatumNow

  let choice = { k: 1, phase: 0, score: -1 }
  for (let k = 1; k <= 4; k++) {
    const bpm = 60000 / (k * tatumNow)
    if (bpm < MIN_BPM || bpm > MAX_BPM) continue
    for (let phase = 0; phase < k; phase++) {
      let slots = 0
      let hits = 0
      for (let s = 0; s < segs; s++) {
        for (let p = span[s][0]; p <= span[s][1]; p++) {
          if (((p % k) + k) % k !== phase) continue
          slots++
          if (occupied.has(`${s}:${p}`)) hits++
        }
      }
      const coverage = slots ? hits / slots : 0
      let sum = 0
      let n = 0
      fit.pos.forEach((p, i) => {
        if (((p % k) + k) % k === phase) (sum += strength[i]), n++
      })
      const accent = n ? sum / n / meanStrength - 1 : 0
      // Beats of three tatums need the touch to say so; otherwise even eighths
      // at 135 would be heard as triplets at 90.
      const meter = k === 3 ? TERNARY : 1
      const score = prior(bpm) * meter * coverage * coverage * (1 + 4 * Math.max(0, accent))
      if (score > choice.score) choice = { k, phase, score }
    }
  }
  if (choice.score <= 0) return null

  const beatMs = choice.k * tatumNow
  // Anchor on the last segment's last beat at or before its last attack.
  const beatPos = lastPos - ((((lastPos - choice.phase) % choice.k) + choice.k) % choice.k)
  const anchor = fit.at + (beatPos - fit.pAt) * tatumNow

  const swing = swingRatio(attacks, anchor, beatMs)
  const bpm = 60000 / beatMs
  return {
    bpm,
    beatMs,
    tatumMs: tatumNow,
    perBeat: choice.k,
    steadiness: fit.residual,
    swing,
    swung: swing >= SWING_FROM,
    anchor,
    alts: [bpm / 2, bpm * 2].filter((b) => b >= 30 && b <= 300),
  }
}

/**
 * Where a lone off-beat attack falls inside its beat, median over the beats
 * that have exactly one. Straight eighths give 0.5, a triplet shuffle 0.67.
 */
export function swingRatio(attacks: Attack[], anchor: number, beatMs: number): number {
  const byBeat = new Map<number, number[]>()
  for (const a of attacks) {
    const x = (a.t - anchor) / beatMs
    const beat = Math.floor(x + 0.1) // an attack a hair early still belongs to its beat
    const frac = x - beat
    if (frac < 0.15 || frac > 0.9) continue
    byBeat.set(beat, [...(byBeat.get(beat) ?? []), frac])
  }
  const lone = [...byBeat.values()].filter((f) => f.length === 1).map((f) => f[0])
  if (lone.length < 3) return 0.5
  return percentile(lone, 0.5)
}

/** The next beat at or after `t`, on a pulse's grid. */
export function nextBeat(p: { anchor: number; beatMs: number }, t: number): number {
  return p.anchor + Math.ceil((t - p.anchor) / p.beatMs) * p.beatMs
}

/** Whether the pulse is steady enough to play on a grid; otherwise the accompaniment goes free time. */
export function isSteady(p: Pulse | null): p is Pulse {
  return !!p && p.steadiness < STEADY
}

/** Re-anchors a pulse at a new tempo (½×, 2×, or one picked by hand), keeping its grid. */
export function withBpm<P extends Pulse>(p: P, bpm: number): P {
  return { ...p, bpm, beatMs: 60000 / bpm }
}

