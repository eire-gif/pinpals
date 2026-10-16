import { useCallback, useEffect, useRef, useState } from "react";

import { HAS_SPEECH } from "./native-capabilities";

/**
 * The phone's speech recogniser, for voice scoring (claude/voice-scoring.md).
 *
 * expo-speech-recognition is required lazily and only when the binary has
 * it (native-capabilities.ts): an over-the-air update reaching an older
 * build must not import a package whose native half isn't there.
 *
 * What it's set up for:
 *   - Irish English first (en-IE), then British, then whatever the phone has.
 *   - On the phone itself whenever the phone can (iPhones since about 2019):
 *     no signal needed on a links course, and nothing said leaves the phone.
 *     Where it can't, the phone's own online recogniser; with no signal that
 *     fails, and the screen says to tap the scores in.
 *   - The group's names and the golf words as hints (voice-scores.ts).
 *   - Listening keeps going while the member pauses for a name, and stops
 *     by itself after a short silence once something has been heard — or
 *     when they let go of the button, or tap Done.
 */

type SpeechModule = (typeof import("expo-speech-recognition"))["ExpoSpeechRecognitionModule"];

function speech(): SpeechModule | null {
  if (!HAS_SPEECH) return null;
  try {
    return (require("expo-speech-recognition") as typeof import("expo-speech-recognition")).ExpoSpeechRecognitionModule;
  } catch {
    return null;
  }
}

export type ListenState =
  /** Not started. */
  | "idle"
  /** Asking for the microphone and speech permissions. */
  | "asking"
  | "listening"
  /** Stopped; `transcript` is what was heard (maybe nothing). */
  | "finished"
  /** Permission refused: only Settings can change it now. */
  | "denied"
  /** No recogniser on this phone, or none for English. */
  | "unavailable"
  /** It started but couldn't finish (no signal for an online recogniser, a call came in). */
  | "failed";

/** Stop by itself after this long with nothing new, once something has been said. */
const SILENCE_MS = 2200;
/** …and give up after this long if nothing at all is said. */
const NOTHING_SAID_MS = 9000;

const PREFERRED = ["en-IE", "en-GB", "en-US"];

let chosenLocale: string | null = null;

async function pickLocale(mod: SpeechModule): Promise<string> {
  if (chosenLocale) return chosenLocale;
  try {
    const { locales } = await mod.getSupportedLocales({});
    const lower = locales.map((l) => l.replace("_", "-").toLowerCase());
    chosenLocale = PREFERRED.find((p) => lower.includes(p.toLowerCase())) ?? "en-GB";
  } catch {
    chosenLocale = "en-GB";
  }
  return chosenLocale;
}

let supported: boolean | null = null;

/** Asked once: the answer doesn't change while the app runs, and the round screen asks on every render. */
export function voiceSupported(): boolean {
  if (supported != null) return supported;
  const mod = speech();
  try {
    supported = mod != null && mod.isRecognitionAvailable();
  } catch {
    supported = false;
  }
  return supported;
}

export function useVoiceListener() {
  const [state, setState] = useState<ListenState>("idle");
  const [transcript, setTranscript] = useState("");
  /** Microphone level, 0–1, for the waveform. */
  const [level, setLevel] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const stateRef = useRef<ListenState>("idle");
  const heardAt = useRef(0);
  const startedAt = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  /** What's been heard and finished so far: after a pause, newer phones send the next words as a new result. */
  const finalText = useRef("");
  /** Bumped by every start and cancel, so a start still waiting on a permission prompt knows it was cancelled. */
  const run = useRef(0);

  const set = (s: ListenState) => {
    stateRef.current = s;
    setState(s);
  };

  const clearTimer = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };

  useEffect(() => {
    const mod = speech();
    if (!mod) return;
    const subs = [
      mod.addListener("result", (e) => {
        const text = (e.results[0]?.transcript ?? "").trim();
        if (!text) return;
        heardAt.current = Date.now();
        if (e.isFinal) {
          finalText.current = `${finalText.current} ${text}`.trim();
          setTranscript(finalText.current);
        } else {
          setTranscript(`${finalText.current} ${text}`.trim());
        }
      }),
      mod.addListener("volumechange", (e) => {
        // -2 (silence) to 10 (loud), as the package reports it.
        setLevel(Math.max(0, Math.min(1, (e.value + 2) / 12)));
      }),
      mod.addListener("end", () => {
        clearTimer();
        setLevel(0);
        if (stateRef.current === "listening") set("finished");
      }),
      mod.addListener("error", (e) => {
        clearTimer();
        setLevel(0);
        switch (e.error) {
          case "aborted":
            return;
          case "no-speech":
          case "speech-timeout":
            set("finished");
            return;
          case "not-allowed":
            set("denied");
            return;
          case "service-not-allowed":
          case "language-not-supported":
            set("unavailable");
            return;
          case "network":
            setProblem("Voice needs a signal on this phone. Tap the scores in instead.");
            set("failed");
            return;
          case "interrupted":
            setProblem("Listening stopped when something else used the microphone.");
            set("failed");
            return;
          default:
            setProblem("That didn't work. Try again, or tap the scores in.");
            set("failed");
        }
      }),
    ];
    return () => {
      clearTimer();
      for (const s of subs) s.remove();
      try {
        if (stateRef.current === "listening") mod.abort();
      } catch {
        // Already stopped.
      }
    };
  }, []);

  const stop = useCallback(() => {
    clearTimer();
    const mod = speech();
    if (!mod || stateRef.current !== "listening") return;
    try {
      mod.stop();
    } catch {
      set("finished");
    }
  }, []);

  const cancel = useCallback(() => {
    run.current += 1;
    clearTimer();
    const mod = speech();
    try {
      if (stateRef.current === "listening") mod?.abort();
    } catch {
      // Already stopped.
    }
    set("idle");
  }, []);

  const start = useCallback(
    async (hints: string[]) => {
      const mod = speech();
      if (!mod) {
        set("unavailable");
        return;
      }
      const mine = ++run.current;
      const stillWanted = () => run.current === mine && stateRef.current === "asking";
      finalText.current = "";
      setTranscript("");
      setProblem(null);
      set("asking");
      try {
        const perm = await mod.requestPermissionsAsync();
        if (!stillWanted()) return;
        if (!perm.granted) {
          set("denied");
          return;
        }
        if (!mod.isRecognitionAvailable()) {
          set("unavailable");
          return;
        }
        const lang = await pickLocale(mod);
        if (!stillWanted()) return;
        let onDevice = false;
        try {
          onDevice = mod.supportsOnDeviceRecognition();
        } catch {
          onDevice = false;
        }
        heardAt.current = 0;
        startedAt.current = Date.now();
        set("listening");
        mod.start({
          lang,
          interimResults: true,
          continuous: true,
          maxAlternatives: 1,
          requiresOnDeviceRecognition: onDevice,
          addsPunctuation: false,
          contextualStrings: hints,
          iosTaskHint: "dictation",
          volumeChangeEventOptions: { enabled: true, intervalMillis: 120 },
          androidIntentOptions: { EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: SILENCE_MS },
        });
        clearTimer();
        timer.current = setInterval(() => {
          if (stateRef.current !== "listening") return clearTimer();
          const now = Date.now();
          if (heardAt.current > 0 ? now - heardAt.current > SILENCE_MS : now - startedAt.current > NOTHING_SAID_MS) {
            clearTimer();
            try {
              mod.stop();
            } catch {
              set("finished");
            }
          }
        }, 250);
      } catch {
        setProblem("The microphone couldn't start. Try again, or tap the scores in.");
        set("failed");
      }
    },
    []
  );

  return { state, transcript, level, problem, start, stop, cancel };
}
