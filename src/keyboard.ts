export type KeyMark = 'held' | 'correct' | 'extra' | 'missing'

const BLACK_PCS = new Set([1, 3, 6, 8, 10])

// Keyboard geometry and practice marks. The keys themselves are drawn by the live
// input's canvas; the shred roll draws on this same axis — if each of them did its
// own arithmetic, the notes would fall outside the key.
export const KEY_W = 26 // white key width
export const KEY_BW = 16 // black key width

const W = KEY_W
const BW = KEY_BW

export type KeyGeom = { midi: number; x: number; w: number; black: boolean }
export type Layout = { keys: KeyGeom[]; width: number; xOf: (midi: number) => number }

/** Position of every key in the range. Single source of the horizontal axis. */
export function keyLayout(low: number, high: number): Layout {
  const keys: KeyGeom[] = []
  let whiteCount = 0
  for (let midi = low; midi <= high; midi++) {
    if (BLACK_PCS.has(midi % 12)) {
      keys.push({ midi, x: whiteCount * W - BW / 2, w: BW, black: true })
    } else {
      keys.push({ midi, x: whiteCount * W, w: W, black: false })
      whiteCount++
    }
  }
  const byMidi = new Map(keys.map((k) => [k.midi, k]))
  return {
    keys,
    width: whiteCount * W,
    xOf: (midi) => {
      const k = byMidi.get(midi)
      return k ? k.x + k.w / 2 : Number.NaN
    },
  }
}

/** Builds the mark map from the result of compareToTarget. */
export function marksFromComparison(c: {
  correct: number[]
  extra: number[]
  missing: number[]
}): Map<number, KeyMark> {
  const m = new Map<number, KeyMark>()
  for (const n of c.missing) m.set(n, 'missing')
  for (const n of c.correct) m.set(n, 'correct')
  for (const n of c.extra) m.set(n, 'extra')
  return m
}
