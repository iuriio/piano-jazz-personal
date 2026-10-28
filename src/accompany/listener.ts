import { applyMidiMessage, newKeys, parseNoteEvent, subscribeRaw } from '../midi'
import type { Activity } from './machine'
import type { PlayedNote } from './played'

// The ear: keeps the last 30 s of what YOU played, outside React.
//
// It subscribes to the raw stream once, like liveNotes, and only ever hears the
// player — the accompaniment schedules straight into its own audio bus and never
// goes through injectRaw, so it cannot hear itself and take its own chords for
// yours. Estimating is pull-based: the accompanist asks a few times a second,
// nothing is computed per note.

const BUFFER_MS = 30000
/** A gap shorter than this still counts as playing, for the activity measure. */
const PLAYING_GAP_MS = 2000

const keys = newKeys()
const sounding = new Map<number, PlayedNote>()
let notes: PlayedNote[] = []
let lastAttack = Number.NEGATIVE_INFINITY
const attackListeners = new Set<(t: number, midi: number, velocity: number) => void>()
let unsubscribe: (() => void) | null = null

function handle(data: ArrayLike<number>, time: number) {
  const ev = parseNoteEvent(data, time)
  // The bass flag needs the keys as they were before this note went down.
  const lowestBefore = Math.min(...keys.down, ...keys.sustained)
  applyMidiMessage(keys, data)

  if (ev?.kind === 'on') {
    const prev = sounding.get(ev.note)
    if (prev) prev.off = time // struck again while ringing: the old note ends here
    const note: PlayedNote = {
      midi: ev.note,
      velocity: ev.velocity,
      on: time,
      off: Number.NaN,
      lowest: !(lowestBefore < ev.note),
    }
    sounding.set(ev.note, note)
    notes.push(note)
    lastAttack = time
    for (const cb of attackListeners) cb(time, ev.note, ev.velocity)
  }

  // Whatever the key state no longer holds has stopped sounding (pedal rules live in midi.ts).
  for (const [midi, note] of sounding) {
    if (!keys.down.has(midi) && !keys.sustained.has(midi)) {
      note.off = time
      sounding.delete(midi)
    }
  }
}

function prune(now: number) {
  if (notes.length && now - notes[0].on > BUFFER_MS) {
    notes = notes.filter((n) => now - n.on <= BUFFER_MS || Number.isNaN(n.off))
  }
}

/** Starts listening. Safe to call more than once. */
export function startListening(): void {
  if (!unsubscribe) unsubscribe = subscribeRaw(handle)
}

export function stopListening(): void {
  unsubscribe?.()
  unsubscribe = null
}

/** What was played in the last 30 s (notes still sounding have off = NaN). */
export function heard(now: number): PlayedNote[] {
  prune(now)
  return notes
}

/** Notes sounding right now: the voicing steers clear of them. */
export function soundingNow(): number[] {
  return [...sounding.keys()]
}

export function lastAttackAt(): number {
  return lastAttack
}

/** Called on every note-on, outside React. For the tempo follower. */
export function onAttack(cb: (t: number, midi: number, velocity: number) => void): () => void {
  attackListeners.add(cb)
  return () => {
    attackListeners.delete(cb)
  }
}

/**
 * Playing time and attack count over the last `windowMs`. Pure, so the machine's
 * thresholds can be tested against the same measure the app uses.
 */
export function activityOf(played: PlayedNote[], now: number, windowMs: number): Activity {
  const recent = played.filter((n) => n.on >= now - windowMs).sort((a, b) => a.on - b.on)
  let activeMs = 0
  let attacks = 0
  let prev = Number.NEGATIVE_INFINITY
  for (const n of recent) {
    if (n.on - prev >= 50) attacks++
    if (n.on - prev < PLAYING_GAP_MS) activeMs += n.on - prev
    prev = Math.max(prev, n.on)
  }
  const last = played.length ? Math.max(...played.map((n) => n.on)) : Number.NEGATIVE_INFINITY
  let lastSound = Number.NEGATIVE_INFINITY
  for (const n of played) lastSound = Math.max(lastSound, Number.isNaN(n.off) ? now : n.off)
  // The note being played now counts up to now, or to its release.
  if (recent.length && now - prev < PLAYING_GAP_MS) activeMs += now - prev
  return { activeMs, attacks, lastAttack: last, lastSound }
}
