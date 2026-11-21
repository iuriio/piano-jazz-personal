import { Drill } from '../Drill'
import { isImprov, useSettings } from '../stage/settings'
import { ImprovDrill } from './ImprovDrill'
import { IntervalDrill } from './IntervalDrill'
import { SeventhDrill } from './SeventhDrill'
import { TwoFiveOneDrill } from './TwoFiveOneDrill'

/** The drills mode: one drill at a time, picked at the top of its sidebar. */
export function Drills() {
  const { settings } = useSettings()
  if (settings.drill === 'intervals') return <IntervalDrill />
  if (settings.drill === 'sevenths') return <SeventhDrill />
  if (settings.drill === 'ii-v-i') return <TwoFiveOneDrill />
  // One component for the three, so the band keeps playing from one to the next.
  if (isImprov(settings.drill)) return <ImprovDrill exercise={settings.drill} />
  return <Drill />
}
