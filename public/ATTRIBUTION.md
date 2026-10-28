# Sample credits

keytrainer serves its sampled instruments itself, from `/samples/`. Each set
below is a subset of the original: fewer velocity layers and/or fewer sampled
keys, re-mapped so every key still sounds. Files were taken from the
[smpldsnds](https://github.com/smpldsnds) mirrors (the original recordings
converted to Ogg Opus and AAC/M4A by the smplr project) and renamed to
URL-safe names. The `preset.json` in each folder is the key/velocity map,
derived from the original SFZ mapping.

## Grand piano — `samples/grand/`

- **Source:** Splendid Grand Piano, Steinway samples released by **AKAI**;
  cleaned up, mapped to SFZ and converted to FLAC by **kinwie**
  ([sfzinstruments/SplendidGrandPiano](https://github.com/sfzinstruments/SplendidGrandPiano)).
  Files from [smpldsnds/sfzinstruments-splendid-grand-piano](https://github.com/smpldsnds/sfzinstruments-splendid-grand-piano).
- **Licence:** public domain ("This samples set was released as public domain in
  early 2000 by Akai company", per the repository README). No attribution
  required; given here anyway.
- **Subset:** 3 of the 4 recorded dynamics (pp, mf, ff; the pp set also plays a
  softest layer through a 1 kHz lowpass, as the original SFZ does), one sample
  about every major third — 60 samples.

## Wurlitzer EP200 — `samples/wurlitzer/`

- **Source:** Wurlitzer EP200 Electric Piano v1.1 (16-May-1999) by
  **Greg Sullivan** ([sullivang.net](http://www.sullivang.net/)), mapped to SFZ by
  **kinwie** ([sfzinstruments/GregSullivan.E-Pianos](https://github.com/sfzinstruments/GregSullivan.E-Pianos)).
  Files from [smpldsnds/sfzinstruments-greg-sullivan-e-pianos](https://github.com/smpldsnds/sfzinstruments-greg-sullivan-e-pianos).
- **Licence:** [Creative Commons Attribution 3.0 Unported](https://creativecommons.org/licenses/by/3.0/).
  Attribution required: this file is that attribution. Changes: format
  conversion (by smpldsnds), renamed files, outermost samples stretched to
  cover A0–C8.
- **Subset:** complete (all 4 layers, 42 samples).

## Yamaha CP80 — `samples/cp80/`

- **Source:** Yamaha CP80 Electric Grand Piano v1.3 (29-Sep-2004) by
  **Greg Sullivan**, mapped to SFZ by **kinwie** (same repositories as above).
- **Licence:** [Creative Commons Attribution 3.0 Unported](https://creativecommons.org/licenses/by/3.0/).
  Attribution required: this file is that attribution. Changes: format
  conversion (by smpldsnds), renamed files, 3 of 4 velocity layers (the second
  stretched up over the dropped third), two regions whose samples are missing
  upstream (F4 pp, G♯5 mp) re-pointed at their nearest neighbour.
- **Subset:** 57 samples.

## Acoustic drum kit — `samples/kit-acoustic/`

- **Source:** the **Versilian Community Sample Library (VCSL)** by
  **Versilian Studios LLC** ([sgossner/VCSL](https://github.com/sgossner/VCSL)).
  Files from [smpldsnds/sgossner-vcsl](https://github.com/smpldsnds/sgossner-vcsl):
  Bass Drum 1, Snare Drum Modern 1 (hits, taps) and Modern 3 (cross-stick),
  Hi-Hat Cymbal (closed, foot, open), Suspended Cymbal 2 (stick hits, used as
  the ride) and Suspended Cymbal 1 (bell).
- **Licence:** [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)
  (public domain dedication). No attribution required.
- **Subset:** 20 samples, assembled into one kit.

Not used: the smpldsnds `drum-machines` collection. Its README says "public
domain" but gives no source per kit (the TR-808 set, for one, is Michael
Fischer's 1994 freeware release, which states no licence), so it was left out.
