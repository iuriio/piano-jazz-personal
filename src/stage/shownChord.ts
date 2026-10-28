import { useMemo, useRef } from 'react'
import { keyById, readChord } from '../analysis'
import { useStage } from './settings'

/**
 * The notes the chord card reads. A new chord replaces the old one; a melody
 * note, an interval or a cluster played on their own do not — the card keeps
 * the last chord up while your right hand moves on, and "notes held" and the
 * staff follow your hands. Before the first chord, whatever you play shows.
 */
export function useShownChordNotes(): number[] {
  const { settings, settled } = useStage()
  const lastChord = useRef<number[]>([])
  return useMemo(() => {
    const reading = readChord(settled, {
      key: keyById(settings.keyId),
      split: settings.split,
      splitPoint: settings.splitPoint,
    })
    if (reading?.kind === 'chord') lastChord.current = settled
    return lastChord.current.length ? lastChord.current : settled
  }, [settled, settings.keyId, settings.split, settings.splitPoint])
}
