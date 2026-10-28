import { useEffect, useRef } from 'react'
import { Accidental, Formatter, Renderer, Stave, StaveConnector, StaveNote, Voice } from 'vexflow'
import { chordNames, keyById, vexKey } from './analysis'

const WIDTH = 340
const HEIGHT = 230
const STAVE_X = 10
const STAVE_WIDTH = 320

type Props = {
  notes: number[]
  /** Key signature id ("Eb", "F#"…): drawn on the staff and drives the spelling. */
  keyId?: string
  /** Ink for the notes; the staff itself always uses the panel's ink. */
  color?: string
  label?: string
}

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

/**
 * Grand staff in the current key. The split between clefs is by actual pitch
 * (>= C4 goes to treble). Accidentals come from VexFlow's own key-aware pass, so
 * an F♯ in D major carries no sharp and an F natural does.
 */
export function Staff({ notes, keyId = 'C', color, label }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    host.innerHTML = ''

    const key = keyById(keyId)
    // Spelled as the chord they make (C E♭ G B♭ in C), not note by note.
    const names = chordNames(notes, { key, split: 'off', splitPoint: 0 })
    const ink = cssVar('--fg-soft', '#c9c9c2')
    const noteInk = color ?? cssVar('--fg', '#edede8')

    const renderer = new Renderer(host, Renderer.Backends.SVG)
    renderer.resize(WIDTH, HEIGHT)
    const ctx = renderer.getContext()
    ctx.setFillStyle(ink)
    ctx.setStrokeStyle(ink)

    const treble = new Stave(STAVE_X, 10, STAVE_WIDTH).addClef('treble').addKeySignature(key.id)
    const bass = new Stave(STAVE_X, 110, STAVE_WIDTH).addClef('bass').addKeySignature(key.id)
    for (const s of [treble, bass]) s.setStyle({ fillStyle: ink, strokeStyle: ink })
    treble.setContext(ctx).draw()
    bass.setContext(ctx).draw()
    new StaveConnector(treble, bass).setType('brace').setContext(ctx).draw()
    new StaveConnector(treble, bass).setType('singleLeft').setContext(ctx).draw()

    const sorted = [...notes].sort((a, b) => a - b)
    const split = { treble: sorted.filter((n) => n >= 60), bass: sorted.filter((n) => n < 60) }

    const voices: Voice[] = []
    const staves: Stave[] = []
    for (const [clef, stave] of [
      ['treble', treble],
      ['bass', bass],
    ] as const) {
      const group = split[clef]
      const note =
        group.length > 0
          ? new StaveNote({ keys: group.map((n) => vexKey(n, key, names)), duration: 'w', clef })
          : new StaveNote({ keys: [clef === 'treble' ? 'b/4' : 'd/3'], duration: 'wr', clef })
      note.setStyle({ fillStyle: noteInk, strokeStyle: noteInk })
      // An empty staff gets an invisible rest: it keeps the formatter happy
      // without drawing a rest symbol where there is simply nothing played.
      if (group.length === 0) note.setStyle({ fillStyle: 'transparent', strokeStyle: 'transparent' })
      voices.push(new Voice({ numBeats: 4, beatValue: 4 }).addTickables([note]))
      staves.push(stave)
    }

    Accidental.applyAccidentals(voices, key.id)
    voices.forEach((v, i) => {
      new Formatter().joinVoices([v]).format([v], STAVE_WIDTH - 110)
      v.draw(ctx, staves[i])
    })

    if (label) {
      ctx.save()
      ctx.setFont('sans-serif', 13)
      ctx.fillText(label, 12, HEIGHT - 6)
      ctx.restore()
    }

    const svg = host.querySelector('svg')
    if (svg) {
      svg.setAttribute('viewBox', `0 0 ${WIDTH} ${HEIGHT}`)
      svg.removeAttribute('width')
      svg.removeAttribute('height')
      // VexFlow pins the size inline too; the panel decides the width.
      svg.removeAttribute('style')
    }
  }, [notes.join(','), keyId, color, label])

  return <div className="staff" ref={hostRef} />
}
