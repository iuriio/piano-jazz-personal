import { useMemo } from 'react'
import { keyById, readChord } from '../analysis'
import { chordLabel, detectVoicing } from '../theory'
import { NAMING_LABEL, nextNamingStyle, styleSymbol } from './naming'
import { useStage } from './settings'
import { useShownChordNotes } from './shownChord'

// Degree labels in the order a chord is built: root, third, fifth, seventh,
// then the extensions. The analysis lists them as played, which puts a ♯9 voiced
// under the third ahead of it — right for "spelled", wrong for reading the chord.
const DEGREE_ORDER = ['R', '♭2', '2', '♯2', '♭3', '3', '4', '♯4', '♭5', '5', '♯5', '♭6', '6', '♭♭7', '♭7', '7', '♭9', '9', '♯9', '11', '♯11', '♭13', '13']

function byDegree(intervals: string[]): string[] {
  const rank = (d: string) => {
    const i = DEGREE_ORDER.indexOf(d)
    return i === -1 ? DEGREE_ORDER.length : i
  }
  return [...intervals].sort((a, b) => rank(a) - rank(b))
}

/**
 * The chord you just played, read every way that matters at the keyboard.
 *
 * It shows the last settled chord and keeps it up after you let go, and while
 * you play a melody over it — only "notes held" follows your hands live, so you
 * can read the card with your hands off the keys. Melody notes the chord's name
 * leaves out show up as tensions in the intervals.
 */
export function ChordCard() {
  const { settings, update, held } = useStage()
  const key = keyById(settings.keyId)
  const notes = useShownChordNotes()

  const reading = useMemo(
    () => readChord(notes, { key, split: settings.split, splitPoint: settings.splitPoint }),
    [notes, key, settings.split, settings.splitPoint],
  )
  // keytrainer's own voicing table: recognises the named jazz shapes.
  const match = useMemo(() => detectVoicing(notes), [notes])
  const spelling = key.accidentals < 0 ? 'flat' : 'sharp'

  const symbol = reading ? styleSymbol(reading.symbol, settings.naming) : null

  const rows: [string, string, string?][] = reading
    ? [
        ['position', reading.position],
        ['voicing', reading.voicing],
        ['root', reading.root, 'accent'],
        // The melody's tensions come after the chord's own degrees, marked "+".
        [
          'intervals',
          [
            ...byDegree(reading.intervals.filter((i) => !reading.extras.includes(i))),
            ...reading.extras.map((e) => `+${e}`),
          ].join(' '),
        ],
        ['spelled', reading.spelled.join(' ')],
        ...(reading.bass ? ([['bass', reading.bass]] as [string, string][]) : []),
      ]
    : [
        ['position', '—'],
        ['voicing', '—'],
        ['root', '—'],
        ['intervals', '—'],
        ['spelled', '—'],
      ]

  return (
    <section className="panel chord-card">
      <header className="panel-head">
        <button
          className="naming"
          onClick={() => update({ naming: nextNamingStyle(settings.naming) })}
          title="Cycle exact / jazz / simple chord names"
        >
          [ {NAMING_LABEL[settings.naming]} ]
        </button>
      </header>

      <div className="card-body">
        <div className="card-name">
          {symbol ? (
            <>
              <div className={`chord-big ${symbol.length > 7 ? 'long' : ''}`}>{symbol}</div>
              <div className="chord-quality">{reading?.name}</div>
              {match && (
                <div className="voicing-name">
                  {match.voicing.label} on{' '}
                  {chordLabel(match.rootMidi % 12, match.quality, spelling)}
                </div>
              )}
              {reading && reading.alternatives.length > 0 && (
                <div className="alt-names">also {reading.alternatives.join(', ')}</div>
              )}
            </>
          ) : (
            <>
              <div className="chord-big empty">no chord yet</div>
              <div className="chord-quality">play on your MIDI keyboard or the computer keys</div>
            </>
          )}
        </div>

        <dl className="card-facts">
          {rows.map(([k, v, cls]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd className={cls}>{v}</dd>
            </div>
          ))}
          <div>
            <dt>notes held</dt>
            <dd className="held-count">{held.length}</dd>
          </div>
        </dl>
      </div>
      {match?.voicing.note && <p className="voicing-note">{match.voicing.note}</p>}
    </section>
  )
}
