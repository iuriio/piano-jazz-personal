// The speaking voice: the browser's own speech synthesis, in English.
//
// Nothing is downloaded and nothing leaves the machine. A browser without
// speech synthesis simply stays quiet — the drill works the same.

/** Slightly brisk: the question should be out of the way quickly. */
const RATE = 1.1

/** If the engine never reports the end (blocked, crashed), stop waiting for it. */
const GIVE_UP_MS = 5000

function synth(): SpeechSynthesis | null {
  return typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null
}

// Plain English voices, best first. A name is matched from its start, so
// "Microsoft Aria Online (Natural)" and "Samantha (Enhanced)" count.
//
// The list is needed because "the first English voice" is not a safe pick: on a
// Mac the en-US voices start with Albert, Bad News, Bahh, Bells and Boing — the
// novelty ones — and the system default may well be in another language.
const PREFERRED = [
  'Samantha',
  'Google US English',
  'Alex',
  'Ava',
  'Allison',
  'Microsoft Aria',
  'Microsoft Jenny',
  'Microsoft Zira',
  'Microsoft David',
  'Karen',
  'Daniel',
  'Moira',
  'Tessa',
  'Google UK English Female',
]

// macOS lists these among its en-US voices. They are effects, not readers.
const NOVELTY = [
  'Albert',
  'Bad News',
  'Bahh',
  'Bells',
  'Boing',
  'Bubbles',
  'Bolhas',
  'Cellos',
  'Good News',
  'Jester',
  'Organ',
  'Superstar',
  'Trinoids',
  'Whisper',
  'Wobble',
  'Zarvox',
]

type VoiceLike = { name: string; lang: string }

/**
 * The voice to speak with: a preferred one, else any English voice that is not
 * a novelty, American first. Null when the machine has no English voice — the
 * caller then stays silent rather than have another language's voice read
 * English chord names.
 */
export function preferredVoice<V extends VoiceLike>(voices: readonly V[]): V | null {
  const english = voices.filter((v) => v.lang.toLowerCase().replace('_', '-').startsWith('en'))
  for (const name of PREFERRED) {
    const v = english.find((x) => x.name.startsWith(name))
    if (v) return v
  }
  const plain = english.filter((v) => !NOVELTY.some((n) => v.name.startsWith(n)))
  return plain.find((v) => v.lang.replace('_', '-') === 'en-US') ?? plain[0] ?? null
}

/** How long to wait for the browser's voice list before speaking without it. */
const VOICES_WAIT_MS = 400

/**
 * The voice list, once it has loaded. Chrome fills it in a moment after the
 * page starts; an utterance sent before that would go out with no voice chosen
 * and be read by whatever the system default is.
 */
function loadedVoices(s: SpeechSynthesis): Promise<SpeechSynthesisVoice[]> {
  const now = s.getVoices()
  if (now.length) return Promise.resolve(now)
  return new Promise((resolve) => {
    const done = () => {
      s.removeEventListener('voiceschanged', done)
      resolve(s.getVoices())
    }
    s.addEventListener('voiceschanged', done)
    setTimeout(done, VOICES_WAIT_MS)
  })
}

// Only the latest request speaks: one that was still waiting for the voice
// list when the next question came must not come out after it.
let latest = 0

/**
 * Says `text`, cutting off whatever was being said. `onEnd` runs exactly once,
 * when the voice is done or gave up — also when there is no voice at all, so a
 * caller can start its clock there without caring.
 */
export function speak(text: string, onEnd?: () => void): void {
  let done = false
  const finish = () => {
    if (done) return
    done = true
    onEnd?.()
  }
  const s = synth()
  if (!s) return finish()

  const mine = ++latest
  s.cancel()
  void loadedVoices(s).then((voices) => {
    if (mine !== latest) return finish()
    const voice = preferredVoice(voices)
    // Voices, but none of them English: say nothing.
    if (!voice && voices.length) return finish()
    const u = new SpeechSynthesisUtterance(text)
    u.lang = voice?.lang ?? 'en-US'
    u.rate = RATE
    if (voice) u.voice = voice
    u.onend = finish
    u.onerror = finish
    s.speak(u)
    setTimeout(finish, GIVE_UP_MS)
  })
}

export function hush(): void {
  latest++
  synth()?.cancel()
}
