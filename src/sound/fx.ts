// The room the band plays in: a stereo chorus and a reverb, fed by send gains.
//
// Voices stay dry and send a copy of themselves here, the way a mixing desk
// works: the pad sends a lot (that is most of what makes it a pad), the bass
// barely anything (reverb on a bass line is mud). Both effects are wet-only and
// return into whatever `out` they were built on, so the level and the fades
// downstream of `out` apply to the tails as well as to the dry sound.
//
// No samples ship with the app, so the reverb's impulse response is generated:
// stereo noise under an exponential decay, darkened as it decays the way a real
// room loses its highs first. As elsewhere, the numbers are pure functions up
// top and the Web Audio wiring sits below them.

/** Small deterministic PRNG (mulberry32): the same room on every load, and testable. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type ImpulseOptions = {
  /** Time for the tail to fall 60 dB (RT60), in seconds. */
  seconds?: number
  /** Silence before the first reflection: separates the dry note from its room. */
  predelay?: number
  /** Lowpass cutoff at the start and at the end of the tail, in Hz. */
  brightHz?: number
  darkHz?: number
  seed?: number
}

export const IMPULSE_DEFAULTS: Required<ImpulseOptions> = {
  seconds: 2.8,
  predelay: 0.018,
  brightHz: 7500,
  darkHz: 1400,
  seed: 0x1f2e3d4c,
}

/**
 * A stereo reverb impulse response.
 *
 * Independent noise per channel (that decorrelation is the stereo width), an
 * exponential decay reaching -60 dB at `seconds`, and a two-pole lowpass whose
 * cutoff slides from `brightHz` down to `darkHz` so the tail darkens instead of
 * fizzing. Each channel is normalised to unit energy, so a sustained input comes
 * back at about its own level and the send gain alone decides how wet it is.
 */
export function makeImpulse(sampleRate: number, opts: ImpulseOptions = {}): [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] {
  const o = { ...IMPULSE_DEFAULTS, ...opts }
  const pre = Math.round(o.predelay * sampleRate)
  const body = Math.max(1, Math.round(o.seconds * sampleRate))
  const len = pre + body
  const k = Math.log(1000) / o.seconds // amplitude falls 60 dB (x1000) over `seconds`
  const fade = Math.max(1, Math.round(0.004 * sampleRate))
  const out: [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] = [new Float32Array(len), new Float32Array(len)]
  const rand = rng(o.seed)

  for (const ch of out) {
    let lp1 = 0
    let lp = 0
    let dcIn = 0
    let dcOut = 0
    let energy = 0
    for (let i = 0; i < body; i++) {
      const t = i / sampleRate
      const frac = i / body
      const cutoff = o.brightHz * (o.darkHz / o.brightHz) ** frac
      const a = 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate)
      // Two cascaded one-poles: 12 dB/octave, steep enough that the tail never fizzes.
      lp1 += a * (rand() * 2 - 1 - lp1)
      lp += a * (lp1 - lp)
      // DC blocker: a lowpassed noise burst can wander off zero at the start.
      dcOut = lp - dcIn + 0.9995 * dcOut
      dcIn = lp
      const v = dcOut * Math.exp(-k * t) * Math.min(1, (i + 1) / fade)
      ch[pre + i] = v
      energy += v * v
    }
    const norm = energy > 0 ? 1 / Math.sqrt(energy) : 0
    for (let i = pre; i < len; i++) ch[i] *= norm
  }
  return out
}

/** RMS of a slice, for tests and for the offline checks. */
export function rms(x: Float32Array, from = 0, to = x.length): number {
  let s = 0
  for (let i = from; i < to; i++) s += x[i] * x[i]
  return to > from ? Math.sqrt(s / (to - from)) : 0
}

export type ChorusShape = { baseDelay: number; depth: number; rate: number }

/**
 * Chorus timing: 20 ms delay lines swept ±2.2 ms at 0.3 Hz. The peak pitch
 * deviation of a swept delay is 2π·rate·depth, here about 0.4 % (7 cents): a
 * gentle shimmer, well short of the seasick wobble of a deep chorus.
 */
export const CHORUS: ChorusShape = { baseDelay: 0.02, depth: 0.0022, rate: 0.3 }

export function chorusCents(shape: ChorusShape = CHORUS): number {
  const ratio = 1 + 2 * Math.PI * shape.rate * shape.depth
  return 1200 * Math.log2(ratio)
}

// --- wiring ---------------------------------------------------------------------

export type FxBus = {
  /** Send into the stereo chorus. */
  chorus: GainNode
  /** Send into the reverb. */
  reverb: GainNode
  /** Where both returns are summed before `out`; its gain is the overall wet level. */
  output: GainNode
  /** Stops the chorus LFO and unplugs everything. Safe to call twice. */
  dispose(): void
}

const impulses = new WeakMap<BaseAudioContext, AudioBuffer>()

/** The generated room, built once per context (it is ~0.3 MB of samples). */
export function impulseFor(ctx: BaseAudioContext): AudioBuffer {
  let buf = impulses.get(ctx)
  if (!buf) {
    const [l, r] = makeImpulse(ctx.sampleRate)
    buf = ctx.createBuffer(2, l.length, ctx.sampleRate)
    buf.copyToChannel(l, 0)
    buf.copyToChannel(r, 1)
    impulses.set(ctx, buf)
  }
  return buf
}

/**
 * Builds a chorus and a reverb that return into `out`.
 *
 * Chorus: the send is summed to mono, then two 20 ms delay lines are swept by
 * the same 0.3 Hz sine in opposite phase and panned hard left and right, so one
 * side runs sharp while the other runs flat. Reverb: a highpass at 200 Hz first
 * (low end in a reverb is what makes a mix muddy), then the convolver.
 */
export function createFxBus(ctx: BaseAudioContext, out: AudioNode): FxBus {
  const output = ctx.createGain()
  output.gain.value = 1
  output.connect(out)

  // Chorus.
  const chorus = ctx.createGain()
  chorus.gain.value = 1
  chorus.channelCount = 1
  chorus.channelCountMode = 'explicit'
  chorus.channelInterpretation = 'speakers'
  const merger = ctx.createChannelMerger(2)
  const lfo = ctx.createOscillator()
  lfo.type = 'sine'
  lfo.frequency.value = CHORUS.rate
  const lines: DelayNode[] = []
  for (const [side, sign] of [
    [0, 1],
    [1, -1],
  ] as const) {
    const d = ctx.createDelay(0.05)
    d.delayTime.value = CHORUS.baseDelay
    const depth = ctx.createGain()
    depth.gain.value = CHORUS.depth * sign
    lfo.connect(depth)
    depth.connect(d.delayTime)
    chorus.connect(d)
    d.connect(merger, 0, side)
    lines.push(d)
  }
  const chorusReturn = ctx.createGain()
  chorusReturn.gain.value = 0.8
  merger.connect(chorusReturn)
  chorusReturn.connect(output)
  lfo.start()

  // Reverb.
  const reverb = ctx.createGain()
  reverb.gain.value = 1
  const hp = ctx.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 200
  hp.Q.value = 0.5
  const conv = ctx.createConvolver()
  conv.normalize = false
  conv.buffer = impulseFor(ctx)
  const reverbReturn = ctx.createGain()
  reverbReturn.gain.value = 1
  reverb.connect(hp)
  hp.connect(conv)
  conv.connect(reverbReturn)
  reverbReturn.connect(output)
  // A little chorus into the reverb too, so the shimmer lives in the room as well.
  const chorusToVerb = ctx.createGain()
  chorusToVerb.gain.value = 0.25
  chorusReturn.connect(chorusToVerb)
  chorusToVerb.connect(reverb)

  let alive = true
  return {
    chorus,
    reverb,
    output,
    dispose() {
      if (!alive) return
      alive = false
      try {
        lfo.stop()
      } catch {
        // never started or already stopped
      }
      for (const n of [chorus, merger, lfo, chorusReturn, chorusToVerb, reverb, hp, conv, reverbReturn, output, ...lines]) {
        n.disconnect()
      }
    },
  }
}

// --- leased buses ------------------------------------------------------------------

/** Silence after the last note before a leased bus is torn down: the reverb tail plus margin. */
export const LEASE_TAIL_S = IMPULSE_DEFAULTS.seconds + 2

type Lease = { bus: FxBus; until: number; timer: ReturnType<typeof setTimeout> | null }
const leases = new WeakMap<BaseAudioContext, WeakMap<AudioNode, Lease>>()

/**
 * An FX bus that returns into `dest`, kept alive only while something plays.
 *
 * Voices call this with the time their last sound ends. The bus is shared by
 * everything scheduled into the same `dest`, and torn down (LFO stopped, nodes
 * unplugged) once `dest` has been quiet for `LEASE_TAIL_S`. That lets a voice
 * get reverb with no wiring at its call site while still honouring whatever
 * fades and levels sit after `dest`, and it never leaks a running LFO when the
 * caller throws `dest` away.
 */
export function leaseFx(ctx: BaseAudioContext, dest: AudioNode, until: number): FxBus {
  let perCtx = leases.get(ctx)
  if (!perCtx) {
    perCtx = new WeakMap()
    leases.set(ctx, perCtx)
  }
  let lease = perCtx.get(dest)
  if (!lease) {
    lease = { bus: createFxBus(ctx, dest), until, timer: null }
    perCtx.set(dest, lease)
  }
  lease.until = Math.max(lease.until, until)
  // Offline renders never need reaping: the whole graph goes when the render does.
  const offline = 'startRendering' in ctx
  if (!offline && !lease.timer) {
    const l = lease
    const map = perCtx
    const check = () => {
      l.timer = null
      if (ctx.state === 'closed' || ctx.currentTime > l.until + LEASE_TAIL_S) {
        l.bus.dispose()
        if (map.get(dest) === l) map.delete(dest)
        return
      }
      l.timer = setTimeout(check, 2000)
    }
    l.timer = setTimeout(check, 2000)
  }
  return lease.bus
}
