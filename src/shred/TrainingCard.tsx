import type { Grade } from './grade'
import type { RollPhase } from './PianoRoll'

// The shred verdict, where the chord card sits in free play: big, central, and
// readable from the corner of your eye while your hands are busy. What used to
// trail under the keyboard — verdict, metrics, rep log — lives here now.

type Props = {
  phase: RollPhase
  bpm: number
  grade: Grade | null
  repLog: { bpm: number; passed: boolean }[]
  /** "1 more clean rep → 90 BPM", or the lock / accel note. Already worded. */
  progress: { text: string; dots: { on: number; total: number; kind: 'up' | 'down' } | null }
  /** Missing / extra note names for the last rep, already spelled. */
  noteDiff: string | null
}

const STATUS: Record<RollPhase, string> = {
  idle: 'ready',
  countin: 'count-in',
  playing: 'playing',
  resting: 'rest',
  demo: 'listening',
}

export function TrainingCard({ phase, bpm, grade, repLog, progress, noteDiff }: Props) {
  // The verdict of the last rep stays up while the next one runs: it is what
  // you are correcting for.
  const verdict = grade ? (grade.passed ? 'clean' : 'not yet') : STATUS[phase]
  const tone = grade ? (grade.passed ? 'ok' : 'fail') : phase === 'countin' ? 'pre' : ''

  const facts: [string, string, string?][] = grade
    ? [
        ['right', `${Math.round(grade.accuracy * 100)}%`, grade.accuracy === 1 ? 'accent' : undefined],
        ['evenness', `${(grade.ioiCv * 100).toFixed(1)}%`],
        ['actual', `${Math.round(grade.effectiveBpm)} bpm`],
        ['attack', `±${grade.velocityStdev.toFixed(0)}`],
        ['grid', `${grade.gridMadMs.toFixed(0)}ms`],
        ...(grade.handSpreadMs > 0 ? ([['hands', `${grade.handSpreadMs.toFixed(0)}ms`]] as [string, string][]) : []),
      ]
    : [
        ['right', '—'],
        ['evenness', '—'],
        ['actual', '—'],
        ['attack', '—'],
        ['grid', '—'],
      ]

  return (
    <section className={`panel training-card ${tone}`}>
      <header className="panel-head">
        <h3>rep</h3>
        <span className={`phase-chip ${phase}`}>{STATUS[phase]}</span>
      </header>

      <div className="card-body">
        <div className="card-name">
          <div className="tempo-big">
            {bpm}
            <span className="unit">bpm</span>
          </div>
          <div className={`verdict-big ${tone}`}>{verdict}</div>
          <div className="ramp-line">
            {progress.dots && (
              <span className={`dots ${progress.dots.kind}`}>
                {Array.from({ length: progress.dots.total }, (_, i) => (
                  <span key={i} className={i < progress.dots!.on ? 'dot on' : 'dot'} />
                ))}
              </span>
            )}
            {progress.text}
          </div>
        </div>

        <dl className="card-facts">
          {facts.map(([k, v, cls]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd className={cls}>{v}</dd>
            </div>
          ))}
        </dl>
      </div>

      {(grade && !grade.passed && grade.reasons.length > 0) || noteDiff ? (
        <p className="card-reasons">
          {grade && !grade.passed && grade.reasons.join(' · ')}
          {grade && !grade.passed && grade.reasons.length > 0 && noteDiff ? ' · ' : ''}
          {noteDiff}
        </p>
      ) : null}

      {repLog.length > 0 && (
        <div className="rep-log">
          {repLog.map((r, i) => (
            <span key={i} className={r.passed ? 'ok' : 'fail'} title={`${r.bpm} BPM`}>
              {r.bpm}
            </span>
          ))}
        </div>
      )}
    </section>
  )
}
