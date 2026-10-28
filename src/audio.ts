// One AudioContext for the whole app.
//
// The transport and the instrument both need to schedule sound. Two contexts
// would mean two independent clocks — and the grading grid is built on the
// transport's clock, so a note sounded on the other one could never be lined up
// against it. They also cost real resources: browsers cap how many a page may
// open. So there is exactly one, created lazily.

import { createFxBus, type FxBus } from './sound/fx'

let ctx: AudioContext | null = null
/** Everything audible goes through here, so one knob can duck the whole app. */
let master: GainNode | null = null

export function getAudioContext(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext()
    master = ctx.createGain()
    master.gain.value = 1

    // Polyphony adds up: a two-hand chord through a synth voice clips the output
    // long before it sounds loud. The compressor only engages near the ceiling,
    // so single notes pass through untouched.
    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = -8
    limiter.knee.value = 6
    limiter.ratio.value = 12
    limiter.attack.value = 0.003
    limiter.release.value = 0.25

    master.connect(limiter)
    limiter.connect(ctx.destination)
  }
  return ctx
}

/** Bus to connect voices to. Never connect to `destination` directly. */
export function getMasterBus(): GainNode {
  getAudioContext()
  return master!
}

let fx: FxBus | null = null

/**
 * The app-wide chorus and reverb (see sound/fx.ts), returning into the master
 * bus. Voices connect a send gain to `chorus` or `reverb`; the dry signal still
 * goes to its own bus. Built on first use: the impulse response costs a few ms.
 */
export function getFxBus(): FxBus {
  if (!fx) fx = createFxBus(getAudioContext(), getMasterBus())
  return fx
}

/**
 * Browsers start an AudioContext suspended and only let a user gesture resume it.
 * A MIDI message does not count as one, so the instrument would stay silent until
 * the first click — this arms a one-shot listener that resumes on any gesture.
 */
export function armAudioResume(): void {
  if (typeof window === 'undefined') return
  const resume = () => {
    const c = getAudioContext()
    if (c.state === 'suspended') void c.resume()
  }
  const opts = { once: true, capture: true } as const
  window.addEventListener('pointerdown', resume, opts)
  window.addEventListener('keydown', resume, opts)
}

/** Best-effort resume, for paths that already sit inside a gesture. */
export async function resumeAudio(): Promise<void> {
  const c = getAudioContext()
  if (c.state === 'suspended') await c.resume()
}
