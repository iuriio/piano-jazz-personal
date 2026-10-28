import { isConfident, sameKey, type KeyEstimate, type KeyMode } from './keyEstimate'
import { isSteady, withBpm, type Pulse } from './pulseEstimate'

// When the accompaniment offers itself, starts, waits for you and gives up.
//
//   idle ──notes──▶ listening ──thresholds──▶ offer ──accept──▶ starting ──1st beat──▶ playing
//                    ▲   ◀─15 s quiet / ×─────────┘                                     │   ▲
//                    │                                       1.5 bars of silence ▼   │ you play again
//                    └──────────────── stop / 20 s of silence ◀──────────────── waiting
//
// A pure reducer over a fake-able clock: every decision here is a test, and the
// impure part (accompanist.ts) only feeds it ticks and does what the phase says.

export type Phase = 'idle' | 'listening' | 'offer' | 'starting' | 'playing' | 'waiting'

export type Context = 'free' | 'voicings' | 'shred'

/** Playing over the last OFFER_WINDOW_MS, as the listener measures it. */
export type Activity = {
  /** Time spent playing (gaps under 2 s count as playing). */
  activeMs: number
  attacks: number
  /** performance.now() of the last attack; -Infinity before the first. */
  lastAttack: number
  /** Until when something you played kept sounding (now, if it still does), pedal included. */
  lastSound?: number
}

/** What the player picked in the offer: one reading of the key, one tempo or free time. */
export type Choice = {
  key: { collectionPc: number; center: number; mode: KeyMode }
  /** null = free time: no grid, the pad follows your phrases. */
  pulse: Pulse | null
}

export type Offer = {
  at: number
  key: KeyEstimate
  pulse: Pulse | null
  /** Index into [key, ...key.alts]. */
  keyIndex: number
  /** Index into tempoOptions(pulse). */
  tempoIndex: number
}

export type MachineState = {
  phase: Phase
  offer: Offer | null
  /** What will play, once accepted. */
  choice: Choice | null
  /** The reading the offer waits on, and since when it has held. */
  stable: { collectionPc: number; center: number } | null
  stableSince: number
  /** After ×: no offers until then, unless the key changes. */
  snoozeUntil: number
  snoozeKey: { collectionPc: number; center: number } | null
  /** Keys already offered this session ("pc:center"): one offer per key. */
  offered: string[]
  /** When the silence that put it in `waiting` began. */
  waitingSince: number
}

export const INITIAL: MachineState = {
  phase: 'idle',
  offer: null,
  choice: null,
  stable: null,
  stableSince: 0,
  snoozeUntil: 0,
  snoozeKey: null,
  offered: [],
  waitingSince: 0,
}

export type Tick = {
  type: 'tick'
  now: number
  context: Context
  offers: boolean
  /** Shred only: whether the exercise's transport is running. */
  transportRunning: boolean
  activity: Activity
  key: KeyEstimate | null
  pulse: Pulse | null
  /** Length of a bar at the playing tempo, for the silence rule. */
  barMs: number
  /**
   * While waiting: whether what you played since the pause is enough to come
   * back in on (the accompanist asks the tempo follower). Absent = any attack is.
   */
  resume?: boolean
}

export type MachineEvent =
  | Tick
  | { type: 'accept'; now: number }
  | { type: 'dismiss'; now: number }
  /** Clicking the listening dot: offer now, thresholds or not. */
  | { type: 'summon'; now: number; key: KeyEstimate | null; pulse: Pulse | null }
  | { type: 'cycleKey' }
  | { type: 'cycleTempo' }
  /** The first beat sounded. */
  | { type: 'started'; now: number }
  | { type: 'stop'; now: number }

/** Window the activity is measured over. */
export const OFFER_WINDOW_MS = 15000
export const OFFER_ACTIVE_MS = 8000
export const OFFER_ATTACKS = 20
export const KEY_STABLE_MS = 3000
/** An open offer stays while you play; this much silence takes it away. */
export const OFFER_QUIET_MS = 15000
export const SNOOZE_MS = 5 * 60 * 1000
/** Silence, in bars, after which it stops playing and waits. */
export const WAIT_BARS = 1.5
/** How long after its attack a held chord still counts as playing. */
export const HOLD_BARS = 2.5
export const GIVE_UP_MS = 20000

const keyId = (k: { collectionPc: number; center: number }) => `${k.collectionPc}:${k.center}`

/** The key readings an offer cycles through: the estimate, then its alternatives. */
export function keyOptions(k: KeyEstimate): { collectionPc: number; center: number; mode: KeyMode }[] {
  return [k, ...k.alts.map((a) => ({ ...a, collectionPc: k.collectionPc }))].map(({ collectionPc, center, mode }) => ({
    collectionPc,
    center,
    mode,
  }))
}

/** Tempo options: as heard, half, double. Without a steady pulse, only free time. */
export function tempoOptions(p: Pulse | null): (Pulse | null)[] {
  if (!isSteady(p)) return [null]
  return [p, ...p.alts.map((b) => withBpm(p, b))]
}

function choiceOf(o: Offer): Choice {
  const keys = keyOptions(o.key)
  const tempos = tempoOptions(o.pulse)
  return { key: keys[o.keyIndex % keys.length], pulse: tempos[o.tempoIndex % tempos.length] }
}

function makeOffer(s: MachineState, now: number, key: KeyEstimate, pulse: Pulse | null): MachineState {
  const offer: Offer = { at: now, key, pulse, keyIndex: 0, tempoIndex: 0 }
  return {
    ...s,
    phase: 'offer',
    offer,
    choice: choiceOf(offer),
    offered: s.offered.includes(keyId(key)) ? s.offered : [...s.offered, keyId(key)],
  }
}

/** Where an offer may appear: free play always, shred only over a running exercise. */
function offersHere(t: Tick): boolean {
  return t.offers && (t.context === 'free' || (t.context === 'shred' && t.transportRunning))
}

function listen(s: MachineState, t: Tick): MachineState {
  const quietFor = t.now - t.activity.lastAttack
  if (t.context === 'voicings' || quietFor > OFFER_WINDOW_MS) {
    return { ...s, phase: 'idle', stable: null, offer: null }
  }

  // The key must read the same, confidently, for KEY_STABLE_MS.
  let { stable, stableSince } = s
  if (isConfident(t.key)) {
    if (!sameKey(stable, t.key)) {
      stable = { collectionPc: t.key!.collectionPc, center: t.key!.center }
      stableSince = t.now
    }
  } else {
    stable = null
  }
  const next = { ...s, phase: 'listening' as const, stable, stableSince }

  const ready =
    offersHere(t) &&
    stable !== null &&
    t.now - stableSince >= KEY_STABLE_MS &&
    t.activity.activeMs >= OFFER_ACTIVE_MS &&
    t.activity.attacks >= OFFER_ATTACKS &&
    !s.offered.includes(keyId(stable)) &&
    (t.now >= s.snoozeUntil || !sameKey(s.snoozeKey, stable))
  return ready ? makeOffer(next, t.now, t.key!, t.pulse) : next
}

/**
 * An open offer stays up while you keep playing, and follows what it hears:
 * a steadier pulse replaces the tempo ("free time" can become "~92"), and a
 * different key, read confidently for KEY_STABLE_MS, replaces the key. A reading
 * that wavers for a tick or two changes nothing. It goes away only on ×, on
 * accept, on leaving the mode, or after OFFER_QUIET_MS of silence — and then
 * the key may be offered again when you come back, since you never said no.
 */
function keepOffer(s: MachineState, t: Tick): MachineState {
  const open = s.offer!
  if (!offersHere(t)) return listen({ ...s, offer: null, choice: null }, t)
  if (t.now - t.activity.lastAttack >= OFFER_QUIET_MS) {
    const offered = s.offered.filter((k) => k !== keyId(open.key))
    return listen({ ...s, phase: 'listening', offer: null, choice: null, offered }, t)
  }

  let { stable, stableSince } = s
  if (isConfident(t.key) && !sameKey(stable, t.key)) {
    stable = { collectionPc: t.key!.collectionPc, center: t.key!.center }
    stableSince = t.now
  }
  let offer = open
  if (
    isConfident(t.key) &&
    sameKey(stable, t.key) &&
    !sameKey(open.key, t.key) &&
    t.now - stableSince >= KEY_STABLE_MS
  ) {
    offer = { ...offer, key: t.key!, keyIndex: 0 }
  }
  if (isSteady(t.pulse) && t.pulse !== offer.pulse) offer = { ...offer, pulse: t.pulse }

  if (offer === open && stable === s.stable && stableSince === s.stableSince) return s
  const offered = s.offered.includes(keyId(offer.key)) ? s.offered : [...s.offered, keyId(offer.key)]
  return { ...s, stable, stableSince, offer, choice: choiceOf(offer), offered }
}

/** Pure. */
export function reduce(s: MachineState, e: MachineEvent): MachineState {
  switch (e.type) {
    case 'tick': {
      const t = e
      switch (s.phase) {
        case 'idle':
        case 'listening':
          return listen(s, t)
        case 'offer':
          return keepOffer(s, t)
        case 'starting':
        case 'playing':
        case 'waiting': {
          // Leaving free play takes the band with it: the sheet lives in its notation slot.
          if (t.context !== 'free') return { ...s, phase: 'listening', choice: null }
          const quietFor = t.now - t.activity.lastAttack
          // A chord you hold is still playing, for up to HOLD_BARS after you struck it:
          // two bars of whole notes are not a pause, a pedal left down for a minute is.
          const heldTill = Math.min(t.activity.lastSound ?? Number.NEGATIVE_INFINITY, t.activity.lastAttack + HOLD_BARS * t.barMs)
          const silentFor = t.now - Math.max(t.activity.lastAttack, heldTill)
          if (s.phase === 'playing' && silentFor >= WAIT_BARS * t.barMs) {
            return { ...s, phase: 'waiting', waitingSince: t.activity.lastAttack }
          }
          if (s.phase === 'waiting') {
            if (t.activity.lastAttack > s.waitingSince && t.resume !== false) return { ...s, phase: 'playing' }
            if (quietFor >= GIVE_UP_MS) return { ...s, phase: 'listening', choice: null, stable: null }
          }
          return s
        }
      }
      return s
    }
    case 'summon':
      if (s.phase !== 'listening' && s.phase !== 'idle') return s
      if (!e.key) return s
      return makeOffer(s, e.now, e.key, e.pulse)
    case 'cycleKey':
    case 'cycleTempo': {
      if (s.phase !== 'offer' || !s.offer) return s
      const offer =
        e.type === 'cycleKey'
          ? { ...s.offer, keyIndex: (s.offer.keyIndex + 1) % keyOptions(s.offer.key).length }
          : { ...s.offer, tempoIndex: (s.offer.tempoIndex + 1) % tempoOptions(s.offer.pulse).length }
      return { ...s, offer, choice: choiceOf(offer) }
    }
    case 'accept':
      if (s.phase !== 'offer' || !s.offer) return s
      return { ...s, phase: 'starting', choice: choiceOf(s.offer), offer: null }
    case 'dismiss':
      if (s.phase !== 'offer' || !s.offer) return s
      return {
        ...s,
        phase: 'listening',
        offer: null,
        choice: null,
        snoozeUntil: e.now + SNOOZE_MS,
        snoozeKey: { collectionPc: s.offer.key.collectionPc, center: s.offer.key.center },
      }
    case 'started':
      return s.phase === 'starting' ? { ...s, phase: 'playing' } : s
    case 'stop':
      if (s.phase === 'idle' || s.phase === 'listening') return s
      return { ...s, phase: 'listening', offer: null, choice: null }
  }
}
