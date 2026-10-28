import { planPhrase, type PlanBar, type PlanKey, type PlanOpts, type Phrase, type Slot } from './progression'

// A key change heard in the middle of a phrase.
//
// The planner works a phrase at a time, and waiting for the next one to follow
// you can take up to four bars: too slow, when you have already moved. So the
// bars of the current phrase that have not started yet are planned again in the
// new key, from the next bar on. A bar that has started is locked (you may be
// aiming at the chord it promised) and keeps what it rendered, in the old key.
//
// Into a major or minor key, when there are two bars or more left, the first of
// them is a ii–V of the new key (two beats each) and the next one lands on its
// tonic, so the move sounds like a move rather than a jump. With one bar left it
// is just the ii–V, and the next phrase, planned in the new key, lands it.

/** The ii–V and the tonic of a key, where it has one. */
function cadence(key: PlanKey): { ii: string; V: string; I: string } | null {
  if (key.mode === 'major') return { ii: 'ii', V: 'V', I: 'I' }
  if (key.mode === 'minor') return { ii: 'iiø', V: 'V', I: 'i' }
  return null
}

/**
 * Phrase `p` with bars `from`..3 planned again in `to`. `lead` asks for the
 * ii–V into it (false when going back to a key the band never left, say). The
 * bars before `from` are kept as they are. Pure.
 */
export function modulate(p: Phrase, from: number, to: PlanKey, opts: PlanOpts, lead: boolean): Phrase {
  if (from >= p.bars.length) return p
  const fresh = planPhrase(to, p.index, opts).bars
  const beats = opts.beatsPerBar
  const c = lead ? cadence(to) : null
  const bars: PlanBar[] = p.bars.map((bar, i) => {
    if (i < from) return bar
    if (c && i === from) {
      const half = beats / 2
      const slots: Slot[] = [
        { token: c.ii, beats: half },
        { token: c.V, beats: beats - half },
      ]
      return { slots, locked: null }
    }
    if (c && i === from + 1) return { slots: [{ token: c.I, beats }], locked: null }
    // Two bars a chord: after the landing, the tonic carries on (a chart's "%").
    if (c && opts.density === 2) return { slots: [{ token: c.I, beats, hold: true }], locked: null }
    const planned = fresh[i]
    // A "%" right where the key changes would repeat a chord of the old key.
    if (i === from) return { ...planned, slots: planned.slots.map((s) => ({ ...s, hold: false })) }
    return planned
  })
  return { ...p, key: to, bars }
}
