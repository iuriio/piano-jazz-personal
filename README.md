# keytrainer

**Live: https://keytrainer.iuri.io**

MIDI piano practice: jazz voicings and shredding.

The app has its own voice, so it makes sound on its own without a synth or a DAW open: a **lead** (warm, deliberately capped in brightness — it plays under an exercise for a long stretch) and a **piano** (struck partials with separate decays, damper on the sustain pedal). Both are synthesized, nothing is downloaded. Pick one — or **off**, to let your own module make the sound — next to `sound` in the header.

To run locally:

```bash
npm install && npm run dev
```

Open it in **Chrome or Edge** (the Web MIDI API does not exist in Firefox/Safari) and grant MIDI access.

- **Visualizer** — play anything and it shows the keyboard, the staff, the chord name, the intervals, and recognizes which voicing it is.
- **Drills** — four of them, picked at the top of the sidebar: intervals and seventh chords against a two-second clock, the 2-5-1 through all 12 keys, and the voicing drill (pick a voicing and a quality, and it asks for the chord in all 12 keys, validating note by note, in whatever octave you play it; a lone left-hand root may sit lower still).
- **Shred** — speed exercises against a metronome, from beginner to advanced, with the BPM climbing gradually.

The sustain pedal counts: a note released with the pedal down stays part of the chord, just like on a piano. To change chord, lift the pedal.

The 10 voicings live in [`src/voicings.ts`](src/voicings.ts), written as degrees (`"3'"` = the third one octave up). To fix or add a voicing, edit only that table.

## Drills

The first three follow the order of a jazz piano lesson: count intervals, build the seventh chords, then run the 2-5-1 through every key. They live in [`src/drills/`](src/drills/).

- **Intervals in 2s** — "minor 7th above F♯": play the note, any octave. The clock stops on the first note.
- **7th chords in 2s** — a chord symbol, all 12 roots in random order. Root position, any octave; the clock stops when the last note lands. maj7, m7 and 7 are on by default (36 chords); ø, °7, m(maj7), 6, m6 and 7♯5 can be switched on.
- **2-5-1 in 12 keys** — major or minor, in close position, shells or rootless voicings. The keys follow the lesson's walk: the one turns minor and becomes the two of the next key, and after six keys the two starts a half step up for the other six. Every chord is checked note for note, so the voice leading is part of the answer; the octave is yours to pick.

The two speed drills build up **five questions at a time**, like a flashcard deck with spaced repetition ([`src/drills/focus.ts`](src/drills/focus.ts)):

- The first five are five different things over one root — the major and minor 3rd, 5th, and minor and major 7th above C, i.e. the chord tones of C — then the same from F, G, D… The extensions (9th, 11th, ♯11) come after every chord tone from every root, and the rest (♭9, 13th, ♭13) last.
- Every answer under two seconds moves a question up a step and pushes its next showing further away: 20 seconds, a minute, then 5 minutes, half an hour, a day, 3 days, a week, three weeks.
- After three fast answers — the last one at least a minute after the second — the question is **known**: it leaves the focus, a new one comes in, and it only returns for review.
- A miss starts the question over and brings it back within seconds; a right but slow answer sends it back into learning.
- The sidebar shows what is in focus with its steps, and the panel next to the chord card is the map of every question: empty, faded while it is being learned, solid once known.

Only the first answer to a question is recorded, and an answer that takes more than ten seconds is treated as you having stepped away, not as slow. `practice → everything, random` switches the build-up off and runs through everything switched on in random order, with a miss or a slow answer coming back a few questions later.

In the 2-5-1, a **clean lap** is all 12 keys with the notes hidden and no wrong chord; three in a row is the bar for moving on. The shapes are a table in [`src/drills/twoFiveOne.ts`](src/drills/twoFiveOne.ts), written as semitones from the two chord's root so the voice leading is visible in the numbers. To fix or add a shape, edit only that table.

### Without looking

Two switches under the drill picker, for practising with your eyes on the keys:

- **say the question** — the browser's own English voice says it: "F-sharp minor seven", "minor seventh above D-flat", each chord of the 2-5-1. In the timed drills the two seconds start when the voice has finished. It only ever says the question, and only with an English voice: a machine without one stays silent.
- **sound for right and wrong** — a light two-note chime for an answer on the clock, a single note for right but slow, a soft low step down for wrong.

The wording lives in [`src/drills/say.ts`](src/drills/say.ts) and the sounds in [`src/drills/cues.ts`](src/drills/cues.ts). After a reload the voice needs one click or computer key before it may speak; a MIDI key alone does not count as a gesture for the browser.

## Shred

17 exercises across 5 levels — pure technique, prog (ELP/Dream Theater), guitar licks and bebop — in [`src/shred/exercises.ts`](src/shred/exercises.ts). Same idea as the voicings: each exercise is the SHAPE of the figure, and it comes out in all 12 keys and in any subdivision. To add an exercise, edit only that table.

A rep passes when the notes come out right in order **and** the spacing between onsets is even (coefficient of variation below the level limit), at the requested tempo ±3%. Evenness matters more than sticking to the click: sloppy shred is almost always right on average and wrong in the detail. Two clean reps raise the BPM; two failures bring it down.

Since the expected figure is known note by note, the app accumulates the deviation **per note** and points out which one you fumble — usually the one right after the thumb crossing.

On being permissive at note entry, which is where it is easy to misjudge the player:

- The error budget has a **floor of 1**. On a 17-note rep, 3% rounded would give zero, and demanding a perfect performance is not practice.
- After two consecutive unmatched onsets, the alignment **widens its search** and finds the line again. Without it, slipping and skipping more than 3 notes froze the cursor and turned all the rest of the rep into "extra".
- The grace at the edges of a rep is a **fraction of a beat, not fixed milliseconds** — at 80 BPM a beat is 750ms, and a fixed 120ms grace discarded notes that landed in the right place.
- A rep you did not play (adjusting the keyboard, reading the screen) does not count as a failure and **does not lower the BPM**.
- The boundary between reps sits **halfway between the last onset of one and the first of the next**, at most a quarter beat out. The exercise loops, so the next rep's first note lands exactly on the end of this one; a trailing grace swallowed it — counted extra here and, since the window is also what gets discarded, missing over there. Two guaranteed errors a rep, which is more than the entire budget of a short exercise: the broken triad has 12 notes and a budget of 1, so playing it perfectly failed every rep after the first.
- An exercise that climbs comes back down. Before, the ones that only climbed teleported two octaves at the end of the rep — impossible to play in a loop. The descent is the **mirror around the top**, not the figure played backwards: for a symmetric shape it comes to the same thing, but for an asymmetric figure (Hanon) the mirror is the real descending form.
- If the notes that were missing and the ones that were extra are the same figure shifted, it tells you: *"you played the whole thing 1 octave down"*. It is the most common mistake and the most confusing one when it shows up as raw error.

If the notes land systematically far from the click, adjust **latency** under *Keyboard and input* until the `grid` number in the verdict drops. A constant offset affects neither evenness nor passing — it only changes where the note appears against the grid and in the piano roll.

The falling notes carry the **finger number**, coloured by hand (right in blue, left in grey), with a toggle under *Keyboard and input*. Where the fingering is genuinely standard it is written down; where it depends on which hand arrives at the note or on the key — hand-to-hand octaves, toccata, ostinato, bebop enclosure — there is no number, and the exercise note says why. A wrong number gets in the way more than no number at all.

The left hand has a list of its own when its shape differs: in C major the right hand does `1 2 3 1 2 3 4` and the left `1 4 3 2 1 3 2`. Neither follows from the other by formula, so where the left hand list does not exist it stays without a number instead of inheriting the right hand's.

**Listen** plays the exercise on a synthesized piano, at the tempo you picked, with the piano roll moving along — it is there to memorize the figure before trying it. It is an oscillator with an exponential decay, not a sampled piano: what matters is audible pitch and rhythm.

The **guide** checkbox makes that same piano play *during* the exercise, rep after rep, while you are being graded — useful for a pattern you have not memorized yet. It has its own volume, separate from the click, because only you know the balance against the sound of your keyboard. It ships off: a piano playing along is a choice, not a surprise. The notes are scheduled one beat at a time, so Hanon does not create 320 oscillators forty seconds before it needs them.

The tempo is yours: **− / +** (in steps of 10) or the BPM field in the header, plus a slider. Changing it by hand resets the clean streaks, otherwise the next success would promote you from a point you did not earn. In *accelerating* mode the curve is in charge, so the control disappears.

Next to the slider, **floor** is the lowest BPM the slider, the − button and the ladder can reach. It defaults to 40, which is fine for running a scale and useless for taking an arpeggio apart — a wide leap is worth practising at 20 or below, one note every few seconds, until the arm learns to carry the hand instead of the finger stretching for it. Set it as low as 10. Raising the floor above the current tempo brings the tempo up with it, so the BPM never sits outside what the controls can express.

When the current rep can promote you, the piano roll warns you beforehand: **"a clean rep here climbs to 90 BPM"**. And when the tempo actually changes, **↑ 90 BPM** appears in large type and the transport gives a count-in bar at the new tempo — the tempo does not change under your hand without warning.

Just below sits the count toward the next step — `●○ 1 more clean rep and it climbs to 70 BPM` — and it turns red counting the failures when the tempo is about to drop. It climbs and drops on the same grid of 10, so failing undoes exactly the last climb.

Everything you select — exercise, key, hands, order, mode, strictness, tempo, tempo floor, volume, keyboard range — is saved and comes back identical on the next load.

**Raise after** sets how many *consecutive* clean reps promote you: 1, 2 or 3. At 2 (the default) one bad rep resets the count, and on a short exercise — the seventh arpeggio lasts 3 seconds — it is easy to never string two together and for the tempo to seem stuck. If that is the case, use **1 clean**: nail it, climb.

Set it to **never** to drill one tempo for as long as you like. The reps are still graded and the records still count — only the ladder stops. Both directions freeze, not just the climb: a tempo that drops on two bad reps is not one tempo.

The **click** slider controls only the metronome volume; the *Listen* piano does not go through it, so you can silence the click and keep hearing the exercise.

**Strictness** sets how permissive the verdict is, on top of the default for the exercise level — and the screen shows the numbers it applies, it is not a mystery button:

| | errors in 64 notes | unevenness | tempo |
|---|---|---|---|
| learning | 6 | measured only | measured only |
| loose | 4 | 22% | ±10% |
| level default | 2 | 14% | ±5% |
| strict | 1 | 11% | ±3% |

*Learning* is what you want while you are still memorizing the shape: timing is still measured and shown on screen, but it does not fail you.

The **Hands** selector overrides the arrangement in the table: *right hand only*, *left hand only*, *both in octaves*, or *as written* (the exercise's own arrangement). Hands separately and then together is the normal way to study any passage — the figure, the subdivision and the fingering stay the same, only who plays changes. On 49 keys not everything fits doubled in octaves: when it does not, the app trims an octave and says why.

Modes: ladder (default), burst (play one rep, rest one), accelerating (the click climbs from the start tempo to the target) and free.

Set the keyboard range under *Keyboard and input* — the **Detect** button records the lowest and the highest note you play. The default is C2–C6, a 49-key controller. You can play from the computer keyboard when the controller is not on the desk.

`npm test` covers transposition, validation, the MIDI message parser, expanding the shred patterns into all 12 keys, the played×expected alignment and the tempo climb.
