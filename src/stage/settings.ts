import { createContext, useContext } from 'react'
import type { BassSplit } from '../analysis'
import { DEFAULT_SETTLE_MS } from '../midi'
import type { NamingStyle } from './naming'

// Settings every mode shares: they belong to the page, not to a practice mode.
// Saved raw and validated on load, so a value from an older version falls back to
// the default instead of breaking the page.

export type Mode = 'free' | 'voicings' | 'shred'

export const MODES: Mode[] = ['free', 'voicings', 'shred']

export const MODE_LABEL: Record<Mode, string> = {
  free: 'free play',
  voicings: 'voicings',
  shred: 'shred',
}

export type StageSettings = {
  mode: Mode
  keyId: string
  split: BassSplit
  splitPoint: number
  naming: NamingStyle
  settleMs: number
  /** Velocity for notes played on the computer keyboard; a MIDI keyboard sends its own. */
  keysVelocity: number
  keysHumanise: boolean
  inputId: string | null
}

export const DEFAULT_STAGE: StageSettings = {
  mode: 'free',
  keyId: 'C',
  split: 'off',
  splitPoint: 48,
  naming: 'exact',
  settleMs: DEFAULT_SETTLE_MS,
  keysVelocity: 90,
  keysHumanise: false,
  inputId: null,
}

export const SPLIT_POINTS: { midi: number; label: string }[] = [
  { midi: 36, label: '≤ C2' },
  { midi: 40, label: '≤ E2' },
  { midi: 43, label: '≤ G2' },
  { midi: 48, label: '≤ C3' },
  { midi: 52, label: '≤ E3' },
  { midi: 55, label: '≤ G3' },
  { midi: 60, label: '≤ C4' },
]

const STORAGE_KEY = 'keytrainer.stage'

export function loadStage(): StageSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<StageSettings>
    const s = { ...DEFAULT_STAGE, ...raw }
    return {
      ...s,
      mode: MODES.includes(s.mode) ? s.mode : 'free',
      split: ['off', 'slash', 'apart'].includes(s.split) ? s.split : 'off',
      naming: ['exact', 'jazz', 'simple'].includes(s.naming) ? s.naming : 'exact',
      splitPoint: SPLIT_POINTS.some((p) => p.midi === s.splitPoint) ? s.splitPoint : 48,
      settleMs: Number.isFinite(s.settleMs) ? s.settleMs : DEFAULT_SETTLE_MS,
      keysVelocity: Number.isFinite(s.keysVelocity) ? s.keysVelocity : 90,
    }
  } catch {
    // Private window or blocked storage: the page still works, it just forgets.
    return DEFAULT_STAGE
  }
}

export function saveStage(s: StageSettings): StageSettings {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  } catch {
    // See loadStage.
  }
  return s
}

// Two contexts on purpose. What you play changes on every note; the settings
// change when you touch a control. A mode that only needs the settings (shred
// reads its own raw events) must not re-render on every key.

export type SettingsContextValue = {
  settings: StageSettings
  update: (patch: Partial<StageSettings>) => void
}

export type PlayContextValue = {
  /** Sounding now: finger + pedal. */
  held: number[]
  /** Last settled chord; stays after you let go. */
  settled: number[]
}

export const SettingsContext = createContext<SettingsContextValue | null>(null)
export const PlayContext = createContext<PlayContextValue>({ held: [], settled: [] })

export function useSettings(): SettingsContextValue {
  const v = useContext(SettingsContext)
  if (!v) throw new Error('useSettings outside the stage')
  return v
}

export function usePlay(): PlayContextValue {
  return useContext(PlayContext)
}

export function useStage(): SettingsContextValue & PlayContextValue {
  return { ...useSettings(), ...usePlay() }
}
