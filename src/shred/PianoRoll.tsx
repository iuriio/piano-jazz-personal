import { useEffect, useRef } from 'react'
import { KEY_BW, KEY_W, keyLayout } from '../keyboard'
import type { ExpectedNote } from './pattern'

// Notes falling onto the keyboard. Canvas and not SVG because this redraws at
// 60fps: touching SVG attributes through React state at that rate stutters.
//
// The X axis comes from keyLayout, the SAME one the live input's keyboard uses,
// and both fill the same width — so a note lands exactly on its own key at any
// screen width. The roll measures the box it is given and draws in CSS pixels,
// so text and glows never stretch.
//
// What it says, without reading anything:
// - grey blocks are not yours yet (count-in, rest, idle); they turn the hand's
//   colour the moment they count,
// - a block you hit lights up and bursts at the hit line, coloured by timing —
//   green on time, amber early, red late,
// - a block that passes the line unplayed goes dark red,
// - the notes you fumble most carry an amber ring, rep after rep.

export type PlayedMark = {
  midi: number
  beat: number
  /** Deviation in ms against the grid: <0 rushed, >0 dragged. */
  devMs: number
}

export type RollPhase = 'idle' | 'countin' | 'playing' | 'resting' | 'demo'

type Props = {
  expected: ExpectedNote[]
  low: number
  high: number
  /** Current position in beats. NaN when stopped. */
  getPosition: () => number
  getPlayed: () => PlayedMark[]
  beatsPerBar: number
  /** Length of one rep in beats: the shape repeats every one of them. */
  cycleBeats: number
  /** How many beats fit in the height of the view. */
  windowBeats?: number
  showFingers: boolean
  phase: RollPhase
  /** Group indices you fumble most, from the accumulated diagnosis. */
  fumbleGroups?: number[]
}

/** How far from a block, in beats, a played note still counts as hitting it. */
const HIT_BEATS = 0.3
/** How long the burst at the hit line lasts, in beats. */
const BURST_BEATS = 0.6
/** Under this deviation a hit counts as on time. */
const ON_TIME_MS = 25

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

function rgbOf(hex: string, fallback: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return fallback
  const n = parseInt(m[1], 16)
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`
}

export function PianoRoll({
  expected,
  low,
  high,
  getPosition,
  getPlayed,
  beatsPerBar,
  cycleBeats,
  windowBeats = 4,
  showFingers,
  phase,
  fumbleGroups = [],
}: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  const posRef = useRef(getPosition)
  const playedRef = useRef(getPlayed)
  const phaseRef = useRef(phase)
  posRef.current = getPosition
  playedRef.current = getPlayed
  phaseRef.current = phase

  const layout = keyLayout(low, high)
  const width = layout.width
  const fumbleKey = fumbleGroups.join(',')

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = Math.min(2, window.devicePixelRatio || 1)
    let cssW = 0
    let H = 0
    let sx = 1
    const resize = () => {
      cssW = canvas.clientWidth
      H = canvas.clientHeight
      sx = cssW / width
      canvas.width = Math.round(cssW * dpr)
      canvas.height = Math.round(H * dpr)
    }
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    resize()

    const font = cssVar('--mono', 'ui-monospace, monospace')
    const rgb = {
      right: rgbOf(cssVar('--accent', '#468c2b'), '70,140,43'),
      left: '126,190,214', // cool blue: tells the hands apart without a legend
      grey: '139,139,131',
      ok: rgbOf(cssVar('--ok', '#468c2b'), '70,140,43'),
      early: rgbOf(cssVar('--early', '#e0a33a'), '224,163,58'),
      late: rgbOf(cssVar('--bad', '#e8705f'), '232,112,95'),
      warn: rgbOf(cssVar('--warn', '#e0a33a'), '224,163,58'),
    }
    const panel = cssVar('--panel', '#101011')
    const fumbles = new Set(fumbleKey ? fumbleKey.split(',').map(Number) : [])

    // Block height: most of the gap to the next onset, so a run reads as a run
    // and a held note reads as long, without blocks touching.
    const onsets = [...new Set(expected.map((e) => e.beat))].sort((a, b) => a - b)
    let step = 1
    for (let i = 1; i < onsets.length; i++) step = Math.min(step, onsets[i] - onsets[i - 1])

    let raf = 0

    const draw = () => {
      const pxPerBeat = H / windowBeats
      // The hit line sits at the bottom, against the keyboard: the note "arrives" there.
      const hitY = H - 2
      const live = phaseRef.current === 'playing'
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = panel
      ctx.fillRect(0, 0, cssW, H)

      const pos = posRef.current()
      const p = Number.isFinite(pos) ? pos : 0

      // Octave lines: the same faint reference the live input draws.
      ctx.fillStyle = 'rgba(255,255,255,0.035)'
      for (const k of layout.keys) {
        if (k.midi % 12 === 0) ctx.fillRect(Math.round(k.x * sx), 0, 1, H)
      }

      // Beat lines. The downbeat is stronger.
      for (let b = Math.floor(p); b <= p + windowBeats + 1; b++) {
        const y = hitY - (b - p) * pxPerBeat
        if (y < 0 || y > H) continue
        const downbeat = ((b % beatsPerBar) + beatsPerBar) % beatsPerBar === 0
        ctx.fillStyle = downbeat ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.045)'
        ctx.fillRect(0, Math.round(y), cssW, 1)
      }

      // Played notes near the view, by pitch, for hit detection and bursts.
      const played = playedRef.current()
      const playedByMidi = new Map<number, PlayedMark[]>()
      for (const m of played) {
        if (m.beat < p - 2 || m.beat > p + 1) continue
        const list = playedByMidi.get(m.midi)
        if (list) list.push(m)
        else playedByMidi.set(m.midi, [m])
      }
      const matched = new Set<PlayedMark>()

      const blockH = Math.max(9, Math.min(step, 1) * pxPerBeat * 0.78)

      const drawExpected = (e: ExpectedNote, beat: number) => {
        const bottom = hitY - (beat - p) * pxPerBeat
        const top = bottom - blockH
        if (bottom < -4 || top > H + blockH) return
        const x = layout.xOf(e.midi) * sx
        if (!Number.isFinite(x)) return
        const black = [1, 3, 6, 8, 10].includes(e.midi % 12)
        const w = (black ? KEY_BW : KEY_W) * sx * 0.8

        const hit = playedByMidi.get(e.midi)?.find((m) => Math.abs(m.beat - beat) <= HIT_BEATS)
        if (hit) matched.add(hit)
        const passed = beat < p - HIT_BEATS

        const hand = e.hand === 'l' ? rgb.left : rgb.right
        const base = live ? hand : rgb.grey
        // Brighter as it approaches the line: the next note is the loudest thing on screen.
        const near = Math.max(0, 1 - Math.abs(beat - p) / 1.5)

        ctx.save()
        if (hit) {
          const t = Math.abs(hit.devMs) < ON_TIME_MS ? rgb.ok : hit.devMs > 0 ? rgb.late : rgb.early
          ctx.shadowColor = `rgba(${t},0.9)`
          ctx.shadowBlur = 14
          ctx.fillStyle = `rgba(${t},0.95)`
          ctx.fillRect(x - w / 2, top, w, blockH)
        } else if (passed && live) {
          ctx.fillStyle = `rgba(${rgb.late},0.28)`
          ctx.fillRect(x - w / 2, top, w, blockH)
        } else {
          const g = ctx.createLinearGradient(0, top, 0, bottom)
          g.addColorStop(0, `rgba(${base},${0.18 + 0.25 * near})`)
          g.addColorStop(1, `rgba(${base},${0.45 + 0.4 * near})`)
          ctx.fillStyle = g
          ctx.fillRect(x - w / 2, top, w, blockH)
          ctx.strokeStyle = `rgba(${base},${0.55 + 0.45 * near})`
          ctx.lineWidth = 1.5
          ctx.strokeRect(x - w / 2 + 0.75, top + 0.75, w - 1.5, blockH - 1.5)
        }
        ctx.restore()

        // Where you fumble, marked on the note itself instead of in a list below.
        if (fumbles.has(e.group) && !hit) {
          ctx.strokeStyle = `rgba(${rgb.warn},0.9)`
          ctx.lineWidth = 2
          ctx.strokeRect(x - w / 2 - 3, top - 3, w + 6, blockH + 6)
        }

        // Finger number inside the block when it fits, on top of it otherwise.
        if (showFingers && e.finger && bottom > 0 && top < H) {
          const inside = blockH >= 14 && w >= 12
          // Dark on a lit block, light on a hollow one, the hand's colour outside.
          ctx.fillStyle = !inside ? `rgba(${base},0.95)` : hit ? panel : 'rgba(237,237,232,0.92)'
          ctx.font = `700 ${inside ? 11 : 12}px ${font}`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(String(e.finger), x, inside ? top + blockH / 2 + 0.5 : top - 9)
          ctx.textBaseline = 'alphabetic'
          ctx.textAlign = 'left'
        }
      }

      // The exercise runs in a loop, so it draws the current rep and the next —
      // otherwise the view empties on the second.
      const loop = cycleBeats > 0
      const firstCycle = loop ? Math.floor(p / cycleBeats) : 0
      for (const e of expected) {
        if (!loop) {
          drawExpected(e, e.beat)
          continue
        }
        for (let c = firstCycle - 1; c <= firstCycle + 1; c++) {
          if (c < 0) continue
          drawExpected(e, e.beat + c * cycleBeats)
        }
      }

      // Bursts at the hit line: every note you play leaves one, coloured by
      // timing; a note that matched no block bursts red.
      for (const [midi, list] of playedByMidi) {
        const x = layout.xOf(midi) * sx
        if (!Number.isFinite(x)) continue
        for (const m of list) {
          const age = p - m.beat
          if (age < 0 || age > BURST_BEATS) continue
          const k = age / BURST_BEATS
          const t = !matched.has(m)
            ? rgb.late
            : Math.abs(m.devMs) < ON_TIME_MS
              ? rgb.ok
              : m.devMs > 0
                ? rgb.late
                : rgb.early
          ctx.strokeStyle = `rgba(${t},${0.9 * (1 - k)})`
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.arc(x, hitY - 2, 5 + k * 22, Math.PI, 2 * Math.PI)
          ctx.stroke()
          ctx.fillStyle = `rgba(${t},${0.5 * (1 - k)})`
          ctx.fillRect(x - 1, hitY - 2 - (1 - k) * 26, 2, (1 - k) * 26)
        }
      }

      // Hit line: lit while the notes count, grey through the count-in.
      ctx.save()
      if (live) {
        ctx.shadowColor = `rgba(${rgb.right},0.8)`
        ctx.shadowBlur = 10
      }
      ctx.fillStyle = live ? `rgba(${rgb.right},0.95)` : `rgba(${rgb.grey},0.5)`
      ctx.fillRect(0, hitY - 1, cssW, 2)
      ctx.restore()

      raf = requestAnimationFrame(draw)
    }

    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
    // expected changes when the exercise or key changes; the rest comes in by ref.
  }, [expected, low, high, width, beatsPerBar, cycleBeats, windowBeats, showFingers, fumbleKey])

  return (
    <canvas
      ref={ref}
      className="piano-roll"
      style={{ width: '100%', height: '100%', display: 'block' }}
      role="img"
      aria-label="falling exercise notes"
    />
  )
}
