import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { Note } from 'tonal'
import { keyById, type KeySig } from '../analysis'
import { useSettings } from './settings'

// What a drill is asking for, so the stage reads it back with the same name.
//
// A drill writes its roots its own way — the two of B major is C♯m7 — and the
// chord card, left to the page's key, might call the same chord D♭m7. The drill
// on screen says which names it is using; the card, the key labels and the
// staff spell those roots that way and everything else as before.

let asked: ReadonlyMap<number, string> | null = null
const listeners = new Set<() => void>()

function setAsked(next: ReadonlyMap<number, string> | null): void {
  asked = next
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Accidentals as ASCII, which is what the chord reading works in. */
const ascii = (name: string) => name.replace(/♯/g, '#').replace(/♭/g, 'b')

/** For a drill: the roots it is asking for right now, as it writes them ("C♯", "F#"). */
export function useAskedRoots(names: readonly string[]): void {
  const key = names.join(' ')
  useEffect(() => {
    const mine = new Map<number, string>()
    for (const name of names.map(ascii)) {
      const pc = Note.chroma(name)
      if (pc !== undefined) mine.set(pc, name)
    }
    setAsked(mine)
    return () => {
      if (asked === mine) setAsked(null)
    }
  }, [key])
}

/** The page's key, carrying the roots the drill on screen is asking for. */
export function useStageKey(): KeySig {
  const { settings } = useSettings()
  const roots = useSyncExternalStore(subscribe, () => asked)
  return useMemo(() => {
    const key = keyById(settings.keyId)
    return roots ? { ...key, asked: roots } : key
  }, [settings.keyId, roots])
}
