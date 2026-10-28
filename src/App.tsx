import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { AccompanyHost } from './accompany/AccompanyBadge'
import { KEY_SIGNATURES, type BassSplit } from './analysis'
import { armAudioResume, resumeAudio } from './audio'
import { useComputerPiano } from './computerPiano'
import { Drill } from './Drill'
import {
  VOICE_HELP,
  VOICE_LABEL,
  instrument,
  loadSound,
  saveSound,
  type Voice,
} from './instrument'
import { setInputFilter, subscribeStatus, useMidi, type MidiStatus } from './midi'
import { Shred } from './shred/Shred'
import { Select } from './ui/Select'
import { Slider } from './ui/Slider'
import { FreePlay } from './stage/FreePlay'
import {
  PlayContext,
  SPLIT_POINTS,
  SettingsContext,
  loadStage,
  saveStage,
  type Mode,
  type StageSettings,
} from './stage/settings'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/700.css'
import './styles.css'

/**
 * Memoised on purpose: what you play changes on every note, and the mode
 * component (shred above all) must not reconcile because a key went down. The
 * parts that do follow your hands read the play context themselves.
 */
const ModeView = memo(function ModeView({ mode }: { mode: Mode }) {
  if (mode === 'voicings') return <Drill />
  if (mode === 'shred') return <Shred />
  return <FreePlay />
})

/** The MIDI input select's value for "no filter" (Radix items can't use an empty string). */
const ALL_INPUTS = '*'

export default function App() {
  const [settings, setSettings] = useState<StageSettings>(loadStage)
  const update = useCallback((patch: Partial<StageSettings>) => {
    setSettings((prev) => saveStage({ ...prev, ...patch }))
  }, [])
  const settingsValue = useMemo(() => ({ settings, update }), [settings, update])

  const [sound, setSound] = useState(loadSound)
  const [status, setStatus] = useState<MidiStatus>({ devices: [], inputs: [], inputId: null, error: null })
  const { held, settled, pedal } = useMidi(settings.settleMs)
  const playValue = useMemo(() => ({ held, settled }), [held, settled])

  // Shred has its own tracker-layout computer keyboard; two layouts at once
  // would play every key twice.
  const { octave } = useComputerPiano({
    enabled: settings.mode !== 'shred',
    velocity: settings.keysVelocity,
    humanise: settings.keysHumanise,
  })

  // The instrument listens to every source on every mode: you play in all of them.
  useEffect(() => {
    instrument.connect()
    armAudioResume()
    return () => instrument.disconnect()
  }, [])

  useEffect(() => {
    instrument.setVoice(sound.voice)
    instrument.setLevel(sound.level)
  }, [sound])

  useEffect(() => subscribeStatus(setStatus), [])
  useEffect(() => setInputFilter(settings.inputId), [settings.inputId])

  const changeSound = (patch: Partial<typeof sound>) => {
    // Picking a voice is a gesture, which is the browser's cue to let audio start.
    void resumeAudio()
    setSound((prev) => saveSound({ ...prev, ...patch }))
  }

  return (
    <SettingsContext.Provider value={settingsValue}>
      <PlayContext.Provider value={playValue}>
        <div className="app">
          <header className="topbar">
            <h1>
              keytrainer<span className="caret" aria-hidden="true" />
            </h1>
            <AccompanyHost />

            <div className="topbar-row">
              <label className="grp">
                <span className="grp-label">key</span>
                <Select
                  value={settings.keyId}
                  onValueChange={(v) => update({ keyId: v })}
                  options={KEY_SIGNATURES.map((k) => ({ value: k.id, label: k.label }))}
                />
              </label>

              <span className="grp" title="Treat the lowest notes as a bass line">
                <span className="grp-label">bass split</span>
                <Select
                  value={settings.split}
                  onValueChange={(v) => update({ split: v as BassSplit })}
                  aria-label="bass split"
                  options={[
                    { value: 'off', label: 'off' },
                    { value: 'slash', label: 'slash chord (C/E)' },
                    { value: 'apart', label: 'bass apart' },
                  ]}
                />
                <Select
                  value={String(settings.splitPoint)}
                  disabled={settings.split === 'off'}
                  aria-label="split point"
                  onValueChange={(v) => update({ splitPoint: Number(v) })}
                  options={SPLIT_POINTS.map((p) => ({ value: String(p.midi), label: p.label }))}
                />
              </span>

              <span className="grp" title={VOICE_HELP[sound.voice]}>
                <span className="grp-label">sound</span>
                <Select
                  value={sound.voice}
                  aria-label="sound"
                  onValueChange={(v) => changeSound({ voice: v as Voice })}
                  options={(Object.keys(VOICE_LABEL) as Voice[]).map((v) => ({ value: v, label: VOICE_LABEL[v] }))}
                />
                <span className="grp-label">vol</span>
                <Slider
                  min={0}
                  max={100}
                  step={5}
                  value={Math.round(sound.level * 100)}
                  disabled={sound.voice === 'off'}
                  aria-label="instrument volume"
                  onValueChange={(v) => changeSound({ level: v / 100 })}
                />
              </span>
            </div>
          </header>

          <ModeView mode={settings.mode} />

          <footer className="statusbar">
            <span className={`midi-dot ${status.error ? 'bad' : status.inputs.length ? 'ok' : ''}`} />
            <span className="ps1">iuri@keytrainer:~$</span>
            {status.error ? (
              <span className="error">{status.error}</span>
            ) : (
              <span>
                midi — {status.inputs.length ? `${status.inputs.length} input${status.inputs.length > 1 ? 's' : ''}` : 'no device'}
              </span>
            )}
            <Select
              value={settings.inputId ?? ALL_INPUTS}
              aria-label="MIDI input"
              onValueChange={(v) => update({ inputId: v === ALL_INPUTS ? null : v })}
              options={[
                { value: ALL_INPUTS, label: 'all inputs' },
                ...status.inputs.map((i) => ({ value: i.id, label: i.name })),
              ]}
            />
            {pedal && <span className="pedal-on">pedal</span>}
            <span className="hint">
              {settings.mode === 'shred' ? (
                'computer keys: shred layout (see settings)'
              ) : (
                <>
                  computer keys <kbd>A</kbd>…<kbd>;</kbd> · <kbd>Z</kbd> <kbd>X</kbd> octave (C{octave})
                </>
              )}
            </span>
          </footer>
        </div>
      </PlayContext.Provider>
    </SettingsContext.Provider>
  )
}
