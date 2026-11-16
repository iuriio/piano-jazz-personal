import { focusState, isIntroduced, isKnown } from './focus'
import { GOAL_MS, itemId, levelOf, summarise, type SpeedStats } from './speed'
import { ROOT_NAMES, glyph } from './spell'
import { seconds, type Practice } from './useSpeedRound'

type Props = {
  rows: { id: string; label: string; name: string }[]
  stats: SpeedStats
  /** The question on screen, outlined so you can see where it sits. */
  current: string
  practice: Practice
}

const LEVEL_TEXT = { new: 'not asked yet', miss: 'missed', slow: 'right, but slow', fast: 'known' }

/**
 * The map of what you know: one cell per question, coloured by its last
 * answer. Takes the notation's place, because the drill is the map filling up.
 */
export function SpeedGrid({ rows, stats, current, practice }: Props) {
  const ids = rows.flatMap((r) => ROOT_NAMES.map((_, pc) => itemId(r.id, pc)))
  const focus = practice === 'focus'
  const done = focus ? focusState(stats, ids).known : summarise(stats, ids).fast

  return (
    <section className="panel speed-panel">
      <header className="panel-head">
        <h3>{focus ? 'known' : `under ${GOAL_MS / 1000}s`}</h3>
        <span className="panel-meta">
          {done}/{ids.length}
        </span>
      </header>
      <div className="speed-grid" role="table" aria-label="answers by root">
        <div className="speed-row speed-head" role="row">
          <span />
          {ROOT_NAMES.map((n) => (
            <span key={n} role="columnheader">
              {glyph(n)}
            </span>
          ))}
        </div>
        {rows.map((r) => (
          <div key={r.id} className="speed-row" role="row">
            <span className="speed-label" role="rowheader" title={r.name}>
              {r.label}
            </span>
            {ROOT_NAMES.map((n, pc) => {
              const id = itemId(r.id, pc)
              const e = stats[id]
              // In focus mode a question that was never introduced stays empty,
              // even if the other mode has asked it; one still being learned is
              // drawn faded until it is known.
              const level = focus && !isIntroduced(e) ? 'new' : levelOf(e)
              const learning = focus && level !== 'new' && !isKnown(e)
              const time = e?.lastOk && level !== 'new' ? ` · ${seconds(e.lastMs)}` : ''
              const text = learning && level === 'fast' ? 'learning' : LEVEL_TEXT[level]
              return (
                <span
                  key={pc}
                  role="cell"
                  className={`speed-cell ${level}${learning ? ' learning' : ''}${id === current ? ' now' : ''}`}
                  title={`${r.name} · ${glyph(n)} — ${text}${time}`}
                />
              )
            })}
          </div>
        ))}
      </div>
      <p className="speed-legend">
        <span className="speed-cell fast" /> known
        {focus && (
          <>
            <span className="speed-cell fast learning" /> learning
          </>
        )}
        <span className="speed-cell slow" /> slow
        <span className="speed-cell miss" /> missed
        <span className="speed-cell new" /> not asked
      </p>
    </section>
  )
}
