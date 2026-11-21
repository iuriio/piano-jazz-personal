import { useEffect, useRef } from 'react'
import { keyById } from '../analysis'
import { isImprov, useSettings } from '../stage/settings'
import { accompanist, useAccompany } from './accompanist'
import { Select } from '../ui/Select'
import { BPM_MAX, BPM_MIN, FIXED_KEYS, clampBpm, type AccompanySettings } from './settings'

/**
 * Keeps the accompanist listening and configured for the whole app, whichever
 * mode is on screen; the bar that drives it sits above the chord card.
 */
export function AccompanyHost() {
  const { settings } = useSettings()
  const pagePc = keyById(settings.keyId).tonicPc

  useEffect(() => {
    accompanist.connect()
    return () => accompanist.disconnect()
  }, [])

  // The improvisation drills have a band of their own; the other drills have none.
  const context = settings.mode === 'voicings' && isImprov(settings.drill) ? 'improv' : settings.mode

  useEffect(() => {
    accompanist.configure(context, settings.accompany, pagePc)
  }, [context, settings.accompany, pagePc])

  return null
}

/**
 * The band's controls, always in the same place above the chord card: start
 * or stop, the key, the tempo. Nothing here comes and goes by itself; you
 * start the band when you want it, at the tempo you set.
 */
export function AccompanyBadge() {
  const { settings, update } = useSettings()
  const { phase, heard, play } = useAccompany()
  const acc = settings.accompany
  const set = (patch: Partial<AccompanySettings>) => update({ accompany: { ...acc, ...patch } })
  const on = phase !== 'idle'

  const pageKey = keyById(settings.keyId).label.split(' / ')[0]
  const keyOptions = [
    { value: 'auto', label: `auto · ${heard.keyLabel ?? pageKey}` },
    { group: 'major', options: FIXED_KEYS.filter((k) => k.value.endsWith('major')) },
    { group: 'minor', options: FIXED_KEYS.filter((k) => k.value.endsWith('minor')) },
  ]

  return (
    <div className={`acc-badge ${on ? 'acc-on' : ''}`} role="group" aria-label="accompaniment">
      {on ? (
        <button className="acc-go" onClick={() => accompanist.stop()} title="Stop the band">
          <span aria-hidden="true">■</span> stop
        </button>
      ) : (
        <button className="acc-go" onClick={() => accompanist.start()} title="Start a band under you, at this key and tempo">
          <span aria-hidden="true">▶</span> accompany
        </button>
      )}
      <span className="acc-sep" aria-hidden="true">·</span>
      {on && play ? (
        <span className="acc-key">{play.keyLabel}</span>
      ) : (
        <Select value={acc.key} onValueChange={(v) => set({ key: v })} options={keyOptions} aria-label="key" />
      )}
      <span className="acc-sep" aria-hidden="true">·</span>
      <BpmControl bpm={acc.bpm} onChange={(bpm) => set({ bpm })} />
      {on && play && (
        <span className="acc-beats" aria-label={`beat ${play.beat + 1}`}>
          {[0, 1, 2, 3].map((b) => (
            <i key={b} className={b <= play.beat ? 'on' : ''} />
          ))}
        </span>
      )}
    </div>
  )
}

/** Taps further apart than this start a new count. */
const TAP_RESET_MS = 2000

/**
 * The tempo: − and + (hold to run), or tap it in. Whatever you set is what
 * the band plays; it never changes by itself.
 */
export function BpmControl({ bpm, onChange }: { bpm: number; onChange: (bpm: number) => void }) {
  const latest = useRef(bpm)
  latest.current = bpm
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null)
  const taps = useRef<number[]>([])

  const stopHold = () => {
    if (hold.current) clearTimeout(hold.current)
    hold.current = null
  }
  useEffect(() => stopHold, [])

  // Counted here as well as in the settings: quick presses land before the re-render.
  const step = (d: number) => {
    latest.current = clampBpm(latest.current + d)
    onChange(latest.current)
  }
  // Hold: one step now, then a run after a pause, the way a stepper behaves.
  const press = (d: number) => {
    stopHold()
    step(d)
    const run = (delay: number) => {
      hold.current = setTimeout(() => {
        step(d)
        run(60)
      }, delay)
    }
    run(380)
  }

  const tap = () => {
    const now = performance.now()
    const t = taps.current.filter((x) => now - x < TAP_RESET_MS * 4)
    if (t.length && now - t[t.length - 1] > TAP_RESET_MS) t.length = 0
    t.push(now)
    taps.current = t.slice(-6)
    if (taps.current.length >= 3) {
      const span = taps.current[taps.current.length - 1] - taps.current[0]
      onChange(clampBpm(60000 / (span / (taps.current.length - 1))))
    }
  }

  // Pointer presses run the stepper; the click that follows only counts from the keyboard.
  const stepper = (d: number, label: string) => (
    <button
      className="acc-step"
      aria-label={label}
      disabled={d < 0 ? bpm <= BPM_MIN : bpm >= BPM_MAX}
      onPointerDown={(e) => {
        if (e.button === 0) press(d)
      }}
      onPointerUp={(e) => {
        stopHold()
        e.currentTarget.blur()
      }}
      onPointerLeave={stopHold}
      onPointerCancel={stopHold}
      onClick={(e) => {
        if (e.detail === 0) step(d)
      }}
    >
      {d < 0 ? '−' : '+'}
    </button>
  )

  return (
    <span className="acc-bpm-ctl" role="group" aria-label="tempo">
      {stepper(-1, 'slower')}
      <span className="acc-bpm" aria-live="polite">
        {bpm}
        <span className="acc-unit"> bpm</span>
      </span>
      {stepper(1, 'faster')}
      <button className="acc-tap" onClick={tap} onPointerUp={(e) => e.currentTarget.blur()} title="Tap the tempo: three taps or more">
        tap
      </button>
    </span>
  )
}
