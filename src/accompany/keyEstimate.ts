import { KEY_SIGNATURES, type KeySig } from '../analysis'
import { pcOf, type PlayedNote } from './played'

// Which key you are playing in, from what you just played.
//
// Two stages, because one correlation cannot tell D dorian from C major — they
// are the same seven notes:
//
// 1. Which COLLECTION of seven notes (= which key signature). Half plain
//    membership (are these the notes of that scale?), half the Kostka–Payne
//    profiles over all 24 keys with relatives grouped. Membership alone ties
//    when a line skips the one note that tells two signatures apart; the
//    profiles alone get dragged by a held pedal tone toward whatever key has it
//    as a fifth. Together they need neither to be perfect.
// 2. Which CENTER inside it, and so which mode: the profiles rotated onto each
//    candidate tonic, plus what a listener actually leans on — the bass and the
//    note a phrase comes to rest on. The corpus profiles separate a key from its
//    relative minor far better than Krumhansl–Schmuckler, which ties on a Hanon
//    in C.

/** Temperley's Kostka–Payne profiles, from tonic up by semitone. */
const KP_MAJOR = [0.748, 0.06, 0.488, 0.082, 0.67, 0.46, 0.096, 0.715, 0.104, 0.366, 0.057, 0.4]
const KP_MINOR = [0.712, 0.084, 0.474, 0.618, 0.049, 0.46, 0.105, 0.747, 0.404, 0.067, 0.133, 0.33]
/** Membership only: the seven notes of a major scale. */
const DIATONIC = [1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1]

/** The modes the planner has templates for. The others are rare enough to read as their neighbours. */
export type KeyMode = 'major' | 'minor' | 'dorian' | 'mixolydian'

/** Where each mode's tonic sits above the major tonic of its collection. */
export const MODE_DEGREE: Record<KeyMode, number> = { major: 0, dorian: 2, mixolydian: 7, minor: 9 }

/**
 * Profile per mode. Dorian is the minor profile with the sixth raised, mixolydian
 * the major one with the seventh lowered — the one note that makes each mode
 * what it is, carried over with the weight it had.
 */
const PROFILE: Record<KeyMode, number[]> = {
  major: KP_MAJOR,
  minor: KP_MINOR,
  dorian: swap(KP_MINOR, 8, 9),
  mixolydian: swap(KP_MAJOR, 10, 11),
}

/**
 * Dorian and mixolydian start behind: they share every note with a major key,
 * and a plain scale must not come out as a mode. They need the bass or the
 * phrase endings to say so.
 */
const MODE_PRIOR: Record<KeyMode, number> = { major: 0, minor: 0, dorian: -0.06, mixolydian: -0.06 }

function swap(p: number[], a: number, b: number): number[] {
  const out = [...p]
  ;[out[a], out[b]] = [out[b], out[a]]
  return out
}

export type KeyEstimate = {
  /** Signature of the collection: a KEY_SIGNATURES id ('Bb'). */
  collection: string
  /** Major tonic of the collection, as a pitch class. */
  collectionPc: number
  /** Tonic, as a pitch class. */
  center: number
  mode: KeyMode
  /** Correlation of the winning collection, -1..1. */
  correlation: number
  /** How far ahead of the best collection that is NOT its relative. */
  margin: number
  /** Score of every collection, by major tonic pc. The modulation tracker compares these. */
  scores: number[]
  /** Other readings of the same collection, best first: the offer cycles through them. */
  alts: { center: number; mode: KeyMode }[]
  /**
   * The last ~20 s note by note, weighed, for the modulation tracker: it looks
   * at what was played since a key was last contradicted, which one histogram
   * cannot tell it.
   */
  recent?: HeardNote[]
}

/** One note as the modulation tracker weighs it. */
export type HeardNote = {
  on: number
  midi: number
  pc: number
  /** Duration × touch × bass, around 1 for a plain note; a chromatic passing note counts ~0.3. */
  w: number
  /** The bass when struck. */
  low: boolean
  /** A phrase came to rest on it (a gap well over the pace follows). */
  rest: boolean
}

export type Weights = {
  /** Duration × touch × recency, per pitch class. */
  pc: number[]
  /** The same, counting only notes that were the bass when struck. */
  bass: number[]
  /** Notes a phrase came to rest on. */
  final: number[]
}

const DECAY_MS = 8000
const MIN_DUR_MS = 100
const MAX_DUR_MS = 2000
/** Two attacks closer than this are one: a chord, not two events. */
const SAME_ATTACK_MS = 50

/**
 * The histogram. A note counts for how long it sounded (pedal included, capped
 * so one held drone cannot outweigh a whole line), a bit more if struck harder,
 * half again if it was the bass, and it fades over ~8 s so the estimate follows
 * a key change.
 */
export function pcWeights(notes: PlayedNote[], now: number, decayMs = DECAY_MS): Weights {
  const pc = new Array(12).fill(0)
  const bass = new Array(12).fill(0)
  const final = new Array(12).fill(0)
  if (notes.length === 0) return { pc, bass, final }

  const decay = (n: PlayedNote) => {
    const end = Number.isNaN(n.off) ? now : Math.min(now, n.off)
    return Math.exp(-Math.max(0, now - end) / decayMs)
  }

  for (const n of notes) {
    const end = Number.isNaN(n.off) ? now : n.off
    const dur = Math.max(MIN_DUR_MS, Math.min(MAX_DUR_MS, end - n.on)) / 1000
    const w = dur * (0.5 + n.velocity / 254) * decay(n)
    pc[pcOf(n.midi)] += n.lowest ? w * 1.5 : w
    if (n.lowest) bass[pcOf(n.midi)] += w
  }

  // Phrase endings: an attack followed by a gap well over the running pace.
  const attacks = groupAttacks(notes)
  const iois = attacks.slice(1).map((a, i) => a.on - attacks[i].on)
  const pace = iois.length ? iois.sort((a, b) => a - b)[iois.length >> 1] : 500
  const restMs = Math.max(600, pace * 2.5)
  attacks.forEach((a, i) => {
    const next = attacks[i + 1]?.on ?? now
    if (next - a.on < restMs) return
    // A melody rests on its note; a chord on its bass.
    const rest = a.notes.length === 1 ? a.notes[0] : a.notes.reduce((lo, n) => (n.midi < lo.midi ? n : lo))
    final[pcOf(rest.midi)] += decay(rest)
  })

  return { pc, bass, final }
}

function groupAttacks(notes: PlayedNote[]): { on: number; notes: PlayedNote[] }[] {
  const sorted = [...notes].sort((a, b) => a.on - b.on)
  const out: { on: number; notes: PlayedNote[] }[] = []
  for (const n of sorted) {
    const last = out[out.length - 1]
    if (last && n.on - last.on < SAME_ATTACK_MS) last.notes.push(n)
    else out.push({ on: n.on, notes: [n] })
  }
  return out
}

/** Pearson correlation of a histogram with a profile rotated onto `tonic`. */
export function correlate(hist: number[], profile: number[], tonic: number): number {
  let mh = 0
  let mp = 0
  for (let i = 0; i < 12; i++) {
    mh += hist[i]
    mp += profile[i]
  }
  mh /= 12
  mp /= 12
  let num = 0
  let dh = 0
  let dp = 0
  for (let i = 0; i < 12; i++) {
    const h = hist[i] - mh
    const p = profile[(i - tonic + 12) % 12] - mp
    num += h * p
    dh += h * h
    dp += p * p
  }
  return dh === 0 || dp === 0 ? 0 : num / Math.sqrt(dh * dp)
}

/**
 * One signature per pitch class. Where two spell the same collection (F♯/G♭,
 * C♯/D♭, B/C♭) the one with fewer accidentals wins; on the F♯/G♭ tie, flats,
 * which is what a chart in that key usually carries.
 */
export const COLLECTION_SIG: KeySig[] = Array.from({ length: 12 }, (_, pc) => {
  const options = KEY_SIGNATURES.filter((k) => k.tonicPc === pc)
  return options.reduce((best, k) =>
    Math.abs(k.accidentals) < Math.abs(best.accidentals) ||
    (Math.abs(k.accidentals) === Math.abs(best.accidentals) && k.accidentals < 0)
      ? k
      : best,
  )
})

/** How much the bass and the phrase endings count against the profile, per share of the total. */
const CUE_WEIGHT = 0.12

/** Stage 1 for every collection: membership and profiles over a flattened histogram. */
function collectionScores(pc: number[]): number[] {
  // Which notes are there matters here, not how much each one weighs — a held
  // pedal tone would otherwise drag the reading toward whichever key has it as
  // a fifth. The square root flattens the peaks.
  const roots = pc.map(Math.sqrt)
  const nonzero = roots.filter((x) => x > 0).sort((a, b) => a - b)
  const cap = 1.5 * nonzero[nonzero.length >> 1]
  const flat = roots.map((x) => Math.min(x, cap))
  const scores = new Array(12).fill(0)
  for (let t = 0; t < 12; t++) {
    const kp = Math.max(correlate(flat, KP_MAJOR, t), correlate(flat, KP_MINOR, (t + 9) % 12))
    scores[t] = (correlate(flat, DIATONIC, t) + kp) / 2
  }
  return scores
}

/** Stage 2: the readings of one collection, best first, from the modal profiles plus the bass and the endings. */
function readCenter(
  collectionPc: number,
  w: Weights,
  keep?: KeyMode,
  modes: KeyMode[] = Object.keys(MODE_DEGREE) as KeyMode[],
): { center: number; mode: KeyMode; score: number }[] {
  const share = (xs: number[]) => {
    const s = xs.reduce((a, b) => a + b, 0)
    return s > 0 ? xs.map((x) => x / s) : xs
  }
  const bass = share(w.bass)
  const final = share(w.final)
  const readings = modes.map((mode) => {
    const center = (collectionPc + MODE_DEGREE[mode]) % 12
    const cue = bass[center] + 2 * final[center]
    const stay = keep === undefined || mode === keep ? 0 : -KEEP_MODE
    return { center, mode, score: correlate(w.pc, PROFILE[mode], center) + MODE_PRIOR[mode] + CUE_WEIGHT * cue + stay }
  })
  return readings.sort((a, b) => b.score - a.score)
}

/**
 * A tune that modulates mostly keeps its mode: C major goes to G major more
 * often than to E minor, and a bar and a half of the new key is too little for
 * the profiles alone to tell those apart.
 */
const KEEP_MODE = 0.1

function reading(
  collectionPc: number,
  scores: number[],
  w: Weights,
  recent?: HeardNote[],
  keep?: KeyMode,
  modes?: KeyMode[],
): KeyEstimate {
  let second = -Infinity
  for (let t = 0; t < 12; t++) if (t !== collectionPc && scores[t] > second) second = scores[t]
  const readings = readCenter(collectionPc, w, keep, modes)
  return {
    collection: COLLECTION_SIG[collectionPc].id,
    collectionPc,
    center: readings[0].center,
    mode: readings[0].mode,
    correlation: scores[collectionPc],
    margin: scores[collectionPc] - second,
    scores,
    alts: readings.slice(1).map(({ center, mode }) => ({ center, mode })),
    recent,
  }
}

/** The key, or null when nothing has been played. Pure. */
export function estimateKey(notes: PlayedNote[], now: number): KeyEstimate | null {
  const w = pcWeights(notes, now)
  const total = w.pc.reduce((a, b) => a + b, 0)
  if (total <= 0) return null
  const scores = collectionScores(w.pc)
  let best = 0
  for (let t = 1; t < 12; t++) if (scores[t] > scores[best]) best = t
  return reading(best, scores, w, heardNotes(notes, now))
}

// --- the recent notes, one by one ---------------------------------------------

/** How far back the modulation tracker looks. */
const RECENT_MS = 20000
/** A note outside a key under this weight does not contradict it: a chromatic passing note. */
export const CONTRADICTS = 0.45

/**
 * The last RECENT_MS of notes, each weighed by how long it sounded against the
 * running pace (a half note in a line of eighths says more than an eighth), by
 * touch, and by being the bass. A short note that slides through by semitones
 * (F F♯ G, G F♯ F) or steps out and back (G F♯ G) is ornament, not key, and
 * counts a third.
 */
export function heardNotes(notes: PlayedNote[], now: number): HeardNote[] {
  const recent = notes.filter((n) => n.on >= now - RECENT_MS).sort((a, b) => a.on - b.on)
  if (recent.length === 0) return []
  const attacks = groupAttacks(recent)
  const iois = attacks.slice(1).map((a, i) => a.on - attacks[i].on).filter((g) => g < 2000)
  const pace = iois.length ? [...iois].sort((a, b) => a - b)[iois.length >> 1] : 500
  const attackOf = new Map<PlayedNote, number>()
  attacks.forEach((a, i) => a.notes.forEach((n) => attackOf.set(n, i)))
  // The line a passing note moves in: the nearest pitch in the attacks around it.
  const nearest = (i: number, midi: number) => {
    const a = attacks[i]
    if (!a) return Number.NaN
    return a.notes.reduce((b, n) => (Math.abs(n.midi - midi) < Math.abs(b - midi) ? n.midi : b), a.notes[0].midi)
  }
  return recent.map((n) => {
    const end = Number.isNaN(n.off) ? now : Math.min(now, n.off)
    const dur = Math.max(0, end - n.on)
    // Around 1 for a plain note at the running pace and an average touch.
    let w = Math.max(0.6, Math.min(1.6, Math.sqrt(dur / pace))) * ((0.5 + n.velocity / 254) / 0.78) * (n.lowest ? 1.25 : 1)
    const i = attackOf.get(n)!
    const prev = nearest(i - 1, n.midi)
    const next = nearest(i + 1, n.midi)
    const through = Math.abs(n.midi - prev) === 1 && Math.abs(next - n.midi) === 1
    if (dur <= 1.2 * pace && through) w *= 0.3
    const after = attacks[i + 1]?.on ?? now
    const rest = after - n.on >= Math.max(600, 2.5 * pace)
    return { on: n.on, midi: n.midi, pc: pcOf(n.midi), w, low: n.lowest, rest }
  })
}
/** Offer only on a clear reading: a strong fit, clearly ahead of the next key. */
export const OFFER_CORRELATION = 0.8
export const OFFER_MARGIN = 0.1

export function isConfident(k: KeyEstimate | null): boolean {
  return !!k && k.correlation >= OFFER_CORRELATION && k.margin >= OFFER_MARGIN
}

/** Same key: same collection and same center. */
export function sameKey(a: { collectionPc: number; center: number } | null, b: { collectionPc: number; center: number } | null): boolean {
  return !!a && !!b && a.collectionPc === b.collectionPc && a.center === b.center
}

// --- modulation -------------------------------------------------------------

export type KeyTrack = {
  current: KeyEstimate | null
  /** A different reading that has been ahead since `since`. */
  challenger: KeyEstimate | null
  since: number
  /** The key before the last fast move, and when that was: going back to it is cheap for a while. */
  previous?: KeyEstimate | null
  movedAt?: number
}

export const NEW_TRACK: KeyTrack = { current: null, challenger: null, since: 0 }

/** A new collection has to win by this much, the whole hold (the slow path). */
export const MODULATION_LEAD = 0.05

/** inKey[X][pc]: whether pc belongs to the collection whose major tonic is X. */
const IN_KEY: boolean[][] = Array.from({ length: 12 }, (_, x) =>
  Array.from({ length: 12 }, (_, pc) => DIATONIC[(pc - x + 12) % 12] === 1),
)

/** Steps around the circle of fifths between two collections: G is 1 from C, E♭ 3. */
function fifths(a: number, b: number): number {
  const steps = ((((b - a) * 7) % 12) + 12) % 12
  return Math.min(steps, 12 - steps)
}

/**
 * The case for collection `to` against the current one, `from`: everything
 * played since `to` was last contradicted, and inside that, since `from` was
 * first contradicted. A modulation is the new key's notes arriving AND the old
 * key's notes going missing; a secondary dominant brings the first without the
 * second for long, a passing note neither.
 */
export type Evidence = {
  collectionPc: number
  /** Onset of the first note in the run that the current key does not have. */
  since: number
  /** Weight of the notes the current key does not have. */
  against: number
  /** Separate attacks since `since`. */
  attacks: number
  /** Distinct pitch classes since `since`, out of the new collection's seven. */
  pcs: number
  /** The notes of the run, for reading its center. */
  run: HeardNote[]
}

export function evidenceFor(recent: HeardNote[], to: number, from: number): Evidence | null {
  let i = recent.length - 1
  while (i >= 0 && (IN_KEY[to][recent[i].pc] || recent[i].w < CONTRADICTS)) i--
  const run = recent.slice(i + 1)
  const first = run.findIndex((n) => !IN_KEY[from][n.pc] && n.w >= CONTRADICTS)
  if (first < 0) return null
  let against = 0
  let attacks = 0
  let last = Number.NEGATIVE_INFINITY
  const pcs = new Set<number>()
  run.forEach((n, j) => {
    if (j < first) return
    if (n.w >= CONTRADICTS) pcs.add(n.pc)
    if (!IN_KEY[from][n.pc] && n.w >= CONTRADICTS) against += n.w
    if (n.on - last >= SAME_ATTACK_MS) attacks++
    last = n.on
  })
  return { collectionPc: to, since: run[first].on, against, attacks, pcs: pcs.size, run }
}

/** How long since a note that does not belong to collection `x` was played. */
function cleanFor(recent: HeardNote[], x: number, now: number): number {
  for (let i = recent.length - 1; i >= 0; i--) {
    if (!IN_KEY[x][recent[i].pc] && recent[i].w >= CONTRADICTS) return now - recent[i].on
  }
  return Number.POSITIVE_INFINITY
}

/** Weight the old key must have lost: two plain notes it does not have, or one long or bass one. */
export const FAST_AGAINST = 1.4
/** One plain note: enough only when the old key's note then stays away for the whole hold. */
export const FAST_AGAINST_ONE = 0.85
export const FAST_ATTACKS = 6
export const FAST_PCS = 5
/**
 * How long, as a share of the hold, the case must stand, by how many of the new
 * collection's seven notes it has heard: one bar with all seven, two with six,
 * two and a half with five. A secondary dominant (D7 → G in C) brings four to
 * six of them and gets its F back within a bar or two; a real move to G keeps
 * playing F♯, fills in the rest of the scale, and never plays F.
 */
export function fastSpan(pcs: number): number {
  return pcs >= 7 ? 0.5 : pcs === 6 ? 1 : 1.25
}
/** For this long after a fast move (in holds), the old key comes back on less evidence: */
const RETURN_WINDOW = 3
/** one plain note of it, standing for a quarter of the hold. */
const RETURN_SPAN = 0.25
/** How long, as a share of the hold, two clean candidates wait for the note that tells them apart. */
export const TOSS_UP_HOLD = 1.5

/**
 * Pitch-class weights of a run, the recent end counting most. A step up by a
 * semitone into a note (F♯ → G) counts half a phrase ending on it: inside one
 * collection only two notes can be reached that way, and the leading tone's is
 * the tonic.
 */
function runWeights(run: HeardNote[], now: number, decayMs: number): Weights {
  const pc = new Array(12).fill(0)
  const bass = new Array(12).fill(0)
  const final = new Array(12).fill(0)
  run.forEach((n, i) => {
    const w = n.w * Math.exp(-Math.max(0, now - n.on) / decayMs)
    pc[n.pc] += n.low ? w * 1.5 : w
    if (n.low) bass[n.pc] += w
    if (n.rest) final[n.pc] += w
    const prev = run[i - 1]
    if (prev && n.on - prev.on >= SAME_ATTACK_MS && n.midi - prev.midi === 1 && prev.w >= CONTRADICTS) final[n.pc] += w / 2
  })
  return { pc, bass, final }
}

/**
 * The fast track: the new key, as soon as the notes since the old one was last
 * heard make the case, or null. Pure.
 */
export function modulationTo(
  recent: HeardNote[],
  current: { collectionPc: number; mode?: KeyMode },
  now: number,
  holdMs: number,
): KeyEstimate | null {
  if (recent.length === 0) return null
  type Case = { e: Evidence; score: number; scores: number[] }
  let best: Case | null = null
  let runnerUp: Case | null = null
  for (let x = 0; x < 12; x++) {
    if (x === current.collectionPc) continue
    const e = evidenceFor(recent, x, current.collectionPc)
    if (!e || e.attacks < FAST_ATTACKS || e.pcs < FAST_PCS) continue
    const span = now - e.since
    // Two notes the old key lacks (or one long one) for a bar and a half; or a
    // single one, if the old key's own note then stays away for two full bars.
    const enough =
      (e.against >= FAST_AGAINST && span >= holdMs * fastSpan(e.pcs)) ||
      (e.against >= FAST_AGAINST_ONE && span >= holdMs && e.pcs >= 6)
    if (!enough) continue
    // Two collections can both be clean (no C and no C♯ yet: G or D?): the
    // notes decide, and on a tie the nearer key, which is where tunes go.
    // The tonic counts too: E♭–G–B♭ on the downbeats is E♭ major more than B♭.
    const w = runWeights(e.run, now, 6000)
    const scores = collectionScores(w.pc)
    const center = readCenter(x, w, current.mode, ['major', 'minor'])[0].score
    const score = scores[x] + 0.5 * center - 0.02 * fifths(current.collectionPc, x)
    const c = { e, score, scores }
    if (!best || score > best.score) (runnerUp = best), (best = c)
    else if (!runnerUp || score > runnerUp.score) runnerUp = c
  }
  if (!best) return null
  // Still a toss-up (E♭ or B♭, before any A♭ or A): wait for the note that
  // decides rather than take one and have to move again — for up to three
  // bars. Without the beat, three E♭s and three Fs read as B♭ as easily as E♭.
  if (runnerUp && now - best.e.since < holdMs * TOSS_UP_HOLD) return null
  // The center from what was played since the move, the rests, the bass and
  // the leading tone leaning on it. Major or minor only, the mode it was in
  // preferred: a bar and a half cannot tell G major from D mixolydian, and the
  // slow track refines the center once the new key has been heard for longer.
  const since = best.e.run.filter((n) => n.on >= best.e.since - SAME_ATTACK_MS * 2)
  return reading(best.e.collectionPc, best.scores, runWeights(since, now, 6000), recent, current.mode, ['major', 'minor'])
}

/**
 * Holds on to the key until a new one has made its case. Two ways in:
 *
 * - fast: a new collection whose notes have kept coming, and the old key's
 *   missing, for 1–1.5 bars (`modulationTo`);
 * - slow: the whole-buffer estimate has favoured another reading for `holdMs`
 *   (two bars, or 4 s without a pulse) — a new center inside the same notes,
 *   or a drift the fast track did not catch. It only takes a collection that
 *   nothing has contradicted for the whole hold, so it cannot drag the key back
 *   while the old estimate is still catching up.
 *
 * Without this the chart would change key on every borrowed chord. Pure.
 */
export function trackKey(track: KeyTrack, est: KeyEstimate | null, now: number, holdMs: number): KeyTrack {
  if (!est) return track
  if (!track.current) return isConfident(est) ? { current: est, challenger: null, since: now } : track
  const cur = track.current
  const recent = est.recent ?? []

  // Back where it was: a move that turned out to be a tonicization (D7 → G in
  // C, and then F again) is undone on the first plain F, half a bar on.
  const prev = track.previous
  if (prev && track.movedAt !== undefined && now - track.movedAt < RETURN_WINDOW * holdMs && prev.collectionPc !== cur.collectionPc) {
    const e = evidenceFor(recent, prev.collectionPc, cur.collectionPc)
    if (e && e.against >= FAST_AGAINST_ONE && now - e.since >= RETURN_SPAN * holdMs) {
      return { current: { ...prev, recent }, challenger: null, since: now, previous: null }
    }
  }

  const moved = modulationTo(recent, cur, now, holdMs)
  if (moved) return { current: moved, challenger: null, since: now, previous: cur, movedAt: now }

  if (sameKey(cur, est)) return { ...track, current: est, challenger: null, since: now }

  let lead: number
  if (est.collectionPc === cur.collectionPc) {
    // Same notes, new center: the profiles alone decide, so no lead to measure.
    // The last two bars must say so too, not just the 30 s behind them.
    const lately = recent.filter((n) => n.on >= now - holdMs)
    const fresh = lately.length ? readCenter(cur.collectionPc, runWeights(lately, now, holdMs))[0] : null
    lead = isConfident(est) && (!fresh || fresh.center === est.center) ? MODULATION_LEAD : 0
  } else {
    lead = est.scores[est.collectionPc] - est.scores[cur.collectionPc]
    if (recent.length && cleanFor(recent, est.collectionPc, now) < holdMs) lead = 0
  }

  if (lead < MODULATION_LEAD || !isConfident(est)) return { ...track, challenger: null, since: now }
  if (!track.challenger || !sameKey(track.challenger, est)) return { ...track, challenger: est, since: now }
  if (now - track.since >= holdMs) return { current: est, challenger: null, since: now, previous: null }
  return { ...track, challenger: est }
}

// --- naming -----------------------------------------------------------------

const glyph = (s: string) => s.replace(/#/g, '♯').replace(/b/g, '♭')

const PC_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const PC_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']

/** The center spelled in its own collection: B♭ in B♭, G in B♭ (as G minor), A♯ never in a flat key. */
export function centerName(k: { collectionPc: number; center: number }): string {
  const sig = COLLECTION_SIG[k.collectionPc]
  const major = sig.id
  const scale = sig.accidentals < 0 ? PC_FLAT : PC_SHARP
  if (k.center === k.collectionPc) return glyph(major)
  return glyph(scale[k.center])
}

/** "B♭ major", "G minor", "D dorian". */
export function keyLabel(k: { collectionPc: number; center: number; mode: KeyMode }): string {
  return `${centerName(k)} ${k.mode}`
}
