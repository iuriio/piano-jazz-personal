import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { accompanist, useAccompany, type PlayView } from '../accompany/accompanist'
import { BpmControl } from '../accompany/AccompanyBadge'
import { chordText } from '../accompany/display'
import { BandControls } from '../accompany/LeadSheet'
import { heard } from '../accompany/listener'
import { autoStyle } from '../accompany/patterns'
import { renderChart } from '../accompany/progression'
import type { KeyMark } from '../keyboard'
import { nextNamingStyle, type NamingStyle } from '../stage/naming'
import { useSettings, type ImprovDrillId } from '../stage/settings'
import { Workspace } from '../stage/Workspace'
import { pitchClassName } from '../theory'
import { Select } from '../ui/Select'
import { Swap } from '../ui/Swap'
import { Switch } from '../ui/Switch'
import { DrillPicker } from './DrillPicker'
import {
  CHARTS,
  CHART_BY_ID,
  MIN_PHRASE_NOTES,
  NEW_FLOW,
  NEW_MOTIF,
  PAUSE_SILENT_BEATS,
  PER_BEAT,
  TONE_LABEL,
  flowStep,
  guideLines,
  guideTones,
  judgeLanding,
  motifOf,
  motifStep,
  placeAt,
  soloLine,
  splitPhrases,
  stopAfterMs,
  targetNames,
  targetPcs,
  type Flow,
  type MotifRun,
  type Sub,
  type Target,
} from './improv'
import { ROOT_NAMES, glyph } from './spell'
import { useStored } from './stored'
import { useCue } from './useDrillSound'

// How often the drill looks at what you played. Verdicts are stamped with the
// notes' own clock, so this only sets how soon they show.
const LOOK_MS = 60
const HISTORY = 5

/** The lowest note that counts as the solo; 0 = the whole keyboard. */
const LOWEST: { value: string; label: string }[] = [
  { value: '0', label: 'the whole keyboard' },
  { value: '48', label: 'C3 and up' },
  { value: '55', label: 'G3 and up' },
  { value: '60', label: 'middle C and up' },
]

const COPY: Record<ImprovDrillId, { title: string; note: string }> = {
  'solo-flow': {
    title: 'never stop',
    note: 'Solo over the changes without stopping. What you play does not matter: a scale, a blues lick, a chromatic run. Stuck? Repeat the same few notes until the next idea comes. A wrong note is not a stop. A silence is.',
  },
  'solo-guide': {
    title: 'land on a guide tone',
    note: `Play a short phrase, pause, play another. Each one has to end on the third or the seventh of the chord it lands on, so you need to know the chord that is coming and steer toward it. A phrase is ${MIN_PHRASE_NOTES} notes or more, closed by ${PAUSE_SILENT_BEATS} beat of silence.`,
  },
  'solo-motif': {
    title: 'repeat and change',
    note: 'Play a phrase, then play it again with one thing changed: a note, the rhythm, the speed, where it starts, which way up it goes. Then a new phrase, and the same again. That is how a solo holds together.',
  },
}

type Entry = { id: number; ok: boolean | null; text: string; detail: string }

type Run = {
  flow: Flow
  entries: Entry[]
  /** Phrases judged, how many were right, and how many right in a row. */
  judged: number
  hits: number
  streak: number
  motif: MotifRun
}

const NEW_RUN: Run = { flow: NEW_FLOW, entries: [], judged: 0, hits: 0, streak: 0, motif: NEW_MOTIF }

type Best = Record<string, number>
const isBest = (v: unknown): boolean =>
  !!v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every((n) => typeof n === 'number')

const sameFlow = (a: Flow, b: Flow) =>
  a.start === b.start && a.last === b.last && a.notes === b.notes && a.stops === b.stops && a.longest === b.longest && a.ended === b.ended

function judged(run: Run, entry: Omit<Entry, 'id'>): Run {
  const id = run.judged + 1
  return {
    ...run,
    judged: id,
    hits: run.hits + (entry.ok ? 1 : 0),
    streak: entry.ok === false ? 0 : run.streak + (entry.ok ? 1 : 0),
    entries: [{ id, ...entry }, ...run.entries].slice(0, HISTORY),
  }
}

/**
 * The three improvisation exercises, over a band playing changes you pick:
 * never stop, land every phrase on a guide tone, repeat a phrase and change
 * one thing. The band is the accompaniment's own, on a written chart.
 */
export function ImprovDrill({ exercise }: { exercise: ImprovDrillId }) {
  const { settings, update } = useSettings()
  const { phase, play } = useAccompany()
  const acc = settings.accompany
  const on = phase !== 'idle'

  const [chartId, setChartId] = useStored<string>('keytrainer.drill.solo.chart', CHARTS[0].id, (v) => typeof v === 'string' && CHART_BY_ID.has(v))
  const [tonic, setTonic] = useStored<number>('keytrainer.drill.solo.key', 0, (v) => Number.isInteger(v) && (v as number) >= 0 && (v as number) < 12)
  const [lowest, setLowest] = useStored<number>('keytrainer.drill.solo.from', 0, (v) => LOWEST.some((l) => l.value === String(v)))
  const [sub, setSub] = useStored<Sub>('keytrainer.drill.solo.sub', 'eighths', (v) => v === 'eighths' || v === 'triplets')
  const [target, setTarget] = useStored<Target>('keytrainer.drill.solo.target', 'guide', (v) => v === 'guide' || v === 'ninth')
  const [show, setShow] = useStored<boolean>('keytrainer.drill.solo.show', true, (v) => typeof v === 'boolean')
  const [want, setWant] = useStored<number>('keytrainer.drill.solo.repeats', 1, (v) => v === 1 || v === 2 || v === 3)
  const [best, setBest] = useStored<Best>('keytrainer.drill.solo.best', {}, isBest)

  const chart = CHART_BY_ID.get(chartId) ?? CHARTS[0]
  const [run, setRun] = useState<Run>(NEW_RUN)

  // What the look-loop reads: it runs on a timer, outside the render that set these.
  const opts = { exercise, lowest, sub, target, want, bpm: acc.bpm, naming: settings.naming }
  const optsRef = useRef(opts)
  optsRef.current = opts
  /** Notes before this are not part of the run; phrases and attacks up to `cursor` are dealt with. */
  const since = useRef(0)
  const cursor = useRef(0)

  // Leaving the drill takes its band with it.
  useEffect(() => () => accompanist.stop(), [])

  useEffect(() => {
    if (!on) return
    // The band started, or the exercise changed under it: a new run.
    since.current = cursor.current = performance.now()
    setRun(NEW_RUN)

    const look = () => {
      const o = optsRef.current
      const now = performance.now()
      const bars = accompanist.bars()
      const beatMs = bars.length ? bars[bars.length - 1].beatMs : 60000 / o.bpm
      const line = soloLine(heard(now), o.lowest, since.current)

      if (o.exercise === 'solo-flow') {
        const fresh = line.filter((n) => n.on > cursor.current).map((n) => n.on)
        if (fresh.length) cursor.current = fresh[fresh.length - 1]
        const limit = stopAfterMs(o.sub, beatMs)
        setRun((r) => {
          const flow = flowStep(r.flow, fresh, now, limit)
          return sameFlow(flow, r.flow) ? r : { ...r, flow }
        })
        return
      }

      for (const p of splitPhrases(line, beatMs, now)) {
        const end = p.notes[p.notes.length - 1].on
        if (!p.closed || end <= cursor.current) continue
        cursor.current = end
        if (p.notes.length < MIN_PHRASE_NOTES) continue

        if (o.exercise === 'solo-guide') {
          const landing = judgeLanding(p.notes, bars, o.target)
          if (!landing) continue
          const chord = chordText(landing.symbol, o.naming)
          if (landing.tone) {
            const name = glyph(guideTones(landing.symbol)?.[landing.tone] ?? '')
            const detail = landing.ahead ? 'just ahead of the change' : ''
            setRun((r) => judged(r, { ok: true, text: `${name}, the ${TONE_LABEL[landing.tone!]} of ${chord}`, detail }))
          } else {
            const name = glyph(pitchClassName(landing.midi, 'lead'))
            const wanted = targetNames(landing.symbol, o.target).map(glyph).join(' or ')
            setRun((r) => judged(r, { ok: false, text: `${name} over ${chord}`, detail: `it wanted ${wanted}` }))
          }
          continue
        }

        const phrase = { notes: motifOf(p.notes, beatMs), beatInBar: placeAt(bars, p.notes[0].on)?.beatInBar ?? null }
        setRun((r) => {
          const { run: motif, verdict } = motifStep(r.motif, phrase, o.want)
          const entry =
            verdict.kind === 'varied'
              ? { ok: true, text: verdict.changes.join(' · '), detail: 'the phrase again, changed' }
              : verdict.kind === 'same'
                ? { ok: false, text: 'the same again', detail: 'change one thing' }
                : verdict.kind === 'early'
                  ? { ok: false, text: 'a new phrase', detail: 'the last one never came back' }
                  : { ok: null, text: 'a phrase', detail: 'now play it again, with one thing changed' }
          return { ...judged(r, entry), motif }
        })
      }
    }

    const id = setInterval(look, LOOK_MS)
    return () => clearInterval(id)
  }, [on, exercise])

  // ---- what the run says ---------------------------------------------------

  const beatMs = 60000 / (play?.bpm ?? acc.bpm)
  const flow = run.flow
  const alive = flow.start !== null && flow.last !== null
  const runBars = alive ? Math.floor((flow.last! - flow.start!) / beatMs / 4) : 0
  const longestBars = Math.floor(flow.longest / beatMs / 4)
  const endedBars = Math.floor(flow.ended / beatMs / 4)
  const perBeat = alive && flow.last! > flow.start! ? (flow.notes - 1) / ((flow.last! - flow.start!) / beatMs) : null
  const last = run.entries[0] ?? null

  const bestKey = exercise === 'solo-flow' ? `flow:${sub}` : exercise === 'solo-guide' ? `guide:${target}` : `motif:${want}`
  const score = exercise === 'solo-flow' ? longestBars : run.streak
  useEffect(() => {
    if (score > (best[bestKey] ?? 0)) setBest({ ...best, [bestKey]: score })
  }, [score, bestKey])
  const record = Math.max(best[bestKey] ?? 0, score)

  useCue(flow.stops > 0 ? 'wrong' : null, `stop:${flow.stops}`)
  useCue(last?.ok === true ? 'right' : last?.ok === false ? 'wrong' : null, `phrase:${last?.id ?? 0}`)

  // The guide tones of the chord sounding now, on every octave of the keys.
  const tones = exercise === 'solo-guide' && show
  const marks = useMemo(() => {
    if (!tones || !play?.now) return undefined
    const pcs = new Set(targetPcs(play.now, target))
    const m = new Map<number, KeyMark>()
    for (let midi = Math.max(36, lowest); midi <= 96; midi++) if (pcs.has(midi % 12)) m.set(midi, 'missing')
    return m
  }, [tones, play?.now, target, lowest])

  const toggle = () => (on ? accompanist.stop() : accompanist.startChart(chart, tonic))
  const copy = COPY[exercise]
  const name = (symbol: string) => chordText(symbol, settings.naming)

  // ---- the strip above the card ---------------------------------------------

  let banner
  if (!on) {
    banner = (
      <div className="prompt solo-strip">
        <span className="prompt-label">{copy.title}</span>
        <div className="solo-big">
          <button className="solo-start" onClick={toggle}>
            ▶ start the band
          </button>
        </div>
        <div className="voicing-name">
          {chart.label} · {glyph(ROOT_NAMES[tonic])} · {acc.bpm} bpm
        </div>
      </div>
    )
  } else if (exercise === 'solo-flow') {
    const stopped = !alive && flow.stops > 0
    banner = (
      <div className={`prompt solo-strip speed ${alive ? 'correct' : stopped ? 'wrong' : 'pending'}`}>
        <span className="prompt-label">never stop</span>
        <div className="solo-big">
          {stopped ? endedBars : runBars}
          <small>
            {(stopped ? endedBars : runBars) === 1 ? 'bar' : 'bars'} {stopped ? 'and then a silence' : 'without stopping'}
          </small>
        </div>
        <div className="voicing-name">
          {sub === 'eighths' ? 'swung eighths' : 'triplets'}
          {perBeat !== null && flow.notes >= 8 && ` · ${perBeat.toFixed(1)} notes a beat (${PER_BEAT[sub]} is the goal)`}
        </div>
        <Swap className="at-end" k={alive ? 'on' : stopped ? 'off' : 'wait'}>
          <div className="verdict">{alive ? 'keep going' : stopped ? 'you stopped: go again' : 'play'}</div>
        </Swap>
        {alive && (
          <span
            key={flow.last}
            className="goal-bar"
            style={{ animationDuration: `${Math.round(stopAfterMs(sub, beatMs))}ms` } as CSSProperties}
            aria-hidden="true"
          />
        )}
      </div>
    )
  } else if (exercise === 'solo-guide') {
    const chords = [
      { label: 'now', symbol: play?.now ?? null, cls: 'now' },
      { label: 'next', symbol: play?.next ?? null, cls: 'todo' },
    ]
    banner = (
      <div className={`prompt solo-strip ${last?.ok === true ? 'correct' : last?.ok === false ? 'wrong' : 'pending'}`}>
        <span className="prompt-label">end on</span>
        <div className="solo-chords">
          {chords.map((c) => (
            <span key={c.label} className={c.cls}>
              <small>{c.label}</small>
              {c.symbol ? name(c.symbol) : '…'}
              <em>{c.symbol && show ? targetNames(c.symbol, target).map(glyph).join(' · ') : ' '}</em>
            </span>
          ))}
        </div>
        <Swap className="at-end" k={String(last?.id ?? 0)}>
          <div className="verdict solo-verdict">
            {last ? last.text : 'play a phrase, then pause'}
            {last?.detail && <small>{last.detail}</small>}
          </div>
        </Swap>
      </div>
    )
  } else {
    const m = run.motif
    const ask = !m.last
      ? 'play a phrase'
      : m.developed < want
        ? 'again, with one thing changed'
        : 'a new phrase, or one more change'
    banner = (
      <div className={`prompt solo-strip ${last?.ok === true ? 'correct' : last?.ok === false ? 'wrong' : 'pending'}`}>
        <span className="prompt-label">now</span>
        <Swap k={ask}>
          <div className="solo-big solo-ask">{ask}</div>
        </Swap>
        {m.last && want > 1 && (
          <div className="voicing-name">
            changed {Math.min(m.developed, want)} of {want} times
          </div>
        )}
        <Swap className="at-end" k={String(last?.id ?? 0)}>
          <div className="verdict solo-verdict">
            {last ? last.text : 'then pause'}
            {last?.detail && <small>{last.detail}</small>}
          </div>
        </Swap>
      </div>
    )
  }

  return (
    <Workspace
      sidebar={
        <>
          <DrillPicker voice={false} />
          <section className="side-group">
            <h3>{copy.title}</h3>
            <Select
              value={chart.id}
              disabled={on}
              aria-label="changes"
              title={on ? 'Stop the band to pick other changes' : 'The changes the band plays'}
              onValueChange={setChartId}
              options={CHARTS.map((c) => ({ value: c.id, label: c.label }))}
            />
            <label className="side-row" title="Notes below this are your left hand comping: they are not judged">
              <span>solo is</span>
              <Select value={String(lowest)} onValueChange={(v) => setLowest(Number(v))} options={LOWEST} />
            </label>
            {exercise === 'solo-flow' && (
              <label className="side-row">
                <span>in</span>
                <Select
                  value={sub}
                  onValueChange={(v) => setSub(v as Sub)}
                  options={[
                    { value: 'eighths', label: 'swung eighths' },
                    { value: 'triplets', label: 'triplets' },
                  ]}
                />
              </label>
            )}
            {exercise === 'solo-guide' && (
              <>
                <label className="side-row">
                  <span>end on</span>
                  <Select
                    value={target}
                    onValueChange={(v) => setTarget(v as Target)}
                    options={[
                      { value: 'guide', label: 'the 3rd or the 7th' },
                      { value: 'ninth', label: 'the 9th' },
                    ]}
                  />
                </label>
                <label className="check-row">
                  <Switch checked={show} onCheckedChange={setShow} />
                  show the notes to land on
                </label>
              </>
            )}
            {exercise === 'solo-motif' && (
              <label className="side-row" title="How many times a phrase comes back changed before a new one">
                <span>change it</span>
                <Select
                  value={String(want)}
                  onValueChange={(v) => setWant(Number(v))}
                  options={[
                    { value: '1', label: 'once' },
                    { value: '2', label: 'twice' },
                    { value: '3', label: 'three times' },
                  ]}
                />
              </label>
            )}
            <div className="side-buttons">
              <button onClick={toggle}>{on ? 'stop the band' : 'start the band'}</button>
            </div>
            <p className="side-note">{copy.note}</p>
            {exercise === 'solo-flow' && sub === 'eighths' && (
              <p className="side-note">When eighths get easy, switch to triplets.</p>
            )}
            {exercise === 'solo-guide' && target === 'guide' && (
              <p className="side-note">Feeling adventurous? Aim for the 9th instead.</p>
            )}
          </section>

          <section className="side-group">
            <h3>this run</h3>
            {exercise === 'solo-flow' ? (
              <p className="side-stat">
                longest {longestBars} {longestBars === 1 ? 'bar' : 'bars'} · {flow.stops} {flow.stops === 1 ? 'stop' : 'stops'}
                {record > 0 && <span className="dim"> · best {record}</span>}
              </p>
            ) : (
              <p className="side-stat">
                {exercise === 'solo-guide'
                  ? `${run.hits} of ${run.judged} landed`
                  : `${run.hits} ${run.hits === 1 ? 'phrase' : 'phrases'} developed`}{' '}
                · {run.streak} in a row
                {record > 0 && <span className="dim"> · best {record}</span>}
              </p>
            )}
            {exercise !== 'solo-flow' && run.entries.length > 0 && (
              <ol className="solo-log" aria-label="last phrases">
                {run.entries.map((e) => (
                  <li key={e.id} className={e.ok === true ? 'ok' : e.ok === false ? 'bad' : ''}>
                    {e.text}
                  </li>
                ))}
              </ol>
            )}
            <p className="side-note">{chart.note}</p>
          </section>
        </>
      }
      banner={banner}
      badge={
        <div className={`acc-badge ${on ? 'acc-on' : ''}`} role="group" aria-label="band">
          <button className="acc-go" onClick={toggle} title={on ? 'Stop the band' : 'Start the band on these changes'}>
            <span aria-hidden="true">{on ? '■' : '▶'}</span> {on ? 'stop' : 'band'}
          </button>
          <span className="acc-sep" aria-hidden="true">
            ·
          </span>
          {on && play ? (
            <span className="acc-key">{play.keyLabel}</span>
          ) : (
            <Select
              value={String(tonic)}
              onValueChange={(v) => setTonic(Number(v))}
              aria-label="key"
              options={ROOT_NAMES.map((n, pc) => ({ value: String(pc), label: `${glyph(n)} major` }))}
            />
          )}
          <span className="acc-sep" aria-hidden="true">
            ·
          </span>
          <BpmControl bpm={acc.bpm} onChange={(bpm) => update({ accompany: { ...acc, bpm } })} />
          {on && play && (
            <span className="acc-beats" aria-label={`beat ${play.beat + 1}`}>
              {[0, 1, 2, 3].map((b) => (
                <i key={b} className={b <= play.beat ? 'on' : ''} />
              ))}
            </span>
          )}
        </div>
      }
      aside={
        <ChangesSheet
          label={chart.label}
          play={on ? play : null}
          preview={() => renderChart(chart, tonic, acc.complexity)}
          tones={tones ? target : null}
          naming={settings.naming}
          onNaming={() => update({ naming: nextNamingStyle(settings.naming) })}
          bpm={acc.bpm}
        />
      }
      marks={marks}
    />
  )
}

type SheetChord = { symbol: string }
type SheetLine = { key: string; label: string; planned: boolean; to: string | null; bars: SheetChord[][] }

type SheetProps = {
  label: string
  /** The band's view while it plays; null shows the chart from the top. */
  play: PlayView | null
  preview: () => { symbol: string }[][][]
  /** Write the notes to land on under each chord. */
  tones: Target | null
  naming: NamingStyle
  onNaming: () => void
  bpm: number
}

/**
 * The changes, in the notation slot: the four bars being played and the four
 * after, or the top of the chart before the band starts. With the guide tones
 * on, each chord carries its two, set out as the two lines they make.
 */
function ChangesSheet({ label, play, preview, tones, naming, onNaming, bpm }: SheetProps) {
  const top = preview()
  const lines: SheetLine[] = play
    ? play.rows.map((row) => ({
        key: String(row.index),
        label: row.label,
        planned: row.planned,
        to: row.to,
        bars: row.bars.map((b) => b.chords),
      }))
    : top.slice(0, 2).map((bars, i) => ({ key: `top:${i}`, label: String(i + 1), planned: i > 0, to: null, bars }))
  const total = top.length * 4

  return (
    <section className="panel notation lead-sheet" aria-label="the changes">
      <header className="panel-head">
        <h3>
          {label}
          {play && (
            <>
              {' '}
              · <span className="ls-bpm">{play.bpm} bpm</span>
            </>
          )}
        </h3>
        {play ? (
          <button className="ls-stop" onClick={() => accompanist.stop()} title="Stop the band">
            ■ stop
          </button>
        ) : (
          <span className="panel-meta">{total} bars</span>
        )}
      </header>

      <div className="ls-grid" onClick={onNaming} title="Cycle exact / jazz / simple chord names">
        {lines.map((line, r) => {
          const flat = line.bars.flat()
          const pairs = tones === 'guide' ? guideLines(flat.map((c) => c.symbol)) : null
          let n = 0
          return (
            <div key={line.key} className={`ls-row ${line.planned ? 'planned' : ''}`}>
              <span className="ls-section" aria-label={`line ${line.label}`}>
                {line.label}
              </span>
              {line.bars.map((bar, i) => {
                const now = !!play && r === 0 && i === play.bar
                return (
                  <div key={i} className={`ls-bar ${now ? 'now' : ''}`} aria-current={now ? 'true' : undefined}>
                    {i === 0 && line.to && <span className="ls-to">→ {line.to}</span>}
                    <div className="ls-chords">
                      {bar.map((c, j) => {
                        const under = pairs ? pairs[n] : tones === 'ninth' ? [guideTones(c.symbol)?.ninth ?? null] : null
                        n++
                        return (
                          <span key={j} className="ls-chord solo-chord">
                            {chordText(c.symbol, naming)}
                            {under && (
                              <span className="solo-tones">
                                {under.map((t, k) => (
                                  <i key={k}>{t ? glyph(t) : ''}</i>
                                ))}
                              </span>
                            )}
                          </span>
                        )
                      })}
                    </div>
                    {now && play && (
                      <div className="ls-beats fact-in" aria-hidden="true">
                        {[0, 1, 2, 3].map((b) => (
                          <i key={b} className={b <= play.beat ? 'on' : ''} />
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>

      <BandControls style={play?.style ?? autoStyle(bpm, true)} written />
    </section>
  )
}
