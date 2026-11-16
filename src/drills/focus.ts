import type { SpeedEntry, SpeedStats } from './speed'

// Focus mode: a few questions at a time, repeated until they are automatic,
// then spaced further and further apart — the way a flashcard deck works.
//
// A question that has been asked has a level. Every fast answer moves it up a
// level and pushes its next showing further away (STEPS_MS). The first three
// levels are the learning steps: seconds apart, in the hand while the other
// questions in focus go by. From KNOWN_LEVEL on the question is known: it
// leaves the focus, a new one takes its place, and it only comes back for
// review — minutes later, then days. A miss sends it back to the start; a slow
// answer, back into learning.

/** Questions being learned at once. */
export const FOCUS_SIZE = 5

/** Fast answers, spaced out, before a question counts as known. */
export const KNOWN_LEVEL = 3

const S = 1000
const MIN = 60 * S
const DAY = 24 * 60 * MIN

/** How long until a question at each level is due again. */
export const STEPS_MS = [8 * S, 20 * S, MIN, 5 * MIN, 30 * MIN, DAY, 3 * DAY, 7 * DAY, 21 * DAY]

const TOP_LEVEL = STEPS_MS.length - 1

export type Outcome = 'fast' | 'slow' | 'miss'

export const isIntroduced = (e: SpeedEntry | undefined): e is SpeedEntry & { level: number } =>
  e?.level !== undefined

export const isKnown = (e: SpeedEntry | undefined): boolean => isIntroduced(e) && e.level >= KNOWN_LEVEL

/**
 * The entry after an answer, with its new level and due time.
 *
 * An answer given before the question was due (the drill had nothing else to
 * ask) still counts while the question is being learned — that is how the
 * first two steps go by quickly — but it cannot take the last step to known or
 * stretch a review: those need the wait to have really happened.
 */
export function reschedule(entry: SpeedEntry, outcome: Outcome, now: number): SpeedEntry {
  const level = entry.level ?? 0
  if (outcome === 'miss') return { ...entry, level: 0, dueAt: now + STEPS_MS[0] }
  if (outcome === 'slow') {
    const back = Math.max(0, Math.min(level, KNOWN_LEVEL) - 1)
    return { ...entry, level: back, dueAt: now + STEPS_MS[back] }
  }
  const due = entry.dueAt === undefined || entry.dueAt <= now
  if (!due && level >= KNOWN_LEVEL - 1) return { ...entry, level }
  const up = Math.min(level + 1, TOP_LEVEL)
  return { ...entry, level: up, dueAt: now + STEPS_MS[up] }
}

/**
 * The next question to ask, never the one just asked while there is another.
 *
 * `order` is the curriculum: the questions switched on, in the order they are
 * introduced.
 *
 *  1. a question being learned that is due — a miss comes back within seconds
 *  2. a known question due for review
 *  3. a new question, while fewer than FOCUS_SIZE are being learned
 *  4. otherwise the focus keeps turning: one of the two learning questions
 *     closest to due, so the order never becomes a pattern to memorise
 *  5. with nothing left to learn, the review closest to due
 */
export function pickNext(
  stats: SpeedStats,
  order: readonly string[],
  now: number,
  last: string | null,
  rand: () => number = Math.random,
): string {
  const dueAt = (id: string) => stats[id]?.dueAt ?? 0
  const byDue = (a: string, b: string) => dueAt(a) - dueAt(b)
  const asked = order.filter((id) => isIntroduced(stats[id]))
  const learning = asked.filter((id) => !isKnown(stats[id]))
  const others = <T extends string>(ids: T[]) => ids.filter((id) => id !== last)

  const dueLearning = others(learning).filter((id) => dueAt(id) <= now).sort(byDue)
  if (dueLearning.length) return dueLearning[0]

  const dueReviews = others(asked.filter((id) => isKnown(stats[id]) && dueAt(id) <= now)).sort(byDue)
  if (dueReviews.length) return dueReviews[0]

  if (learning.length < FOCUS_SIZE) {
    const fresh = others(order.filter((id) => !isIntroduced(stats[id])))
    if (fresh.length) return fresh[0]
  }

  const turning = others(learning).sort(byDue).slice(0, 2)
  if (turning.length) return turning[Math.floor(rand() * turning.length)]

  const reviews = others(asked).sort(byDue)
  return reviews[0] ?? last ?? order[0]
}

/** Where the learner stands, for the sidebar. */
export function focusState(stats: SpeedStats, order: readonly string[]) {
  const asked = order.filter((id) => isIntroduced(stats[id]))
  const learning = asked.filter((id) => !isKnown(stats[id]))
  return {
    learning,
    known: asked.length - learning.length,
    total: order.length,
    /** The question that comes in when a place opens. */
    upNext: order.find((id) => !isIntroduced(stats[id])) ?? null,
  }
}
