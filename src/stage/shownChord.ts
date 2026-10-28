import { useMemo, useRef } from 'react'
import { keyById, readChord, type BassSplit, type KeySig } from '../analysis'
import { snapshot } from './liveNotes'
import { useStage } from './settings'

type ReadOpts = { key: KeySig; split: BassSplit; splitPoint: number }

/** Longer than a rolled chord: a note this much after the voicing was added to it. */
const ADDED_AFTER_MS = 120

/**
 * What the chord card shows after a new settled reading. `shown` is what it
 * shows now, `prev` the previous settled notes, `now` the new ones, and
 * `played.struck` whether any key went down since `prev` settled.
 *
 * - A new chord replaces the old one; a lone note, an interval or a cluster
 *   does not — the card keeps the chord while your hand plays a line.
 * - Letting go never renames the chord. Lift the C out of an A minor and you
 *   are still playing A minor, not an "A5"; lift the D out of a Dm7 and it is
 *   still Dm7, not F; lift the hand top to bottom and the chord stays. The one
 *   exception is a note added over the voicing: when the notes that come up
 *   were all struck after the ones still held (`liftedLater`) and what is left
 *   is a chord of three or more notes, they were a melody on it (Cmaj7 with a D
 *   on top reads Cmaj9; let the D go and it is Cmaj7 again).
 */
export function nextShownChord(
  shown: number[],
  prev: number[],
  now: number[],
  played: { struck: boolean; liftedLater: boolean },
  opts: ReadOpts,
): number[] {
  if (now.length === 0) return shown
  const reading = readChord(now, opts)
  const isChord = reading?.kind === 'chord'
  const keep = shown.length ? shown : now

  const releasedOnly = !played.struck && now.length < prev.length && now.every((n) => prev.includes(n))
  if (releasedOnly) {
    const pcs = new Set(now.map((n) => n % 12)).size
    return played.liftedLater && isChord && pcs >= 3 ? now : keep
  }
  return isChord ? now : keep
}

/**
 * The notes the chord card reads: the settled notes run through
 * nextShownChord. "Notes held" and the staff follow your hands instead.
 * Before the first chord, whatever you play shows.
 */
export function useShownChordNotes(): number[] {
  const { settings, settled } = useStage()
  const shownRef = useRef<number[]>([])
  const prevRef = useRef<number[]>([])
  // When the previous settled notes were taken in: a key down after this is a
  // new attack, which is how a re-struck A–E tells itself apart from an A
  // minor with the C lifted.
  const sinceRef = useRef(0)

  return useMemo(() => {
    const opts = { key: keyById(settings.keyId), split: settings.split, splitPoint: settings.splitPoint }
    if (settled !== prevRef.current) {
      const t = performance.now()
      const { sounding, trail } = snapshot(t)
      const struck = [...sounding, ...trail].some((n) => n.on > sinceRef.current)
      // Lifted notes struck clearly after everything still held were added on
      // top of the voicing; a roll or a hand going down together is not that.
      const onOf = new Map<number, number>()
      for (const n of [...trail, ...sounding]) onOf.set(n.midi, n.on)
      const lifted = prevRef.current.filter((n) => !settled.includes(n))
      const heldSince = Math.max(...settled.map((n) => onOf.get(n) ?? Infinity))
      const liftedLater = lifted.length > 0 && lifted.every((n) => (onOf.get(n) ?? -Infinity) > heldSince + ADDED_AFTER_MS)
      shownRef.current = nextShownChord(shownRef.current, prevRef.current, settled, { struck, liftedLater }, opts)
      prevRef.current = settled
      sinceRef.current = t
    }
    return shownRef.current
  }, [settled, settings.keyId, settings.split, settings.splitPoint])
}
