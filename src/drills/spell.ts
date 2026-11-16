import { PITCH_CLASSES_LEAD, noteAbove } from '../theory'

export { noteAbove }

// Names for the drills that jump between all 12 roots. They ask for a root the
// way a lead sheet writes it (F♯, not G♭; A♭, not G♯) instead of following the
// page's key signature: the point is to meet every root, not to stay in a key.
// The stage reads with the same names: see PITCH_CLASSES_LEAD.
export const ROOT_NAMES = PITCH_CLASSES_LEAD

/**
 * The order roots are introduced in when a drill builds up gradually: the white
 * keys by fifths from C, then the flats, F♯ last.
 */
export const LEARN_ORDER = [0, 5, 7, 2, 9, 4, 11, 10, 3, 8, 1, 6]

/**
 * A curriculum: tier by tier, root by root, every row of the tier on that root.
 * The first questions are therefore a handful of different things over one
 * root — the chord tones of C — rather than one thing over every root.
 */
export function curriculum(tiers: readonly (readonly string[])[], enabled: readonly string[], id: (row: string, pc: number) => string): string[] {
  return tiers.flatMap((tier) => {
    const rows = tier.filter((r) => enabled.includes(r))
    return LEARN_ORDER.flatMap((pc) => rows.map((r) => id(r, pc)))
  })
}

/** ASCII accidentals of a note name to the glyphs shown on screen: "Bb" -> "B♭". */
export function glyph(name: string): string {
  return name.replace(/^([A-G])([b#]+)/, (_m, letter: string, acc: string) => letter + acc.replace(/b/g, '♭').replace(/#/g, '♯'))
}

/** The MIDI note of a pitch class closest to `near`; a tie (a tritone away) goes up. */
export function nearestWithPc(pc: number, near: number): number {
  const up = (((pc - near) % 12) + 12) % 12
  return up <= 6 ? near + up : near + up - 12
}
