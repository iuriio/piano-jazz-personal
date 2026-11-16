import type { KeyMode } from './keyEstimate'
import type { Pulse } from './pulseEstimate'

// When the accompaniment plays.
//
//   idle ──start──▶ starting ──1st beat──▶ playing ──stop, or leaving free play──▶ idle
//
// It starts only when you press start, at the tempo you set, and plays until you
// stop it: nothing here appears, offers, pauses or gives up by itself.
//
// A pure reducer: every decision here is a test, and the impure part
// (accompanist.ts) only feeds it events and does what the phase says.

export type Phase = 'idle' | 'starting' | 'playing'

export type Context = 'free' | 'voicings' | 'shred'

/** Playing over the last ACTIVITY_WINDOW_MS, as the listener measures it. */
export type Activity = {
  /** Time spent playing (gaps under 2 s count as playing). */
  activeMs: number
  attacks: number
  /** performance.now() of the last attack; -Infinity before the first. */
  lastAttack: number
  /** Until when something you played kept sounding (now, if it still does), pedal included. */
  lastSound?: number
}

/** What the band starts on: a key, and the feel it heard in your playing (its swing), if any. */
export type Choice = {
  key: { collectionPc: number; center: number; mode: KeyMode }
  pulse: Pulse | null
}

export type MachineState = {
  phase: Phase
  /** What plays, from the press of start. */
  choice: Choice | null
}

export const INITIAL: MachineState = { phase: 'idle', choice: null }

export type Tick = { type: 'tick'; context: Context }

export type MachineEvent =
  | Tick
  | { type: 'start'; choice: Choice }
  /** The first beat sounded. */
  | { type: 'started' }
  | { type: 'stop' }

/** Window the activity is measured over. */
export const ACTIVITY_WINDOW_MS = 15000

/** Pure. */
export function reduce(s: MachineState, e: MachineEvent): MachineState {
  switch (e.type) {
    case 'tick':
      // Leaving free play takes the band with it: the sheet lives in its notation slot.
      return s.phase !== 'idle' && e.context !== 'free' ? INITIAL : s
    case 'start':
      if (s.phase !== 'idle') return s
      return { ...s, phase: 'starting', choice: e.choice }
    case 'started':
      return s.phase === 'starting' ? { ...s, phase: 'playing' } : s
    case 'stop':
      return s.phase === 'idle' ? s : INITIAL
  }
}
