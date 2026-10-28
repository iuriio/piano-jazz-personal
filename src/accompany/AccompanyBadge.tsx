import { useEffect, useRef, useState } from 'react'
import { useSettings } from '../stage/settings'
import { accompanist, useAccompany } from './accompanist'
import { chordText } from './display'
import { Presence } from '../ui/Presence'
import { Switch } from '../ui/Switch'

/**
 * The corner widget next to the brand. Mostly nothing: a dim dot while it
 * listens, an offer when it has something to offer, the chord and the beat
 * while it plays. It also owns the accompanist's lifecycle, since it is the one
 * piece of it that is always mounted.
 */
/**
 * Keeps the accompanist listening and configured for the whole app, whichever
 * mode is on screen; the badge that shows it lives in the chord card.
 */
export function AccompanyHost() {
  const { settings } = useSettings()

  useEffect(() => {
    accompanist.connect()
    return () => accompanist.disconnect()
  }, [])

  useEffect(() => {
    accompanist.configure(settings.mode, settings.accompany)
  }, [settings.mode, settings.accompany])

  return null
}

/** The accompany hint above the chord card; it fades in and out as it comes and goes. */
export function AccompanyBadge() {
  return <Presence ms={360}>{useBadge()}</Presence>
}

function useBadge() {
  const { settings, update } = useSettings()
  const view = useAccompany()
  const [menu, setMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // The little menu closes on any click outside it, and on Escape.
  useEffect(() => {
    if (!menu) return
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !menuRef.current?.contains(e.target as Node)) setMenu(false)
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', close)
    }
  }, [menu])

  const { phase, offer, play, heard } = view

  if (phase === 'offer' && offer) {
    return (
      <div key="offer" className="acc-badge acc-offer" role="group" aria-label="accompaniment offer">
        <span className="acc-bracket" aria-hidden="true">[</span>
        <button className="acc-accept" onClick={() => accompanist.accept()} title="Start a quiet piano and bass under you">
          accompany?
        </button>
        <button
          className="acc-choice"
          onClick={() => accompanist.cycleKey()}
          disabled={offer.keys < 2}
          title="Another reading of the same notes"
        >
          {offer.keyLabel}
        </button>
        <span className="acc-sep" aria-hidden="true">·</span>
        <button
          className="acc-choice"
          onClick={() => accompanist.cycleTempo()}
          disabled={offer.tempos < 2}
          title={offer.free ? 'No steady pulse heard: the band follows your phrases' : 'Half or double time'}
        >
          {offer.tempoLabel}
        </button>
        <span className="acc-bracket" aria-hidden="true">]</span>
        <button className="acc-x" onClick={() => accompanist.dismiss()} aria-label="not now" title="Not now (5 min)">
          ×
        </button>
      </div>
    )
  }

  if (play && (phase === 'starting' || phase === 'playing' || phase === 'waiting')) {
    const now = play.now ? chordText(play.now, settings.naming) : '—'
    const next = play.next ? chordText(play.next, settings.naming) : null
    return (
      <div key="play" className="acc-badge acc-play" aria-live="off">
        <span className="acc-now">{now}</span>
        {play.waiting ? (
          <span className="acc-wait">· waiting for you</span>
        ) : (
          <>
            {next && (
              <span className="acc-next">
                <span aria-hidden="true">▸ </span>
                {next}
              </span>
            )}
            <span className="acc-beats" aria-label={`beat ${play.beat + 1}`}>
              {[0, 1, 2, 3].map((b) => (
                <i key={b} className={b <= play.beat ? 'on' : ''} />
              ))}
            </span>
            <span className="acc-bpm">
              {play.free ? 'free' : `${play.bpm} ${play.tempo === 'lock' ? 'lock' : '~'}`}
            </span>
          </>
        )}
        <button className="acc-stop" onClick={() => accompanist.stop()} aria-label="stop the accompaniment" title="Stop">
          ■
        </button>
      </div>
    )
  }

  if (phase === 'idle' && !menu) return null

  const reading = heard.keyLabel ? `${heard.keyLabel}${heard.bpm && heard.steady ? ` · ~${heard.bpm}` : ''}` : null
  return (
    <div key="listen" className="acc-badge acc-listen" ref={menuRef}>
      <button
        className={`acc-dot ${reading ? 'heard' : ''}`}
        onClick={() => setMenu((m) => !m)}
        aria-label="listening — accompaniment options"
        aria-expanded={menu}
        title={reading ? `listening: ${reading}` : 'listening'}
      />
      <Presence ms={160}>
        {menu && (
          <div className="acc-menu" role="dialog" aria-label="accompaniment">
            <div className="acc-menu-row">
              <span className="grp-label">heard</span>
              <span>{reading ?? 'nothing yet'}</span>
            </div>
            <button
              className="acc-menu-go"
              disabled={!heard.keyLabel}
              onClick={() => {
                setMenu(false)
                accompanist.summon()
              }}
            >
              accompany now
            </button>
            <label className="acc-menu-check">
              <Switch
                checked={settings.accompany.offers}
                onCheckedChange={(on) => update({ accompany: { ...settings.accompany, offers: on } })}
              />
              offer to accompany
            </label>
          </div>
        )}
      </Presence>
    </div>
  )
}
