import { useCallback, useEffect, useRef, useState } from 'react'
import { draw, requeue, shuffle } from './deck'
import { pickNext, reschedule } from './focus'
import { GOAL_MS, IDLE_MS, clearSpeed, loadSpeed, recordAnswer, saveSpeed, type SpeedStats } from './speed'

/**
 * How the questions are chosen. `focus` builds up a few at a time and spaces
 * out what is known (focus.ts); `all` runs through everything switched on in
 * random order, the lesson's "jump around at random".
 */
export type Practice = 'focus' | 'all'

export const isPractice = (v: unknown): boolean => v === 'focus' || v === 'all'

export type Verdict =
  | { kind: 'pending' }
  /** Right on the first try; `fast` is under the goal. */
  | { kind: 'fast' | 'slow'; ms: number }
  /** Wrong; the question stays until the right answer is played. */
  | { kind: 'miss' }
  /** Right, but not on the clock: after a miss, or after walking away. */
  | { kind: 'right' }

type Round = {
  id: string
  round: number
  verdict: Verdict
  /** Answers given to this question so far: a second wrong note is a new event with the same verdict. */
  tries: number
}

// How long the verdict stays up before the next question. A fast answer moves
// on quickly to keep the pace; anything else leaves time to read what happened.
const NEXT_AFTER_FAST_MS = 450
const NEXT_AFTER_OTHER_MS = 900

/**
 * One question at a time against the clock, shared by the speed drills.
 *
 * Only the first answer to a question is recorded: a miss stays a miss even
 * after you find the note, and it brings the question back a few rounds later.
 * The drill decides what a right answer is and calls `answer` with the time
 * the deciding note was struck.
 *
 * `ids` are the questions switched on, in the order focus mode introduces them.
 */
export function useSpeedRound(storeKey: string, ids: string[], practice: Practice) {
  const runKey = `${practice}|${ids.join(',')}`
  const idsRef = useRef(ids)
  idsRef.current = ids
  const practiceRef = useRef(practice)
  practiceRef.current = practice

  const queueRef = useRef<string[]>([])
  const startedAt = useRef(0)
  const judgedRef = useRef(false)
  const doneRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [stats, setStats] = useState<SpeedStats>(() => loadSpeed(storeKey))
  // The first question is picked without touching the queue: React may run an
  // initializer twice, and a draw that consumed the queue would leave the
  // question on screen and the one being judged out of step.
  const [state, setState] = useState<Round>(() => ({
    id:
      practice === 'focus'
        ? pickNext(loadSpeed(storeKey), ids, Date.now(), null)
        : ids[Math.floor(Math.random() * ids.length)],
    round: 0,
    verdict: { kind: 'pending' },
    tries: 0,
  }))
  // The question being judged. Follows the state, and is set ahead of it in
  // `next` so an answer landing before the re-render is judged against the
  // right one.
  const idRef = useRef(state.id)
  idRef.current = state.id

  useEffect(() => {
    queueRef.current = shuffle(idsRef.current).filter((x) => x !== idRef.current)
    startedAt.current = performance.now()
  }, [])

  const next = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    let id: string
    if (practiceRef.current === 'focus') {
      id = pickNext(loadSpeed(storeKey), idsRef.current, Date.now(), idRef.current)
    } else {
      const d = draw(queueRef.current, idsRef.current, idRef.current)
      queueRef.current = d.queue
      id = d.item
    }
    idRef.current = id
    judgedRef.current = false
    doneRef.current = false
    startedAt.current = performance.now()
    setState((s) => ({ id, round: s.round + 1, verdict: { kind: 'pending' }, tries: 0 }))
  }, [storeKey])

  // Switching items on or off, or changing how they are chosen, starts afresh.
  const shownKey = useRef(runKey)
  useEffect(() => {
    if (shownKey.current === runKey) return
    shownKey.current = runKey
    queueRef.current = []
    next()
  }, [runKey, next])

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    [],
  )

  /** Returns false when the answer came too late to count (the round is already won). */
  const answer = useCallback(
    (ok: boolean, at: number): boolean => {
      const id = idRef.current
      if (doneRef.current) return false
      const ms = at - startedAt.current
      let verdict: Verdict
      if (judgedRef.current) {
        verdict = ok ? { kind: 'right' } : { kind: 'miss' }
      } else if (ok && ms > IDLE_MS) {
        judgedRef.current = true
        verdict = { kind: 'right' }
        queueRef.current = requeue(queueRef.current, id, 4)
      } else {
        judgedRef.current = true
        verdict = !ok ? { kind: 'miss' } : ms <= GOAL_MS ? { kind: 'fast', ms } : { kind: 'slow', ms }
        let updated = recordAnswer(loadSpeed(storeKey), id, ok, ms)
        if (practiceRef.current === 'focus') {
          updated = { ...updated, [id]: reschedule(updated[id], verdict.kind, Date.now()) }
        }
        saveSpeed(storeKey, updated)
        setStats(updated)
        if (!ok) queueRef.current = requeue(queueRef.current, id, 3)
        else if (ms > GOAL_MS) queueRef.current = requeue(queueRef.current, id, 6)
      }
      if (ok) {
        doneRef.current = true
        timerRef.current = setTimeout(next, verdict.kind === 'fast' ? NEXT_AFTER_FAST_MS : NEXT_AFTER_OTHER_MS)
      }
      setState((s) => ({ ...s, verdict, tries: s.tries + 1 }))
      return true
    },
    [next, storeKey],
  )

  /** Moves on without answering; the question comes back, and nothing is recorded. */
  const skip = useCallback(() => {
    queueRef.current = requeue(queueRef.current, idRef.current, 4)
    next()
  }, [next])

  const reset = useCallback(() => {
    clearSpeed(storeKey)
    setStats({})
  }, [storeKey])

  return { ...state, stats, startedAt, answer, skip, reset }
}

export function verdictClass(v: Verdict): string {
  if (v.kind === 'fast' || v.kind === 'right') return 'correct'
  if (v.kind === 'slow') return 'slow'
  if (v.kind === 'miss') return 'wrong'
  return 'pending'
}

/** The sound that goes with a verdict: the chime is for an answer on the clock. */
export function verdictCue(v: Verdict): 'right' | 'slow' | 'wrong' | null {
  if (v.kind === 'fast') return 'right'
  if (v.kind === 'slow' || v.kind === 'right') return 'slow'
  if (v.kind === 'miss') return 'wrong'
  return null
}

export const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`
