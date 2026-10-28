import type { Sampler, SampleLoader, SmplrGroup, SmplrPreset, StopFn, Storage } from 'smplr'

// Sampled instruments: a real grand, two electric pianos and an acoustic kit.
//
// The samples are ours to serve (public/samples/, credits in ATTRIBUTION.md):
// nothing is fetched from a third-party host. Each set has a preset.json in
// smplr's own format, plus a smaller "quick" subset of it — one velocity
// layer, fewer keys — that loads first, so a note sounds within a second or so
// of choosing the instrument; the full set follows in the background and is
// swapped in when it is all there.
//
// smplr itself is imported lazily: the app pays for it only when a sampled
// sound is chosen. Decoded buffers are shared through one loader per audio
// context, so the band and your own playing load each set once, and the raw
// files sit in the Cache API between visits.
//
// Until a set is playable, callers fall back to their synthesized voice: an
// instrument that is still downloading must not mean silence.

export type KeysTimbre = 'grand' | 'wurlitzer' | 'cp80'
export const KEYS_TIMBRES: KeysTimbre[] = ['grand', 'wurlitzer', 'cp80']

export const KEYS_LABEL: Record<KeysTimbre, string> = {
  grand: 'grand piano',
  wurlitzer: 'Wurlitzer',
  cp80: 'CP80 electric grand',
}

export const KEYS_HELP: Record<KeysTimbre, string> = {
  grand: 'A sampled Steinway grand. Loads in the background; the synth piano plays until it is ready.',
  wurlitzer: 'Wurlitzer EP200 electric piano, sampled. Bites when you dig in.',
  cp80: 'Yamaha CP80 electric grand, sampled: a piano with a pickup, bright and short.',
}

export type DrumKit = 'acoustic'
export const DRUM_KITS: DrumKit[] = ['acoustic']

export const DRUM_KIT_LABEL: Record<DrumKit, string> = {
  acoustic: 'acoustic kit',
}

/** A sample set on disk: public/samples/<bank>/. */
export type Bank = KeysTimbre | `kit-${DrumKit}`

export function isKeysTimbre(v: unknown): v is KeysTimbre {
  return KEYS_TIMBRES.includes(v as KeysTimbre)
}

export function isDrumKit(v: unknown): v is DrumKit {
  return DRUM_KITS.includes(v as DrumKit)
}

/**
 * Level trim per set, dB, so a chord at the same velocity is about as loud on
 * every keyboard (measured offline against the grand), and the kit sits under
 * the band. The VCSL drums are recorded at true level, with no normalising:
 * a soft hit is quiet in the file already, hence the big lift.
 */
export const BANK_TRIM_DB: Record<Bank, number> = {
  grand: 0,
  wurlitzer: 4.5,
  cp80: 4,
  'kit-acoustic': 12,
}

/** Bumped whenever a file under public/samples changes, so the browser cache is not stale. */
export const SAMPLES_VERSION = 2
const CACHE_PREFIX = 'keytrainer-samples-v'
const CACHE_NAME = `${CACHE_PREFIX}${SAMPLES_VERSION}`

// --- pure ---------------------------------------------------------------------------

/** preset.json as stored: smplr's format plus the quick first-load subset. */
export type StoredPreset = SmplrPreset & { quick?: { groups: SmplrGroup[] } }

/** Where a bank's files are served from. */
export function bankUrl(bank: Bank, base = baseUrl()): string {
  return `${base.replace(/\/?$/, '/')}samples/${bank}`
}

/**
 * The two load stages of a stored preset, with its baseUrl pointed at where we
 * serve it. Without a quick subset both stages are the full set. Pure.
 */
export function stagesOf(stored: StoredPreset, url: string): { quick: SmplrPreset; full: SmplrPreset } {
  const { quick, ...rest } = stored
  const full: SmplrPreset = { ...rest, samples: { ...rest.samples, baseUrl: url } }
  return { quick: quick ? { ...full, groups: quick.groups } : full, full }
}

/** Every sample a preset needs, once each. Pure. */
export function sampleNames(p: SmplrPreset): string[] {
  const seen = new Set<string>()
  for (const g of p.groups) for (const r of g.regions) seen.add(r.sample)
  return [...seen]
}

function baseUrl(): string {
  try {
    return import.meta.env.BASE_URL ?? '/'
  } catch {
    return '/'
  }
}

// --- loading ------------------------------------------------------------------------

type Smplr = typeof import('smplr')
let lib: Promise<Smplr> | null = null
function smplr(): Promise<Smplr> {
  return (lib ??= import('smplr'))
}

/**
 * Cache API storage that only keeps good answers. smplr's own CacheStorage
 * would also keep a 404 forever; and without the Cache API (insecure origin,
 * old browser) this is plain fetch.
 */
let pruned = false
const storage: Storage = {
  async fetch(url: string) {
    if (typeof caches === 'undefined') return fetch(url)
    if (!pruned) {
      pruned = true
      // Older versions' caches: the samples they hold are stale now.
      void caches
        .keys()
        .then((keys) => Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME).map((k) => caches.delete(k))))
        .catch(() => {})
    }
    try {
      const cache = await caches.open(CACHE_NAME)
      const hit = await cache.match(url)
      if (hit) return hit
      const res = await fetch(url)
      if (res.ok) await cache.put(url, res.clone())
      return res
    } catch {
      return fetch(url)
    }
  },
}

export type Stage = 'idle' | 'loading' | 'quick' | 'full' | 'error'

type BankLoad = {
  stage: Stage
  quick: Promise<SmplrPreset | null>
  full: Promise<SmplrPreset | null>
}

const loaders = new WeakMap<BaseAudioContext, SampleLoader>()
const banks = new WeakMap<BaseAudioContext, Map<Bank, BankLoad>>()
const stageListeners = new Set<() => void>()

async function loaderFor(ctx: BaseAudioContext): Promise<SampleLoader> {
  const m = await smplr()
  let l = loaders.get(ctx)
  if (!l) {
    l = m.SampleLoader(ctx, { storage })
    loaders.set(ctx, l)
  }
  return l
}

/** Loads a set into the context's shared loader: quick stage first, then the rest. Idempotent. */
export function prepare(ctx: BaseAudioContext, bank: Bank): BankLoad {
  let perCtx = banks.get(ctx)
  if (!perCtx) {
    perCtx = new Map()
    banks.set(ctx, perCtx)
  }
  const had = perCtx.get(bank)
  if (had) return had

  const url = bankUrl(bank)
  const setStage = (s: Stage) => {
    load.stage = s
    for (const cb of stageListeners) cb()
  }
  const stages = storage
    .fetch(`${url}/preset.json`)
    .then((r) => {
      if (r.status >= 400) throw new Error(`${bank}: preset ${r.status}`)
      return r.json() as Promise<StoredPreset>
    })
    .then((stored) => stagesOf(stored, url))
  const loadAll = async (p: SmplrPreset): Promise<SmplrPreset | null> => {
    const loader = await loaderFor(ctx)
    const got = await loader.load(p)
    // Nothing decoded (offline, a broken deploy): stay on the synth.
    return got.size > 0 ? p : null
  }
  const quick = stages.then((s) => loadAll(s.quick)).catch(() => null)
  const full = quick
    .then(async (q) => {
      if (!q) return null
      const s = await stages
      return s.full === s.quick ? q : loadAll(s.full)
    })
    .catch(() => null)
  const load: BankLoad = { stage: 'loading', quick, full }
  perCtx.set(bank, load)
  setStage('loading')
  void quick.then((q) => {
    if (q) setStage('quick')
  })
  void full.then((f) => {
    if (f) setStage('full')
    else if (load.stage === 'loading') setStage('error')
  })
  return load
}

/** How far a set has loaded in this context. */
export function bankStage(ctx: BaseAudioContext, bank: Bank): Stage {
  return banks.get(ctx)?.get(bank)?.stage ?? 'idle'
}

/** Called whenever any set changes stage: for a "loading…" hint in the UI. */
export function onBankStage(cb: () => void): () => void {
  stageListeners.add(cb)
  return () => {
    stageListeners.delete(cb)
  }
}

// --- one playing instance -------------------------------------------------------------

export type SampledNote = {
  note: number | string
  /** MIDI velocity, 1..127: smplr maps it to gain (v²) and to the velocity layer. */
  velocity: number
  /** Audio-clock time. Omitted: now. */
  time?: number
  /** Seconds; omitted: until the returned stop is called. */
  duration?: number
}

/**
 * A sampled instrument writing into `dest`. Plays nothing (and says so through
 * `playable`) until its set's quick stage is loaded; upgrades itself to the
 * full set when that arrives. Cheap to make once a set is loaded: the buffers
 * come from the shared loader, so a new instance per band session is fine.
 */
export class SampledInstrument {
  private inst: Sampler | null = null
  private trim: GainNode
  private disposed = false
  private stopSeq = 0
  /** Resolves when the instrument can play (or never will: check `playable`). */
  readonly ready: Promise<void>

  constructor(
    readonly ctx: BaseAudioContext,
    readonly bank: Bank,
    readonly dest: AudioNode,
    private readonly volume = 110,
  ) {
    this.trim = ctx.createGain()
    this.trim.gain.value = 10 ** (BANK_TRIM_DB[bank] / 20)
    this.trim.connect(dest)
    const load = prepare(ctx, bank)
    this.ready = this.boot(load)
  }

  get playable(): boolean {
    return this.inst !== null && !this.disposed
  }

  private async boot(load: BankLoad): Promise<void> {
    // Already fully loaded (a later session): start on the full set directly.
    const first = load.stage === 'full' ? await load.full : await load.quick
    if (!first || this.disposed) return
    const m = await smplr()
    const loader = await loaderFor(this.ctx)
    if (this.disposed) return
    const inst = m.Sampler(this.ctx, {
      preset: first,
      destination: this.trim,
      loader,
      volume: this.volume,
    })
    await inst.ready
    if (this.disposed) {
      inst.dispose()
      return
    }
    this.inst = inst
    if (first !== (await load.full)) {
      const full = await load.full
      if (full && !this.disposed) await inst.reload(full)
    }
  }

  /** Starts a note; the returned function releases it (at `time`, or now). */
  start(n: SampledNote): (time?: number) => void {
    const inst = this.inst
    if (!inst || this.disposed) return () => {}
    // A stopId of its own: smplr's default (the note) would let releasing one
    // note cut every other voice on the same key.
    const stop: StopFn = inst.start({
      note: n.note,
      velocity: Math.max(1, Math.min(127, Math.round(n.velocity))),
      time: n.time,
      duration: n.duration,
      stopId: `n${++this.stopSeq}`,
    })
    return (time?: number) => {
      if (!this.disposed) stop(time ?? this.ctx.currentTime)
    }
  }

  /** Releases everything sounding, at `time` (default now). */
  stopAll(time?: number): void {
    if (!this.inst || this.disposed) return
    this.inst.stop({ time: time ?? this.ctx.currentTime })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.inst?.dispose()
    this.inst = null
    this.trim.disconnect()
  }
}
