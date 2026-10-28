// Metronome and transport.
//
// setTimeout/setInterval have tens of ms of jitter — unacceptable for a click
// someone is going to use as a time reference. The pattern here is the classic
// "A Tale of Two Clocks": a coarse timer (25ms) only looks ahead and SCHEDULES
// the clicks on the audio clock, which is precise. Nothing sounds at the moment
// the timer fires.

import { getAudioContext, getMasterBus } from '../audio'
import { schedulePianoTone } from '../instrument'

const LOOKAHEAD_MS = 25
const SCHEDULE_AHEAD_S = 0.1

export type StartOpts = {
  bpm: number
  beatsPerBar: number
  /** Count-in bars before beat 0. */
  countInBars: number
  /** Clicks per beat beyond the downbeat (1 = the beat only). */
  clicksPerBeat?: number
  /** false = schedule beats without sounding the metronome (the accompaniment's own clock). */
  clicks?: boolean
  /** Audio-clock time of the first beat, to land on a beat predicted from your playing. */
  startAt?: number
}

export type Beat = {
  /** 0 = first beat of the exercise. Negative = count-in. */
  index: number
  audioTime: number
  /** The same instant in the performance.now() epoch. This is what grading uses. */
  perfTime: number
  bar: number
  beatInBar: number
}

type Mark = { index: number; audio: number }

export class Transport {
  private ctx: AudioContext | null = null
  /** Click-only gain: the metronome can come down without touching the piano. */
  private clickGain: GainNode | null = null
  private volume = 0.8
  private timer: ReturnType<typeof setInterval> | null = null
  private nextAudio = 0
  private nextIndex = 0
  private bpm = 120
  private beatsPerBar = 4
  private clicksPerBeat = 1
  private clicks = true
  /** Bridge between the audio clock and the performance clock, in ms. */
  private offsetMs = 0
  /** Last scheduled beats, for interpolating the current position. */
  private marks: Mark[] = []

  /** Fires when a beat is SCHEDULED — that is, with perfTime in the future. */
  onBeat: ((b: Beat) => void) | null = null

  get running(): boolean {
    return this.timer !== null
  }

  get currentBpm(): number {
    return this.bpm
  }

  /** Must be called inside a user gesture: the browser demands it. */
  async start(opts: StartOpts): Promise<void> {
    this.stop()
    const ctx = this.ensureCtx()
    if (ctx.state === 'suspended') await ctx.resume()

    this.bpm = opts.bpm
    this.beatsPerBar = opts.beatsPerBar
    this.clicksPerBeat = opts.clicksPerBeat ?? 1
    this.clicks = opts.clicks ?? true
    this.syncOffset()

    this.nextIndex = -opts.countInBars * opts.beatsPerBar
    // Headroom for the first scheduling pass; a start in the past would bunch beats up.
    this.nextAudio = Math.max(ctx.currentTime + 0.05, opts.startAt ?? ctx.currentTime + 0.15)
    this.marks = []

    this.tick()
    this.timer = setInterval(() => this.tick(), LOOKAHEAD_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.marks = []
  }

  /** A tempo change takes effect from the next beat on — accel mode uses this. */
  setBpm(bpm: number): void {
    this.bpm = bpm
  }

  /**
   * Current position in beats (float). Negative during the count-in.
   * Interpolates between scheduled beats, so it stays correct with a varying bpm.
   */
  position(): number {
    const ctx = this.ctx
    if (!ctx || this.marks.length === 0) return Number.NaN
    const now = ctx.currentTime
    const m = this.marks
    for (let i = m.length - 1; i >= 0; i--) {
      if (m[i].audio <= now) {
        const next = m[i + 1]
        if (!next) return m[i].index + ((now - m[i].audio) * this.bpm) / 60
        const frac = (now - m[i].audio) / (next.audio - m[i].audio)
        return m[i].index + frac * (next.index - m[i].index)
      }
    }
    // Still before the first scheduled beat.
    return m[0].index - ((m[0].audio - now) * this.bpm) / 60
  }

  /** Converts an audio-clock instant into the performance.now() epoch. */
  audioToPerf(audioTime: number): number {
    return audioTime * 1000 + this.offsetMs
  }

  /** The inverse: a performance.now() instant (a MIDI timestamp) on the audio clock. */
  perfToAudio(perfTime: number): number {
    if (this.offsetMs === 0) {
      this.ensureCtx()
      this.syncOffset()
    }
    return (perfTime - this.offsetMs) / 1000
  }

  /**
   * Moves every beat not yet scheduled by `ms` (negative = earlier). Phase
   * correction for a follower: the tempo stays, the grid slides.
   */
  nudge(ms: number): void {
    if (!this.timer) return
    const ctx = this.ctx
    const shifted = this.nextAudio + ms / 1000
    // Never into the past: a beat already due would fire at once and stutter.
    this.nextAudio = ctx ? Math.max(ctx.currentTime + 0.01, shifted) : shifted
  }

  /** Length of one beat in ms, at the current bpm. */
  beatMs(): number {
    return 60000 / this.bpm
  }

  /** 0 to 1. Takes effect immediately, even with the transport running. */
  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v))
    if (this.clickGain) this.clickGain.gain.value = this.volume
  }

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      // Shared with the instrument: the grading grid is built on this clock, so a
      // second context would put what you play on a timeline of its own.
      this.ctx = getAudioContext()
      this.clickGain = this.ctx.createGain()
      this.clickGain.gain.value = this.volume
      this.clickGain.connect(getMasterBus())
    }
    return this.ctx
  }

  private syncOffset(): void {
    const ctx = this.ctx
    if (!ctx) return
    // getOutputTimestamp gives both clocks at the same instant, which is exactly
    // the bridge we need. Not every browser has it — then we sample by hand.
    const ts = ctx.getOutputTimestamp?.()
    const next =
      ts && ts.contextTime !== undefined && ts.performanceTime !== undefined
        ? ts.performanceTime - ts.contextTime * 1000
        : performance.now() - ctx.currentTime * 1000
    // The first measurement lands whole; after that it smooths, or the grid shakes.
    this.offsetMs = this.offsetMs === 0 ? next : this.offsetMs * 0.9 + next * 0.1
  }

  private tick(): void {
    const ctx = this.ctx
    if (!ctx) return
    this.syncOffset()

    while (this.nextAudio < ctx.currentTime + SCHEDULE_AHEAD_S) {
      this.scheduleBeat(this.nextIndex, this.nextAudio)
      this.nextAudio += 60 / this.bpm
      this.nextIndex += 1
    }
  }

  private scheduleBeat(index: number, audio: number): void {
    const beatInBar = ((index % this.beatsPerBar) + this.beatsPerBar) % this.beatsPerBar
    const isDownbeat = beatInBar === 0
    const isCountIn = index < 0

    if (this.clicks) {
      // The count-in sounds different from the exercise, so the entry is not confusing.
      this.click(audio, isDownbeat ? 1200 : 800, isCountIn ? 0.5 : isDownbeat ? 0.6 : 0.35)

      for (let s = 1; s < this.clicksPerBeat; s++) {
        this.click(audio + (s * 60) / this.bpm / this.clicksPerBeat, 1600, 0.12)
      }
    }

    this.marks.push({ index, audio })
    if (this.marks.length > 64) this.marks.shift()

    this.onBeat?.({
      index,
      audioTime: audio,
      perfTime: this.audioToPerf(audio),
      bar: Math.floor(index / this.beatsPerBar),
      beatInBar,
    })
  }

  /**
   * Synthesized note, to demonstrate the exercise before you play it.
   *
   * Uses the same piano voice the keyboard plays through, so the demonstration
   * and your own playing are the same instrument answering itself. Still
   * synthesized, not sampled: megabytes of samples do not pay for themselves when
   * what this has to convey is pitch and rhythm.
   */
  note(midi: number, atAudio: number, durS: number, gain = 0.16): void {
    const ctx = this.ctx
    if (!ctx) return
    schedulePianoTone(ctx, getMasterBus(), midi, atAudio, durS, gain)
  }

  private click(time: number, freq: number, gain: number): void {
    const ctx = this.ctx
    if (!ctx) return
    const osc = ctx.createOscillator()
    const env = ctx.createGain()
    osc.frequency.value = freq
    // Instant attack and fast decay: it is a click, not a note. Exponential ramp
    // because a linear one down to zero pops.
    env.gain.setValueAtTime(0.0001, time)
    env.gain.exponentialRampToValueAtTime(gain, time + 0.002)
    env.gain.exponentialRampToValueAtTime(0.0001, time + 0.05)
    osc.connect(env)
    env.connect(this.clickGain ?? ctx.destination)
    osc.start(time)
    osc.stop(time + 0.06)
  }
}
