import { applyMidiMessage, newKeys, parseNoteEvent, subscribeRaw } from '../midi'

// What the Live input draws, kept OUTSIDE React.
//
// Every note on/off used to be a setState that re-rendered the whole tree just to
// light one key. The canvas reads this store once per animation frame instead, so
// playing fast costs a redraw, not a reconciliation.

export type LiveNote = {
  midi: number
  velocity: number
  /** performance.now() of the note-on. */
  on: number
  /** performance.now() of the moment it stopped sounding. NaN while it sounds. */
  off: number
  /** Released under the pedal: still sounding, no longer under a finger. */
  sustained: boolean
}

/** How long a released note stays on screen, rising and fading. */
export const TRAIL_MS = 2500

const keys = newKeys()
const sounding = new Map<number, LiveNote>()
let trail: LiveNote[] = []
let version = 0
const wakeListeners = new Set<() => void>()
let unsubscribe: (() => void) | null = null

function wake() {
  version++
  for (const cb of wakeListeners) cb()
}

function handle(data: ArrayLike<number>, time: number) {
  const ev = parseNoteEvent(data, time)
  applyMidiMessage(keys, data)

  if (ev?.kind === 'on') {
    const prev = sounding.get(ev.note)
    // Struck again while still sounding: the old bar ends here and a new one starts.
    if (prev) trail.push({ ...prev, off: time, sustained: false })
    sounding.set(ev.note, { midi: ev.note, velocity: ev.velocity, on: time, off: Number.NaN, sustained: false })
  }

  // Whatever the key state no longer holds has stopped sounding — note-off without
  // pedal, pedal lifted, all-notes-off. Reading it back from `keys` means the pedal
  // rules live in one place (midi.ts) instead of being re-derived here.
  for (const [midi, note] of sounding) {
    const down = keys.down.has(midi)
    const held = down || keys.sustained.has(midi)
    if (!held) {
      sounding.delete(midi)
      trail.push({ ...note, off: time, sustained: false })
    } else {
      note.sustained = !down
    }
  }
  wake()
}

function ensureStarted() {
  if (!unsubscribe) unsubscribe = subscribeRaw(handle)
}

/** Notes sounding now and the recent trail. Prunes the trail as it goes. */
export function snapshot(now: number): { sounding: LiveNote[]; trail: LiveNote[]; pedal: boolean } {
  if (trail.length && now - trail[0].off > TRAIL_MS) {
    trail = trail.filter((n) => now - n.off <= TRAIL_MS)
  }
  return { sounding: [...sounding.values()], trail, pedal: keys.pedal }
}

/** Bumps on every change; lets the canvas skip frames where nothing moved. */
export function liveVersion(): number {
  return version
}

/** Called on every change. Returns the unsubscribe function. */
export function onLiveChange(cb: () => void): () => void {
  ensureStarted()
  wakeListeners.add(cb)
  return () => {
    wakeListeners.delete(cb)
  }
}
