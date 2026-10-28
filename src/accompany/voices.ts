import { midiToFreq } from '../instrument'
import { leaseFx, type FxBus } from '../sound/fx'

// The band's two own timbres: a bass and a pad. The piano is the app's own
// (schedulePianoTone), so the band and your playing sound like one room.
//
// Both are scheduled at a fixed instant for a fixed length, like the shred
// guide's notes: the accompaniment knows how long every note lasts before it
// sounds. As in instrument.ts, the numbers are pure functions up top.
//
// The pad is a classic "supersaw" string pad: seven detuned sawtooths spread
// across the stereo field plus a quiet sine an octave down, through a lowpass
// that opens slowly after the note starts. The bass is a saw and a sine through
// a gentle drive and a plucked lowpass. Both send to a chorus and reverb (see
// sound/fx.ts); the pad generously, the bass barely.

export type VoiceOptions = {
  /**
   * How hard the note is played, 0..1, for brightness. Defaults to a value
   * inferred from `gain` (see touchFromGain), which is right as long as the
   * caller passes velocityToGain(velocity) times the usual part scale.
   */
  touch?: number
  /**
   * Where to send for chorus and reverb. Omitted: a bus leased on `dest`
   * (wet returns into `dest`, so its level and fades apply). `null`: dry.
   */
  fx?: FxBus | null
}

// --- pure numbers ------------------------------------------------------------------

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))

/** The multipliers accompanist.ts applies on top of velocityToGain for each part. */
export const PAD_GAIN_SCALE = 0.32
export const BASS_GAIN_SCALE = 1.1

/**
 * Touch (0..1) from a part's gain.
 *
 * Inverts velocityToGain (0.08 + 0.92·v²) back to a normalised velocity, then
 * stretches the band's working range: its dynamics live around velocity 12–75,
 * so mapping only the full 0–127 range would leave brightness barely moving.
 * Velocity ~10 → 0, ~75 and up → 1.
 */
export function touchFromGain(gain: number, scale: number): number {
  const g = gain / scale
  const v = Math.sqrt(Math.max(0, g - 0.08) / 0.92)
  return clamp01((v - 0.08) / 0.5)
}

export type SpreadVoice = { cents: number; pan: number; level: number }

/**
 * Detune and pan for an n-voice unison (n odd keeps a voice dead centre).
 *
 * Outer voices are detuned more than inner ones (a 1.6 power curve between
 * `minCents` and `maxCents`), the way the classic supersaw spreads: a dense
 * core that stays in tune with wider, slower-beating edges. Pan follows detune
 * so the beating moves across the field. Side voices sit a little lower than
 * the centre; levels are normalised so the sum of squares is 1 (incoherent
 * oscillators add in power, not amplitude).
 */
export function detuneSpread(n = 7, minCents = 5, maxCents = 24): SpreadVoice[] {
  const half = (n - 1) / 2
  const raw = Array.from({ length: n }, (_, i) => {
    if (half === 0) return { cents: 0, pan: 0, level: 1 }
    const x = (i - half) / half // -1..1
    const mag = Math.abs(x)
    const cents = mag === 0 ? 0 : Math.sign(x) * (minCents + (maxCents - minCents) * mag ** 1.6)
    const pan = Math.sign(x) * 0.85 * mag
    const level = mag === 0 ? 1 : 0.78 - 0.18 * mag
    return { cents, pan, level }
  })
  const norm = 1 / Math.sqrt(raw.reduce((s, v) => s + v.level * v.level, 0))
  return raw.map((v) => ({ ...v, level: v.level * norm }))
}

export type PadEnvelope = {
  attack: number
  release: number
  /** Level reached at the end of the attack, as a fraction of the note's gain. */
  start: number
  /** Duration over which the note swells from `start` to full. */
  swell: number
}

/**
 * Pad envelope: slow in, long out, with a gentle swell through long notes.
 *
 * The attack scales with the note (a third of it, 0.12–0.6 s): a bar at a
 * medium tempo fades in like strings, a short chord still speaks. The release
 * is long (0.8–1.8 s) so chords hand over to each other instead of stopping.
 */
export function padEnvelope(durS: number): PadEnvelope {
  const attack = Math.max(0.12, Math.min(0.6, durS * 0.3))
  const release = Math.max(0.8, Math.min(1.8, 0.6 + durS * 0.25))
  const swell = Math.max(0, durS - attack)
  return { attack, release, start: swell > 0.4 ? 0.82 : 1, swell }
}

export type PadFilter = { from: number; peak: number; open: number }

/**
 * Pad lowpass: where it starts, how far it opens, and how long that takes.
 *
 * Soft playing stays dark (peaks near 750 Hz), loud playing opens to ~3 kHz,
 * so the band's dynamics are heard as colour, not only as level. Mild key
 * tracking keeps high voicings from sounding muffled next to low ones.
 */
export function padFilter(touch: number, midi: number): PadFilter {
  const t = clamp01(touch)
  const track = (midiToFreq(midi) / 261.63) ** 0.3
  const peak = Math.min(4000, (750 + 2300 * t) * track)
  return { from: 260 + 120 * t, peak, open: 1.3 - 0.45 * t }
}

/** Bass brightness: a lowpass that opens a little with touch, never past a warm 900 Hz. */
export function bassCutoff(gain: number): number {
  return Math.min(900, 380 + 700 * gain)
}

export type BassFilter = { peak: number; sustain: number; decay: number }

/**
 * Bass pluck: the lowpass jumps open at the attack and settles within ~0.1 s.
 * Harder notes pluck brighter; even the brightest settles below 900 Hz, so the
 * line stays under the piano instead of in its way.
 */
export function bassFilter(touch: number): BassFilter {
  const t = clamp01(touch)
  return { peak: 480 + 1700 * t, sustain: 260 + 520 * t, decay: 0.07 + 0.05 * t }
}

/**
 * Soft-clip curve for the bass drive: tanh, normalised so ±1 maps to ±1.
 * At drive 1.6 it adds a little odd-harmonic growl that helps the bass read on
 * small speakers, without audible distortion.
 */
export function driveCurve(drive = 1.6, size = 1024): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(size)
  const norm = Math.tanh(drive)
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * 2 - 1
    curve[i] = Math.tanh(drive * x) / norm
  }
  return curve
}

// --- Web Audio ---------------------------------------------------------------------

const PAD_SPREAD = detuneSpread(7, 5, 24)
/** Sub sine an octave down, relative to the unison's combined level. */
const PAD_SUB = 0.22
/** Unison saws are loud; this trims the pad to sit where the old one did. */
const PAD_TRIM = 1.35
const PAD_SEND = { chorus: 0.5, reverb: 0.42 }
const BASS_SEND = { chorus: 0, reverb: 0.05 }

let driveCache: Float32Array<ArrayBuffer> | null = null

function resolveFx(ctx: BaseAudioContext, dest: AudioNode, until: number, opts?: VoiceOptions): FxBus | null {
  if (opts && opts.fx !== undefined) return opts.fx
  return leaseFx(ctx, dest, until)
}

/**
 * Filter sweeps here are slow (a pluck settles over ~0.1 s, the pad opens over
 * ~1 s), so per-128-sample coefficient updates are inaudible, and far cheaper
 * than Chrome's per-sample recomputation once a biquad param is automated or
 * modulated. Older engines without settable automationRate keep a-rate.
 */
function kRate(...params: AudioParam[]): void {
  for (const p of params) {
    try {
      p.automationRate = 'k-rate'
    } catch {
      // not settable here; a-rate still sounds the same, just costs more
    }
  }
}

function send(ctx: BaseAudioContext, from: AudioNode, to: AudioNode, amount: number): void {
  if (amount <= 0) return
  const g = ctx.createGain()
  g.gain.value = amount
  from.connect(g)
  g.connect(to)
}

/**
 * Bass: a saw and a sine at the same pitch, a touch of drive, a plucked
 * lowpass and a tight envelope. The sine is the weight, the saw is the
 * definition the filter lets through for a moment at each attack.
 */
export function scheduleBassTone(
  ctx: BaseAudioContext,
  dest: AudioNode,
  midi: number,
  at: number,
  durS: number,
  gain: number,
  opts?: VoiceOptions,
): void {
  const f = midiToFreq(midi)
  const touch = opts?.touch ?? touchFromGain(gain, BASS_GAIN_SCALE)
  const flt = bassFilter(touch)
  const end = at + Math.max(0.09, durS)
  const release = 0.06
  const stopAt = end + release * 7 // seven time constants: -60 dB, so the stop never clicks

  const shaper = ctx.createWaveShaper()
  shaper.curve = driveCache ??= driveCurve()
  shaper.oversample = '2x'

  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.Q.value = 0.9
  kRate(lp.frequency, lp.detune, lp.Q)
  lp.frequency.setValueAtTime(flt.peak, at)
  lp.frequency.setTargetAtTime(flt.sustain, at + 0.005, flt.decay)

  const env = ctx.createGain()
  shaper.connect(lp)
  lp.connect(env)
  env.connect(dest)

  const level = gain * 0.95
  env.gain.setValueAtTime(0, at)
  env.gain.linearRampToValueAtTime(level, at + 0.005)
  env.gain.setTargetAtTime(level * 0.72, at + 0.01, 0.12)
  env.gain.setTargetAtTime(0, end, release)

  for (const [type, lvl] of [
    ['sine', 0.62],
    ['sawtooth', 0.3],
  ] as const) {
    const osc = ctx.createOscillator()
    osc.type = type
    osc.frequency.value = f
    const g = ctx.createGain()
    g.gain.value = lvl
    osc.connect(g)
    g.connect(shaper)
    osc.start(at)
    osc.stop(stopAt)
  }

  const fx = resolveFx(ctx, dest, stopAt, opts)
  if (fx) {
    send(ctx, env, fx.reverb, BASS_SEND.reverb)
    send(ctx, env, fx.chorus, BASS_SEND.chorus)
  }
}

type PadChord = { left: AudioNode; right: AudioNode; centre: AudioNode; sub: AudioNode }
type PadEntry = { key: string; fx: FxBus | null; chord: PadChord }
/** The chord currently being scheduled into each destination. */
const padChords = new WeakMap<AudioNode, PadEntry>()

// Relative levels from the spread, folded into the shared chain: every side saw
// enters its panner at unit level, so the centre saw and the sub are scaled
// against the side average. A mono input reaches both channels at full level,
// while a panned one splits its power, hence the 1/√2.
const SIDE_LEVEL = (() => {
  const sides = PAD_SPREAD.filter((v) => v.cents !== 0)
  return sides.reduce((s, v) => s + v.level, 0) / sides.length
})()
const CENTRE_LEVEL = PAD_SPREAD.find((v) => v.cents === 0)?.level ?? SIDE_LEVEL

/**
 * The part of a pad chord its notes share: two panned buses and a centre bus
 * into one lowpass (with its envelope and LFO), one highpass, one amp envelope
 * and one pair of sends. Only the oscillators are per note. The band schedules
 * a chord as one call per note with the same start, length and gain, so those
 * calls land on one chain: five notes cost five sets of oscillators and one set
 * of everything else.
 */
function padChord(
  ctx: BaseAudioContext,
  dest: AudioNode,
  midi: number,
  at: number,
  durS: number,
  gain: number,
  touch: number,
  opts: VoiceOptions | undefined,
): PadChord {
  const env = padEnvelope(durS)
  const hold = at + Math.max(env.attack, durS)
  const stopAt = hold + env.release * 1.6
  const fx = resolveFx(ctx, dest, stopAt, opts)
  const key = `${at}|${durS}|${gain}|${touch}`
  const prev = padChords.get(dest)
  if (prev && prev.key === key && prev.fx === fx) return prev.chord

  const flt = padFilter(touch, midi)
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.Q.value = 0.6
  kRate(lp.frequency, lp.detune, lp.Q)
  lp.frequency.setValueAtTime(flt.from, at)
  lp.frequency.exponentialRampToValueAtTime(flt.peak, at + flt.open)
  if (hold > at + flt.open + 0.2) {
    // Keep opening a little through a long note: part of the swell.
    lp.frequency.linearRampToValueAtTime(Math.min(4500, flt.peak * 1.2), hold)
  }
  lp.frequency.setTargetAtTime(flt.from * 1.5, hold, env.release / 3)

  // A slow cutoff drift, ±110 cents, at a rate that differs from chord to chord.
  const lfo = ctx.createOscillator()
  lfo.type = 'sine'
  lfo.frequency.value = 0.13 + ((at * 7.31) % 1) * 0.17
  const lfoDepth = ctx.createGain()
  lfoDepth.gain.value = 110
  lfo.connect(lfoDepth)
  lfoDepth.connect(lp.detune)
  lfo.start(at)
  lfo.stop(stopAt)

  const hp = ctx.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 130
  hp.Q.value = 0.55

  const amp = ctx.createGain()
  lp.connect(hp)
  hp.connect(amp)
  amp.connect(dest)

  const level = gain * PAD_TRIM * SIDE_LEVEL
  amp.gain.setValueAtTime(0, at)
  // Two-segment fade in: a single linear ramp over a slow attack sounds late to start.
  amp.gain.linearRampToValueAtTime(level * env.start * 0.55, at + env.attack * 0.35)
  amp.gain.linearRampToValueAtTime(level * env.start, at + env.attack)
  if (env.start < 1) amp.gain.linearRampToValueAtTime(level, hold)
  amp.gain.setTargetAtTime(0, hold, env.release / 4)

  const panned = (pan: number) => {
    const p = ctx.createStereoPanner()
    p.pan.value = pan
    p.connect(lp)
    return p
  }
  const scaled = (g: number) => {
    const n = ctx.createGain()
    n.gain.value = g
    n.connect(lp)
    return n
  }
  const chord: PadChord = {
    left: panned(-0.6),
    right: panned(0.6),
    centre: scaled(CENTRE_LEVEL / SIDE_LEVEL / Math.SQRT2),
    sub: scaled(PAD_SUB / SIDE_LEVEL / Math.SQRT2),
  }

  if (fx) {
    send(ctx, amp, fx.chorus, PAD_SEND.chorus)
    send(ctx, amp, fx.reverb, PAD_SEND.reverb)
  }
  padChords.set(dest, { key, fx, chord })
  return chord
}

/**
 * Pad: seven detuned saws spread across the stereo field and a sine an octave
 * down, through a lowpass that opens over about a second, a highpass that
 * leaves the low end to the bass, and a slow envelope that swells through long
 * notes. A slow LFO on the cutoff keeps a held chord breathing.
 *
 * Notes sharing `at`, `durS` and `gain` share one filter/envelope chain (see
 * padChord); the lowpass's mild key tracking follows the first of them.
 */
export function schedulePadTone(
  ctx: BaseAudioContext,
  dest: AudioNode,
  midi: number,
  at: number,
  durS: number,
  gain: number,
  opts?: VoiceOptions,
): void {
  const f = midiToFreq(midi)
  const touch = opts?.touch ?? touchFromGain(gain, PAD_GAIN_SCALE)
  const env = padEnvelope(durS)
  const stopAt = at + Math.max(env.attack, durS) + env.release * 1.6
  const chord = padChord(ctx, dest, midi, at, durS, gain, touch, opts)

  // Phase offsets: start each saw a fraction of a period apart, so the unison
  // does not open with all saws aligned (that sounds like a flanger sweep).
  // At most one period (under 10 ms), so nothing like a strum; the attack hides it.
  const period = 1 / f
  PAD_SPREAD.forEach((v, i) => {
    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.value = f
    osc.detune.value = v.cents
    osc.connect(v.cents < 0 ? chord.left : v.cents > 0 ? chord.right : chord.centre)
    osc.start(at + ((i * 0.381966) % 1) * period)
    osc.stop(stopAt)
  })

  const sub = ctx.createOscillator()
  sub.type = 'sine'
  sub.frequency.value = f / 2
  sub.connect(chord.sub)
  sub.start(at)
  sub.stop(stopAt)
}
