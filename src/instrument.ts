// The app's own voice: it sounds the notes YOU play.
//
// The point is not to replace a real synth — it is to make the app usable on its
// own, without opening a DAW first. Two voices are synthesized: nothing is
// downloaded, so they work offline and add no load time. The sampled ones
// (grand, electric pianos: sound/sampled.ts) download on first choice and play
// the synth piano until they are ready.
//
// The parameter maths lives in pure functions at the top, tested without a
// browser. Only the node wiring below needs an AudioContext.

import { getAudioContext, getFxBus, getMasterBus, resumeAudio } from './audio'
import { subscribeRaw } from './midi'
import { KEYS_HELP, KEYS_LABEL, KEYS_TIMBRES, SampledInstrument, isKeysTimbre, type KeysTimbre } from './sound/sampled'

/** 'piano' is the synthesized one; the sampled timbres are KeysTimbre (sound/sampled.ts). */
export type Voice = 'off' | 'lead' | 'piano' | KeysTimbre

export const VOICE_LABEL: Record<Voice, string> = {
  off: 'off (external)',
  lead: 'lead synth',
  piano: 'synth piano',
  ...KEYS_LABEL,
}

export const VOICE_HELP: Record<Voice, string> = {
  off: 'The app stays silent — the sound comes from your own synth or module.',
  lead: 'Warm sustained lead. Holds while the key is down, so lines join up.',
  piano: 'Struck and decaying, with the damper on the sustain pedal. Nothing to download.',
  ...KEYS_HELP,
}

/** Every voice, in menu order. */
export const VOICES: Voice[] = ['off', 'lead', 'piano', ...KEYS_TIMBRES]

const A4_MIDI = 69
const SUSTAIN_CC = 64
const PEDAL_THRESHOLD = 64
/** Above this, voice stealing starts. A ten-finger chord under pedal fits easily. */
const MAX_VOICES = 24

export function midiToFreq(midi: number): number {
  return 440 * 2 ** ((midi - A4_MIDI) / 12)
}

/**
 * MIDI velocity to amplitude. Squared rather than linear: the ear hears loudness
 * roughly logarithmically, and a linear map makes every note feel equally hard.
 * The floor keeps a feather-light touch audible instead of silent.
 */
export function velocityToGain(velocity: number): number {
  const v = Math.max(0, Math.min(127, velocity)) / 127
  return 0.08 + 0.92 * v * v
}

/**
 * Lead filter cutoff, in Hz.
 *
 * Tracks pitch so low notes stay dark and high notes open up — but the cap is the
 * point of this function. Unclamped tracking is exactly what makes a synth
 * shrill in the top octaves, which is the one thing this voice must not be, since
 * it plays under an exercise for half an hour at a time.
 */
export function leadCutoff(midi: number): number {
  const tracked = midiToFreq(midi) * 3.2 + 200
  return Math.max(320, Math.min(2600, tracked))
}

/**
 * How long a piano note rings, in seconds, before the damper touches it.
 *
 * Real pianos ring far longer in the bass than in the treble — a bottom A holds
 * for many seconds while the top octave is nearly a click. A single decay time
 * for the whole range is the giveaway of a fake piano.
 */
export function pianoDecay(midi: number): number {
  return Math.max(0.7, Math.min(12, 12 * Math.exp(-(midi - 21) / 32)))
}

/**
 * Frequency of partial `n` (1-based) over a fundamental.
 *
 * Piano strings are stiff, so their partials sit progressively sharp of the exact
 * harmonic series. That slight stretch is a good part of why a piano sounds like
 * a struck string and an organ does not.
 */
export function partialFreq(fundamental: number, n: number, inharmonicity = 0.0004): number {
  // Normalized on the first partial. Applying the stretch raw would put partial 1
  // — the pitch you actually hear — sharp of the note that was played, on every
  // note. Only the spacing between partials is meant to stretch.
  const stretch = Math.sqrt(1 + inharmonicity * n * n) / Math.sqrt(1 + inharmonicity)
  return fundamental * n * stretch
}

/** Amplitude of partial `n`, and how much faster than the fundamental it dies. */
export function partialShape(n: number): { gain: number; decayScale: number } {
  return { gain: 1 / (n * n * 0.85 + 0.15), decayScale: 1 / (1 + 0.42 * (n - 1)) }
}

const PIANO_PARTIALS = 6

/**
 * Schedules one piano tone at a fixed instant, for a fixed length.
 *
 * Same synthesis the played voice uses, minus the note-off bookkeeping: the
 * transport's guide knows up front how long each note lasts. Sharing it means the
 * exercise being demonstrated and the exercise being played sound like the same
 * instrument, instead of a synth answering a different synth.
 */
export function schedulePianoTone(
  ctx: AudioContext,
  dest: AudioNode,
  midi: number,
  at: number,
  durS: number,
  gain: number,
): void {
  const freq = midiToFreq(midi)
  // Held to the shorter of the string's natural ring and the slot it was given.
  const decay = Math.min(pianoDecay(midi), durS)

  const env = ctx.createGain()
  env.gain.value = gain
  env.connect(dest)

  const tone = ctx.createBiquadFilter()
  tone.type = 'lowpass'
  tone.frequency.value = Math.min(9000, 900 + 7000 * gain * 4)
  tone.Q.value = 0.4
  tone.connect(env)

  for (let n = 1; n <= PIANO_PARTIALS; n++) {
    const f = partialFreq(freq, n)
    if (f > 16000) break
    const { gain: pGain, decayScale } = partialShape(n)
    const life = decay * decayScale
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = f
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, at)
    g.gain.exponentialRampToValueAtTime(pGain, at + 0.003)
    g.gain.exponentialRampToValueAtTime(0.0001, at + life)
    osc.connect(g)
    g.connect(tone)
    osc.start(at)
    osc.stop(at + life + 0.05)
  }
}

/** Reverb send for the sampled keys: a room around them, not a hall. */
const SAMPLED_REVERB = 0.16

type Held = {
  midi: number
  /** Called to release the voice; returns when its tail is scheduled to end. */
  release: (at: number) => void
  stop: () => void
  started: number
}

/** Runs `fn` now if the page has had a user gesture, else on the first one. */
function afterGesture(fn: () => void): void {
  if (typeof window === 'undefined') return
  if (navigator.userActivation?.hasBeenActive ?? true) {
    fn()
    return
  }
  const once = () => {
    window.removeEventListener('pointerdown', once, true)
    window.removeEventListener('keydown', once, true)
    fn()
  }
  window.addEventListener('pointerdown', once, true)
  window.addEventListener('keydown', once, true)
}

class Instrument {
  private voice: Voice = 'lead'
  private level = 0.75
  private bus: GainNode | null = null
  private held = new Map<number, Held>()
  /** Released under pedal: still ringing, damped when the pedal lifts. */
  private sustained = new Set<number>()
  private pedal = false
  private unsubscribe: (() => void) | null = null
  /** One per sampled timbre, kept once made: switching back is instant. */
  private sampled = new Map<KeysTimbre, SampledInstrument>()
  private sampledIn: GainNode | null = null

  setVoice(v: Voice): void {
    if (v === this.voice) return
    this.voice = v
    if (v === 'off') this.allOff()
    // Start downloading now, not on the first note: by the time you play, it is
    // there. Before any gesture, wait for one: making the AudioContext earlier
    // only earns a console warning, since the browser keeps it suspended anyway.
    if (isKeysTimbre(v)) afterGesture(() => this.voice === v && this.sampledFor(v))
  }

  getVoice(): Voice {
    return this.voice
  }

  setLevel(v: number): void {
    this.level = Math.max(0, Math.min(1, v))
    if (this.bus) this.bus.gain.value = this.level
  }

  /** Starts listening to the keyboard. Safe to call more than once. */
  connect(): void {
    if (this.unsubscribe) return
    this.unsubscribe = subscribeRaw((data) => this.handle(data))
  }

  /**
   * Sounds a note that did not come from the MIDI port — the computer-keyboard
   * fallback. Without this, the one input that needs no hardware would be the one
   * that makes no sound.
   */
  play(kind: 'on' | 'off', midi: number, velocity = 80): void {
    if (this.voice === 'off') return
    if (kind === 'on') {
      void resumeAudio()
      this.noteOn(midi, velocity)
    } else {
      this.noteOff(midi)
    }
  }

  disconnect(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    this.allOff()
  }

  private ensureBus(): GainNode {
    if (!this.bus) {
      const ctx = getAudioContext()
      this.bus = ctx.createGain()
      this.bus.gain.value = this.level
      this.bus.connect(getMasterBus())
    }
    return this.bus
  }

  /**
   * The sampled instrument for a timbre, made on first use. Its input carries
   * a small reverb send; the synth voices stay dry, as they always were.
   */
  private sampledFor(t: KeysTimbre): SampledInstrument {
    let s = this.sampled.get(t)
    if (!s) {
      const ctx = getAudioContext()
      if (!this.sampledIn) {
        this.sampledIn = ctx.createGain()
        this.sampledIn.connect(this.ensureBus())
        const send = ctx.createGain()
        send.gain.value = SAMPLED_REVERB
        this.sampledIn.connect(send)
        send.connect(getFxBus().reverb)
      }
      s = new SampledInstrument(ctx, t, this.sampledIn)
      this.sampled.set(t, s)
    }
    return s
  }

  private handle(data: ArrayLike<number>): void {
    if (this.voice === 'off') return
    const command = data[0] & 0xf0

    if (command === 0x90 && data[2] > 0) {
      void resumeAudio()
      this.noteOn(data[1], data[2])
      return
    }
    if (command === 0x80 || (command === 0x90 && data[2] === 0)) {
      this.noteOff(data[1])
      return
    }
    if (command === 0xb0 && data[1] === SUSTAIN_CC) {
      this.setPedal(data[2] >= PEDAL_THRESHOLD)
      return
    }
    // All sound off / all notes off.
    if (command === 0xb0 && (data[1] === 120 || data[1] === 123)) this.allOff()
  }

  private setPedal(down: boolean): void {
    if (down === this.pedal) return
    this.pedal = down
    if (down) return
    // Lifting the damper bar: everything not under a finger stops.
    const ctx = getAudioContext()
    for (const midi of this.sustained) this.held.get(midi)?.release(ctx.currentTime)
    for (const midi of this.sustained) this.held.delete(midi)
    this.sustained.clear()
  }

  private noteOn(midi: number, velocity: number): void {
    const ctx = getAudioContext()
    // Re-striking a ringing note: damp the old one first, or the two stack up and
    // a repeated note gets louder every time.
    this.held.get(midi)?.stop()
    this.held.delete(midi)
    this.sustained.delete(midi)

    if (this.held.size >= MAX_VOICES) this.stealOldest()

    const at = ctx.currentTime
    const gain = velocityToGain(velocity)
    let voice: Held
    if (isKeysTimbre(this.voice)) {
      const s = this.sampledFor(this.voice)
      // Still downloading: the synth piano covers, so the first notes are never silent.
      voice = s.playable ? this.buildSampled(s, midi, velocity, at) : this.buildPiano(midi, gain, at)
    } else {
      voice = this.voice === 'piano' ? this.buildPiano(midi, gain, at) : this.buildLead(midi, gain, at)
    }
    this.held.set(midi, voice)
  }

  private noteOff(midi: number): void {
    const v = this.held.get(midi)
    if (!v) return
    if (this.pedal) {
      this.sustained.add(midi) // keeps ringing; the pedal owns it now
      return
    }
    v.release(getAudioContext().currentTime)
    this.held.delete(midi)
  }

  private stealOldest(): void {
    let oldest: Held | null = null
    for (const v of this.held.values()) {
      if (!oldest || v.started < oldest.started) oldest = v
    }
    if (!oldest) return
    oldest.release(getAudioContext().currentTime)
    this.held.delete(oldest.midi)
    this.sustained.delete(oldest.midi)
  }

  private allOff(): void {
    const ctx = this.bus ? getAudioContext() : null
    for (const v of this.held.values()) {
      if (ctx) v.release(ctx.currentTime)
      else v.stop()
    }
    this.held.clear()
    this.sustained.clear()
  }

  /**
   * A sampled note, struck now — no lookahead: smplr starts anything due within
   * its window on the spot. Velocity goes in raw: the samples have their own
   * layers and smplr its own curve, and both need the real number to work.
   * Release is the sample's own (the damper), whether a finger or the pedal
   * lets go: the pedal logic above stays exactly as it is for the synth.
   */
  private buildSampled(s: SampledInstrument, midi: number, velocity: number, at: number): Held {
    const release = s.start({ note: midi, velocity, time: at })
    return {
      midi,
      started: at,
      release: (t) => release(t),
      stop: () => release(getAudioContext().currentTime),
    }
  }

  /**
   * Warm sustained lead: two detuned saws over a sub sine, through a lowpass
   * that never opens past leadCutoff(). The detune is what keeps a held note
   * from sounding dead — two saws a few cents apart drift in and out of phase.
   */
  private buildLead(midi: number, gain: number, at: number): Held {
    const ctx = getAudioContext()
    const freq = midiToFreq(midi)
    const cutoff = leadCutoff(midi)

    const env = ctx.createGain()
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    // Low Q on purpose: resonance here would put a whistle on top of exactly the
    // notes that are already the most tiring to listen to.
    filter.Q.value = 0.8
    filter.connect(env)
    env.connect(this.ensureBus())

    const oscs: OscillatorNode[] = []
    const addOsc = (type: OscillatorType, f: number, detune: number, level: number) => {
      const osc = ctx.createOscillator()
      osc.type = type
      osc.frequency.value = f
      osc.detune.value = detune
      const g = ctx.createGain()
      g.gain.value = level
      osc.connect(g)
      g.connect(filter)
      osc.start(at)
      oscs.push(osc)
    }
    addOsc('sawtooth', freq, -7, 0.5)
    addOsc('sawtooth', freq, 7, 0.5)
    addOsc('sine', freq / 2, 0, 0.42) // sub: body without brightness

    // A touch of filter movement on the attack reads as articulation. Small,
    // because a big sweep on every note becomes seasick over a long session.
    filter.frequency.setValueAtTime(cutoff * 1.7, at)
    filter.frequency.exponentialRampToValueAtTime(cutoff, at + 0.16)

    const peak = gain * 0.5
    env.gain.setValueAtTime(0.0001, at)
    env.gain.exponentialRampToValueAtTime(peak, at + 0.012)
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * 0.72), at + 0.15)

    let stopped = false
    const stopAll = (when: number) => {
      if (stopped) return
      stopped = true
      for (const osc of oscs) osc.stop(when)
    }

    return {
      midi,
      started: at,
      release: (t) => {
        const end = t + 0.22
        env.gain.cancelScheduledValues(t)
        env.gain.setValueAtTime(Math.max(0.0002, env.gain.value), t)
        env.gain.exponentialRampToValueAtTime(0.0001, end)
        stopAll(end + 0.03)
      },
      stop: () => {
        const t = ctx.currentTime
        env.gain.cancelScheduledValues(t)
        env.gain.setValueAtTime(0.0001, t)
        stopAll(t + 0.02)
      },
    }
  }

  /**
   * Struck string: stacked partials, each with its own decay.
   *
   * The separate decay per partial is the whole trick. One oscillator with a
   * fixed timbre decaying as a block sounds like an organ with a volume pedal;
   * a piano loses its top partials within a moment and rings on in the
   * fundamental, and that difference is most of what the ear recognizes.
   */
  private buildPiano(midi: number, gain: number, at: number): Held {
    const ctx = getAudioContext()
    const freq = midiToFreq(midi)
    const decay = pianoDecay(midi)

    const env = ctx.createGain()
    env.gain.value = gain * 0.42
    env.connect(this.ensureBus())

    // Harder strikes are brighter, not just louder — that is the difference
    // between a piano and a recording with the volume turned up.
    const tone = ctx.createBiquadFilter()
    tone.type = 'lowpass'
    tone.frequency.value = Math.min(9000, 900 + 7000 * gain)
    tone.Q.value = 0.4
    tone.connect(env)

    const oscs: OscillatorNode[] = []
    let longest = 0
    for (let n = 1; n <= PIANO_PARTIALS; n++) {
      const f = partialFreq(freq, n)
      if (f > 16000) break // past hearing; just wasted oscillators
      const { gain: pGain, decayScale } = partialShape(n)
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = f

      const g = ctx.createGain()
      const life = decay * decayScale
      longest = Math.max(longest, life)
      g.gain.setValueAtTime(0.0001, at)
      g.gain.exponentialRampToValueAtTime(pGain, at + 0.003)
      g.gain.exponentialRampToValueAtTime(0.0001, at + life)

      osc.connect(g)
      g.connect(tone)
      osc.start(at)
      osc.stop(at + life + 0.05)
      oscs.push(osc)
    }

    this.hammer(tone, at, gain)

    let stopped = false
    const stopAll = (when: number) => {
      if (stopped) return
      stopped = true
      for (const osc of oscs) {
        try {
          osc.stop(when)
        } catch {
          // Already stopped by its own scheduled end — nothing to do.
        }
      }
    }

    return {
      midi,
      started: at,
      release: (t) => {
        // The damper felt does not cut instantly, and bass strings keep more
        // energy for it to absorb, so they take longer to quieten.
        const damp = midi < 48 ? 0.34 : 0.16
        const end = t + damp
        env.gain.cancelScheduledValues(t)
        env.gain.setValueAtTime(Math.max(0.0002, env.gain.value), t)
        env.gain.exponentialRampToValueAtTime(0.0001, end)
        stopAll(end + 0.03)
      },
      stop: () => {
        const t = ctx.currentTime
        env.gain.cancelScheduledValues(t)
        env.gain.setValueAtTime(0.0001, t)
        stopAll(t + 0.02)
      },
    }
  }

  /** Short noise burst: the felt hitting the string, before any pitch. */
  private hammer(target: AudioNode, at: number, gain: number): void {
    const ctx = getAudioContext()
    const frames = Math.floor(ctx.sampleRate * 0.02)
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate)
    const chan = buffer.getChannelData(0)
    for (let i = 0; i < frames; i++) {
      chan[i] = (Math.random() * 2 - 1) * (1 - i / frames)
    }
    const src = ctx.createBufferSource()
    src.buffer = buffer

    const hp = ctx.createBiquadFilter()
    hp.type = 'bandpass'
    hp.frequency.value = 2400
    hp.Q.value = 0.7

    const g = ctx.createGain()
    g.gain.setValueAtTime(gain * 0.06, at)
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.02)

    src.connect(hp)
    hp.connect(g)
    g.connect(target)
    src.start(at)
    src.stop(at + 0.03)
  }
}

export const instrument = new Instrument()

// --- persisted choice ------------------------------------------------------

const KEY = 'pjt:sound'

export type SoundSettings = { voice: Voice; level: number }
/** Lead by default: the app should make a usable sound before anything is set up. */
export const DEFAULT_SOUND: SoundSettings = { voice: 'lead', level: 0.75 }

export function loadSound(): SoundSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<SoundSettings>
    return {
      voice: VOICES.includes(raw.voice as Voice) ? (raw.voice as Voice) : DEFAULT_SOUND.voice,
      level:
        typeof raw.level === 'number' && raw.level >= 0 && raw.level <= 1
          ? raw.level
          : DEFAULT_SOUND.level,
    }
  } catch {
    return { ...DEFAULT_SOUND } // corrupt storage must not take the app down
  }
}

export function saveSound(s: SoundSettings): SoundSettings {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // Private mode with storage blocked: the setting just does not persist.
  }
  return s
}
