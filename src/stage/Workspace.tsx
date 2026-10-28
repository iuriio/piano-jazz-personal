import { useCallback, useMemo, type ReactNode } from 'react'
import { chordNames, keyById, spellMidi } from '../analysis'
import type { KeyMark } from '../keyboard'
import { Staff } from '../Staff'
import { ChordCard } from './ChordCard'
import { LiveInput } from './LiveInput'
import { MODES, MODE_LABEL, useStage } from './settings'

type Props = {
  /** The mode's own controls, under the mode switch. */
  sidebar: ReactNode
  /** Above the card row: the drill target, the exercise header… */
  banner?: ReactNode
  /** Replaces the chord card, when a mode has something better to show there. */
  card?: ReactNode
  /** Replaces the notation panel, when a mode has something better to show there. */
  aside?: ReactNode
  /** What the notation shows; defaults to the notes held right now. */
  notation?: { notes: number[]; color?: string; title?: string }
  marks?: Map<number, KeyMark>
  roll?: ReactNode
  quiet?: boolean
  /** Under the live input: verdicts, stats, diagnosis. */
  below?: ReactNode
}

/**
 * The one page. Every mode renders this, filling the slots it needs; the stage —
 * card, notation, live input — is the same object in all of them, so moving from
 * free play to a drill never moves your eyes.
 */
export function Workspace({ sidebar, banner, card, aside, notation, marks, roll, quiet, below }: Props) {
  const { settings, update, held } = useStage()
  const key = keyById(settings.keyId)
  // Labels spell what is held as the chord it makes: E♭ in a Cm7, even in C.
  const names = useMemo(
    () => chordNames(held, { key, split: settings.split, splitPoint: settings.splitPoint }),
    [held, key, settings.split, settings.splitPoint],
  )
  // spellMidi speaks ASCII ("F#4", "Bb4"); the labels get the real glyphs.
  const nameOf = useCallback(
    (midi: number) => spellMidi(midi, key, names).replace('#', '♯').replace(/^([A-G])b/, '$1♭'),
    [key, names],
  )

  // The staff follows your hands, like the keys; the card is what keeps the chord.
  const staffNotes = notation?.notes ?? held

  return (
    <div className="workspace">
      <aside className="sidebar">
        <div className="seg" role="tablist" aria-label="mode">
          {MODES.map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={settings.mode === m}
              className={settings.mode === m ? 'on' : ''}
              onClick={() => update({ mode: m })}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
        {sidebar}
      </aside>

      <main className="stage">
        {banner}
        <div className="card-row">
          {card ?? <ChordCard />}
          {aside ?? (
            <section className="panel notation">
              <header className="panel-head">
                <h3>{notation?.title ?? 'notation'}</h3>
                <span className="panel-meta">key of {key.label.split(' / ')[0].replace(' major', '')}</span>
              </header>
              <Staff notes={staffNotes} keyId={key.id} color={notation?.color} />
            </section>
          )}
        </div>
        <LiveInput nameOf={nameOf} marks={marks} roll={roll} quiet={quiet} />
        {below}
      </main>
    </div>
  )
}
