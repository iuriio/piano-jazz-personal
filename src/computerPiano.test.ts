import { describe, expect, it } from 'vitest'
import {
  MAX_OCTAVE,
  MIN_OCTAVE,
  clampOctave,
  createComputerPiano,
  humaniseVelocity,
  isTextEntryTarget,
  pianoKeyOffset,
  pianoNote,
  type PianoKeyEvent,
} from './computerPiano'

describe('layout', () => {
  it('home row is the white keys, row above the black keys', () => {
    const white = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon']
    expect(white.map(pianoKeyOffset)).toEqual([0, 2, 4, 5, 7, 9, 11, 12, 14, 16])
    const black = ['KeyW', 'KeyE', 'KeyT', 'KeyY', 'KeyU', 'KeyO', 'KeyP']
    expect(black.map(pianoKeyOffset)).toEqual([1, 3, 6, 8, 10, 13, 15])
  })

  it('leaves the gaps where a piano has no black key, and Space alone', () => {
    for (const code of ['KeyR', 'KeyI', 'Space', 'KeyZ', 'KeyX', 'KeyQ']) {
      expect(pianoKeyOffset(code)).toBeUndefined()
    }
  })

  it('A is middle C at the default octave', () => {
    expect(pianoNote('KeyA', 4)).toBe(60)
    expect(pianoNote('KeyK', 4)).toBe(72)
  })
})

describe('octave range', () => {
  it('clamps', () => {
    expect(clampOctave(MIN_OCTAVE - 1)).toBe(MIN_OCTAVE)
    expect(clampOctave(MAX_OCTAVE + 1)).toBe(MAX_OCTAVE)
    expect(clampOctave(3)).toBe(3)
  })

  it('never produces a note off the piano', () => {
    for (let o = MIN_OCTAVE; o <= MAX_OCTAVE; o++) {
      for (const code of ['KeyA', 'KeyH', 'KeyK', 'Semicolon']) {
        const n = pianoNote(code, o)
        if (n !== undefined) expect(n >= 21 && n <= 108).toBe(true)
      }
    }
    expect(pianoNote('KeyA', 0)).toBeUndefined() // C0 = 12
    expect(pianoNote('KeyH', 0)).toBe(21) // A0
    expect(pianoNote('KeyK', 7)).toBe(108) // C8
    expect(pianoNote('KeyO', 7)).toBeUndefined()
  })
})

describe('humanise', () => {
  it('spreads about ±12 and stays in 1..127', () => {
    expect(humaniseVelocity(80, () => 0)).toBe(68)
    expect(humaniseVelocity(80, () => 1)).toBe(92)
    expect(humaniseVelocity(80, () => 0.5)).toBe(80)
    expect(humaniseVelocity(5, () => 0)).toBe(1)
    expect(humaniseVelocity(125, () => 1)).toBe(127)
  })
})

describe('text entry targets', () => {
  it('blocks typing fields and selects', () => {
    expect(isTextEntryTarget({ tagName: 'INPUT', type: 'text' } as unknown as EventTarget)).toBe(true)
    expect(isTextEntryTarget({ tagName: 'INPUT' } as unknown as EventTarget)).toBe(true)
    expect(isTextEntryTarget({ tagName: 'input', type: 'search' } as unknown as EventTarget)).toBe(true)
    expect(isTextEntryTarget({ tagName: 'TEXTAREA' } as unknown as EventTarget)).toBe(true)
    expect(isTextEntryTarget({ tagName: 'SELECT' } as unknown as EventTarget)).toBe(true)
    expect(isTextEntryTarget({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget)).toBe(true)
  })

  it('lets sliders, checkboxes and the page through', () => {
    expect(isTextEntryTarget({ tagName: 'INPUT', type: 'range' } as unknown as EventTarget)).toBe(false)
    expect(isTextEntryTarget({ tagName: 'INPUT', type: 'checkbox' } as unknown as EventTarget)).toBe(false)
    expect(isTextEntryTarget({ tagName: 'BUTTON' } as unknown as EventTarget)).toBe(false)
    expect(isTextEntryTarget({ tagName: 'BODY' } as unknown as EventTarget)).toBe(false)
    expect(isTextEntryTarget(null)).toBe(false)
  })
})

function setup(opts: { humanise?: boolean } = {}) {
  const sent: number[][] = []
  let octave = 4
  const piano = createComputerPiano({
    send: (d) => sent.push(d),
    getOctave: () => octave,
    setOctave: (o) => {
      octave = o
    },
    getVelocity: () => 90,
    getHumanise: () => opts.humanise ?? false,
    random: () => 1,
  })
  const ev = (code: string, extra: Partial<PianoKeyEvent> = {}): PianoKeyEvent => ({
    code,
    repeat: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    target: null,
    preventDefault: () => {},
    ...extra,
  })
  return { sent, piano, ev, octave: () => octave }
}

describe('createComputerPiano', () => {
  it('sends note on and off', () => {
    const { sent, piano, ev } = setup()
    piano.keyDown(ev('KeyA'))
    piano.keyUp(ev('KeyA'))
    expect(sent).toEqual([
      [0x90, 60, 90],
      [0x80, 60, 0],
    ])
  })

  it('applies humanise', () => {
    const { sent, piano, ev } = setup({ humanise: true })
    piano.keyDown(ev('KeyA'))
    expect(sent[0]).toEqual([0x90, 60, 102])
  })

  it('ignores autorepeat, modifiers and text fields', () => {
    const { sent, piano, ev } = setup()
    piano.keyDown(ev('KeyA'))
    piano.keyDown(ev('KeyA', { repeat: true }))
    piano.keyDown(ev('KeyA')) // a repeat the browser did not flag
    piano.keyDown(ev('KeyS', { metaKey: true }))
    piano.keyDown(ev('KeyD', { ctrlKey: true }))
    piano.keyDown(ev('KeyF', { altKey: true }))
    piano.keyDown(ev('KeyG', { target: { tagName: 'INPUT', type: 'text' } as unknown as EventTarget }))
    expect(sent).toEqual([[0x90, 60, 90]])
  })

  it('plays while a slider has focus', () => {
    const { sent, piano, ev } = setup()
    piano.keyDown(ev('KeyA', { target: { tagName: 'INPUT', type: 'range' } as unknown as EventTarget }))
    expect(sent).toEqual([[0x90, 60, 90]])
  })

  it('Z/X change octave, clamped', () => {
    const { piano, ev, octave } = setup()
    piano.keyDown(ev('KeyX'))
    expect(octave()).toBe(5)
    piano.keyDown(ev('KeyX', { repeat: true }))
    expect(octave()).toBe(5)
    for (let i = 0; i < 10; i++) piano.keyDown(ev('KeyX'))
    expect(octave()).toBe(MAX_OCTAVE)
    for (let i = 0; i < 20; i++) piano.keyDown(ev('KeyZ'))
    expect(octave()).toBe(MIN_OCTAVE)
  })

  it('releases the note that was turned on, even after an octave change', () => {
    const { sent, piano, ev } = setup()
    piano.keyDown(ev('KeyA'))
    piano.keyDown(ev('KeyX'))
    piano.keyUp(ev('KeyA'))
    expect(sent).toEqual([
      [0x90, 60, 90],
      [0x80, 60, 0],
    ])
  })

  it('the same note from two keys ends only when both are up', () => {
    const { sent, piano, ev } = setup()
    piano.keyDown(ev('KeyK')) // C5 at octave 4
    piano.keyDown(ev('KeyX'))
    piano.keyDown(ev('KeyA')) // C5 at octave 5
    piano.keyUp(ev('KeyK'))
    expect(sent).toEqual([[0x90, 72, 90]])
    piano.keyUp(ev('KeyA'))
    expect(sent).toEqual([
      [0x90, 72, 90],
      [0x80, 72, 0],
    ])
  })

  it('releaseAll sends note-off for everything held', () => {
    const { sent, piano, ev } = setup()
    piano.keyDown(ev('KeyA'))
    piano.keyDown(ev('KeyD'))
    piano.keyDown(ev('KeyG'))
    piano.releaseAll()
    expect(sent.slice(3).sort((a, b) => a[1] - b[1])).toEqual([
      [0x80, 60, 0],
      [0x80, 64, 0],
      [0x80, 67, 0],
    ])
    piano.keyUp(ev('KeyA'))
    expect(sent).toHaveLength(6) // nothing left to release
  })
})
