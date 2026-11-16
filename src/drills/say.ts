// What the voice says. Kept apart from the speaking itself so the wording can
// be tested, and so a name that comes out wrong is fixed in one table.

/**
 * A note name as it is said: "F-sharp", "B-flat". Takes ASCII or glyph
 * accidentals.
 *
 * Two things here are for the speech engine, not for the reader. The hyphen
 * keeps "A-flat" from being read as the article ("a flat tyre"), and the comma
 * after a bare "A" does the same for "A minor seven".
 */
export function sayNote(name: string): string {
  const m = /^([A-G])([b#♭♯]*)$/.exec(name)
  if (!m) return name
  const [, letter, acc] = m
  if (!acc) return letter === 'A' ? 'A,' : letter
  const word = acc[0] === 'b' || acc[0] === '♭' ? 'flat' : 'sharp'
  return `${letter}-${acc.length > 1 ? 'double-' : ''}${word}`
}

// By what follows the root in the symbol, so one table serves every drill.
const QUALITY: Record<string, string> = {
  '': 'major',
  m: 'minor',
  maj7: 'major seven',
  m7: 'minor seven',
  '7': 'seven',
  ø: 'half diminished',
  '°7': 'diminished seven',
  'm(maj7)': 'minor, major seven',
  '6': 'six',
  m6: 'minor six',
  '7♯5': 'seven sharp five',
}

/** A chord symbol as it is said: "F♯m7" -> "F-sharp minor seven". */
export function sayChord(symbol: string): string {
  const m = /^([A-G][b#♭♯]?)(.*)$/.exec(symbol)
  if (!m) return symbol
  return `${sayNote(m[1])} ${QUALITY[m[2]] ?? m[2]}`
}

const ORDINAL: Record<string, string> = {
  '2nd': 'second',
  '3rd': 'third',
  '4th': 'fourth',
  '5th': 'fifth',
  '6th': 'sixth',
  '7th': 'seventh',
}

/** "minor 7th", "F#" -> "minor seventh above F-sharp". */
export function sayInterval(intervalName: string, root: string): string {
  const words = intervalName.replace(/\d(nd|rd|th)/, (o) => ORDINAL[o] ?? o)
  return `${words} above ${sayNote(root)}`
}
