import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { keyById } from './analysis'
import { DrillPicker } from './drills/DrillPicker'
import { glyph } from './drills/spell'
import { sayChord } from './drills/say'
import { useCue, useSpokenQuestion } from './drills/useDrillSound'
import { marksFromComparison } from './keyboard'
import { CHROMATIC, FOURTHS, type Order } from './keys'
import { useAskedRoots } from './stage/asked'
import { usePlay, useSettings } from './stage/settings'
import { Workspace } from './stage/Workspace'
import { Presence } from './ui/Presence'
import { Swap } from './ui/Swap'
import { Select } from './ui/Select'
import { Switch } from './ui/Switch'
import { clearStats, loadStats, recordAttempt, summaryFor, type Stats } from './stats'
import {
  chordLabel,
  compareToTarget,
  handNotes,
  pitchClassName,
  placeVoicing,
  type Spelling,
} from './theory'
import { QUALITY_LABEL, VOICINGS, type Quality, voicingToMidi } from './voicings'

// The target is drawn with its root in C3..B3, so the staff is unambiguous. It
// counts in any octave: see `placeVoicing`.
const ROOT_OCTAVE_BASE = 48

type Target = { rootPc: number; quality: Quality }

/** The accent as a colour value: VexFlow paints with it, so a CSS var() will not do. */
function accentInk(): string {
  return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#347ce2'
}

/**
 * Voicing drill on the stage: the target sits in the banner and on the staff,
 * the chord card reads what you actually played, and the keys show right, extra
 * and missing notes.
 */
export function Drill() {
  const { settings } = useSettings()
  const { settled } = usePlay()
  const key = keyById(settings.keyId)
  // The key decides how roots are written; with no signature, as on a lead sheet.
  const spelling: Spelling = key.accidentals > 0 ? 'sharp' : key.accidentals < 0 ? 'flat' : 'lead'

  const [voicingId, setVoicingId] = useState(VOICINGS[0].id)
  const [qualities, setQualities] = useState<Quality[]>(['m7'])
  const [order, setOrder] = useState<Order>('fourths')
  const [target, setTarget] = useState<Target>({ rootPc: 0, quality: 'm7' })
  // Counts targets, so the symbol fades in on each new one even when it repeats.
  const [round, setRound] = useState(0)
  const [result, setResult] = useState<'pending' | 'correct' | 'wrong'>('pending')
  const [revealed, setRevealed] = useState(false)
  // Chords judged so far: a second wrong chord is a new event with the same result.
  const [tries, setTries] = useState(0)
  const [stats, setStats] = useState<Stats>(() => loadStats())

  const voicing = VOICINGS.find((v) => v.id === voicingId) ?? VOICINGS[0]
  const allowed = qualities.filter((q) => voicing.qualities.includes(q))
  const activeQualities = allowed.length ? allowed : [voicing.qualities[0]]

  const startedAtRef = useRef(performance.now())
  const lockedRef = useRef(false)
  const indexRef = useRef(0)
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current)
    },
    [],
  )

  const nextTarget = useCallback(
    (i: number) => {
      // A skip while the advance is pending must not move on twice.
      if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current)
      const sequence = order === 'chromatic' ? CHROMATIC : FOURTHS
      const rootPc =
        order === 'random' ? Math.floor(Math.random() * 12) : sequence[i % sequence.length]
      const quality = activeQualities[i % activeQualities.length]
      setTarget({ rootPc, quality })
      setRound((n) => n + 1)
      setResult('pending')
      setRevealed(false)
      startedAtRef.current = performance.now()
      lockedRef.current = false
    },
    [order, activeQualities.join(',')],
  )

  // A new voicing or a new order restarts the sequence.
  useEffect(() => {
    indexRef.current = 0
    nextTarget(0)
  }, [voicingId, order, activeQualities.join(',')])

  const advance = useCallback(() => {
    indexRef.current += 1
    nextTarget(indexRef.current)
  }, [nextTarget])

  const targetMidi = useMemo(
    () => voicingToMidi(voicing, target.quality, ROOT_OCTAVE_BASE + target.rootPc),
    [voicing, target],
  )

  // The target in the octave it is being played in.
  const placed = useCallback(
    (played: number[]) =>
      placeVoicing(played, voicing, target.quality, ROOT_OCTAVE_BASE + target.rootPc),
    [voicing, target],
  )

  // Evaluates on every new settled chord. `settled` is a fresh array on each
  // reading, so playing the same chord again fires again — which is what we want.
  useEffect(() => {
    if (settled.length === 0 || lockedRef.current) return
    if (compareToTarget(settled, placed(settled)).exact) {
      lockedRef.current = true
      setResult('correct')
      setTries((n) => n + 1)
      setStats(
        recordAttempt(voicing.id, target.rootPc, true, performance.now() - startedAtRef.current),
      )
      // Kept in a ref, not in this effect's cleanup: letting go of the chord one
      // finger at a time settles a smaller chord, and a cleanup would cancel the
      // advance with the target still locked — the drill froze on "right".
      advanceTimerRef.current = setTimeout(advance, 700)
      return
    }
    // Only counts a miss once there are enough notes; a chord being built is not penalized.
    if (settled.length >= targetMidi.length) {
      setResult('wrong')
      setTries((n) => n + 1)
      setStats(
        recordAttempt(voicing.id, target.rootPc, false, performance.now() - startedAtRef.current),
      )
    }
  }, [settled])

  // Marks only make sense against what was played for THIS target; a fresh target
  // starts from the outline alone.
  const marks = useMemo(() => {
    const played = result === 'pending' && lockedRef.current ? [] : settled
    return marksFromComparison(compareToTarget(played, placed(played)))
  }, [settled, placed, result])

  // The card reads the chord back with the root name it is asked by.
  useAskedRoots([pitchClassName(target.rootPc, spelling)])
  useSpokenQuestion(sayChord(chordLabel(target.rootPc, target.quality, spelling)), round)
  useCue(result === 'correct' ? 'right' : result === 'wrong' ? 'wrong' : null, tries)

  const hands = handNotes(voicing, target.quality, ROOT_OCTAVE_BASE + target.rootPc, spelling)
  const summary = summaryFor(stats, voicing.id)

  return (
    <Workspace
      sidebar={
        <>
          <DrillPicker />
          <section className="side-group">
            <h3>voicing</h3>
            <label className="side-row">
              <span>shape</span>
              <Select
                value={voicingId}
                onValueChange={setVoicingId}
                options={VOICINGS.map((v) => ({ value: v.id, label: v.label }))}
              />
            </label>
            <div className="check-list" role="group" aria-label="qualities">
              {voicing.qualities.map((q) => (
                <label key={q} className="check-row">
                  <Switch
                    checked={activeQualities.includes(q)}
                    onCheckedChange={(on) =>
                      setQualities((prev) => (on ? [...new Set([...prev, q])] : prev.filter((x) => x !== q)))
                    }
                  />
                  {QUALITY_LABEL[q]}
                </label>
              ))}
            </div>
            <label className="side-row">
              <span>order</span>
              <Select
                value={order}
                onValueChange={(v) => setOrder(v as Order)}
                options={[
                  { value: 'fourths', label: 'cycle of fourths' },
                  { value: 'chromatic', label: 'chromatic' },
                  { value: 'random', label: 'random' },
                ]}
              />
            </label>
            <div className="side-buttons">
              <button onClick={advance}>skip</button>
              <button onClick={() => setRevealed((r) => !r)}>{revealed ? 'hide' : 'show'} answer</button>
            </div>
          </section>

          <section className="side-group">
            <h3>score</h3>
            <p className="side-stat">
              {summary.correct}/{summary.attempts}{' '}
              <span className="dim">({Math.round(summary.accuracy * 100)}%)</span>
              {summary.avgMs > 0 && (
                <span className="dim"> · {(summary.avgMs / 1000).toFixed(1)}s per chord</span>
              )}
            </p>
            <details className="per-key">
              <summary>by key</summary>
              <ul>
                {CHROMATIC.map((pc) => {
                  const e = stats[voicing.id]?.[pc]
                  if (!e) return null
                  return (
                    <li key={pc}>
                      {glyph(pitchClassName(pc, spelling))}: {e.correct}/{e.attempts}
                    </li>
                  )
                })}
              </ul>
            </details>
            <button
              className="small"
              onClick={() => {
                clearStats()
                setStats({})
              }}
            >
              reset
            </button>
          </section>
        </>
      }
      banner={
        <div className={`prompt ${result}`}>
          <span className="prompt-label">play</span>
          <Swap k={String(round)}>
            <div className="chord-symbol">{glyph(chordLabel(target.rootPc, target.quality, spelling))}</div>
          </Swap>
          <Swap k={voicing.id}>
            <div className="voicing-name">{voicing.label}</div>
          </Swap>
          <Presence ms={200}>
            {revealed && (
              <p className="hand-notes">
                LH {hands.lh.map(glyph).join(' ')} · RH {hands.rh.map(glyph).join(' ')}
              </p>
            )}
          </Presence>
          <Swap k={result}>
            <div className="verdict">{result === 'correct' ? 'right' : result === 'wrong' ? 'wrong' : '…'}</div>
          </Swap>
        </div>
      }
      notation={{
        notes: targetMidi,
        title: 'target',
        // The staff is the target, so it never turns red: the card and the keys
        // already say what went wrong. It turns green when you land it.
        color: result === 'correct' ? accentInk() : undefined,
      }}
      marks={marks}
    />
  )
}
