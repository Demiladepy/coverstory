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

## The 41-second gap was never a gap

The first browser run showed 40885 ms between releasing the key and the final
transcript. It is not a latency. `finaliseMs` was `performance.now() -
releasedAt`, `releasedAt` was still **0**, and `performance.now()` counts from
page load — so the number printed was *how long the page had been open*, which
happened to be 40.9 s.

For that to happen, a final turn had to arrive **before the key was ever
released**. It did, because the mic was streaming continuously from the moment
Start was pressed rather than only while the key was down, so the model
endpointed on its own at a pause and the old `onTurn` timed that against a
release that had not happened.

Three fixes, and the third is the one that matters:

- The mic gate opens on key down and shuts on key up. Between turns nothing is
  captured, sent or timed, so our audio clock and the server's stay the same
  clock — which is also what keeps word timings lined up with the loudness
  track.
- A turn that arrives while no release is pending is **carried**, not dropped:
  its words are glued onto the turn the release does produce. The model can
  still end a turn at a pause mid-hold, and those words are the player's.
- Timing a turn against a release that has not happened is now structurally
  impossible, because that path returns early.

### What ForceEndpoint actually costs

Measured with no microphone at all, by synthesising a line, streaming it to the
socket at exactly real time the way a mic would, and releasing at the end
(`node scripts/probe.mjs endpoint`):

| take | gated — stream stops at release | ungated — 3 s of silence after |
| --- | --- | --- |
| 1 | 315 ms | 1377 ms |
| 2 | 179 ms | 110 ms |
| 3 | 807 ms | 216 ms |

**Median 315 ms gated.** The first take looked like proof that trailing audio
delays the final; two more takes say that was noise. At three seconds of
silence the gate makes no reliable difference to *speed* — it is a correctness
fix, not a latency fix, and the spread here is the server's own variance.

So the whole gap is about **315 ms of transcript plus 270 ms of voice ≈ 585
ms**, against a 1500 ms budget. None of the plan's three fallbacks are needed.

### Hesitations survive, confirmed without a mic

The probe's line goes in as "Hi, yeah, sorry, um, my dad is in the shower" and
comes back with the `um` intact on `universal-3-6-pro`. No need to fall back to
`universal-streaming-english`.

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

## The one judgement the model is trusted with

Contradiction is the only thing scored by the model, and it is scored as one
yes/no question folded into the call that writes the visitor's next line —
the same thought, not two round trips.

Tested against five answers with one claim on the record (`node` against the
live route, with the dev server up):

| answer, against "I am at work until about nine tonight" | expected | got |
| --- | --- | --- |
| "She is upstairs asleep, actually." | clash | clash |
| "I will be back a bit later, I am not sure exactly when." | vague | vague |
| "Anyway, did you see the game last night?" | subject change | subject change |
| "Honestly I could not tell you where she is right now." | not knowing | not knowing |
| "She never works evenings, never has." | clash | clash |

**Five of five, and no false positives.** The first pass missed the last one —
a general claim ruling out a specific one — so the prompt gained a one-line
example of that shape. The example is deliberately about something else
entirely ("nobody here drives" against "he took the car to the shop"), because
an example drawn from the test case teaches the model that case rather than the
shape of the problem; swapped for a neutral one, all five still pass.

The asymmetry is on purpose. A missed contradiction costs the player nothing; a
false one costs 26 points for something they did not do. Of the two ways to be
wrong, only one is unfair, so the prompt is written to be conservative and the
code refuses to score a contradiction when there is nothing on the record to
contradict.

## What the code scores, and how hard

Checked by compiling `src/game/score.ts` on its own and running hand-written
answers through it — it takes facts and returns points, with no model, clock or
audio in the way, which is the whole reason it is shaped that way.

| answer | points |
| --- | --- |
| steady, in the voice that was asked for | **−8** |
| answered as Uncle when they asked for Mom | +18 |
| "My mom said I'm not allowed to open the door" | +14 |
| the same words, mumbled (mean word confidence 0.41) | +14 |
| "um uh I dunno like um" | +10 |
| a 1.4 s pause in the middle of a sentence | +10 |
| contradicting a claim on the record | +26 |
| saying nothing at all for seven seconds | +12 |

Starting at 10 and caught at 100, a player who gets everything wrong lasts about
four turns, and levels run three to five.

Two rules fell out of writing the tests rather than out of the design:

- **Conviction only counts when nothing else went wrong.** The first pass
  awarded it alongside the penalties, so a confident kid-slip scored +6 instead
  of +14 — which would teach the player that volume beats keeping the story
  straight.
- **A long pause has to cost something.** It only suppressed the conviction
  bonus at first, so a 1.4 s stall mid-sentence scored exactly zero. Stalling
  and dodging look the same from the doorstep, so it scores as evasion and says
  so.

## What a prepared line is worth

A line written in the prep phase is scored on a different scale, because there
is nothing to hear. No fillers, no pauses, no loudness — the player did not
speak. That is the trade: a canned line is perfectly fluent and instant, so it
cannot give you away the way your own voice can.

What it can do is fail to fit, because it was written before the question was
asked.

| firing an excuse | points |
| --- | --- |
| fits the question, first use | **−10** |
| nobody in particular was asked | **−10** |
| they had asked for Mom, Dad's line fired | +18 |
| the visitor has heard that line already | +12 |
| it clashes with something on the record | +26 |
| all three at once | +56 |

The voice is chosen when the line is written, not when it is fired. Deciding
*who* says a thing is most of the work of preparing an excuse, and doing it in
advance is the whole advantage prep buys — at the door it is one key.

### Two things the error path taught us

Driving the game with the microphone blocked, which is the one state that is
easy to reach by accident, showed up two bugs that no amount of typechecking
would have:

- **A denied microphone rendered as losing.** `result` was null and the
  game-over panel read "they stopped believing you", blaming the player for
  something the browser did. A run that cannot start now has its own screen.
- **The permission prompt was gating the prep screen.** Asking for the
  microphone before prep meant the prompt landed over a blank page. It now
  opens behind the prep screen, along with the token, the socket and the model
  warm-up — several seconds the player spends writing instead of watching a
  spinner. The click's activation still covers the request, because it is made
  immediately rather than when prep ends.

## The tape

The replay needs nothing from the service. Every line's raw PCM is kept as it
plays, so the encounter is stitched back together locally and the player hears
exactly what they heard the first time.

Checked end to end without a microphone, by synthesising two lines and running
them through the real share path:

| | |
| --- | --- |
| visitor line | 5.44 s, 15 word timings |
| house line | 3.76 s, 12 word timings |
| stitched, with a 420 ms breath between | 9.62 s, 230880 samples — exact |
| WAV out | 461804 bytes, `RIFF`/`WAVE`, 24 kHz mono 16-bit |
| declared data bytes vs actual | 461760 / 461760 |

The gap between lines is not cosmetic. Played back to back the conversation
sounds like one person talking over themselves, and the joke is that it is two
people who are not there.

Clip length is taken from the samples rather than from the service's reported
`audio_duration_ms`, because the captions have to line up with what the ear
hears and the samples are the thing the ear gets.

## Correction: the judgement was never "5 out of 5"

An earlier entry in this file reported the contradiction check passing five of
five hand-written cases with no false positives. That number was one sample of
a stochastic process — the call ran at temperature 0.9 — and re-running the
same prompt against the same cases gave different answers. The claim was true
of that run and not true in general, and the tuning done on the back of it was
tuning against noise.

`node scripts/judge-check.mjs` now runs nine cases and reports misses and false
positives separately, because they are not equally bad: a missed contradiction
costs the player nothing, a false one takes 26 points off them for something
they did not do.

## Why the judgement is its own call now

Writing the visitor's line and judging the answer used to be one call, on the
theory that they are the same thought. It reads well and it scored badly:

| one call, in character | result |
| --- | --- |
| at temperature 0.9 | 6–7 of 9, **2 false positives** |
| at temperature 0.25 | 6–7 of 9, **2 false positives** |

The false positives were the same ones each time — a grown-up being vague
about when someone would be back, or admitting they did not know where someone
was, came back as a contradiction.

The premise was wrong. A character whose whole job is to catch you out, asked
in the same breath to judge impartially, will find something. The two jobs also
want opposite settings: the character needs a high temperature or it repeats
itself, the judgement needs a low one or it wanders.

They are two calls now, fired together with `Promise.all` so the round trip is
unchanged. The line keeps the persona and the heat. The judgement has no
persona at all, runs at temperature 0, sees only the numbered list of claims,
and is told at length what does *not* count.

| split, neutral judge | result |
| --- | --- |
| six consecutive runs | 5–8 of 9, **0 false positives** |

**Precision is the number that matters and it is holding: 54 judgements across
six runs without once punishing a player for something they did not say.**
Recall is noisy — between one and four real contradictions slip through per
run — and that is the side of the trade worth being on. You are never caught
out unfairly; you sometimes get away with a slip.

The cost is that the visitor's line can no longer react to a contradiction it
was not told about. It still has every claim in front of it and often notices
anyway, and a meter that moves for the right reason is worth more than a line
that gloats.

## The other thing the suite caught

The visitor used to repeat its own previous line word for word — the suite
flags that separately, because a visitor asking the same question twice reads
as broken long before anyone notices a scoring mistake. One line in the persona
prompt fixed it.

## The silent hang

A streaming session is capped by the token that opened it, and the socket was
being opened behind the prep screen — so up to forty-five seconds of a
two-hundred-second budget was spent watching someone type excuses. The rest
went on the encounter, and the longest level can run past what was left.

What happened when it ran out was the bad part. Nothing threw. `send()` and
`ForceEndpoint` both no-op on a closed socket, and the engine never passed an
`onClose` handler, so the player held a key, spoke, let go — and nothing
answered, for ever. No error, no meter movement, no visitor. A silent total
hang, most likely on the Christmas level, which is the one a demo would end on.

Three fixes, and the last is the one that matters:

- The transcript socket now opens when prep ends, not when prep starts, so the
  session clock begins with the encounter. It costs well under a second and the
  visitor's opening line plays over it.
- Tokens are minted during prep and used after it, so they are issued with a
  lifetime that outlives prep rather than the sixty seconds they had — which
  was itself close enough to the forty-five-second prep phase to fail on a slow
  writer.
- The socket closing is now an event the game notices and reports. It ends the
  run honestly instead of pretending to listen.

The session cap went to seven minutes, which comfortably covers the longest
encounter, and the socket is terminated the moment a level ends rather than
when the player finally leaves the end screen — billing runs on socket time,
and the end screen is where someone sits and listens to the tape.
