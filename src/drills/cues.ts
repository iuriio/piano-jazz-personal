import { getAudioContext, getMasterBus } from '../audio'

// The sounds that say how an answer went, for practising without looking:
// a light two-note chime for right, one note for right-but-slow, a soft low
// step down for wrong. Short and quiet on purpose — they land on top of the
// chord you are still holding.

export type Cue = 'right' | 'slow' | 'wrong'

type Blip = { hz: number; at: number; len: number; gain: number; type: OscillatorType }

const CUES: Record<Cue, Blip[]> = {
  right: [
    { hz: 1318.5, at: 0, len: 0.14, gain: 0.07, type: 'sine' }, // E6
    { hz: 1975.5, at: 0.07, len: 0.22, gain: 0.07, type: 'sine' }, // B6
  ],
  slow: [{ hz: 1318.5, at: 0, len: 0.2, gain: 0.06, type: 'sine' }],
  wrong: [
    { hz: 233.1, at: 0, len: 0.14, gain: 0.09, type: 'triangle' }, // Bb3
    { hz: 196, at: 0.09, len: 0.24, gain: 0.09, type: 'triangle' }, // G3
  ],
}

export function playCue(cue: Cue): void {
  let ctx: AudioContext
  try {
    ctx = getAudioContext()
  } catch {
    return // no Web Audio here: the drill goes on without the sound
  }
  // Still suspended means no gesture has let audio start; a cue scheduled now
  // would all come out at once when it does.
  if (ctx.state !== 'running') return
  const t0 = ctx.currentTime + 0.01
  for (const b of CUES[cue]) {
    const osc = ctx.createOscillator()
    const env = ctx.createGain()
    osc.type = b.type
    osc.frequency.value = b.hz
    env.gain.setValueAtTime(0, t0 + b.at)
    env.gain.linearRampToValueAtTime(b.gain, t0 + b.at + 0.008)
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + b.at + b.len)
    osc.connect(env)
    env.connect(getMasterBus())
    osc.start(t0 + b.at)
    osc.stop(t0 + b.at + b.len + 0.02)
  }
}
