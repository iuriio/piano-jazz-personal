import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { marksFromComparison } from '../keyboard'
import { useAskedRoots } from '../stage/asked'
import { usePlay } from '../stage/settings'
import { Workspace } from '../stage/Workspace'
import { compareToTarget, placeTarget } from '../theory'
import { Select } from '../ui/Select'
import { Swap } from '../ui/Swap'
import { Switch } from '../ui/Switch'
import { DrillPicker } from './DrillPicker'
import { sayChord } from './say'
import { useStored } from './stored'
import { useCue, useSpokenQuestion } from './useDrillSound'
import {
  CLEAN_LAPS_GOAL,
  FORMS,
  FORM_BY_ID,
  KEY_CHAIN,
  NEW_LAP,
  advance,
  chordSymbols,
  keyName,
  lapKey,
  lapStep,
  spoil,
  supports,
  targetNotes,
  type Lap,
  type Tonality,
} from './twoFiveOne'

// Long enough to see the chord turn right, short enough that ii-V-I still
// feels like one phrase.
const NEXT_MS = 350

const NUMERALS: Record<Tonality, [string, string, string]> = {
  major: ['ii', 'V', 'I'],
  minor: ['ii', 'V', 'i'],
}

function accentInk(): string {
  return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#347ce2'
}

type Best = Record<string, number>
const isBest = (v: unknown): boolean =>
  !!v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every((n) => typeof n === 'number')

/**
 * The 2-5-1 through all 12 keys, the lesson's way: land on the one, make it
 * minor, and it is the two of the next key. Each chord is checked note for
 * note, so the voice leading is part of the answer.
 */
export function TwoFiveOneDrill() {
  const { settled } = usePlay()
  const [tonality, setTonality] = useStored<Tonality>('keytrainer.drill.251.tonality', 'major', (v) => v === 'major' || v === 'minor')
  const [formId, setFormId] = useStored<string>('keytrainer.drill.251.form', FORMS[0].id, (v) => typeof v === 'string' && FORM_BY_ID.has(v))
  const [show, setShow] = useStored<boolean>('keytrainer.drill.251.show', true, (v) => typeof v === 'boolean')
  const [best, setBest] = useStored<Best>('keytrainer.drill.251.best', {}, isBest)

  const picked = FORM_BY_ID.get(formId) ?? FORMS[0]
  // A shape with no minor version falls back to the first one that has it.
  const form = supports(picked, tonality) ? picked : FORMS[0]
  const runKey = `${tonality}:${form.id}`

  const [lap, setLap] = useState<Lap>(NEW_LAP)
  const [result, setResult] = useState<'pending' | 'correct' | 'wrong'>('pending')
  // Chords judged so far: a second wrong chord is a new event with the same result.
  const [tries, setTries] = useState(0)

  const lockedRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showRef = useRef(show)
  showRef.current = show
  // The chord that was on the keys when this target came up belongs to the
  // previous target: it is neither judged nor coloured against the new one.
  const staleRef = useRef<number[] | null>(settled)
  const settledRef = useRef(settled)
  settledRef.current = settled

  const tonic = KEY_CHAIN[lapKey(lap)]
  const step = lapStep(lap)
  const target = useMemo(() => targetNotes(form, tonality, tonic, step), [form, tonality, tonic, step])

  const fresh = settled !== staleRef.current

  const lapRef = useRef(lap)
  lapRef.current = lap

  const goNext = useCallback(
    (spoiled: boolean) => {
      if (timerRef.current) clearTimeout(timerRef.current)
      lockedRef.current = false
      staleRef.current = settledRef.current
      const next = advance(spoiled ? spoil(lapRef.current) : lapRef.current)
      if (next.streak > (best[runKey] ?? 0)) setBest({ ...best, [runKey]: next.streak })
      setResult('pending')
      setLap(next)
    },
    [best, runKey, setBest],
  )

  // A new key type or a new shape is a new exercise: back to C, streak gone.
  const shownRun = useRef(runKey)
  useEffect(() => {
    if (shownRun.current === runKey) return
    shownRun.current = runKey
    if (timerRef.current) clearTimeout(timerRef.current)
    lockedRef.current = false
    staleRef.current = settledRef.current
    setLap(NEW_LAP)
    setResult('pending')
  }, [runKey])

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    [],
  )

  // The target in the octave it is being played in: the shape counts anywhere,
  // and a left-hand root may sit lower still.
  const placed = useCallback(
    (played: number[]) =>
      form.bass ? placeTarget(played, target.slice(1), target[0]) : placeTarget(played, target),
    [form, target],
  )

  // Evaluates each newly settled chord, like the voicing drill.
  useEffect(() => {
    if (!fresh || settled.length === 0 || lockedRef.current) return
    if (compareToTarget(settled, placed(settled)).exact) {
      lockedRef.current = true
      setResult('correct')
      setTries((n) => n + 1)
      // Played with the notes on screen: right, but not from memory.
      const spoiled = showRef.current
      timerRef.current = setTimeout(() => goNext(spoiled), NEXT_MS)
    } else if (settled.length >= target.length) {
      // A chord still being built is not a miss; a full wrong one spoils the lap.
      setResult('wrong')
      setTries((n) => n + 1)
      setLap(spoil)
    }
  }, [settled])

  const marks = useMemo(() => {
    const played = fresh ? settled : []
    const c = compareToTarget(played, placed(played))
    // From memory, the keys only say what you got; a wrong chord gives the rest away.
    return marksFromComparison(show || result === 'wrong' ? c : { ...c, missing: [] })
  }, [settled, fresh, placed, show, result])

  const symbols = chordSymbols(tonality, tonic)
  // The card reads each chord back with the root this key writes it with.
  useAskedRoots(symbols.map((s) => /^[A-G][♯♭]?/.exec(s)![0]))
  useSpokenQuestion(sayChord(symbols[step]), `${runKey}:${lap.pos}`)
  useCue(result === 'correct' ? 'right' : result === 'wrong' ? 'wrong' : null, tries)
  const streakBest = Math.max(best[runKey] ?? 0, lap.streak)

  return (
    <Workspace
      sidebar={
        <>
          <DrillPicker />
          <section className="side-group">
            <h3>2-5-1</h3>
            <label className="side-row">
              <span>key</span>
              <Select
                value={tonality}
                onValueChange={(v) => setTonality(v as Tonality)}
                options={[
                  { value: 'major', label: 'major' },
                  { value: 'minor', label: 'minor' },
                ]}
              />
            </label>
            <label className="side-row">
              <span>shape</span>
              <Select
                value={form.id}
                onValueChange={setFormId}
                options={FORMS.map((f) => ({ value: f.id, label: f.label, disabled: !supports(f, tonality) }))}
              />
            </label>
            <label className="check-row">
              <Switch checked={show} onCheckedChange={setShow} />
              show the notes
            </label>
            <div className="side-buttons">
              <button onClick={() => goNext(true)}>skip</button>
              <button
                onClick={() => {
                  if (timerRef.current) clearTimeout(timerRef.current)
                  lockedRef.current = false
                  staleRef.current = settledRef.current
                  setResult('pending')
                  setLap((l) => ({ ...NEW_LAP, streak: l.streak }))
                }}
              >
                restart lap
              </button>
            </div>
            <p className="side-note">{form.note}</p>
          </section>

          <section className="side-group">
            <h3>clean laps</h3>
            <p className="side-stat lap-dots" aria-label={`${lap.streak} clean laps in a row`}>
              {Array.from({ length: CLEAN_LAPS_GOAL }, (_, i) => (
                <span key={i} className={`lap-dot${i < Math.min(lap.streak, CLEAN_LAPS_GOAL) ? ' on' : ''}`} />
              ))}
              <span className="dim">
                {lap.streak} in a row{streakBest > 0 && ` · best ${streakBest}`}
              </span>
            </p>
            <p className="side-note">
              A clean lap is all 12 keys from memory: notes hidden, no wrong chord. {CLEAN_LAPS_GOAL} in a row and
              the pattern is yours.
              {lap.dirty && <span className="lap-spoiled"> This lap no longer counts.</span>}
            </p>
          </section>
        </>
      }
      banner={
        <div className={`prompt ${result}`}>
          <span className="prompt-label">play</span>
          <Swap k={`${runKey}:${tonic}`}>
            <div className="ii-v-i">
              {symbols.map((s, i) => (
                <span key={i} className={i < step ? 'done' : i === step ? 'now' : 'todo'}>
                  <small>{NUMERALS[tonality][i]}</small>
                  {s}
                </span>
              ))}
            </div>
          </Swap>
          <Swap k={`${tonality}:${tonic}`}>
            <div className="voicing-name">
              {keyName(tonality, tonic)} · key {lapKey(lap) + 1}/{KEY_CHAIN.length}
            </div>
          </Swap>
          <Swap className="at-end" k={result}>
            <div className="verdict">{result === 'correct' ? 'right' : result === 'wrong' ? 'wrong' : '…'}</div>
          </Swap>
        </div>
      }
      notation={
        show
          ? { notes: target, title: 'target', color: result === 'correct' ? accentInk() : undefined }
          : undefined
      }
      marks={marks}
    />
  )
}
