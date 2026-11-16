import { useEffect, useRef, useState } from 'react'
import { useSettings } from '../stage/settings'
import { playCue, type Cue } from './cues'
import { hush, speak } from './voice'

/**
 * Says the question when it changes, if the voice is on.
 *
 * `onSpoken` runs when the voice has finished the question — the moment a
 * timed drill starts its clock, so the time it takes to say "F-sharp minor
 * seven" is not taken out of the two seconds. The number returned goes up at
 * that same moment, for anything on screen that has to restart with the clock.
 */
export function useSpokenQuestion(text: string, questionKey: string | number, onSpoken?: () => void): number {
  const { settings } = useSettings()
  const [spoken, setSpoken] = useState(0)
  const onSpokenRef = useRef(onSpoken)
  onSpokenRef.current = onSpoken

  useEffect(() => {
    if (!settings.drillVoice) return
    // A question cut off by the next one still reports its end; only the
    // question on screen may start the clock.
    let current = true
    speak(text, () => {
      if (!current) return
      onSpokenRef.current?.()
      setSpoken((n) => n + 1)
    })
    return () => {
      current = false
    }
  }, [questionKey, settings.drillVoice])

  useEffect(() => hush, [])

  return spoken
}

/** Plays the right/slow/wrong sound whenever `cue` becomes one, if the sounds are on. */
export function useCue(cue: Cue | null, key: string | number): void {
  const { settings } = useSettings()
  useEffect(() => {
    if (cue && settings.drillCues) playCue(cue)
  }, [cue, key])
}
