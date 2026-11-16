import { useSyncExternalStore } from 'react'
import { getAudioContext, getMasterBus, resumeAudio } from '../audio'
import { schedulePianoTone, velocityToGain } from '../instrument'
import { Transport, type Beat } from '../shred/clock'
import { NEW_TRACK, estimateKey, keyLabel, sameKey, trackKey, type KeyTrack } from './keyEstimate'
import { activityOf, heard, soundingNow, startListening, stopListening } from './listener'
import { ACTIVITY_WINDOW_MS, INITIAL, reduce, type Choice, type Context, type MachineEvent, type MachineState, type Phase } from './machine'
import { autoStyle, feel, patternFor, swingFor, swungAt, walkingLine, type BarPattern, type Hit, type Style } from './patterns'
import { median, rng } from './played'
import {
  lockThrough,
  planPhrase,
  renderPhrase,
  type Complexity,
  type Phrase,
  type PlanChord,
  type PlanKey,
  type Section,
} from './progression'
import { estimatePulse, isSteady, type Pulse } from './pulseEstimate'
import { DEFAULT_ACCOMPANY, parseKey, type AccompanySettings } from './settings'
import { avoidClashes, bassNote, registerFor, voice, voiceTones, type Register } from './voicing'
import { schedulePadTone, scheduleBassTone } from './voices'
import { energyOf, spread } from './groove'
import { DRUM_RING_BEATS, drumBar, kitVelocity, type DrumHit } from './drums'
import { SampledInstrument } from '../sound/sampled'
import { leaseFx, type FxBus } from '../sound/fx'

// The band. Wires the ear, the state machine, the planner and the audio.
//
// Everything that decides is pure and lives in the modules it imports; this is
// the part that holds a clock, a timer and an audio bus. Its state lives here,
// outside React, and the two views (the badge and the chart) read it through
// useSyncExternalStore. It publishes on a phase change, on a new reading and on
// each beat — never on a note.
//
// The one rule: nothing here goes through injectRaw. The band schedules
// straight into its own bus, so the listener, the chord card and shred's
// grading never hear it.

const TICK_MS = 250
/** Your recent register, for keeping out of your way. */
const REGISTER_MS = 8000
/** smplr output volume (0..127, v² curve) for the sampled band piano and the kit. */
const KEYS_VOLUME = 118
const KIT_VOLUME = 100
/** Reverb sends for the sampled parts, through the session's leased FX bus. */
const KEYS_REVERB = 0.2
const KIT_REVERB = 0.1
/**
 * Low cut on the band piano. Its voicings start at C3 (131 Hz, voicing.ts), so
 * this costs the bottom voice ~2 dB and takes the samples' sub-60 Hz rumble out
 * of the bass's way.
 */
const KEYS_LOW_CUT_HZ = 120

export type SheetBar = { chords: { symbol: string; hold: boolean }[]; locked: boolean }
export type SheetRow = {
  index: number
  section: Section
  bars: SheetBar[]
  planned: boolean
  /** Set where a new key starts: "→ E♭ major". */
  to: string | null
  /** The bar (0-3) the new key starts on: 0 for a phrase planned in it, later for a change mid-phrase. */
  toBar: number
}

export type PlayView = {
  key: PlanKey
  keyLabel: string
  bpm: number
  style: Style
  rows: SheetRow[]
  /** Bar (0-3) inside the first row, and beat inside it. -1 before the first beat. */
  bar: number
  beat: number
  now: string | null
  next: string | null
}

export type AccompanyView = {
  phase: Phase
  /** What the ear makes of your playing right now: the key 'auto' would start in. */
  heard: { keyLabel: string | null; bpm: number | null; steady: boolean }
  play: PlayView | null
}

type Session = {
  key: PlanKey
  bpm: number
  beatMs: number
  style: Style
  /** What 'auto' resolved to at the start: kept, so the band does not change style mid-tune. */
  heardStyle: Style
  swing: number | null
  densityAuto: 1 | 2
  seed: number
  rand: () => number
  transport: Transport
  out: GainNode
  current: Phrase
  next: Phrase
  barInPhrase: number
  beatInBar: number
  barCount: number
  barChords: PlanChord[]
  ahead: { chord: PlanChord; voicing: number[] } | null
  pattern: BarPattern | null
  voicings: number[][]
  walk: number[] | null
  /** The bass note the bar's walking line set off from, so a re-plan mid-bar walks the same first beats. */
  walkFrom: number | null
  prevVoicing: number[] | null
  prevBass: number | null
  prevPattern: string | null
  register: Register
  baseVel: number
  started: boolean
  /** Your key, as the ear holds it while the band plays: a change has to win for two bars. */
  track: KeyTrack
  /** Sampled band piano (null: the synth piano) and drum kit (null: no drums). */
  keys: SampledInstrument | null
  kit: SampledInstrument | null
  /** Where the sampled parts write: dry into `out`, and a send into the leased reverb. */
  keysIn: AudioNode
  kitIn: GainNode
  wetSend: GainNode
  wetBus: FxBus | null
  /** This bar's drums, written straight. */
  drums: DrumHit[]
}

class Accompanist {
  private state: MachineState = INITIAL
  private context: Context = 'free'
  private settings: AccompanySettings = DEFAULT_ACCOMPANY
  /** The page's key, for 'auto' before the ear has heard anything. */
  private pageKey: PlanKey = { collectionPc: 0, center: 0, mode: 'major' }
  private timer: ReturnType<typeof setInterval> | null = null
  private bus: GainNode | null = null
  private session: Session | null = null
  private lastHeard: { key: ReturnType<typeof estimateKey>; pulse: Pulse | null } = { key: null, pulse: null }
  private view: AccompanyView = {
    phase: 'idle',
    heard: { keyLabel: null, bpm: null, steady: false },
    play: null,
  }
  private listeners = new Set<() => void>()

  get connected(): boolean {
    return this.timer !== null
  }

  // --- lifecycle -------------------------------------------------------------

  connect(): void {
    if (this.timer) return
    startListening()
    this.timer = setInterval(() => this.tick(), TICK_MS)
  }

  /**
   * Takes over from the band a hot update replaced (dev only): its settings,
   * and its ear if it was listening. See the end of this file.
   */
  takeOver(old: Accompanist): void {
    this.context = old.context
    this.settings = old.settings
    this.pageKey = old.pageKey
    this.bus = old.bus
    this.state = old.state
    this.lastHeard = old.lastHeard
    // A band that is playing goes on playing, now driven from here: the chart
    // stays up and nothing stops mid-bar because a file was saved.
    const s = old.session
    old.session = null
    const was = old.connected
    old.disconnect()
    if (s) {
      this.session = s
      s.transport.onBeat = (b) => this.onBeat(s, b)
    }
    if (was) this.connect()
    this.publish(true)
  }

  disconnect(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.teardown()
    stopListening()
  }

  /** `pageKeyPc`: the major tonic of the page's key signature, for 'auto' before anything is heard. */
  configure(context: Context, settings: AccompanySettings, pageKeyPc = 0): void {
    const prev = this.settings
    this.context = context
    this.settings = settings
    this.pageKey = { collectionPc: pageKeyPc, center: pageKeyPc, mode: 'major' }
    if (this.bus) this.bus.gain.value = settings.level
    const s = this.session
    if (s) {
      if (settings.style !== prev.style) s.style = this.resolveStyle(s)
      if (settings.density !== prev.density) {
        // The phrase on screen as "next" is replanned; the one playing stays.
        s.next = planPhrase(s.next.key, s.next.index, this.planOpts(s))
      }
      if (settings.bpm !== prev.bpm) {
        // Your new tempo, from the next beat on.
        s.bpm = settings.bpm
        s.beatMs = 60000 / settings.bpm
        s.transport.setBpm(settings.bpm)
      }
      if (settings.keys !== prev.keys || settings.drums !== prev.drums) this.equip(s)
    }
    this.publish(true)
  }

  // --- start and stop ---------------------------------------------------------

  /**
   * Starts the band at your tempo, in the key the settings name, or with 'auto'
   * the one it hears you in (the page's key before it has heard anything).
   */
  start(): void {
    // Inside the click: the browser lets audio start here.
    void resumeAudio()
    this.dispatch({ type: 'start', choice: { key: this.startKey(), pulse: isSteady(this.lastHeard.pulse) ? this.lastHeard.pulse : null } })
  }

  stop(): void {
    this.dispatch({ type: 'stop' })
  }

  private startKey(): PlanKey {
    const fixed = this.settings.key === 'auto' ? null : parseKey(this.settings.key)
    if (fixed) return fixed
    const k = this.lastHeard.key
    return k ? { collectionPc: k.collectionPc, center: k.center, mode: k.mode } : this.pageKey
  }

  // --- store -----------------------------------------------------------------

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }

  getView = (): AccompanyView => this.view

  // --- the machine -------------------------------------------------------------

  private tick(): void {
    const now = performance.now()
    const played = heard(now)
    const activity = activityOf(played, now, ACTIVITY_WINDOW_MS)
    // Nothing played in a while: no estimate to make, nothing to show.
    const recent = activity.attacks === 0 ? [] : played.filter((n) => now - n.on <= ACTIVITY_WINDOW_MS)
    const key = recent.length ? estimateKey(played, now) : null
    const pulse = recent.length ? estimatePulse(recent) : null
    this.lastHeard = { key, pulse }
    if (this.session && this.state.phase === 'playing') this.followKey(this.session, key, now)
    this.dispatch({ type: 'tick', context: this.context })
  }

  private dispatch(e: MachineEvent): void {
    const before = this.state
    this.state = reduce(before, e)
    const from = before.phase
    const to = this.state.phase
    if (from !== to) {
      if (to === 'starting' && this.state.choice) void this.begin(this.state.choice)
      if (to === 'idle' && this.session) this.teardown()
    }
    this.publish(from !== to || e.type !== 'tick')
  }

  // --- the band --------------------------------------------------------------

  private ensureBus(): GainNode {
    if (!this.bus) {
      const ctx = getAudioContext()
      this.bus = ctx.createGain()
      this.bus.gain.value = this.settings.level
      // Its own bus into the master: it plays even with your instrument set to
      // "off (external)", since the band is the app's, not yours.
      this.bus.connect(getMasterBus())
    }
    return this.bus
  }

  private planOpts(s: Pick<Session, 'seed' | 'densityAuto'>) {
    const d = this.settings.density
    return { seed: s.seed, density: d === 'auto' ? s.densityAuto : d === '2' ? (2 as const) : (1 as const), beatsPerBar: 4 }
  }

  private resolveStyle(s: Pick<Session, 'heardStyle'>): Style {
    return this.settings.style === 'auto' ? s.heardStyle : this.settings.style
  }

  private async begin(choice: Choice): Promise<void> {
    this.teardown()
    const ctx = getAudioContext()
    const now = performance.now()
    const played = heard(now)
    // Your feel (swing) comes from what it heard; the tempo is only ever yours.
    const pulse = choice.pulse
    const bpm = this.settings.bpm
    const beatMs = 60000 / bpm
    const activity = activityOf(played, now, ACTIVITY_WINDOW_MS)
    const rate = activity.activeMs > 0 ? activity.attacks / (activity.activeMs / 1000) : 0
    const densityAuto: 1 | 2 = rate < 1.5 || bpm > 160 ? 2 : 1
    const heardStyle = autoStyle(bpm, !!pulse?.swung)
    const seed = Math.floor(Math.random() * 2 ** 31)

    const out = ctx.createGain()
    out.gain.value = 1
    out.connect(this.ensureBus())
    // The sampled parts' inputs: dry into out, and each a send into one wet
    // node that follows the leased reverb (see wet()).
    const wetSend = ctx.createGain()
    const keysIn = ctx.createBiquadFilter()
    keysIn.type = 'highpass'
    keysIn.frequency.value = KEYS_LOW_CUT_HZ
    keysIn.Q.value = Math.SQRT1_2
    const kitIn = ctx.createGain()
    for (const [node, send] of [
      [keysIn, KEYS_REVERB],
      [kitIn, KIT_REVERB],
    ] as const) {
      node.connect(out)
      const g = ctx.createGain()
      g.gain.value = send
      node.connect(g)
      g.connect(wetSend)
    }

    const transport = new Transport()
    const base = { seed, densityAuto }
    const s: Session = {
      key: choice.key,
      bpm,
      beatMs,
      style: 'pad',
      heardStyle,
      swing: null,
      densityAuto,
      seed,
      rand: rng(seed ^ 0x5bd1e995),
      transport,
      out,
      current: planPhrase(choice.key, 0, this.planOpts(base)),
      next: planPhrase(choice.key, 1, this.planOpts(base)),
      barInPhrase: -1,
      beatInBar: -1,
      barCount: -1,
      barChords: [],
      ahead: null,
      pattern: null,
      voicings: [],
      walk: null,
      walkFrom: null,
      prevVoicing: null,
      prevBass: null,
      prevPattern: null,
      register: registerFor([]),
      // Half-ish of your touch: the band sits under you.
      baseVel: Math.round(0.55 * (median(played.slice(-40).map((n) => n.velocity)) || 70)),
      started: false,
      track: NEW_TRACK,
      keys: null,
      kit: null,
      keysIn,
      kitIn,
      wetSend,
      wetBus: null,
      drums: [],
    }
    s.style = this.resolveStyle(s)
    // Your own swing, measured from your playing, pulls the band's toward it.
    s.swing = s.style === 'comp' || s.style === 'walk' ? swingFor(bpm, pulse?.swing) : null
    this.session = s
    this.equip(s)

    // Bar one right away, at your tempo: you come in on the band.
    const first = now + 150
    transport.onBeat = (b) => this.onBeat(s, b)
    await transport.start({ bpm, beatsPerBar: 4, countInBars: 0, clicks: false, startAt: transport.perfToAudio(first) })
    // Stopped while the audio was waking up: this transport must not keep ticking.
    if (this.session !== s) {
      transport.stop()
      return
    }
    this.publish(true)
  }

  /**
   * You changed key. The ear's tracker (trackKey: one to two bars of the new
   * key's notes) holds what you are in; nothing on the chart changes for it.
   * The next phrase to be planned is planned in it (see enterBar), so a key
   * change shows up four bars before it plays, marked "→ key", and what is on
   * screen always plays as shown.
   */
  private followKey(s: Session, key: ReturnType<typeof estimateKey>, now: number): void {
    if (!key) return
    if (!s.track.current) {
      // Seed the tracker with the key the band is in, so a change is measured from it.
      s.track = { current: { ...key, collectionPc: s.key.collectionPc, center: s.key.center, mode: s.key.mode }, challenger: null, since: now }
    }
    s.track = trackKey(s.track, key, now, 8 * s.beatMs)
  }

  /** The key the next phrase is planned in: yours, if the band follows you, else its own. */
  private planKey(s: Session): PlanKey {
    const t = s.track.current
    if (!this.settings.followKey || !t) return s.key
    return { collectionPc: t.collectionPc, center: t.center, mode: t.mode }
  }

  private teardown(): void {
    const s = this.session
    if (!s) return
    this.session = null
    s.transport.onBeat = null
    s.transport.stop()
    // A short fade rather than a cut: notes already scheduled would otherwise click off.
    const ctx = getAudioContext()
    const end = ctx.currentTime + 0.3
    s.out.gain.setValueAtTime(s.out.gain.value, ctx.currentTime)
    s.out.gain.linearRampToValueAtTime(0, end)
    // The sampled parts release under the fade; their reverb tails return into
    // out, so the same fade takes them too.
    s.keys?.stopAll(end)
    s.kit?.stopAll(end)
    setTimeout(() => {
      s.out.disconnect()
      s.keys?.dispose()
      s.kit?.dispose()
    }, 1500)
    this.publish(true)
  }

  /**
   * Gives a session the sampled piano and kit the settings ask for, replacing
   * what it had. A set still downloading plays nothing yet: the piano part
   * falls back to the synth piano meanwhile, the drums just come in later.
   */
  private equip(s: Session): void {
    const ctx = getAudioContext()
    const { keys, drums } = this.settings
    const retire = (inst: SampledInstrument | null) => {
      if (!inst) return
      inst.stopAll(ctx.currentTime + 0.15)
      setTimeout(() => inst.dispose(), 1000)
    }
    const wantKeys = keys === 'synth' ? null : keys
    if ((s.keys?.bank ?? null) !== wantKeys) {
      retire(s.keys)
      s.keys = wantKeys ? new SampledInstrument(ctx, wantKeys, s.keysIn, KEYS_VOLUME) : null
    }
    const wantKit = drums === 'off' ? null : (`kit-${drums}` as const)
    if ((s.kit?.bank ?? null) !== wantKit) {
      retire(s.kit)
      s.kit = wantKit ? new SampledInstrument(ctx, wantKit, s.kitIn, KIT_VOLUME) : null
    }
  }

  /**
   * Keeps the session's reverb lease alive until `until` and the sampled
   * parts' send plugged into it. The lease is re-made after a quiet spell, so
   * the send follows whichever bus is current.
   */
  private wet(s: Session, until: number): void {
    const bus = leaseFx(getAudioContext(), s.out, until)
    if (bus === s.wetBus) return
    if (s.wetBus) {
      try {
        s.wetSend.disconnect(s.wetBus.reverb)
      } catch {
        // Already unplugged by the old lease's teardown.
      }
    }
    s.wetSend.connect(bus.reverb)
    s.wetBus = bus
  }

  private onBeat(s: Session, b: Beat): void {
    if (this.session !== s) return
    if (b.beatInBar === 0) this.enterBar(s)
    this.scheduleBeat(s, b)

    // The view moves when the beat sounds, not when it is scheduled ~100 ms early.
    const delay = Math.max(0, b.perfTime - performance.now())
    setTimeout(() => {
      if (this.session !== s) return
      s.beatInBar = b.beatInBar
      if (!s.started) {
        s.started = true
        this.dispatch({ type: 'started' })
      }
      this.publish(true)
    }, delay)
  }

  private enterBar(s: Session): void {
    const now = performance.now()
    s.barCount++
    s.barInPhrase++
    if (s.barInPhrase >= 4) {
      s.current = s.next
      // A modulation lands here: the band is in the new key from this phrase on.
      s.key = s.current.key
      // The phrase that comes on screen now plays four bars from now, as shown.
      s.next = planPhrase(this.planKey(s), s.current.index + 1, this.planOpts(s))
      s.barInPhrase = 0
    }
    const c = this.settings.complexity
    const played = heard(now)
    const rendered = renderPhrase(s.current, c, s.seed, s.next)
    s.current = lockThrough(s.current, s.barInPhrase, rendered)
    s.barChords = rendered[s.barInPhrase]

    s.register = registerFor(played.filter((n) => now - n.on <= REGISTER_MS).map((n) => n.midi))
    const energy = energyOf(played, now, 8 * s.beatMs)
    s.pattern = patternFor(s.style, s.bpm, s.current.index, s.barInPhrase, s.prevPattern, s.seed, { energy })
    s.prevPattern = s.pattern.id
    s.drums = s.kit
      ? drumBar({
          style: s.style,
          free: false,
          phrase: s.current.index,
          bar: s.barInPhrase,
          barCount: s.barCount,
          energy,
          baseVel: s.baseVel,
          seed: s.seed,
        })
      : []

    s.voicings = s.barChords.map((ch) => {
      const v = voice(voiceTones(ch, c, s.register.shellOnly), s.prevVoicing, s.register.piano)
      s.prevVoicing = v
      return v
    })
    s.walkFrom = s.prevBass
    this.lookAhead(s)
  }

  /**
   * What this bar leans toward: the next bar's first chord, for the piano's
   * anticipation and the walking line's approach note.
   */
  private lookAhead(s: Session): void {
    if (s.barInPhrase < 0 || !s.barChords.length) return
    const c = this.settings.complexity
    const following =
      s.barInPhrase < 3
        ? renderPhrase(s.current, c, s.seed, s.next)[s.barInPhrase + 1][0]
        : renderPhrase(s.next, c, s.seed)[0][0]
    const last = s.voicings[s.voicings.length - 1] ?? s.prevVoicing
    s.ahead = { chord: following, voicing: voice(voiceTones(following, c, s.register.shellOnly), last, s.register.piano) }

    s.walk = null
    if (s.style === 'walk') {
      // Two chords in the bar: half a line each, root then approach.
      const [a, b2] = s.barChords
      if (b2) {
        const one = walkingLine(a.root, a.tones, b2.root, s.walkFrom, s.register.bass, s.seed + s.barCount)
        const two = walkingLine(b2.root, b2.tones, following.root, one[3], s.register.bass, s.seed + s.barCount + 7)
        s.walk = [one[0], one[3], two[0], two[3]]
      } else {
        s.walk = walkingLine(a.root, a.tones, following.root, s.walkFrom, s.register.bass, s.seed + s.barCount)
      }
    }
  }

  private chordAt(s: Session, at: number): number {
    let acc = 0
    for (let i = 0; i < s.barChords.length; i++) {
      acc += s.barChords[i].beats
      if (at < acc - 1e-6) return i
    }
    return s.barChords.length - 1
  }

  private scheduleBeat(s: Session, b: Beat): void {
    if (!s.pattern) return
    const ctx = getAudioContext()
    const beatS = s.beatMs / 1000
    for (const hit of s.pattern.hits) {
      if (Math.floor(hit.at + 1e-6) !== b.beatInBar) continue
      const idx = this.chordAt(s, hit.at)
      const chord = s.barChords[idx]
      if (!chord) continue
      // A held bar (a chart's "%") keeps the pad ringing from the bar before.
      if (hit.part === 'pad' && chord.hold) continue
      const f = feel(hit, s.baseVel, s.barCount, s.swing !== null, s.rand)
      const when = b.audioTime + (swungAt(hit.at, s.swing) - b.beatInBar) * beatS + f.lateMs / 1000
      this.play(s, ctx, hit, chord, idx, when, f.velocity)
    }
    this.drumBeat(s, ctx, b)
  }

  /** The drums due in this beat, on the same grid and swing as the band. */
  private drumBeat(s: Session, ctx: AudioContext, b: Beat): void {
    const kit = s.kit
    if (!kit?.playable || s.drums.length === 0) return
    const beatS = s.beatMs / 1000
    let last = 0
    for (const d of s.drums) {
      if (Math.floor(d.at + 1e-6) !== b.beatInBar) continue
      const when = Math.max(ctx.currentTime, b.audioTime + (swungAt(d.at, s.swing) - b.beatInBar) * beatS + d.lateMs / 1000)
      const ring = DRUM_RING_BEATS[d.piece]
      kit.start({ note: d.piece, velocity: kitVelocity(d.velocity), time: when, duration: ring === null ? undefined : ring * beatS })
      last = Math.max(last, when + (ring ?? 1) * beatS)
    }
    if (last) this.wet(s, last)
  }

  private play(s: Session, ctx: AudioContext, hit: Hit, chord: PlanChord, idx: number, when: number, velocity: number): void {
    const gain = velocityToGain(velocity)
    const beatS = s.beatMs / 1000
    let dur = hit.dur * beatS
    if (hit.part === 'piano' || hit.part === 'pad') {
      const target = hit.ahead && s.ahead ? s.ahead : { chord, voicing: s.voicings[idx] }
      // Last check against what you hold right now: no ♭9 rubs with your melody.
      const notes = avoidClashes(target.voicing, soundingNow(), target.chord.tones)
      if (hit.part === 'pad') {
        const nextHold = s.barInPhrase < 3 && s.current.bars[s.barInPhrase + 1]?.slots[0]?.hold
        if (nextHold) dur *= 2
        for (const m of notes) schedulePadTone(ctx, s.out, m, when, dur, gain * 0.32)
      } else {
        // Played by hands: rolled a few ms, the top voice singing (groove.ts spread).
        const keys = s.keys?.playable ? s.keys : null
        for (const n of spread(notes, hit, velocity, s.rand)) {
          const at = when + n.delayMs / 1000
          // The sampled piano takes the real velocity: its layers and curve
          // carry the ghosts and accents velocityToGain's floor would flatten.
          if (keys) keys.start({ note: n.midi, velocity: n.velocity, time: at, duration: dur })
          else schedulePianoTone(ctx, s.keysIn, n.midi, at, dur, velocityToGain(n.velocity) * 0.9)
        }
        if (keys) this.wet(s, when + dur + 1)
      }
      return
    }
    let midi: number
    if (hit.what === 'walk' && s.walk) midi = s.walk[Math.floor(hit.at)]
    else if (hit.what === 'fifth') midi = bassNote((chord.root + 7) % 12, s.register.bass, s.prevBass)
    else midi = bassNote(chord.root, s.register.bass, s.prevBass)
    s.prevBass = midi
    // Lighter when you play your own bass notes (voicing.ts registerFor).
    scheduleBassTone(ctx, s.out, midi, when, dur, gain * 1.1 * s.register.bassLevel)
  }

  // --- view ------------------------------------------------------------------

  private publish(force: boolean): void {
    const next = this.buildView()
    if (!force && sameView(this.view, next)) return
    this.view = next
    for (const cb of this.listeners) cb()
  }

  private buildView(): AccompanyView {
    const st = this.state
    const k = this.lastHeard.key
    const p = this.lastHeard.pulse
    const heardView = {
      keyLabel: k ? keyLabel(k) : null,
      bpm: p ? Math.round(p.bpm) : null,
      steady: isSteady(p),
    }

    const s = this.session
    let play: PlayView | null = null
    if (s) {
      const c = this.settings.complexity as Complexity
      const cur = renderPhrase(s.current, c, s.seed, s.next)
      const nxt = renderPhrase(s.next, c, s.seed)
      const row = (ph: Phrase, r: PlanChord[][], planned: boolean): SheetRow => ({
        index: ph.index,
        section: ph.section,
        planned,
        to: planned && !sameKey(ph.key, s.current.key) ? keyLabel(ph.key) : null,
        toBar: 0,
        bars: r.map((bar, i) => ({
          chords: bar.map((ch) => ({ symbol: ch.symbol, hold: ch.hold })),
          locked: !!ph.bars[i].locked,
        })),
      })
      const bar = s.barInPhrase
      const beat = s.beatInBar
      const nowChord = bar >= 0 ? cur[bar][this.chordAt(s, Math.max(0, beat))] ?? cur[bar][0] : cur[0][0]
      const nextChord = bar < 3 ? cur[bar + 1][0] : nxt[0][0]
      play = {
        key: s.key,
        keyLabel: keyLabel(s.key),
        bpm: Math.round(s.bpm),
        style: s.style,
        rows: [row(s.current, cur, false), row(s.next, nxt, true)],
        bar,
        beat,
        now: nowChord?.symbol ?? null,
        next: nextChord?.symbol ?? null,
      }
    }
    return { phase: st.phase, heard: heardView, play }
  }
}

function sameView(a: AccompanyView, b: AccompanyView): boolean {
  return (
    a.phase === b.phase &&
    JSON.stringify(a.play) === JSON.stringify(b.play) &&
    a.heard.keyLabel === b.heard.keyLabel &&
    a.heard.bpm === b.heard.bpm &&
    a.heard.steady === b.heard.steady
  )
}

export const accompanist = new Accompanist()

// A Vite hot update re-runs this module whenever it, or anything it imports
// (the estimators, the listener, the planner), changes, and so makes a new
// band. The views pick the new one up, but AccompanyHost's mount effect does
// not run again: the old band went on listening into a view nobody read, and
// the new one, the one on screen, never heard a note until a reload. The new
// band takes over.
if (import.meta.hot) {
  const old = import.meta.hot.data.accompanist as Accompanist | undefined
  if (old && old !== accompanist) accompanist.takeOver(old)
  import.meta.hot.data.accompanist = accompanist
}

/** The whole view, for the badge and the chart. */
export function useAccompany(): AccompanyView {
  return useSyncExternalStore(accompanist.subscribe, accompanist.getView)
}

/** Only whether the chart should take the notation slot: the workspace re-renders on that, not on every beat. */
export function useAccompanySheet(): boolean {
  return useSyncExternalStore(accompanist.subscribe, () => accompanist.getView().play !== null)
}
