import { useCallback, useState } from 'react'

/**
 * A drill option that survives a reload and a trip to another mode. A stored
 * value the current version does not accept falls back to the default instead
 * of breaking the drill.
 */
export function useStored<T>(key: string, fallback: T, valid: (v: unknown) => boolean): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      if (raw === null) return fallback
      const parsed: unknown = JSON.parse(raw)
      return valid(parsed) ? (parsed as T) : fallback
    } catch {
      return fallback
    }
  })
  const set = useCallback(
    (v: T) => {
      setValue(v)
      try {
        localStorage.setItem(key, JSON.stringify(v))
      } catch {
        // Private window: the option still applies, it just is not remembered.
      }
    },
    [key],
  )
  return [value, set]
}

export const isStringArray = (v: unknown): boolean => Array.isArray(v) && v.every((x) => typeof x === 'string')
