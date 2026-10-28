import { useEffect, useRef } from 'react'
import { injectRaw } from '../midi'

// Input from the computer keyboard.
//
// It exists so the engine can be tested without hardware — and it works as a
// fallback when the controller is not on the desk. Tracker layout: the bottom
// row is one octave, the top row the next, with the black keys on the row above
// each of them.

const LAYOUT: Record<string, number> = {
  // base octave
  KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5,
  KeyG: 6, KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11,
  Comma: 12, KeyL: 13, Period: 14, Semicolon: 15, Slash: 16,
  // octave above
  KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16, KeyR: 17,
  Digit5: 18, KeyT: 19, Digit6: 20, KeyY: 21, Digit7: 22, KeyU: 23,
  KeyI: 24, Digit9: 25, KeyO: 26, Digit0: 27, KeyP: 28,
}

export const QWERTY_HELP =
  'The bottom row (Z S X D C...) is the base octave, the top row (Q 2 W 3 E...) the next one. The ← → arrows change octave.'

/**
 * Injects the same MIDI messages a real keyboard sends, so the rest of the app —
 * grading, the instrument, the live input — cannot tell the difference. `baseNote`
 * is the lowest C of the layout.
 */
export function useComputerKeyboard(enabled: boolean, baseNote = 48): void {
  const base = useRef(baseNote)
  base.current = baseNote
  const down = useRef(new Set<string>())

  useEffect(() => {
    if (!enabled) return

    const shift = { octaves: 0 }

    const keyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        shift.octaves = Math.max(-2, Math.min(2, shift.octaves + (e.code === 'ArrowRight' ? 1 : -1)))
        e.preventDefault()
        return
      }
      const offset = LAYOUT[e.code]
      if (offset === undefined) return
      e.preventDefault()
      // OS autorepeat would send dozens of note-ons for the same held key.
      if (down.current.has(e.code)) return
      down.current.add(e.code)
      const note = base.current + offset + shift.octaves * 12
      injectRaw([0x90, note, 80])
    }

    const keyUp = (e: KeyboardEvent) => {
      const offset = LAYOUT[e.code]
      if (offset === undefined || !down.current.delete(e.code)) return
      const note = base.current + offset + shift.octaves * 12
      injectRaw([0x80, note, 0])
    }

    // Switching tabs with a key held down would leave the note stuck forever.
    const blur = () => {
      // Otherwise the note is stuck down AND stuck sounding.
      for (const code of down.current) {
        const offset = LAYOUT[code]
        if (offset !== undefined) injectRaw([0x80, base.current + offset + shift.octaves * 12, 0])
      }
      down.current.clear()
    }

    window.addEventListener('keydown', keyDown)
    window.addEventListener('keyup', keyUp)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', keyDown)
      window.removeEventListener('keyup', keyUp)
      window.removeEventListener('blur', blur)
      down.current.clear()
    }
  }, [enabled])
}
