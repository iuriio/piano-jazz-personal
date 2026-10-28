import { useEffect, useRef, useState } from 'react'

// The notes of a chord do NOT arrive together — they land spread over 10-80ms
// depending on the hand. This is the quiet time (no note on/off) after which the
// chord counts as "settled". Real hardware needs tuning: there is a slider in the UI.
export const DEFAULT_SETTLE_MS = 60

/** Keys under a finger + keys released but still held by the pedal. */
export type Keys = {
  down: Set<number>
  sustained: Set<number>
  pedal: boolean
}

export function newKeys(): Keys {
  return { down: new Set(), sustained: new Set(), pedal: false }
}

/** What is sounding: finger + pedal. This is what becomes a chord. */
export function sounding(keys: Keys): number[] {
  return [...new Set([...keys.down, ...keys.sustained])].sort((a, b) => a - b)
}

const SUSTAIN_CC = 64
const PEDAL_THRESHOLD = 64 // half-pedal counts as pressed

/**
 * Applies a MIDI message to the key state.
 * Returns true when what is sounding changed. Pure on purpose — this is the part
 * that fails silently, so it stays testable without a browser.
 */
export function applyMidiMessage(keys: Keys, data: ArrayLike<number>): boolean {
  const [status, data1, data2] = [data[0], data[1], data[2]]
  const command = status & 0xf0

  if (command === 0x90 && data2 > 0) {
    const wasSounding = keys.down.has(data1) || keys.sustained.has(data1)
    keys.down.add(data1)
    keys.sustained.delete(data1) // struck again: back to being a finger note
    return !wasSounding
  }

  if (command === 0x80 || (command === 0x90 && data2 === 0)) {
    // Plenty of keyboards send note-on with velocity 0 instead of note-off.
    if (!keys.down.delete(data1)) return false
    if (keys.pedal) {
      // Pedal down: the note keeps sounding, so it stays in the chord.
      keys.sustained.add(data1)
      return false
    }
    return true
  }

  if (command === 0xb0 && data1 === SUSTAIN_CC) {
    const pedal = data2 >= PEDAL_THRESHOLD
    if (pedal === keys.pedal) return false
    keys.pedal = pedal
    if (pedal) return false // pressing changes nothing sounding, only what will keep sounding
    if (keys.sustained.size === 0) return false
    keys.sustained.clear() // releasing the pedal cuts whatever is not under a finger
    return true
  }

  if (command === 0xb0 && (data1 === 120 || data1 === 123)) {
    if (keys.down.size === 0 && keys.sustained.size === 0) return false
    keys.down.clear()
    keys.sustained.clear() // all sound off / all notes off
    return true
  }

  return false
}

// ---------------------------------------------------------------------------
// Raw event stream
//
// The chord path (useMidi) throws away velocity and timestamp on purpose: a chord
// has no rhythm. Shred needs both. Instead of two hooks opening two MIDIAccess,
// there is a single one here in the module fanning out to N subscribers.
// ---------------------------------------------------------------------------

export type MidiEvent = {
  kind: 'on' | 'off'
  note: number
  velocity: number
  /** performance.now() epoch, to line up with every other measurement. */
  time: number
}

/** Extracts the note from a message. null for CC, clock, aftertouch. Pure. */
export function parseNoteEvent(data: ArrayLike<number>, time: number): MidiEvent | null {
  const command = data[0] & 0xf0
  if (command === 0x90 && data[2] > 0) {
    return { kind: 'on', note: data[1], velocity: data[2], time }
  }
  if (command === 0x80 || (command === 0x90 && data[2] === 0)) {
    return { kind: 'off', note: data[1], velocity: 0, time }
  }
  return null
}

export type MidiStatus = {
  /** Input names, kept for the callers that only show a list. */
  devices: string[]
  /** Same inputs with their ids: the id is what setInputFilter takes. */
  inputs: { id: string; name: string }[]
  /** Only this input reaches the listeners. null = every input. */
  inputId: string | null
  error: string | null
}

type RawListener = (data: ArrayLike<number>, time: number) => void

const rawListeners = new Set<RawListener>()
const statusListeners = new Set<(s: MidiStatus) => void>()
const boundInputs = new WeakSet<MIDIInput>()

let status: MidiStatus = { devices: [], inputs: [], inputId: null, error: null }
let access: MIDIAccess | null = null
let starting = false

function publishStatus(patch: Partial<MidiStatus>) {
  status = { ...status, ...patch }
  for (const cb of statusListeners) cb(status)
}

function fanOut(data: ArrayLike<number>, time: number) {
  for (const cb of rawListeners) cb(data, time)
}

/**
 * Entry point for every message that came from a MIDIInput.
 *
 * Exported so the filter can be tested with a fake input id: the real path only
 * differs in that a MIDIInput's listener calls this. The filter is applied here,
 * at delivery time, rather than by unbinding the other inputs — that way an input
 * that is unplugged and plugged back in (rebound on statechange, possibly as a
 * new object) is filtered correctly without any bookkeeping.
 */
export function receiveFromInput(inputId: string, data: ArrayLike<number>, time: number): void {
  if (status.inputId !== null && status.inputId !== inputId) return
  fanOut(data, time)
}

/**
 * Restricts the listeners to one input — e.g. a controller that also forwards a
 * DAW's MIDI clock, or a second keyboard someone else is playing. null = all.
 *
 * The filter survives the input disappearing on purpose: unplugging the cable
 * should not silently widen it to "everything", and when the same device comes
 * back it keeps working with no action from the user.
 */
export function setInputFilter(id: string | null): void {
  if (id === status.inputId) return
  publishStatus({ inputId: id })
}

/**
 * Feeds a synthetic message to every raw listener, exactly as if it came from
 * hardware: chord state, the app's own voice and Shred all see it.
 *
 * Deliberately independent of Web MIDI — Safari and Firefox have no
 * requestMIDIAccess, and the computer keyboard has to play there too. It also
 * ignores the input filter: the filter picks between hardware ports, and the
 * computer keyboard is not one of them.
 */
export function injectRaw(data: number[]): void {
  // A copy, typed like what a MIDIInput delivers, so a listener that keeps the
  // message cannot see it change under it if the caller reuses the array.
  fanOut(Uint8Array.from(data), performance.now())
}

function bindInputs() {
  if (!access) return
  const inputs: { id: string; name: string }[] = []
  access.inputs.forEach((input) => {
    // addEventListener, not onmidimessage: assigning the property would let the
    // second consumer wipe out the first with no error at all.
    if (!boundInputs.has(input)) {
      // The id is read at bind time: it is what the filter compares against.
      const id = input.id
      input.addEventListener('midimessage', (e: Event) => {
        const m = e as MIDIMessageEvent
        if (!m.data) return
        // timeStamp comes from the driver and is more accurate than reading the
        // clock in here, which already paid for the event queue. Some
        // environments send 0.
        receiveFromInput(id, m.data, m.timeStamp || performance.now())
      })
      boundInputs.add(input)
    }
    inputs.push({ id: input.id, name: input.name ?? 'unnamed' })
  })
  publishStatus({ devices: inputs.map((i) => i.name), inputs, error: null })
}

function start() {
  if (access || starting) return
  // typeof guard: the module also loads in tests and SSR-ish contexts with no navigator.
  if (typeof navigator === 'undefined' || !navigator.requestMIDIAccess) {
    publishStatus({ devices: [], inputs: [], error: 'This browser has no Web MIDI API. Use Chrome or Edge.' })
    return
  }
  starting = true
  navigator
    .requestMIDIAccess({ sysex: false })
    .then((a) => {
      access = a
      a.onstatechange = bindInputs // keyboard plugged/unplugged mid-session
      bindInputs()
    })
    .catch((e: Error) =>
      publishStatus({ devices: [], inputs: [], error: `MIDI access denied: ${e.message}` }),
    )
    .finally(() => {
      starting = false
    })
}

/** Subscribes to the raw messages. Returns the unsubscribe function. */
export function subscribeRaw(cb: RawListener): () => void {
  rawListeners.add(cb)
  start()
  return () => {
    rawListeners.delete(cb)
  }
}

/** Subscribes to note on/off only, already parsed. */
export function subscribeMidi(cb: (e: MidiEvent) => void): () => void {
  return subscribeRaw((data, time) => {
    const ev = parseNoteEvent(data, time)
    if (ev) cb(ev)
  })
}

/** Subscribes to devices/error. Fires immediately with the current state. */
export function subscribeStatus(cb: (s: MidiStatus) => void): () => void {
  statusListeners.add(cb)
  cb(status)
  start()
  return () => {
    statusListeners.delete(cb)
  }
}

/** Raw notes with velocity and time. The callback may change between renders. */
export function useMidiEvents(cb: (e: MidiEvent) => void): void {
  const ref = useRef(cb)
  ref.current = cb
  useEffect(() => subscribeMidi((e) => ref.current(e)), [])
}

export type MidiState = {
  /** Notes sounding right now: finger + pedal. */
  held: number[]
  /** Last settled chord. Does not clear when you let go of the keys. */
  settled: number[]
  pedal: boolean
  devices: string[]
  error: string | null
}

export function useMidi(settleMs: number = DEFAULT_SETTLE_MS): MidiState {
  const [held, setHeld] = useState<number[]>([])
  const [settled, setSettled] = useState<number[]>([])
  const [pedal, setPedal] = useState(false)
  const [devices, setDevices] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const keysRef = useRef(newKeys())
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const settleMsRef = useRef(settleMs)
  settleMsRef.current = settleMs

  useEffect(() => {
    const flush = () => {
      const snapshot = sounding(keysRef.current)
      setHeld(snapshot)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        if (snapshot.length > 0) setSettled(snapshot)
      }, settleMsRef.current)
    }

    const unsubStatus = subscribeStatus((s) => {
      setDevices(s.devices)
      setError(s.error)
    })

    const unsubRaw = subscribeRaw((data) => {
      if (applyMidiMessage(keysRef.current, data)) flush()
      setPedal(keysRef.current.pedal)
    })

    return () => {
      unsubStatus()
      unsubRaw()
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  return { held, settled, pedal, devices, error }
}
