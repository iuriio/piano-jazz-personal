import { useEffect, useRef, useState } from 'react'
import { injectRaw } from './midi'

// The computer keyboard laid out like a piano.
//
// Not the tracker layout in shred/qwerty.ts: that one packs two octaves for
// speed runs, this one is for reading chords, where seeing the white and black
// keys where a pianist expects them matters more than range. Home row = white
// keys, the row above = black keys, with the gaps (no key between E-F and B-C)
// where a piano has them.
//
// Everything goes through injectRaw, so the app cannot tell this from a real
// controller: the chord reader, the app's voice and Shred all hear it.

const LAYOUT: Record<string, number> = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7,
  KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14,
  KeyP: 15, Semicolon: 16,
}

const OCTAVE_DOWN = 'KeyZ'
const OCTAVE_UP = 'KeyX'

/** Piano range: A0..C8. */
const LOWEST = 21
const HIGHEST = 108

/**
 * Octave bounds, as the number of the base C.
 *
 * 0 and 7 look odd — at C0 only H/U/J/K and up land on the piano, at C7 only
 * A..K — but they are the only way to reach A0-B0 and C#7-C8 with this layout.
 * Keys that would fall off the piano stay silent (see pianoNote) instead of the
 * octave refusing to go there.
 */
export const MIN_OCTAVE = 0
export const MAX_OCTAVE = 7
export const DEFAULT_OCTAVE = 4

/** Semitones above the base C for a KeyboardEvent.code, or undefined. Pure. */
export function pianoKeyOffset(code: string): number | undefined {
  return LAYOUT[code]
}

export function clampOctave(octave: number): number {
  return Math.max(MIN_OCTAVE, Math.min(MAX_OCTAVE, octave))
}

/** MIDI note for a key at an octave, or undefined when unmapped or off the piano. */
export function pianoNote(code: string, octave: number): number | undefined {
  const offset = pianoKeyOffset(code)
  if (offset === undefined) return undefined
  const note = (octave + 1) * 12 + offset // MIDI 60 = C4
  return note >= LOWEST && note <= HIGHEST ? note : undefined
}

const HUMANISE_SPREAD = 12

/**
 * A computer key has no velocity: every note would land at exactly the same
 * loudness, which sounds like a sequencer. A small random spread makes held
 * chords read as played. `random` is injectable for tests.
 */
export function humaniseVelocity(velocity: number, random: () => number = Math.random): number {
  const v = velocity + Math.round((random() * 2 - 1) * HUMANISE_SPREAD)
  return Math.max(1, Math.min(127, v))
}

// Input types where a letter key does nothing useful — focusing a slider or a
// checkbox (which happens every time you click one) must not mute the piano.
const NON_TEXT_INPUTS = new Set([
  'range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file', 'image', 'hidden',
])

/**
 * True when the key belongs to a field the user is typing into. Duck-typed on
 * purpose, so it is testable without a DOM.
 */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false
  const el = target as { tagName?: string; type?: string; isContentEditable?: boolean }
  if (el.isContentEditable) return true
  const tag = el.tagName?.toUpperCase()
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') return !NON_TEXT_INPUTS.has((el.type ?? 'text').toLowerCase())
  return false
}

const NOTE_ON = 0x90
const NOTE_OFF = 0x80

/** The parts of a KeyboardEvent the piano reads — plain objects work in tests. */
export type PianoKeyEvent = Pick<
  KeyboardEvent,
  'code' | 'repeat' | 'metaKey' | 'ctrlKey' | 'altKey' | 'target' | 'preventDefault'
>

export type ComputerPiano = {
  keyDown: (e: PianoKeyEvent) => void
  keyUp: (e: PianoKeyEvent) => void
  /** Note-off for every key still down: blur, disable, unmount. */
  releaseAll: () => void
}

/**
 * The keyboard logic without the window wiring, so held-note bookkeeping can be
 * tested with fake events. `send` is injectRaw in the app. The getters are read
 * per keystroke, so velocity/humanise/octave changes apply without rebuilding
 * this (which would drop the held-key map).
 */
export function createComputerPiano(io: {
  send: (data: number[]) => void
  getOctave: () => number
  setOctave: (octave: number) => void
  getVelocity: () => number
  getHumanise: () => boolean
  random?: () => number
}): ComputerPiano {
  // code -> the note it actually turned on. The note-off has to go to that note,
  // not to whatever the key means after an octave change, or the original note
  // hangs forever.
  const down = new Map<string, number>()

  const heldByOther = (note: number, except: string) => {
    for (const [code, n] of down) if (n === note && code !== except) return true
    return false
  }

  const release = (code: string) => {
    const note = down.get(code)
    if (note === undefined) return
    down.delete(code)
    // K at C4 and A at C5 are the same note: the first key let go must not cut
    // the one still held.
    if (!heldByOther(note, code)) io.send([NOTE_OFF, note, 0])
  }

  return {
    keyDown(e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (isTextEntryTarget(e.target)) return

      if (e.code === OCTAVE_DOWN || e.code === OCTAVE_UP) {
        e.preventDefault()
        if (e.repeat) return
        io.setOctave(clampOctave(io.getOctave() + (e.code === OCTAVE_UP ? 1 : -1)))
        return
      }

      if (pianoKeyOffset(e.code) === undefined) return
      e.preventDefault()
      // OS autorepeat would send dozens of note-ons for the same held key; the
      // map check also covers browsers that do not flag repeat reliably.
      if (e.repeat || down.has(e.code)) return
      const note = pianoNote(e.code, io.getOctave())
      if (note === undefined) return // off the end of the piano at this octave

      const base = Math.max(1, Math.min(127, Math.round(io.getVelocity())))
      const velocity = io.getHumanise() ? humaniseVelocity(base, io.random) : base
      const already = heldByOther(note, e.code)
      down.set(e.code, note)
      if (!already) io.send([NOTE_ON, note, velocity])
    },

    // No modifier/target checks here: a key that went down as a note must come
    // up as one, even if focus moved into a field while it was held.
    keyUp(e) {
      release(e.code)
    },

    releaseAll() {
      for (const code of [...down.keys()]) release(code)
    },
  }
}

export function useComputerPiano(opts: {
  enabled: boolean
  velocity: number
  humanise: boolean
}): { octave: number } {
  const [octave, setOctave] = useState(DEFAULT_OCTAVE)
  // Handlers read refs instead of depending on these: re-binding the listeners
  // would run the cleanup, which releases every held key mid-chord.
  const octaveRef = useRef(octave)
  const velocityRef = useRef(opts.velocity)
  velocityRef.current = opts.velocity
  const humaniseRef = useRef(opts.humanise)
  humaniseRef.current = opts.humanise

  useEffect(() => {
    if (!opts.enabled) return

    const piano = createComputerPiano({
      // Synchronous, inside the keydown: the instrument resumes its AudioContext
      // from this call, which only works within a user gesture.
      send: injectRaw,
      getOctave: () => octaveRef.current,
      setOctave: (o) => {
        octaveRef.current = o
        setOctave(o)
      },
      getVelocity: () => velocityRef.current,
      getHumanise: () => humaniseRef.current,
    })

    // Switching tabs or windows with a key held: the keyup never arrives here,
    // and the note would stay stuck in the chord and in the speaker.
    const blur = () => piano.releaseAll()

    window.addEventListener('keydown', piano.keyDown)
    window.addEventListener('keyup', piano.keyUp)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', piano.keyDown)
      window.removeEventListener('keyup', piano.keyUp)
      window.removeEventListener('blur', blur)
      piano.releaseAll()
    }
  }, [opts.enabled])

  return { octave }
}
