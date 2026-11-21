import { DRILLS, DRILL_LABEL, IMPROV_DRILLS, isImprov, useSettings, type DrillId } from '../stage/settings'
import { Select } from '../ui/Select'
import { Switch } from '../ui/Switch'

/** Which drill the drills mode runs; sits at the top of every drill's sidebar. */
export function DrillPicker({ voice = true }: { voice?: boolean }) {
  const { settings, update } = useSettings()
  const plain = DRILLS.filter((d) => !isImprov(d))
  return (
    <section className="side-group">
      <h3>drill</h3>
      <Select
        value={settings.drill}
        aria-label="drill"
        onValueChange={(v) => update({ drill: v as DrillId })}
        options={[
          ...plain.map((d) => ({ value: d, label: DRILL_LABEL[d] })),
          { group: 'solo over the band', options: IMPROV_DRILLS.map((d) => ({ value: d, label: DRILL_LABEL[d] })) },
        ]}
      />
      {voice && (
        <label className="check-row" title="Says each question out loud, in English">
          <Switch checked={settings.drillVoice} onCheckedChange={(on) => update({ drillVoice: on })} />
          say the question
        </label>
      )}
      <label className="check-row" title="A light chime when you get it, a soft low note when you do not">
        <Switch checked={settings.drillCues} onCheckedChange={(on) => update({ drillCues: on })} />
        sound for right and wrong
      </label>
      {voice && settings.drillVoice && (
        <p className="side-note">
          With both on you can practise without looking. After a reload the voice waits for one click or
          computer key: a MIDI key alone does not let the browser speak.
        </p>
      )}
    </section>
  )
}
