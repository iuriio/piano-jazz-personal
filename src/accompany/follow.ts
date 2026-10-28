import { SAME_ATTACK_MS, estimatePulse } from './pulseEstimate'

// Tempo following: once a beat, a small grid is fitted through your last two
// bars of attacks, and the band moves a share of the way toward it.
//
// The fit counts your attacks in eighths gap by gap (so a gradual change does
// not miscount a step), leaves out the ones that fall between eighths (a
// sixteenth, a push), weighs the recent bar most, and drops the one worst note
// if it sits far off. Its slope is the tempo you are playing now; its line,
// carried to the band's next beat, is where your grid will be then.
//
// - Phase: the band's next beat moves 35% of the way to your nearest eighth,
//   at most 5% of a beat per beat, so it never jumps audibly. The offset is
//   measured fresh each beat, never summed, so a run of late notes does not
//   pull five times for one lateness.
// - Tempo: inside ±1.5% nothing moves — you hear the band and settle into it,
//   and a band that chased every note would have the two of you dragging each
//   other around (Large & Kolen; Pardo's online tracker). Past that, once three
//   beats in a row lean the same way, a third of the lean, at most 1.5% a beat.
// - A real change: six beats in a row more than 6% off the same way move the
//   band to your tempo at once, and the phase may catch up faster for a bar.
//   And if nothing fits a grid for a bar while you keep playing (a change of a
//   third or more), the pulse is estimated again from your attacks and the
//   reading nearest the old tempo taken.
//
// Before this, each attack near the grid pulled the phase and the tempo moved
// at most 2% a bar from the median gap: a jump from 100 to 115 took six bars,
// an accelerando left the band behind until your notes fell outside its window
// and it stopped hearing them, and the three notes of a chord pulled three
// times. A chord is one attack here; velocity and chord size weigh it.
//
// `lock` keeps the tempo and lets only the phase follow.

/**
 * An attack this far (in eighths) from a whole number of them is between
 * eighths, not used: a sixteenth sits at 0.5, a triplet at 0.33, the short
 * note of a swung pair at 0.33.
 */
const SNAP = 0.2
/** Inside this lean the tempo does not move. */
const DEAD = 0.015
const TEMPO_GAIN = 0.5
const MAX_STEP = 0.025
/** Beats in a row the lean must keep its sign before the tempo moves. */
const AGREE_BEATS = 3
const PHASE_GAIN = 0.35
/** Share of a lasting phase lean that goes into the tempo, per beat (the PLL's integral). */
const KAPPA = 0.25
/** Per beat, the phase moves at most this share of a beat: never an audible jump. */
const MAX_NUDGE = 0.07
/** Right after a jump, the phase may catch up faster for a few beats. */
const RESYNC_NUDGE = 0.12
const RESYNC_BEATS = 4
/** A lean this large, three beats running, is a new tempo, not a drift. */
export const JUMP = 0.06
const JUMP_BEATS = 3
/** The last bar's grid is taken over the last two bars' once they differ by this much. */
const SHORT_WINS = 0.04
/** Beats with no fit, while you keep playing, before the pulse is estimated again. */
const LOST_BEATS = 4
/** Attacks kept for the fit and a re-estimate. */
const KEEP_MS = 12000
/** A fit worse than this (RMS, in eighths) is not a grid. */
const FIT_RESIDUAL = 0.2
/** Nor one that fewer than this share of the attacks land on (sixteenths: half do). */
const MIN_USED = 0.5

export type HeardAttack = {
  t: number
  velocity: number
  size: number
  /** Where it fell on the band's grid when it was heard, in eighths from a beat (even = on a beat). */
  band?: number
  /** The latest note that joined it: a rolled chord keeps joining note by note. */
  last?: number
}

/**
 * A rolled chord, or one a hand lands a little unevenly, can spread its notes
 * over more than SAME_ATTACK_MS: each note joins the chord if it comes within
 * SAME_ATTACK_MS of the one before it, up to this much after the first. Counted
 * as separate attacks, the stragglers sat between eighths, halved the share of
 * attacks on the grid, and over a few bars of comping the follower lost the
 * grid and "re-estimated" the band from 120 down to 83 bpm.
 */
const MAX_ROLL_MS = 120

/** The band's grid position of an attack, as the grid stands now. */
function onBand(s: FollowState, a: HeardAttack): HeardAttack {
  return Number.isNaN(s.anchor) || !s.inSync ? a : { ...a, band: (a.t - s.anchor) / (s.beatMs / 2) }
}

export type FollowState = {
  beatMs: number
  /** A grid point (perf ms): the grid is anchor + n × beatMs / 2. */
  anchor: number
  /** The attack still gathering the notes of its chord. */
  open: HeardAttack | null
  /** Your recent attacks, chords folded. */
  attacks: HeardAttack[]
  /** Your tempo against ours over the last beats, newest last: −0.1 = you are 10% faster. NaN: no fit. */
  leans: number[]
  /** Beats left in which the phase may move by RESYNC_NUDGE. */
  resync: number
  /** Your beat against the band's next one, the last few beats (ms, + = yours is later). */
  phases: number[]
  /** Whether the band is with you, so an attack's place on its grid says which eighths are beats. */
  inSync: boolean
  locked: boolean
}

export function newFollow(beatMs: number, locked: boolean): FollowState {
  return { beatMs, anchor: Number.NaN, open: null, attacks: [], leans: [], resync: 0, phases: [], inSync: true, locked }
}

/** How much an attack counts: a firm touch or a chord more than a grazed note. */
function weightOf(a: HeardAttack): number {
  return Math.max(0.5, Math.min(1.6, 0.6 + (0.4 * a.velocity) / 80 + 0.25 * (a.size - 1)))
}

/** One of your attacks (a note-on). Notes of a chord, under 50 ms apart, are one. Pure. */
export function followAttack(s: FollowState, t: number, velocity = 80): FollowState {
  if (Number.isNaN(s.anchor)) return s
  if (s.open && t - (s.open.last ?? s.open.t) < SAME_ATTACK_MS && t - s.open.t < MAX_ROLL_MS) {
    return { ...s, open: { ...s.open, size: s.open.size + 1, velocity: Math.max(s.open.velocity, velocity), last: t } }
  }
  const attacks = s.open ? [...s.attacks.filter((x) => t - x.t <= KEEP_MS), onBand(s, s.open)] : s.attacks
  return { ...s, attacks, open: { t, velocity, size: 1 } }
}

/** Commits the open attack once no more notes can join its chord. */
function settle(s: FollowState, now: number): FollowState {
  if (!s.open || (s.open.last ?? s.open.t) >= now - SAME_ATTACK_MS) return s
  return { ...s, attacks: [...s.attacks.filter((x) => now - x.t <= KEEP_MS), onBand(s, s.open)], open: null }
}

export type LocalGrid = {
  /** Your eighth, ms. */
  step: number
  /** Your grid: a + step × n. */
  a: number
  /** RMS distance of the attacks used from it, in eighths. */
  residual: number
  /** Share of the attacks that landed on its eighths. */
  used: number
  /**
   * Which of your eighths are beats: n with (n − beatParity) even, by how the
   * attacks that were heard on the band's grid sat on it. NaN when none did.
   */
  beatParity: number
}

/**
 * Your grid over a handful of attacks, counting from `step0`. Weighted least
 * squares, the newest bar counting most; the worst attack is dropped once if it
 * sits far off. Null when fewer than four attacks land on eighths. Pure.
 */
export function localGrid(attacks: HeardAttack[], step0: number, now: number, tauMs: number): LocalGrid | null {
  if (attacks.length < 4) return null
  let step = step0
  let fit: LocalGrid | null = null
  for (let iter = 0; iter < 3; iter++) {
    // Counted from the last attack that landed on an eighth, with a counting
    // step that follows the gaps a little: 15% faster still counts one as one.
    let pts: { t: number; n: number; w: number; band?: number }[] = []
    let local = step
    for (const a of attacks) {
      const w = weightOf(a) * Math.exp(-(now - a.t) / tauMs)
      const last = pts[pts.length - 1]
      if (!last) {
        pts.push({ t: a.t, n: 0, w, band: a.band })
        continue
      }
      const x = (a.t - last.t) / local
      const k = Math.round(x)
      if (k < 1 || Math.abs(x - k) > SNAP) continue
      pts.push({ t: a.t, n: last.n + k, w, band: a.band })
      if (k <= 2) local += 0.3 * ((a.t - last.t) / k - local)
    }
    for (let pass = 0; pass < 2; pass++) {
      if (pts.length < 4) return null
      let sw = 0
      let sn = 0
      let st = 0
      for (const p of pts) (sw += p.w), (sn += p.w * p.n), (st += p.w * p.t)
      const mn = sn / sw
      const mt = st / sw
      let num = 0
      let den = 0
      for (const p of pts) (num += p.w * (p.n - mn) * (p.t - mt)), (den += p.w * (p.n - mn) ** 2)
      if (den <= 0) return null
      const s = num / den
      const a = mt - s * mn
      const res = pts.map((p) => (p.t - a - s * p.n) / s)
      const rms = Math.sqrt(pts.reduce((acc, p, j) => acc + p.w * res[j] ** 2, 0) / sw)
      fit = { step: s, a, residual: rms, used: pts.length / attacks.length, beatParity: parity(pts) }
      // One fumbled note: drop it and fit again.
      const worst = res.reduce((wi, r, j) => (Math.abs(r) > Math.abs(res[wi]) ? j : wi), 0)
      if (pass === 0 && Math.abs(res[worst]) > 0.15 && pts.length > 5) pts = pts.filter((_, j) => j !== worst)
      else break
    }
    step = fit!.step
    if (!(step > step0 * 0.55 && step < step0 * 1.8)) return null
  }
  return fit
}

/** The vote of the attacks heard close to the band's grid (within a fifth of an eighth). */
function parity(pts: { n: number; band?: number }[]): number {
  let even = 0
  let odd = 0
  for (const p of pts) {
    if (p.band === undefined) continue
    const b = Math.round(p.band)
    if (Math.abs(p.band - b) > 0.2) continue
    if ((((p.n - b) % 2) + 2) % 2 === 0) even++
    else odd++
  }
  return even + odd === 0 ? Number.NaN : even >= odd ? 0 : 1
}

/**
 * One beat of the band, as it is scheduled at `beatAt` (~100 ms ahead of now).
 * Returns how far to nudge the grid and the tempo from here on. Pure.
 */
export function followBeat(s0: FollowState, beatAt: number): { state: FollowState; nudgeMs: number; beatMs: number } {
  const now = beatAt - 100
  let s = settle(s0, now)
  const step = s.beatMs / 2
  const bar = 4 * s.beatMs
  let window = s.attacks.filter((a) => a.t > now - 2 * bar)
  if (window.length < 6) window = s.attacks.filter((a) => a.t > now - 4 * bar).slice(-6)
  const long = localGrid(window, step, now, bar)
  // The last bar alone, for a change that is happening now: two bars of the
  // old tempo would hide it for a bar, and by then the grids are an eighth apart.
  const lastBar = s.attacks.filter((a) => a.t > now - bar)
  const short = lastBar.length >= 5 ? localGrid(lastBar, step, now, 2 * s.beatMs) : null
  // A grid that only half your attacks land on is a guess: every third note
  // of a run at 140 fits a grid at 93 just as well as triplets fit one at 80.
  const shortFits = !!short && short.residual < FIT_RESIDUAL * 0.75 && short.used >= MIN_USED
  const longFits = !!long && long.residual < FIT_RESIDUAL && long.used >= MIN_USED
  // Plenty played in the last bar and none of it on a grid: something just
  // changed, and two bars that are mostly the old tempo cannot say what.
  const changed = lastBar.length >= 5 && !shortFits
  const grid = changed
    ? null
    : shortFits && (!longFits || Math.abs(short!.step / long!.step - 1) > SHORT_WINS)
      ? short
      : longFits
        ? long
        : null
  const fits = !!grid

  let beatMs = s.beatMs
  let leans = [...s.leans, fits ? grid!.step / step - 1 : Number.NaN].slice(-8)
  let resync = Math.max(0, s.resync - 1)
  let phase = Number.NaN

  if (fits && !s.locked) {
    const lean = leans[leans.length - 1]
    const run = leans.slice(-JUMP_BEATS)
    const agree = leans.slice(-AGREE_BEATS)
    if (run.length === JUMP_BEATS && run.every((l) => Math.abs(l) > JUMP && Math.sign(l) === Math.sign(lean))) {
      // You changed tempo: go there now.
      beatMs = 2 * grid!.step
      leans = []
      resync = RESYNC_BEATS
    } else if (
      Math.abs(lean) > DEAD &&
      agree.length === AGREE_BEATS &&
      agree.every((l) => Math.abs(l) > DEAD / 2 && Math.sign(l) === Math.sign(lean))
    ) {
      beatMs = s.beatMs * (1 + Math.max(-MAX_STEP, Math.min(MAX_STEP, TEMPO_GAIN * lean)))
    }
  } else if (!fits && !s.locked) {
    // Playing, but nothing on a grid for a bar: re-estimate from scratch.
    // From what you played since it stopped fitting, not the two bars before.
    const recent = s.attacks.filter((a) => a.t > now - bar)
    if (recent.length < 8) recent.splice(0, recent.length, ...s.attacks.slice(-8))
    const blind = leans.slice(-LOST_BEATS)
    // Only a run of notes is evidence of a new tempo: eight attacks inside two
    // bars. Comping (a chord every beat or two, syncopated, held) often fits no
    // grid of eighths for a bar, and estimating a pulse from eight chords spread
    // over four bars picked a new tempo out of the rhythm of the comping.
    const dense = recent.length >= 8 && recent[recent.length - 1].t - recent[0].t <= 2 * bar
    if (dense && blind.length === LOST_BEATS && blind.every(Number.isNaN)) {
      const p = estimatePulse(recent.map((a) => ({ on: a.t, velocity: a.velocity })))
      if (p && p.steadiness < 0.15) {
        // The estimate's own beat if it is anywhere near; its half or double otherwise.
        const near =
          p.beatMs / s.beatMs > 0.6 && p.beatMs / s.beatMs < 1.6
            ? p.beatMs
            : [p.beatMs / 2, p.beatMs * 2].reduce((b, x) => (Math.abs(Math.log(x / s.beatMs)) < Math.abs(Math.log(b / s.beatMs)) ? x : b))
        const r = near / s.beatMs
        // Three against two of the old tempo is triplets (or a swung pair), not a new tempo.
        const triplets = [2 / 3, 3 / 2, 4 / 3, 3 / 4].some((q) => Math.abs(r / q - 1) < 0.04)
        if (Math.abs(r - 1) > JUMP && r > 0.6 && r < 1.6 && !triplets) {
          beatMs = near
          leans = []
          resync = RESYNC_BEATS
          // Your eighths, at the new tempo, through the estimate's beat.
          const next = beatAt + beatMs
          const k = Math.round((next - p.anchor) / (near / 2))
          phase = p.anchor + (k * near) / 2 - next
        }
      }
    }
  }

  // Phase: your beat nearest the band's next one, at the tempo it will have.
  const phaseAt = (next: number) => {
    let k = Math.round((next - grid!.a) / grid!.step)
    // Your beat, not just your nearest eighth: once the band has drifted half
    // an eighth, the nearest one is your off-beat.
    const par = grid!.beatParity
    if (!Number.isNaN(par) && (((k - par) % 2) + 2) % 2 === 1) {
      const x = (next - grid!.a) / grid!.step
      k = x > k ? k + 1 : k - 1
    }
    return grid!.a + k * grid!.step - next
  }
  if (fits) {
    phase = phaseAt(beatAt + beatMs)
    // A phase that keeps leaning the same way, and is not shrinking under the
    // nudges, is a tempo the lean has not caught yet (a ritardando, or the last
    // percent after a jump): a share of it goes into the tempo.
    const lately = [...s.phases.slice(-2), phase]
    if (
      !s.locked &&
      resync === 0 &&
      lately.length === 3 &&
      lately.every((p) => Math.abs(p) > 0.03 * step && Math.sign(p) === Math.sign(phase)) &&
      Math.abs(phase) >= 0.9 * Math.abs(lately[1])
    ) {
      beatMs *= 1 + Math.max(-MAX_STEP, Math.min(MAX_STEP, (KAPPA * phase) / s.beatMs))
      phase = phaseAt(beatAt + beatMs)
    }
  }
  const cap = (s.resync > 0 || resync > 0 ? RESYNC_NUDGE : MAX_NUDGE) * s.beatMs
  const nudgeMs = Number.isNaN(phase) ? 0 : Math.max(-cap, Math.min(cap, PHASE_GAIN * phase))
  const left = phase - nudgeMs
  s = {
    ...s,
    beatMs,
    leans,
    resync,
    anchor: beatAt + nudgeMs,
    phases: [...s.phases, phase].slice(-4),
    // In step with you, to an eighth's sixth: attacks heard now can vote on which eighths are your beats.
    inSync: Number.isNaN(left) ? s.inSync : Math.abs(left) < step / 6,
  }
  return { state: s, nudgeMs, beatMs }
}

/**
 * Whether you came back in the band's time: your first attacks after a pause,
 * each gap within ±10% of a whole number of the band's grid steps (eighths).
 * True: the band picks up on its next beat. False: your tempo has changed and
 * the pulse should be estimated again before it plays. Null: not enough yet
 * (three attacks are needed). Pure.
 */
export function resumeFits(attacks: number[], beatMs: number): boolean | null {
  const ts = [...attacks].sort((a, b) => a - b).filter((t, i, a) => i === 0 || t - a[i - 1] >= SAME_ATTACK_MS)
  if (ts.length < 3) return null
  const step = beatMs / 2
  return ts.slice(1, 3).every((t, i) => {
    const steps = (t - ts[i]) / step
    const whole = Math.max(1, Math.round(steps))
    return whole <= 8 && Math.abs(steps / whole - 1) <= 0.1
  })
}

export type Follower = {
  /** A beat time the grid passes through (the first beat, a resume). */
  anchor(t: number): void
  /** Every note-on; notes of one chord are folded. Velocity is optional (80). */
  attack(t: number, velocity?: number): void
  /** Called as each beat is scheduled. */
  adjust(beatAt: number): { nudgeMs: number; beatMs: number }
  setLocked(on: boolean): void
}

/** The stateful wrapper the accompanist holds. */
export function createFollower(opts: { beatMs: number; locked: boolean }): Follower {
  let s = newFollow(opts.beatMs, opts.locked)
  return {
    anchor: (t) => {
      s = { ...s, anchor: t, open: null, attacks: [], leans: [], resync: 0, phases: [], inSync: true }
    },
    attack: (t, velocity) => {
      s = followAttack(s, t, velocity)
    },
    adjust: (beatAt) => {
      const r = followBeat(s, beatAt)
      s = r.state
      return { nudgeMs: r.nudgeMs, beatMs: r.beatMs }
    },
    setLocked: (on) => {
      s = { ...s, locked: on }
    },
  }
}
