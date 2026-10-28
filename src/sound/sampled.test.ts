import { describe, expect, it } from 'vitest'
import { DRUM_KITS, KEYS_TIMBRES, bankUrl, sampleNames, stagesOf, type Bank, type StoredPreset } from './sampled'

// Vite's glob: the presets as data, the audio files as a list of paths (never loaded).
const PRESETS = import.meta.glob<StoredPreset>('../../public/samples/*/preset.json', { eager: true, import: 'default' })
const FILES = new Set(Object.keys(import.meta.glob('../../public/samples/*/*.{ogg,m4a}')))
const BANKS: Bank[] = [...KEYS_TIMBRES, ...DRUM_KITS.map((k) => `kit-${k}` as const)]
const read = (bank: Bank) => PRESETS[`../../public/samples/${bank}/preset.json`]
const exists = (bank: Bank, file: string) => FILES.has(`../../public/samples/${bank}/${file}`)

describe('sample sets on disk', () => {
  it('every bank has a preset', () => {
    for (const bank of BANKS) expect(read(bank), bank).toBeDefined()
    expect(FILES.size).toBeGreaterThan(100)
  })

  it.each(BANKS)('%s: every sample its preset names is there, in both formats', (bank) => {
    const { quick, full } = stagesOf(read(bank), '/x')
    for (const name of new Set([...sampleNames(full), ...sampleNames(quick)])) {
      for (const ext of ['ogg', 'm4a']) expect(exists(bank, `${name}.${ext}`), `${name}.${ext}`).toBe(true)
    }
  })

  it.each(KEYS_TIMBRES)('%s: every key of an 88-key board sounds at every velocity, in both stages', (bank) => {
    const { quick, full } = stagesOf(read(bank), '/x')
    for (const p of [quick, full]) {
      for (let midi = 21; midi <= 108; midi++) {
        for (const v of [1, 30, 64, 100, 127]) {
          const hit = p.groups.some((g) => {
            const [gl, gh] = g.velRange ?? [0, 127]
            return v >= gl && v <= gh && g.regions.some((r) => {
              const [kl, kh] = r.keyRange ?? [r.key ?? 0, r.key ?? 127]
              const [vl, vh] = r.velRange ?? [0, 127]
              return midi >= kl && midi <= kh && v >= vl && v <= vh
            })
          })
          expect(hit, `${bank} midi ${midi} vel ${v}`).toBe(true)
        }
      }
    }
  })

  it.each(KEYS_TIMBRES)('%s: the quick stage is a small part of the full set', (bank) => {
    const { quick, full } = stagesOf(read(bank), '/x')
    expect(sampleNames(quick).length).toBeLessThan(sampleNames(full).length / 2)
    for (const n of sampleNames(quick)) expect(sampleNames(full)).toContain(n)
  })

  it('the kit answers to the piece names the grooves use', () => {
    const p = read('kit-acoustic')
    for (const piece of ['kick', 'snare', 'rim', 'hat', 'chick', 'open', 'ride', 'bell']) {
      const key = p.aliases?.[piece]
      expect(key, piece).toBeDefined()
      expect(p.groups.some((g) => g.regions.some((r) => r.key === key))).toBe(true)
    }
  })
})

describe('stagesOf', () => {
  it('points the samples at where we serve them and splits off the quick subset', () => {
    const stored: StoredPreset = {
      samples: { baseUrl: '', formats: ['ogg', 'm4a'] },
      groups: [{ regions: [{ sample: 'a' }, { sample: 'b' }] }],
      quick: { groups: [{ regions: [{ sample: 'a' }] }] },
    }
    const { quick, full } = stagesOf(stored, '/samples/grand')
    expect(full.samples.baseUrl).toBe('/samples/grand')
    expect(quick.samples.baseUrl).toBe('/samples/grand')
    expect(sampleNames(full)).toEqual(['a', 'b'])
    expect(sampleNames(quick)).toEqual(['a'])
    expect('quick' in full).toBe(false)
  })

  it('without a quick subset both stages are the full set', () => {
    const stored: StoredPreset = { samples: { baseUrl: '', formats: ['ogg'] }, groups: [{ regions: [{ sample: 'a' }] }] }
    const { quick, full } = stagesOf(stored, '/s')
    expect(quick).toBe(full)
  })

  it('serves from the site root, never from a third-party host', () => {
    expect(bankUrl('grand', '/')).toBe('/samples/grand')
    expect(bankUrl('kit-acoustic', '/app')).toBe('/app/samples/kit-acoustic')
  })
})
