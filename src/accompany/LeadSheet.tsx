import { nextNamingStyle } from '../stage/naming'
import { useSettings } from '../stage/settings'
import { accompanist, useAccompany, type SheetRow } from './accompanist'
import { chordText } from './display'
import { STYLES } from './patterns'
import { Select } from '../ui/Select'
import { Slider } from '../ui/Slider'
import { ACCOMPANY_DRUMS_OPTIONS, ACCOMPANY_KEYS_OPTIONS, type AccompanySettings } from './settings'

const COMPLEXITY_LABEL = ['triads', 'sevenths', 'extensions', 'substitutions']

/**
 * The chart, iReal-style, in the notation slot while the band plays: the phrase
 * being played on top (the current bar marked, its beat counted), the next one
 * under it, dimmer, already decided. The card beside it still reads what YOU
 * play; this is what the band plays.
 */
export function LeadSheet() {
  const { settings, update } = useSettings()
  const { play } = useAccompany()
  if (!play) return null
  const acc = settings.accompany
  const set = (patch: Partial<AccompanySettings>) => update({ accompany: { ...acc, ...patch } })
  const tempo = play.free ? 'free time' : `${play.bpm} ${play.tempo === 'lock' ? 'lock' : '~'}`

  return (
    <section className="panel notation lead-sheet" aria-label="accompaniment chart">
      <header className="panel-head">
        <h3>
          accompany · {play.keyLabel} · <span className="ls-bpm">{tempo}</span>
        </h3>
        <button className="ls-stop" onClick={() => accompanist.stop()} title="Stop the accompaniment">
          ■ stop
        </button>
      </header>

      <div
        className="ls-grid"
        onClick={() => update({ naming: nextNamingStyle(settings.naming) })}
        title="Cycle exact / jazz / simple chord names"
      >
        {play.rows.map((row, r) => (
          <Row key={row.index} row={row} current={r === 0 ? play.bar : -1} beat={play.beat} naming={settings.naming} waiting={play.waiting} />
        ))}
      </div>

      <div className="ls-controls">
        <label className="ls-ctl">
          <span className="grp-label">keys</span>
          <Select
            value={acc.keys}
            onValueChange={(v) => set({ keys: v as AccompanySettings['keys'] })}
            options={ACCOMPANY_KEYS_OPTIONS}
          />
        </label>
        <label className="ls-ctl">
          <span className="grp-label">drums</span>
          <Select
            value={acc.drums}
            onValueChange={(v) => set({ drums: v as AccompanySettings['drums'] })}
            options={ACCOMPANY_DRUMS_OPTIONS}
          />
        </label>
        <label className="ls-ctl">
          <span className="grp-label">style</span>
          <Select
            value={acc.style}
            onValueChange={(v) => set({ style: v as AccompanySettings['style'] })}
            options={[{ value: 'auto', label: `auto (${play.style})` }, ...STYLES.map((s) => ({ value: s, label: s }))]}
          />
        </label>
        <label className="ls-ctl" title="Bars per chord">
          <span className="grp-label">density</span>
          <Select
            value={acc.density}
            onValueChange={(v) => set({ density: v as AccompanySettings['density'] })}
            options={[
              { value: 'auto', label: 'auto' },
              { value: '1', label: '1 chord / bar' },
              { value: '2', label: '1 chord / 2 bars' },
            ]}
          />
        </label>
        <label className="ls-ctl ls-rich" title={COMPLEXITY_LABEL[acc.complexity - 1]}>
          <span className="grp-label">simple</span>
          <Slider
            min={1}
            max={4}
            value={acc.complexity}
            aria-label="chord complexity"
            aria-valuetext={COMPLEXITY_LABEL[acc.complexity - 1]}
            onValueChange={(v) => set({ complexity: v as AccompanySettings['complexity'] })}
          />
          <span className="grp-label">rich</span>
        </label>
        <span className="ls-ctl ls-seg" role="group" aria-label="tempo">
          <span className="grp-label">tempo</span>
          {(['follow', 'lock'] as const).map((t) => (
            <button key={t} className={acc.tempo === t ? 'on' : ''} aria-pressed={acc.tempo === t} onClick={() => set({ tempo: t })}>
              {t}
            </button>
          ))}
        </span>
        <label className="ls-ctl">
          <span className="grp-label">vol</span>
          <Slider
            min={0}
            max={100}
            step={5}
            value={Math.round(acc.level * 100)}
            aria-label="accompaniment volume"
            onValueChange={(v) => set({ level: v / 100 })}
          />
        </label>
      </div>
    </section>
  )
}

function Row({
  row,
  current,
  beat,
  naming,
  waiting,
}: {
  row: SheetRow
  current: number
  beat: number
  naming: Parameters<typeof chordText>[1]
  waiting: boolean
}) {
  return (
    <div className={`ls-row ${row.planned ? 'planned' : ''}`}>
      <span className="ls-section" aria-label={`section ${row.section}`}>
        {row.section}
      </span>
      {row.bars.map((bar, i) => {
        const now = i === current
        return (
          <div key={i} className={`ls-bar ${now ? 'now' : ''} ${now && waiting ? 'waiting' : ''}`} aria-current={now ? 'true' : undefined}>
            {i === row.toBar && row.to && <span className="ls-to">→ {row.to}</span>}
            <div className="ls-chords">
              {bar.chords.map((c, j) =>
                c.hold ? (
                  <span key={j} className="ls-hold" title="same chord">
                    %
                  </span>
                ) : (
                  <span key={j} className="ls-chord">
                    {chordText(c.symbol, naming)}
                  </span>
                ),
              )}
            </div>
            {now && (
              <div className="ls-beats fact-in" aria-hidden="true">
                {[0, 1, 2, 3].map((b) => (
                  <i key={b} className={b <= beat ? 'on' : ''} />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
