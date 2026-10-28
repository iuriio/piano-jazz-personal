import { Chord } from 'tonal'

// Three ways to write the same chord. The card cycles through them on click.
//
// - exact: everything that was played, as the analysis names it (C7♯9, Cmaj9).
// - jazz: lead-sheet shorthand — Δ for major seventh, – for minor, ø half-
//   diminished, ° diminished, alterations in parentheses. What a chart says.
// - simple: reduced to the triad or the seventh chord underneath. What a
//   beginner, or a quick comping read, needs.

export type NamingStyle = 'exact' | 'jazz' | 'simple'

export const NAMING_STYLES: NamingStyle[] = ['exact', 'jazz', 'simple']

export const NAMING_LABEL: Record<NamingStyle, string> = {
  exact: 'exact names',
  jazz: 'jazz names',
  simple: 'simple names',
}

export function nextNamingStyle(s: NamingStyle): NamingStyle {
  return NAMING_STYLES[(NAMING_STYLES.indexOf(s) + 1) % NAMING_STYLES.length]
}

/** "C♯m7/G♯" -> { root: "C♯", quality: "m7", bass: "G♯" }. Display glyphs are kept. */
export function splitSymbol(symbol: string): { root: string; quality: string; bass: string | null } {
  const m = /^([A-G][♯♭#b]*)(.*?)(?:\/([A-G][♯♭#b]*))?$/.exec(symbol)
  if (!m) return { root: symbol, quality: '', bass: null }
  return { root: m[1], quality: m[2], bass: m[3] ?? null }
}

const toAscii = (s: string) => s.replace(/♯/g, '#').replace(/♭/g, 'b')
const toGlyph = (s: string) => s.replace(/#/g, '♯').replace(/(\d)b|b(\d)/g, (_, a, b) => (a ? `${a}♭` : `♭${b}`))

/**
 * Jazz shorthand for a quality. Order matters: the longer, more specific forms
 * are replaced before their prefixes.
 */
export function jazzQuality(q: string): string {
  const ascii = toAscii(q)
  if (ascii === '' || ascii === 'M') return ''
  if (ascii === '5') return '5'

  // Half-diminished is one symbol, not a minor seventh with an altered fifth.
  if (ascii === 'm7b5') return 'ø7'

  let base = ascii
  let alts = ''
  // Alterations written after the core quality go in parentheses: 7#9 -> 7(♯9).
  const altMatch = /^(.*?\d*)((?:[#b](?:5|9|11|13))+)$/.exec(base)
  if (altMatch && altMatch[1] !== '') {
    base = altMatch[1]
    alts = altMatch[2]
  }

  const rules: [RegExp, string][] = [
    [/^m7b5$/, 'ø7'],
    [/^dim7$|^o7$/, '°7'],
    [/^dim$|^o$/, '°'],
    [/^(?:m|-)(?:Maj|M|maj)(\d+)$/, '–Δ$1'],
    [/^(?:Maj|M|maj)(\d+)$/, 'Δ$1'],
    [/^m(\d*)(.*)$/, '–$1$2'],
    [/^aug$/, '+'],
  ]
  for (const [re, out] of rules) {
    if (re.test(base)) {
      base = base.replace(re, out)
      break
    }
  }
  const altText = alts ? `(${toGlyph(alts.replace(/([#b])/g, ' $1').trim().replace(/ /g, ','))})` : ''
  return toGlyph(base) + altText
}

/**
 * The triad or seventh chord under a quality, from its intervals. Anything the
 * analysis cannot parse is returned as it came — better an exact name than a wrong
 * simple one.
 */
export function simpleQuality(q: string): string {
  const ascii = toAscii(q)
  if (ascii === '' || ascii === '5') return ascii
  const chord = Chord.get(`C${ascii}`)
  if (chord.empty) return q
  const iv = new Set(chord.intervals)
  const has = (...xs: string[]) => xs.some((x) => iv.has(x))

  const third = has('3M') ? 'M' : has('3m') ? 'm' : has('4P') ? 'sus4' : has('2M', '9M') ? 'sus2' : 'M'
  const fifth = has('5d') && !has('5P') ? 'd' : has('5A') && !has('5P') ? 'A' : 'P'
  const seventh = has('7M') ? 'M' : has('7m') ? 'm' : has('7d') ? 'd' : null

  if (third === 'sus4' || third === 'sus2') return seventh === 'm' ? `7${third}` : third
  if (third === 'm') {
    if (fifth === 'd') return seventh === 'm' ? 'm7♭5' : seventh === 'd' ? 'dim7' : 'dim'
    if (seventh === 'M') return 'mMaj7'
    return seventh === 'm' ? 'm7' : 'm'
  }
  if (fifth === 'A') return seventh === 'M' ? 'maj7♯5' : seventh === 'm' ? '7♯5' : 'aug'
  if (seventh === 'M') return 'maj7'
  if (seventh === 'm') return fifth === 'd' ? '7♭5' : '7'
  return ''
}

/** The symbol written in the chosen style. Slash bass survives every style. */
export function styleSymbol(symbol: string, style: NamingStyle): string {
  if (style === 'exact') return symbol
  const { root, quality, bass } = splitSymbol(symbol)
  // A dyad or a single note has no quality to restyle.
  if (!/^[A-G]/.test(symbol)) return symbol
  const q = style === 'jazz' ? jazzQuality(quality) : simpleQuality(quality)
  return `${root}${q}${bass && bass !== root ? `/${bass}` : ''}`
}
