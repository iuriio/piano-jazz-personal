import { memo, useCallback, useEffect, useMemo, useState } from 'react'
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
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
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

            <div className="topbar-row">
              <label className="grp">
                <span className="grp-label">key</span>
                <select value={settings.keyId} onChange={(e) => update({ keyId: e.target.value })}>
                  {KEY_SIGNATURES.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </label>

              <span className="grp" title="Treat the lowest notes as a bass line">
                <span className="grp-label">bass split</span>
                <select
                  value={settings.split}
                  onChange={(e) => update({ split: e.target.value as BassSplit })}
                >
                  <option value="off">off</option>
                  <option value="slash">slash chord (C/E)</option>
                  <option value="apart">bass apart</option>
                </select>
                <select
                  value={settings.splitPoint}
                  disabled={settings.split === 'off'}
                  aria-label="split point"
                  onChange={(e) => update({ splitPoint: Number(e.target.value) })}
                >
                  {SPLIT_POINTS.map((p) => (
                    <option key={p.midi} value={p.midi}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </span>

              <span className="grp" title={VOICE_HELP[sound.voice]}>
                <span className="grp-label">sound</span>
                <select
                  value={sound.voice}
                  onChange={(e) => changeSound({ voice: e.target.value as Voice })}
                >
                  {(Object.keys(VOICE_LABEL) as Voice[]).map((v) => (
                    <option key={v} value={v}>
                      {VOICE_LABEL[v]}
                    </option>
                  ))}
                </select>
                <span className="grp-label">vol</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={Math.round(sound.level * 100)}
                  disabled={sound.voice === 'off'}
                  aria-label="instrument volume"
                  onChange={(e) => changeSound({ level: Number(e.target.value) / 100 })}
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
            <select
              value={settings.inputId ?? ''}
              aria-label="MIDI input"
              onChange={(e) => update({ inputId: e.target.value || null })}
            >
              <option value="">all inputs</option>
              {status.inputs.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
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
