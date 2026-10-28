import { useEffect, useRef, type ReactNode } from 'react'
import { KEY_BW, KEY_W, keyLayout, type KeyMark } from '../keyboard'
import { liveVersion, onLiveChange, snapshot, type LiveNote } from './liveNotes'

// The live input: bars rise out of the keys while a note sounds and float away
// after it stops, each held note wears a label with its name and velocity, and the
// 88 keys sit underneath — all on one canvas.
//
// One canvas and not SVG + DOM labels: this redraws every frame while you play,
// and the old SVG keyboard re-rendered 61 React nodes per note. The canvas reads
// the note store directly and stops drawing when nothing moves.

export const FULL_LOW = 21 // A0
export const FULL_HIGH = 108 // C8

/** Height of the area above the keys, in CSS px. */
export const ROLL_PX = 200

/** How fast a bar rises, CSS px per second. */
const RISE_PX_PER_S = 110

/** Key height as a multiple of the white key width; a real key is about 6:1, drawn taller so it reads at a glance. */
const KEY_ASPECT = 7.5

const LABEL_ROWS = 4
const LABEL_ROW_PX = 25

/** Dark seam between keys and the shadow lip across the top of the keyboard, CSS px. */
const SEAM_PX = 1.5
const LIP_PX = 3
/** The bright cap a sounding note puts right on top of its key. */
const CAP_PX = 6

type Props = {
  /** Spelled name for a key, e.g. "F♯4" — follows the key signature. */
  nameOf: (midi: number) => string
  /** Practice marks on the keys: target, right, extra. */
  marks?: Map<number, KeyMark>
  /** Replaces the rising bars, e.g. the shred roll. Drawn over the roll area. */
  roll?: ReactNode
  /** Hide the bars and labels of what is played (a roll in `roll` shows its own). */
  quiet?: boolean
  title?: ReactNode
}

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

/** "#347ce2" -> "52,124,226", so alpha can vary per bar without new strings per colour. */
function rgbOf(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return '52,124,226'
  const n = parseInt(m[1], 16)
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`
}

export function LiveInput({ nameOf, marks, roll, quiet = false, title = 'Live input' }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  // Props reach the draw loop through refs, so a new mark map or a new key
  // signature does not tear down and rebuild the loop.
  const marksRef = useRef(marks)
  const nameRef = useRef(nameOf)
  const quietRef = useRef(quiet)
  const dirtyRef = useRef<() => void>(() => {})
  marksRef.current = marks
  nameRef.current = nameOf
  quietRef.current = quiet

  useEffect(() => {
    dirtyRef.current()
  }, [marks, nameOf, quiet])

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!wrap || !canvas || !ctx) return

    const layout = keyLayout(FULL_LOW, FULL_HIGH)
    const font = cssVar('--sans', 'system-ui, sans-serif')
    const mono = cssVar('--mono', 'ui-monospace, monospace')
    const c = {
      panel: cssVar('--panel', '#101011'),
      bg: cssVar('--bg', '#0b0b0c'),
      line: cssVar('--line', '#1c1c1a'),
      border: cssVar('--border', '#2a2a26'),
      fg: cssVar('--fg', '#edede8'),
      dim: cssVar('--dim', '#8b8b83'),
      faint: cssVar('--faint', '#82827a'),
      accent: cssVar('--accent', '#347ce2'),
      accentDeep: cssVar('--accent-deep', '#2a5ea8'),
      badDeep: cssVar('--bad-deep', '#c2412f'),
      keyLit: cssVar('--key-lit', '#347ce2'),
      keyHeld: cssVar('--key-held', '#1e3f6e'),
      white: cssVar('--key-white', '#e4e4de'),
      black: cssVar('--key-black', '#1c1c1a'),
      missWhite: '#a9c4ec',
      missBlack: '#1d3355',
    }
    const accentRgb = rgbOf(c.accent)

    let cssW = 0
    let cssH = 0
    let scale = 1
    let keysTop = ROLL_PX
    let whiteH = 0
    let blackH = 0
    let dpr = 1
    let raf = 0
    let drawnVersion = -1
    let dirty = true

    const resize = () => {
      cssW = wrap.clientWidth
      if (cssW === 0) return
      scale = cssW / layout.width
      whiteH = Math.round(KEY_W * scale * KEY_ASPECT)
      blackH = Math.round(whiteH * 0.62)
      keysTop = ROLL_PX
      cssH = keysTop + whiteH + 18 // room for the octave labels under the keys
      dpr = Math.min(2, window.devicePixelRatio || 1)
      canvas.width = Math.round(cssW * dpr)
      canvas.height = Math.round(cssH * dpr)
      canvas.style.height = `${cssH}px`
      dirty = true
      kick()
    }

    const drawBars = (notes: LiveNote[], now: number) => {
      for (const n of notes) {
        const x = layout.xOf(n.midi) * scale
        if (!Number.isFinite(x)) continue
        const black = [1, 3, 6, 8, 10].includes(n.midi % 12)
        const w = (black ? KEY_BW : KEY_W) * scale * 0.8
        const sounding = Number.isNaN(n.off)
        const top = keysTop - (now - n.on) * (RISE_PX_PER_S / 1000)
        const bottom = sounding ? keysTop : keysTop - (now - n.off) * (RISE_PX_PER_S / 1000)
        if (bottom <= 0) continue
        const y0 = Math.max(0, top)
        // A muted column, brightest at the key, so the labels and the cap stand
        // out over it. Velocity is how bright: a soft note is a faint bar.
        const a = (0.2 + 0.35 * (n.velocity / 127)) * (n.sustained ? 0.6 : 1)
        const g = ctx.createLinearGradient(0, keysTop, 0, 0)
        g.addColorStop(0, `rgba(${accentRgb},${a})`)
        g.addColorStop(1, `rgba(${accentRgb},${a * 0.25})`)
        ctx.fillStyle = g
        ctx.fillRect(x - w / 2, y0, w, bottom - y0)
        // The cap: the note's full colour where it touches the key, while struck.
        if (sounding && !n.sustained) {
          ctx.fillStyle = c.accent
          ctx.fillRect(x - w / 2, keysTop - CAP_PX, w, CAP_PX)
        }
      }
    }

    const drawLabels = (notes: LiveNote[]) => {
      // Greedy rows, left to right: each label takes the lowest row where it does
      // not touch the one before it. A cluster stairs upward instead of piling up.
      const sorted = [...notes].sort((p, q) => p.midi - q.midi)
      const rowRight = new Array<number>(LABEL_ROWS).fill(-Infinity)
      ctx.textBaseline = 'middle'
      for (const n of sorted) {
        const x = layout.xOf(n.midi) * scale
        if (!Number.isFinite(x)) continue
        const name = nameRef.current(n.midi)
        const vel = String(n.velocity)
        ctx.font = `700 13px ${font}`
        const nameW = ctx.measureText(name).width
        ctx.font = `400 11px ${mono}`
        const velW = ctx.measureText(vel).width
        const w = nameW + velW + 6 + 14
        const left = Math.min(Math.max(2, x - w / 2), cssW - w - 2)
        let row = rowRight.findIndex((r) => r + 4 <= left)
        if (row === -1) row = LABEL_ROWS - 1
        rowRight[row] = left + w
        const h = 21
        const y = keysTop - 10 - h - row * LABEL_ROW_PX

        // Stem: a thin bright line tying a label that climbed a few rows back to
        // its own key, through the bar.
        ctx.fillStyle = n.sustained ? c.border : c.accent
        ctx.fillRect(Math.round(x) - 1, y + h, 2, keysTop - CAP_PX - (y + h))

        // Dark, tinted with the accent, so it sits on the bar instead of
        // punching a black hole in it.
        ctx.fillStyle = c.bg
        ctx.fillRect(left, y, w, h)
        ctx.fillStyle = `rgba(${accentRgb},${n.sustained ? 0.05 : 0.1})`
        ctx.fillRect(left, y, w, h)
        ctx.strokeStyle = n.sustained ? c.border : `rgba(${accentRgb},0.45)`
        ctx.lineWidth = 1
        ctx.strokeRect(left + 0.5, y + 0.5, w - 1, h - 1)
        ctx.fillStyle = n.sustained ? c.dim : c.fg
        ctx.font = `700 13px ${font}`
        ctx.fillText(name, left + 7, y + h / 2 + 0.5)
        ctx.fillStyle = c.accent
        ctx.font = `400 11px ${mono}`
        ctx.fillText(vel, left + 7 + nameW + 6, y + h / 2 + 0.5)
      }
    }

    const drawKeys = (lit: Map<number, LiveNote>) => {
      const marksNow = marksRef.current
      const fillFor = (midi: number, base: string) => {
        const note = lit.get(midi)
        const mark = marksNow?.get(midi)
        if (mark === 'extra') return c.badDeep
        // Right notes take the struck colour: it is the one that holds 3:1 on both key colours.
        if (mark === 'correct') return c.keyLit
        // A struck key takes the accent: 3.3:1 against an unlit white key, 4.1:1
        // against an unlit black one. Pedal-held goes darker on the white keys;
        // on a black key that would sink into the key itself, so it stays lit.
        if (note) return note.sustained && base === c.white ? c.keyHeld : c.keyLit
        // A target note not played yet: tinted, so it reads at a glance on both
        // the white and the black keys, and outlined below so it never looks struck.
        if (mark === 'missing') return base === c.white ? c.missWhite : c.missBlack
        return base
      }

      // The seams are the background showing between the keys.
      ctx.fillStyle = c.bg
      ctx.fillRect(0, keysTop, cssW, whiteH)
      const bevel = Math.round(whiteH * 0.08)
      for (const k of layout.keys) {
        if (k.black) continue
        const x = k.x * scale + SEAM_PX / 2
        const w = KEY_W * scale - SEAM_PX
        const fill = fillFor(k.midi, c.white)
        ctx.fillStyle = fill
        ctx.fillRect(x, keysTop, w, whiteH)
        // The front edge of the key, a touch darker: it reads as a key, not a stripe.
        if (fill === c.white) {
          ctx.fillStyle = 'rgba(0,0,0,0.09)'
          ctx.fillRect(x, keysTop + whiteH - bevel, w, bevel)
        }
      }
      for (const k of layout.keys) {
        if (!k.black) continue
        const x = k.x * scale
        const w = KEY_BW * scale
        ctx.fillStyle = c.bg
        ctx.fillRect(x - SEAM_PX, keysTop, w + SEAM_PX * 2, blackH + SEAM_PX)
        ctx.fillStyle = fillFor(k.midi, c.black)
        ctx.fillRect(x, keysTop, w, blackH)
      }
      // The lip: a shadow across the top of the keyboard, under the bars' caps.
      ctx.fillStyle = c.bg
      ctx.fillRect(0, keysTop, cssW, LIP_PX)
      // "Missing" is an outline, so a target note you have not played yet is
      // visible without pretending it was struck.
      if (marksNow) {
        ctx.setLineDash([4, 3])
        ctx.lineWidth = 2
        ctx.strokeStyle = c.accentDeep
        for (const k of layout.keys) {
          if (marksNow.get(k.midi) !== 'missing') continue
          const x = k.x * scale
          const w = (k.black ? KEY_BW : KEY_W) * scale
          ctx.strokeRect(x + 1.5, keysTop + 1.5, w - 3, (k.black ? blackH : whiteH) - 3)
        }
        ctx.setLineDash([])
      }

      ctx.fillStyle = c.faint
      ctx.font = `400 10px ${font}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'alphabetic'
      for (const k of layout.keys) {
        if (k.midi % 12 !== 0) continue
        ctx.fillText(`C${k.midi / 12 - 1}`, (k.x + KEY_W / 2) * scale, keysTop + whiteH + 13)
      }
      ctx.textAlign = 'left'
    }

    const draw = () => {
      raf = 0
      if (cssW === 0) return
      const now = performance.now()
      const snap = snapshot(now)
      const animating = snap.sounding.length > 0 || snap.trail.length > 0
      const v = liveVersion()
      if (!animating && !dirty && v === drawnVersion) return
      drawnVersion = v
      dirty = false

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = c.panel
      ctx.fillRect(0, 0, cssW, cssH)

      // Octave lines: a pitch reference faint enough to vanish behind the bars.
      ctx.fillStyle = 'rgba(255,255,255,0.035)'
      for (const k of layout.keys) {
        if (k.midi % 12 === 0) ctx.fillRect(Math.round(k.x * scale), 0, 1, keysTop)
      }

      if (!quietRef.current) {
        drawBars(snap.trail, now)
        drawBars(snap.sounding, now)
      }
      drawKeys(new Map(snap.sounding.map((n) => [n.midi, n])))
      if (!quietRef.current) drawLabels(snap.sounding)

      // Keep going only while something is still moving.
      if (animating) raf = requestAnimationFrame(draw)
    }

    const kick = () => {
      if (!raf) raf = requestAnimationFrame(draw)
    }
    dirtyRef.current = () => {
      dirty = true
      kick()
    }

    const ro = new ResizeObserver(resize)
    ro.observe(wrap)
    resize()
    const unsub = onLiveChange(kick)

    return () => {
      ro.disconnect()
      unsub()
      if (raf) cancelAnimationFrame(raf)
      dirtyRef.current = () => {}
    }
  }, [])

  return (
    <section className="panel live-input">
      <header className="panel-head">
        <h3>{title}</h3>
      </header>
      <div className="live-wrap" ref={wrapRef}>
        <canvas ref={canvasRef} className="live-canvas" role="img" aria-label="live input keyboard" />
        {roll && (
          <div className="live-roll-slot" style={{ height: ROLL_PX }}>
            {roll}
          </div>
        )}
      </div>
    </section>
  )
}
