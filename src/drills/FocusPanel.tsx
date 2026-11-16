import { Select } from '../ui/Select'
import { FOCUS_SIZE, KNOWN_LEVEL, focusState } from './focus'
import type { SpeedStats } from './speed'
import type { Practice } from './useSpeedRound'

/** The "practice" row both speed drills put in their sidebar. */
export function PracticeSelect({ value, onChange }: { value: Practice; onChange: (p: Practice) => void }) {
  return (
    <label className="side-row">
      <span>practice</span>
      <Select
        value={value}
        onValueChange={(v) => onChange(v as Practice)}
        options={[
          { value: 'focus', label: `${FOCUS_SIZE} at a time` },
          { value: 'all', label: 'everything, random' },
        ]}
      />
    </label>
  )
}

type Props = {
  stats: SpeedStats
  /** The questions switched on, in the order they are introduced. */
  ids: string[]
  current: string
  label: (id: string) => string
}

/**
 * What is in focus right now: each question being learned with its steps
 * toward known, how many are already known, and the one waiting to come in.
 */
export function FocusPanel({ stats, ids, current, label }: Props) {
  const f = focusState(stats, ids)
  // A question on screen for the first time is in focus too, before its first answer.
  const rows = f.learning.includes(current) || stats[current]?.level !== undefined ? f.learning : [...f.learning, current]

  return (
    <section className="side-group">
      <h3>learning now</h3>
      {rows.length ? (
        <ul className="focus-list">
          {rows.map((id) => {
            const level = Math.min(stats[id]?.level ?? 0, KNOWN_LEVEL)
            return (
              <li key={id} className={id === current ? 'now' : undefined}>
                <span>{label(id)}</span>
                <span className="focus-steps" aria-label={`${level} of ${KNOWN_LEVEL} steps`}>
                  {Array.from({ length: KNOWN_LEVEL }, (_, i) => (
                    <span key={i} className={`lap-dot${i < level ? ' on' : ''}`} />
                  ))}
                </span>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="side-note">Nothing left to learn here: only reviews.</p>
      )}
      <p className="side-stat">
        {f.known}/{f.total} <span className="dim">known</span>
        {f.upNext && f.upNext !== current && <span className="dim"> · next: {label(f.upNext)}</span>}
      </p>
      <p className="side-note">
        {KNOWN_LEVEL} fast answers, further apart each time, and a question is known. It makes room for a new one
        and comes back for review after 5 minutes, half an hour, a day, 3 days, a week. A miss starts it over.
      </p>
    </section>
  )
}
