import { NAMING_LABEL, NAMING_STYLES, type NamingStyle } from './naming'
import { useSettings } from './settings'
import { Workspace } from './Workspace'

/** Free play: no target, no grading — the stage reads whatever you play. */
export function FreePlay() {
  const { settings, update } = useSettings()

  return (
    <Workspace
      sidebar={
        <>
          <section className="side-group">
            <h3>display</h3>
            <label className="side-row">
              <span>names</span>
              <select
                value={settings.naming}
                onChange={(e) => update({ naming: e.target.value as NamingStyle })}
              >
                {NAMING_STYLES.map((s) => (
                  <option key={s} value={s}>
                    {NAMING_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
          </section>

          <section className="side-group">
            <h3>dynamics</h3>
            <span className="side-sub">computer keys</span>
            <label className="slider-row" title="Velocity of notes played on the computer keyboard. A MIDI keyboard sends its own.">
              <span className="end">soft</span>
              <input
                type="range"
                min={20}
                max={127}
                value={settings.keysVelocity}
                onChange={(e) => update({ keysVelocity: Number(e.target.value) })}
              />
              <span className="end">hard</span>
              <span className="val">{settings.keysVelocity}</span>
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={settings.keysHumanise}
                onChange={(e) => update({ keysHumanise: e.target.checked })}
              />
              humanise keys
            </label>
          </section>

          <section className="side-group">
            <h3>input</h3>
            <label className="slider-row" title="Quiet time without MIDI events before a chord counts as settled">
              <span className="end">settle</span>
              <input
                type="range"
                min={20}
                max={200}
                step={5}
                value={settings.settleMs}
                onChange={(e) => update({ settleMs: Number(e.target.value) })}
              />
              <span className="val">{settings.settleMs}ms</span>
            </label>
            <p className="side-note">
              The pedal counts: a note released with the pedal down stays in the chord. Lift
              the pedal to change chord.
            </p>
          </section>
        </>
      }
    />
  )
}
