import type { Complexity } from './progression'
import { STYLES, type Style } from './patterns'
import { DRUM_KITS, DRUM_KIT_LABEL, KEYS_LABEL, KEYS_TIMBRES, isDrumKit, isKeysTimbre, type DrumKit, type KeysTimbre } from '../sound/sampled'

// The accompaniment's saved choices. They live inside StageSettings (one
// storage key for the page) and are validated the same way: anything from an
// older version, or hand-edited, falls back field by field to the default.

export type AccompanySettings = {
  /** Whether it offers by itself. The listening dot works either way. */
  offers: boolean
  /** 'auto' = picked from what it heard: pad for rubato or slow, comp for swing, even for straight. */
  style: 'auto' | Style
  complexity: Complexity
  /** Bars per chord. 'auto' = 2 when you play sparsely or fast. */
  density: 'auto' | '1' | '2'
  /** follow = drifts with you, slowly; lock = the tempo it started with. */
  tempo: 'follow' | 'lock'
  /** Accompaniment volume, 0..1. Its own bus, apart from your instrument. */
  level: number
  /** Move to a new key when you do. */
  followKey: boolean
  /** The band's piano: 'synth' (no download) or a sampled timbre. */
  keys: 'synth' | KeysTimbre
  /** Drums under the band: off, or a kit. Off by default: not everyone practises with a drummer. */
  drums: 'off' | DrumKit
}

/** Options for a "band piano" select, in menu order. */
export const ACCOMPANY_KEYS_OPTIONS: { value: AccompanySettings['keys']; label: string }[] = [
  ...KEYS_TIMBRES.map((t) => ({ value: t, label: KEYS_LABEL[t] })),
  { value: 'synth', label: 'synth piano' },
]

/** Options for a "drums" select, in menu order. */
export const ACCOMPANY_DRUMS_OPTIONS: { value: AccompanySettings['drums']; label: string }[] = [
  { value: 'off', label: 'no drums' },
  ...DRUM_KITS.map((k) => ({ value: k, label: DRUM_KIT_LABEL[k] })),
]

export const DEFAULT_ACCOMPANY: AccompanySettings = {
  offers: true,
  style: 'auto',
  complexity: 2,
  density: 'auto',
  tempo: 'follow',
  level: 0.35,
  followKey: true,
  keys: 'grand',
  drums: 'off',
}

/** Field-by-field validation of whatever came out of storage. */
export function validAccompany(raw: unknown): AccompanySettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof AccompanySettings, unknown>>
  const d = DEFAULT_ACCOMPANY
  return {
    offers: typeof r.offers === 'boolean' ? r.offers : d.offers,
    style: r.style === 'auto' || STYLES.includes(r.style as Style) ? (r.style as AccompanySettings['style']) : d.style,
    complexity: [1, 2, 3, 4].includes(r.complexity as number) ? (r.complexity as Complexity) : d.complexity,
    density: ['auto', '1', '2'].includes(r.density as string) ? (r.density as AccompanySettings['density']) : d.density,
    tempo: r.tempo === 'follow' || r.tempo === 'lock' ? r.tempo : d.tempo,
    level: typeof r.level === 'number' && r.level >= 0 && r.level <= 1 ? r.level : d.level,
    followKey: typeof r.followKey === 'boolean' ? r.followKey : d.followKey,
    keys: r.keys === 'synth' || isKeysTimbre(r.keys) ? r.keys : d.keys,
    drums: r.drums === 'off' || isDrumKit(r.drums) ? r.drums : d.drums,
  }
}
