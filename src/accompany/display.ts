import { styleSymbol, type NamingStyle } from '../stage/naming'

/**
 * A planned chord as the card would write it: same naming style (exact / jazz /
 * simple), real ♭ and ♯ glyphs. The planner speaks ASCII ("Bbmaj7", "D7b9").
 */
export function chordText(symbol: string, naming: NamingStyle): string {
  const glyphRoot = (s: string) => s.replace(/^([A-G])b/, '$1♭').replace(/^([A-G])#/, '$1♯')
  const styled = styleSymbol(glyphRoot(symbol), naming)
  // Alterations left in ASCII by the exact style: 7b9 -> 7♭9, 7#11 -> 7♯11.
  return styled.replace(/b(\d)/g, '♭$1').replace(/#(\d)/g, '♯$1')
}
