import { NAMING_LABEL, NAMING_STYLES, type NamingStyle } from './naming'
import { useSettings } from './settings'
import { Workspace } from './Workspace'
import { Select } from '../ui/Select'
import { Slider } from '../ui/Slider'
import { Switch } from '../ui/Switch'

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
              <Select
                value={settings.naming}
                onValueChange={(v) => update({ naming: v as NamingStyle })}
                options={NAMING_STYLES.map((s) => ({ value: s, label: NAMING_LABEL[s] }))}
              />
            </label>
          </section>

          <section className="side-group">
            <h3>dynamics</h3>
            <span className="side-sub">computer keys</span>
            <label className="slider-row" title="Velocity of notes played on the computer keyboard. A MIDI keyboard sends its own.">
              <span className="end">soft</span>
              <Slider
                aria-label="computer keys velocity"
                min={20}
                max={127}
                value={settings.keysVelocity}
                onValueChange={(v) => update({ keysVelocity: v })}
              />
              <span className="end">hard</span>
              <span className="val">{settings.keysVelocity}</span>
            </label>
            <label className="check-row">
              <Switch checked={settings.keysHumanise} onCheckedChange={(on) => update({ keysHumanise: on })} />
              humanise keys
            </label>
          </section>

          <section className="side-group">
            <h3>input</h3>
            <label className="slider-row" title="Quiet time without MIDI events before a chord counts as settled">
              <span className="end">settle</span>
              <Slider
                aria-label="settle time"
                min={20}
                max={200}
                step={5}
                value={settings.settleMs}
                onValueChange={(v) => update({ settleMs: v })}
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
