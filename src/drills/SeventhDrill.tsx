import { useEffect, useMemo, useRef } from 'react'
import { useMidiEvents } from '../midi'
import { useAskedRoots } from '../stage/asked'
import { usePlay } from '../stage/settings'
import { Workspace } from '../stage/Workspace'
import { Swap } from '../ui/Swap'
import { Switch } from '../ui/Switch'
import { DrillPicker } from './DrillPicker'
import { FocusPanel, PracticeSelect } from './FocusPanel'
import { CHORDS, chordItems, chordMarks, chordQuestion, isRootPosition } from './sevenths'
import { sayChord } from './say'
import { GOAL_MS, summarise } from './speed'
import { SpeedGrid } from './SpeedGrid'
import { ROOT_NAMES } from './spell'
import { isStringArray, useStored } from './stored'
import { useCue, useSpokenQuestion } from './useDrillSound'
import { isPractice, seconds, useSpeedRound, verdictClass, verdictCue, type Practice } from './useSpeedRound'

const CORE = CHORDS.filter((c) => c.core).map((c) => c.id)

/**
 * A chord symbol, a clock, and all 12 roots in random order: the lesson's
 * second step. The chord counts the moment its last note lands, in root
 * position and in any octave.
 */
export function SeventhDrill() {
  const { held, settled } = usePlay()
  const [enabled, setEnabled] = useStored<string[]>('keytrainer.drill.sevenths', CORE, isStringArray)
  const active = CHORDS.filter((c) => enabled.includes(c.id))
  const rows = active.length ? active : CHORDS.filter((c) => c.core)
  const rowKey = rows.map((c) => c.id).join(',')
  const ids = useMemo(() => chordItems(rowKey.split(',')), [rowKey])

  const [practice, setPractice] = useStored<Practice>('keytrainer.drill.practice', 'focus', isPractice)
  const r = useSpeedRound('keytrainer.speed.sevenths', ids, practice)
  const q = chordQuestion(r.id)
  // The card reads the chord back with the root name it is asked by.
  useAskedRoots([ROOT_NAMES[q.rootPc]])
  const focus = practice === 'focus'
  const isNew = focus && r.stats[r.id]?.level === undefined && r.verdict.kind === 'pending'

  // With the voice on, the two seconds start when it has finished asking.
  const spoken = useSpokenQuestion(sayChord(q.symbol), r.round, () => {
    r.startedAt.current = performance.now()
  })
  useCue(verdictCue(r.verdict), `${r.round}:${r.tries}`)

  // When the last note went down: that is the moment the chord was played, not
  // the moment the page got around to looking at it.
  const lastOn = useRef(0)
  useMidiEvents((e) => {
    if (e.kind === 'on') lastOn.current = e.time
  })
  // Notes still ringing from the previous chord say nothing about this one:
  // the question is only judged once a key has gone down since it was asked.
  const fresh = () => lastOn.current > r.startedAt.current

  useEffect(() => {
    if (fresh() && isRootPosition(held, q.rootPc, q.chord)) r.answer(true, lastOn.current)
  }, [held])

  // A wrong chord only counts once four notes have settled: a chord still
  // being built, or one note brushed on the way, is not a miss.
  useEffect(() => {
    if (!fresh() || settled.length < 4) return
    if (!isRootPosition(settled, q.rootPc, q.chord)) r.answer(false, lastOn.current)
  }, [settled])

  const v = r.verdict
  const marks = useMemo(
    () => (fresh() || v.kind !== 'pending' ? chordMarks(held, q.rootPc, q.chord, v.kind === 'miss') : new Map()),
    [held, r.id, v.kind],
  )

  const verdict =
    v.kind === 'fast'
      ? seconds(v.ms)
      : v.kind === 'slow'
        ? `slow · ${seconds(v.ms)}`
        : v.kind === 'miss'
          ? `wrong · ${q.spelled.join(' ')}`
          : v.kind === 'right'
            ? 'right'
            : '…'

  const score = summarise(r.stats, ids)

  return (
    <Workspace
      sidebar={
        <>
          <DrillPicker />
          <section className="side-group">
            <h3>chords</h3>
            <PracticeSelect value={practice} onChange={setPractice} />
            <div className="check-list" role="group" aria-label="chord types">
              {CHORDS.map((c) => (
                <label key={c.id} className="check-row" title={c.name}>
                  <Switch
                    checked={rows.includes(c)}
                    onCheckedChange={(on) =>
                      setEnabled(on ? [...new Set([...enabled, c.id])] : rows.map((x) => x.id).filter((x) => x !== c.id))
                    }
                  />
                  {c.suffix}
                </label>
              ))}
            </div>
            <div className="side-buttons">
              <button onClick={r.skip}>skip</button>
            </div>
            <p className="side-note">
              Root position, any octave: the root goes at the bottom. The clock stops when the last note lands;
              under {GOAL_MS / 1000}s counts as known.
            </p>
          </section>

          {focus && (
            <FocusPanel stats={r.stats} ids={ids} current={r.id} label={(id) => chordQuestion(id).symbol} />
          )}

          <section className="side-group">
            <h3>score</h3>
            <p className="side-stat">
              {score.fast}/{score.total} <span className="dim">under {GOAL_MS / 1000}s</span>
              {score.avgMs > 0 && <span className="dim"> · {seconds(score.avgMs)} average</span>}
            </p>
            <button className="small" onClick={r.reset}>
              reset
            </button>
          </section>
        </>
      }
      banner={
        <div className={`prompt speed ${verdictClass(v)}`}>
          <span className="prompt-label">{isNew ? 'new · play' : 'play'}</span>
          <Swap k={String(r.round)}>
            <div className="chord-symbol">{q.symbol}</div>
          </Swap>
          <Swap k={q.chord.id}>
            <div className="voicing-name">{q.chord.name}</div>
          </Swap>
          <Swap className="at-end" k={`${r.round}:${verdict}`}>
            <div className="verdict">{verdict}</div>
          </Swap>
          <span key={`${r.round}:${spoken}`} className={`goal-bar${v.kind === 'pending' ? '' : ' stopped'}`} aria-hidden="true" />
        </div>
      }
      aside={
        <SpeedGrid
          rows={rows.map((c) => ({ id: c.id, label: c.suffix, name: c.name }))}
          stats={r.stats}
          current={r.id}
          practice={practice}
        />
      }
      marks={marks}
    />
  )
}
