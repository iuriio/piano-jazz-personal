import { describe, expect, it, beforeEach } from 'vitest'
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from './shredStats'
import { ABS_MIN_BPM, DEFAULT_RAMP, LOCKED } from './ramp'

// jsdom is not enabled; a fake localStorage is enough to test the normalization,
// which is where the missing-field bug shows up.
const store = new Map<string, string>()
beforeEach(() => store.clear())
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as Storage

describe('normalizing the preferences', () => {
  it('fills in a field an older version did not save', () => {
    // Exactly the format written before clickVolume existed.
    store.set('pjt:shred:settings', JSON.stringify({ low: 36, high: 84, latencyMs: 0, strictness: 'standard' }))
    const s = loadSettings()
    expect(Number.isFinite(s.clickVolume)).toBe(true)
    expect(s.clickVolume).toBe(DEFAULT_SETTINGS.clickVolume)
  })

  it('saving completes too, so what comes back never has a hole', () => {
    const s = saveSettings({ low: 36, high: 84 })
    expect(Number.isFinite(s.clickVolume)).toBe(true)
    expect(Number.isFinite(s.latencyMs)).toBe(true)
    expect(typeof s.strictness).toBe('string')
    expect(JSON.parse(store.get('pjt:shred:settings') as string)).toEqual(s)
  })

  it('a volume outside 0..1 is clamped', () => {
    expect(saveSettings({ ...DEFAULT_SETTINGS, clickVolume: 5 }).clickVolume).toBe(1)
    expect(saveSettings({ ...DEFAULT_SETTINGS, clickVolume: -2 }).clickVolume).toBe(0)
  })

  it('a keyboard range that is too small falls back to the default', () => {
    expect(saveSettings({ low: 60, high: 62 })).toEqual(DEFAULT_SETTINGS)
  })

  it('a strictness value that no longer exists falls back to the default', () => {
    // Settings written by the Portuguese build carry strictness: 'padrao'. Left
    // as-is it would reach toleranceFor() and match no case.
    store.set('pjt:shred:settings', JSON.stringify({ low: 36, high: 84, strictness: 'padrao' }))
    expect(loadSettings().strictness).toBe(DEFAULT_SETTINGS.strictness)
  })

  it('the tempo floor is a saved preference, clamped to what a click can hold', () => {
    // Slow practice on an arpeggio is a real use, so the floor goes well under
    // the default 40 — but not so low that the pulse stops being a pulse.
    expect(saveSettings({ ...DEFAULT_SETTINGS, minBpm: 20 }).minBpm).toBe(20)
    expect(saveSettings({ ...DEFAULT_SETTINGS, minBpm: 1 }).minBpm).toBe(ABS_MIN_BPM)
    expect(saveSettings({ ...DEFAULT_SETTINGS, minBpm: 9999 }).minBpm).toBe(
      DEFAULT_RAMP.maxBpm - DEFAULT_RAMP.stepBpm,
    )
    expect(loadSettings().minBpm).toBe(DEFAULT_RAMP.maxBpm - DEFAULT_RAMP.stepBpm)
  })

  it('settings saved before the floor existed keep the old floor', () => {
    store.set('pjt:shred:settings', JSON.stringify({ low: 36, high: 84 }))
    expect(loadSettings().minBpm).toBe(DEFAULT_RAMP.minBpm)
  })

  it('never (LOCKED) is a valid choice for raise-after, not a clamped-away zero', () => {
    // Drilling one tempo indefinitely is a normal way to practise, so 0 has to
    // survive normalize instead of being pulled up to 1.
    expect(saveSettings({ ...DEFAULT_SETTINGS, advanceReps: LOCKED }).advanceReps).toBe(LOCKED)
    expect(loadSettings().advanceReps).toBe(LOCKED)
    expect(saveSettings({ ...DEFAULT_SETTINGS, advanceReps: -5 }).advanceReps).toBe(LOCKED)
    expect(saveSettings({ ...DEFAULT_SETTINGS, advanceReps: 9 }).advanceReps).toBe(3)
  })

  it('corrupt storage does not take it down', () => {
    store.set('pjt:shred:settings', '{this is not json')
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
  })
})

describe('hands', () => {
  it('opens with the right hand alone', () => {
    expect(loadSettings().handMode).toBe('rh')
  })

  it("ignores the 'as-is' default an older build saved", () => {
    store.set('pjt:shred:settings', JSON.stringify({ ...DEFAULT_SETTINGS, handMode: 'as-is', handModeChosen: undefined }))
    expect(loadSettings().handMode).toBe('rh')
  })

  it('keeps hands the player picked', () => {
    saveSettings({ ...DEFAULT_SETTINGS, handMode: 'both', handModeChosen: true })
    expect(loadSettings().handMode).toBe('both')
  })
})

describe('what was selected survives a reload', () => {
  it('stores and returns the selects', () => {
    saveSettings({
      ...DEFAULT_SETTINGS,
      exerciseId: 'dim7-arpeggio',
      rootPc: 7,
      handMode: 'both',
      handModeChosen: true,
      order: 'chromatic',
      mode: 'burst',
      qwerty: true,
    })
    const s = loadSettings()
    expect(s.exerciseId).toBe('dim7-arpeggio')
    expect(s.rootPc).toBe(7)
    expect(s.handMode).toBe('both')
    expect(s.order).toBe('chromatic')
    expect(s.mode).toBe('burst')
    expect(s.qwerty).toBe(true)
  })

  it('a key outside 0..11 is clamped', () => {
    expect(saveSettings({ ...DEFAULT_SETTINGS, rootPc: 40 }).rootPc).toBe(11)
    expect(saveSettings({ ...DEFAULT_SETTINGS, rootPc: -3 }).rootPc).toBe(0)
  })

  it('qwerty only turns on with an explicit true', () => {
    store.set('pjt:shred:settings', JSON.stringify({ low: 36, high: 84, qwerty: 'yes' }))
    expect(loadSettings().qwerty).toBe(false)
  })

  it('storage without the newer fields does not break', () => {
    store.set('pjt:shred:settings', JSON.stringify({ low: 36, high: 84 }))
    const s = loadSettings()
    expect(s.exerciseId).toBe('')
    expect(s.mode).toBe('ladder')
    expect(s.rootPc).toBe(0)
  })
})

describe('continuous guide', () => {
  it('off by default: a piano playing along is a choice, not a surprise', () => {
    store.set('pjt:shred:settings', JSON.stringify({ low: 36, high: 84 }))
    expect(loadSettings().guide).toBe(false)
    expect(loadSettings().guideVolume).toBe(DEFAULT_SETTINGS.guideVolume)
  })

  it('stores the on/volume pair', () => {
    const s = saveSettings({ ...DEFAULT_SETTINGS, guide: true, guideVolume: 0.35 })
    expect(s.guide).toBe(true)
    expect(s.guideVolume).toBe(0.35)
    expect(loadSettings().guide).toBe(true)
  })

  it('the guide volume and the click volume are independent', () => {
    const s = saveSettings({ ...DEFAULT_SETTINGS, clickVolume: 0, guideVolume: 1 })
    expect(s.clickVolume).toBe(0)
    expect(s.guideVolume).toBe(1)
  })

  it('a volume outside 0..1 is clamped', () => {
    expect(saveSettings({ ...DEFAULT_SETTINGS, guideVolume: 9 }).guideVolume).toBe(1)
    expect(saveSettings({ ...DEFAULT_SETTINGS, guideVolume: -1 }).guideVolume).toBe(0)
  })
})
