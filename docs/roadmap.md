# Roadmap: one page, everything on the stage

keytrainer is becoming a single page. The stage in the middle — chord card, notation,
live input over an 88-key keyboard — is always there, and every practice mode runs
on top of it instead of on a page of its own.

The feature list below was mapped from OrbKord by watching what it does, never by
reading or reusing its code. Every item is rebuilt here, in keytrainer's own look.

Status: `done` · `wip` · `next` · `later` · `out` (deliberately left out).

## Stage

| Feature | Notes | Status |
| --- | --- | --- |
| Single page, sidebar + stage | Modes (free play, voicings, shred, sequencer) switch the sidebar and what the stage overlays — never a separate page | done |
| Chord card | Big symbol, quality name, position (root / inversions / slash bass), voicing (close / open / drop 2 / drop 3), root, intervals from the root, spelled notes, notes held | done |
| Naming style | Click cycles **exact** (every extension) → **jazz** (lead-sheet: Δ – ø °) → **simple** (reduced to triad or seventh) | done |
| Notation | Grand staff in the current key signature, accidentals only where the key needs them | done |
| Live input | Bars rise out of the keys while held and float away after release; a label per held note with name and **velocity** (OrbKord shows the MIDI number there — we show velocity, which is what matters for practice); labels stagger so they never overlap; bar intensity follows velocity | done |
| 88-key keyboard | Canvas, drawn on the same axis as the live input and the exercise roll | done |
| Practice overlays | Voicings: target / right / extra / missing on the keys. Shred: falling expected notes in the live input area | done |

## Top bar and settings row

| Feature | Notes | Status |
| --- | --- | --- |
| Key signature | 15 keys; drives spelling everywhere (card, staff, labels) | done |
| Bass split | Off / slash chord (C/E) / bass apart, split point C2…C4 | done |
| Sound + volume | Existing lead/piano voices; add Rhodes and a better piano | next |
| Reverb | Send on the app's own voice | next |
| MIDI input select, status | Footer, like the rest of the status | done |
| Computer keys | A…; piano layout, Z/X octave, velocity + humanise | done |
| Light theme | | later |
| Tuning systems | 19/31/41/53-EDO, .scl | later |
| Video capture of the stage | | later |
| Load MIDI file, transport, playback speed | Not wanted | out |
| Breath controller via phone | | out |

## Free play (sidebar)

| Feature | Notes | Status |
| --- | --- | --- |
| Harmonise | Each melody note you play gets a chord under it: key + major/minor, functional (in key) or non-functional, chord vocabulary (all / fewer notes / more notes / jazz), vary repeated notes | next |
| Voicing | Tight ↔ open spread (close → drop voicings), lowest allowed note | next |
| Dynamics | Velocity for computer-keyboard notes and for generated chords, each with humanise | next |
| Record take | Tempo, metronome (monitor only), record, export .mid | next |

## Sequencer (sidebar)

| Feature | Notes | Status |
| --- | --- | --- |
| Record melody → looping progression | Count-in, record, harmonise into a loop | later |
| Source | Our own rule engine; progression packs only after checking each pack's licence | later |
| Mood, comping style, chords per bar, length, tempo, next progression | | later |

## Views

| Feature | Notes | Status |
| --- | --- | --- |
| Fretboard | Show all positions / exactly what was played / one playable voicing, next voicing | later |
| Fretboard tunings | Standard, drop D, DADGAD, open G, open D, all fourths, ½ step down, custom — **plus guitarra baiana (5 strings in fifths)** | later |
| Isomorphic keyboard | Harmonic-table hex grid | later |

## Practice (keytrainer's own, moved onto the stage)

| Feature | Notes | Status |
| --- | --- | --- |
| Voicing drill | All 12 keys, note-by-note validation, stats per key | done |
| Shred | Hanon and friends, BPM ladder driven by clean reps, per-note diagnosis | done |

## Performance notes

- Notes no longer go through React state to reach the screen: a small store outside
  React (`src/stage/liveNotes.ts`) is read by the canvas once per frame, and the
  canvas stops drawing when nothing moves.
- The stage card and the staff re-render on a settled chord, not on every key.
- Shred's view is split into the stage slots (sidebar, banner, roll, below); it no
  longer keeps held notes in state, so a key press does not reconcile its 1000
  lines. Pulling the engine out into its own hook is still worth doing.
