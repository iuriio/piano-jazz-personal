import { Drill } from '../Drill'
import { useSettings } from '../stage/settings'
import { IntervalDrill } from './IntervalDrill'
import { SeventhDrill } from './SeventhDrill'
import { TwoFiveOneDrill } from './TwoFiveOneDrill'

/** The drills mode: one drill at a time, picked at the top of its sidebar. */
export function Drills() {
  const { settings } = useSettings()
  if (settings.drill === 'intervals') return <IntervalDrill />
  if (settings.drill === 'sevenths') return <SeventhDrill />
  if (settings.drill === 'ii-v-i') return <TwoFiveOneDrill />
  return <Drill />
}
