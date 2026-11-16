import { useEffect, useMemo, useState } from 'react'
import type { KeyMark } from '../keyboard'
import { useMidiEvents } from '../midi'
import { useAskedRoots } from '../stage/asked'
import { Workspace } from '../stage/Workspace'
import { Swap } from '../ui/Swap'
import { Switch } from '../ui/Switch'
import { DrillPicker } from './DrillPicker'
import { FocusPanel, PracticeSelect } from './FocusPanel'
import { INTERVALS, intervalItems, intervalQuestion } from './intervals'
import { sayInterval } from './say'
import { GOAL_MS, summarise } from './speed'
import { SpeedGrid } from './SpeedGrid'
import { ROOT_NAMES, glyph, nearestWithPc } from './spell'
import { isStringArray, useStored } from './stored'
import { useCue, useSpokenQuestion } from './useDrillSound'
import { isPractice, seconds, useSpeedRound, verdictClass, verdictCue, type Practice } from './useSpeedRound'

const ALL = INTERVALS.map((i) => i.id)

/**
 * "Which note is a minor 7th above F♯?" — answered at the keyboard, any octave,
 * and timed to the first note. The first step of the lesson: every interval
 * from every note in under two seconds.
 */
export function IntervalDrill() {
  const [enabled, setEnabled] = useStored<string[]>('keytrainer.drill.intervals', ALL, isStringArray)
  const active = INTERVALS.filter((i) => enabled.includes(i.id))
  // Nothing switched on would leave nothing to ask.
  const rows = active.length ? active : INTERVALS
  const rowKey = rows.map((r) => r.id).join(',')
  const ids = useMemo(() => intervalItems(rowKey.split(',')), [rowKey])

  const [practice, setPractice] = useStored<Practice>('keytrainer.drill.practice', 'focus', isPractice)
  const r = useSpeedRound('keytrainer.speed.intervals', ids, practice)
  const q = intervalQuestion(r.id)
  // The card names the root, and the answer over it, the way the question does.
  useAskedRoots([ROOT_NAMES[q.rootPc]])
  const focus = practice === 'focus'
  // In focus mode a question nobody has answered yet is announced as new.
  const isNew = focus && r.stats[r.id]?.level === undefined && r.verdict.kind === 'pending'
  const short = (id: string) => {
    const x = intervalQuestion(id)
    return `${x.interval.name} above ${glyph(ROOT_NAMES[x.rootPc])}`
  }

  // With the voice on, the two seconds start when it has finished asking.
  const spoken = useSpokenQuestion(sayInterval(q.interval.name, ROOT_NAMES[q.rootPc]), r.round, () => {
    r.startedAt.current = performance.now()
  })
  useCue(verdictCue(r.verdict), `${r.round}:${r.tries}`)

  // The note that answered, for the keys: it stays lit until the next question.
  const [played, setPlayed] = useState<number | null>(null)
  useEffect(() => setPlayed(null), [r.round])

  useMidiEvents((e) => {
    if (e.kind !== 'on') return
    if (r.answer(e.note % 12 === q.answerPc, e.time)) setPlayed(e.note)
  })

  const marks = useMemo(() => {
    const m = new Map<number, KeyMark>()
    if (played === null) return m
    if (played % 12 === q.answerPc) return m.set(played, 'correct')
    // A miss gives the answer away, next to where the hand went.
    return m.set(nearestWithPc(q.answerPc, played), 'missing').set(played, 'extra')
  }, [played, q.answerPc])

  const v = r.verdict
  const verdict =
    v.kind === 'fast'
      ? seconds(v.ms)
      : v.kind === 'slow'
        ? `slow · ${seconds(v.ms)}`
        : v.kind === 'miss'
          ? `wrong · it is ${glyph(q.answerName)}`
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
            <h3>intervals</h3>
            <PracticeSelect value={practice} onChange={setPractice} />
            <div className="check-list" role="group" aria-label="intervals">
              {INTERVALS.map((i) => (
                <label key={i.id} className="check-row" title={i.name}>
                  <Switch
                    checked={rows.includes(i)}
                    onCheckedChange={(on) =>
                      setEnabled(on ? [...new Set([...enabled, i.id])] : rows.map((x) => x.id).filter((x) => x !== i.id))
                    }
                  />
                  {i.name}
                </label>
              ))}
            </div>
            <div className="side-buttons">
              <button onClick={r.skip}>skip</button>
            </div>
            <p className="side-note">
              Play the note in any octave. The clock stops on your first note; under {GOAL_MS / 1000}s counts as
              known.{!focus && ' A miss or a slow answer comes back a few questions later.'}
            </p>
          </section>

          {focus && <FocusPanel stats={r.stats} ids={ids} current={r.id} label={short} />}

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
          <span className="prompt-label">{isNew ? 'new · play the' : 'play the'}</span>
          <Swap k={String(r.round)}>
            <div className="chord-symbol">
              {q.interval.name} <span className="ask-dim">above</span> {glyph(ROOT_NAMES[q.rootPc])}
            </div>
          </Swap>
          <Swap className="at-end" k={`${r.round}:${verdict}`}>
            <div className="verdict">{verdict}</div>
          </Swap>
          <span key={`${r.round}:${spoken}`} className={`goal-bar${v.kind === 'pending' ? '' : ' stopped'}`} aria-hidden="true" />
        </div>
      }
      aside={
        <SpeedGrid
          rows={rows.map((i) => ({ id: i.id, label: i.id, name: i.name }))}
          stats={r.stats}
          current={r.id}
          practice={practice}
        />
      }
      marks={marks}
    />
  )
}
