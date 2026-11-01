# Day-one spike — findings

Measured 1 Nov 2026 with `node scripts/probe.mjs` on the live account, from
Lagos. These are the numbers the rest of the build is designed around. Re-run
the probe before the demo; a number that moves changes a decision below.

## The gap is not the problem

The plan budgeted 1500 ms between the player letting go of the key and the
grown-up voice starting, and named three fallbacks for going over.

**Speaking an adult line starts in about 270 ms once the voice is warm.**

| voice | kind | first audio, cold | warm |
| --- | --- | --- | --- |
| `aai-paul` | built-in | 1282 ms | 730 ms |
| `aai-mary` | built-in | 300 ms | 273 ms |
| `aai-george` | built-in | 238 ms | 271 ms |
| `aai-dorsey` | catalog | 284 ms | 285 ms |

Two things fall out of this.

**`aai-paul` is the odd one out**, and it was cast as Dad. Three runs each
across the built-in men settled it:

| voice | runs | median |
| --- | --- | --- |
| `aai-charles` | 253 · 265 · 254 | **254 ms** |
| `aai-george` | 397 · 269 · 255 | 269 ms |
| `aai-jean` | 255 · 325 · 284 | 284 ms |
| `aai-michael` | 328 · 262 · 343 | 328 ms |
| `aai-paul` | 1224 · 689 · 250 | 689 ms |

Charles is both the fastest and by far the steadiest; Paul swings by a second
between runs despite being built in. **Dad is now `aai-charles`.** That is a
decision made on latency alone — nobody has listened to these yet, and whether
Charles sounds like a tired father is still an open audition.

**The cold-start worry was overstated.** `aai-dorsey` is a catalog voice and
showed no cold-start penalty at all. Opening the visitor's session during the
level intro is still the right move, but it is insurance, not a fix for a
measured problem.

That leaves roughly **1200 ms of headroom for the transcript half**, which the
browser spike measures. Hold Space at `/spike` to fill it in.

## The shout trick works

Writing the loud words in CAPS and giving the line a rising tail both change
the audio measurably, which is what makes the joke land:

| line | audio |
| --- | --- |
| `...come back later.` | 2240 ms |
| `...come back LATER.` | 2800 ms |
| `...come back later?!` | 2320 ms |

CAPS buys 25% more time on the same sentence — the voice leans on the word
rather than reading it flat. Both markers are worth keeping.

## Word timings arrive and look right

One `WordBoundaries` frame per request, one entry per whitespace token, with
confidences. Zero-length entries show up for tokens with no sound, exactly as
documented, so the caption renderer has to skip them. Captions are real.

## The brain: choose on judgement, not on speed

Before the plan was upgraded this account could reach exactly two Gateway
models, and the usable one was bad at the job. **Upgrading opened the
catalog**, so the choice is now real. Four answers were written to trip one
flag each, and each model scored 2 for setting only the right flag, 1 for
setting it among others, 0 for missing it:

| model | avg latency | flag score | misses |
| --- | --- | --- | --- |
| **`gemini-2.5-flash-lite`** | 1482 ms | **6/8** | read the evasive answer as childlike |
| `nemotron-nano-9b-v2` | 908 ms | 4/8 | missed childlike and contradiction |
| `gemma-4-31b` | 936 ms | 2/8 | `confident` on everything, saw nothing else |
| `claude-haiku-5-5` | 2444 ms | — | never returned parsable JSON |

**The brain runs on `gemini-2.5-flash-lite`.** The two quicker models save
about 500 ms and get the meter wrong, which is the wrong trade: the brain
runs *after* the grown-up line has started playing, so it has two or three
seconds of cover and no reason to be cheap about accuracy.

The one flag gemini gets cleanly that the others don't is **contradiction** —
which is the single flag that genuinely needs memory and semantics, and the
one thing code cannot do for itself.

### What the model should and shouldn't be asked

Gemini missed `evasive`, reading a reply full of fillers as childlike. That is
a defensible reading, and it is also the point: these categories blur for a
model looking only at text, while the code has signals the model cannot see.

The plan already said to score suspicion in code rather than on the model's
mood, for tunability. The measurement makes it a stronger rule: **the model
writes the line and judges contradiction; the code scores everything it can
see for itself.**

| signal | where it comes from now |
| --- | --- |
| dead air | the turn timer, already in code |
| wrong voice | which hotkey was held versus who the visitor asked for |
| kid slip | vocabulary and sentence shape, plus STT word confidence |
| evasive | did the reply contain what was asked for; filler density |
| confidence | filler count, hesitation length, loudness against baseline |
| contradiction | the model, asked **one** yes/no question against remembered claims |

Everything above the last row is already measurable from the mic and the
transcript, for free and instantly. Only contradiction needs the model, and
gemini is the model that gets it right.

## Costs are not a constraint

A 103-character visitor line billed 103 characters. A 2000-character run is
about **$0.03** of TTS. The budget guard is there to stop a public link being
farmed, not to protect a thin margin.

## Open, needs a microphone

- The transcript half of the gap: key release to final turn.
- Whether hesitations survive, and whether `universal-3-6-pro` or
  `universal-streaming-english` with `format_turns=false` keeps more of them.
- Whether the loudness track separates a shout from a normal voice.

All three are in the browser spike at `/spike`.

## Open, needs a decision

- ~~The free plan is the binding constraint.~~ **Upgraded 1 Nov.** It lifted
  the 5-sessions-per-minute caps and opened the Gateway catalog, which is what
  made `gemini-2.5-flash-lite` available.
- Audition the three grown-ups. Casting so far is on latency only.
