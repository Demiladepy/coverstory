# Cover Story

**You are twelve. You are home alone. Someone is at the door, and they want to
speak to an adult.**

Hold a key and talk. Whatever you say comes back out of the house in a
grown-up's voice — Dad, Mom or Uncle — hesitations, stammers and raised voice
included. Keep the story straight across a whole night of visitors and nobody
ever finds out you were on your own.

The joke only works because nothing is cleaned up. Your "uh" is Dad's "uh". If
you shout, Dad shouts.

**Play it: https://coverstory-eta.vercel.app** — Chrome or Edge, and it needs a
microphone. There is no playing around that.

---

## The night

| | |
| --- | --- |
| **1 / 2 / 3** | hold to answer as Dad, Mom or Uncle — the key you hold *is* the voice that speaks |
| **7 / 8 / 9** | fire a line you wrote during prep |
| let go | the turn ends immediately |

Four doors in order: a pizza driver at eight, a neighbour who has not seen your
mother's car all week, the school attendance office on the phone, and a carload
of relatives on Christmas Eve.

Before each one you get 45 seconds to write three lines and choose who says
them. Then they knock.

**What crosses a doorstep is the only thing that should: the story.** Each
visitor is a different person, with their own conversation and their own
starting wariness. But every line an adult of this house has spoken all night
stays on the record — so what you told the pizza driver at eight still has to
be true when the relatives arrive.

---

## The three AssemblyAI products

Each one is load-bearing. Remove any of them and there is no game.

**Streaming Speech-to-Text** hears the player. Push-to-talk means turn
detection is never relied on: releasing the key sends `ForceEndpoint` and the
turn ends at once. Hesitations are kept on purpose — a re-voiced line only
sounds human if the "uh"s survive.

**LLM Gateway** is the visitor, and separately the one judgement the game
trusts a model with. Two calls, fired together: the character, hot, and the
judge, cold. [Why they were split](#the-visitor-cannot-be-the-judge) is one of
the more interesting things in here.

**Text-to-Speech** is the whole cast — the visitor at the door and the three
grown-ups who answer. It runs over `/v1/speech/events`, the only route that
returns audio *and* word timings together, which is what makes the words light
up as they are spoken and what makes the captioned replay possible.

---

## The decisions

This is the part worth reading. Almost every number in this game started as a
guess and got replaced by a measurement, and several of the measurements said
the guess was backwards.

### The 41-second gap that was not a gap

The first full browser run reported **40,885 ms** between releasing the key and
the transcript coming back. That is not a latency. `finaliseMs` subtracted
`releasedAt` from `performance.now()` while `releasedAt` was still **0**, so the
number printed was how long the page had been open.

For that to happen, a final turn had to arrive before the key was ever
released — which it did, because the microphone was streaming continuously
instead of only while the key was down, so the model ended a turn by itself at
a pause.

The real number, measured without a microphone at all by synthesising a line
and streaming it at exactly real time:

| | |
| --- | --- |
| key release → final transcript | **315 ms** median |
| transcript → first adult word | **~270 ms** |
| the gap the player actually feels | **~585 ms**, against a 1500 ms budget |

The plan had three fallbacks ready for going over budget. None were needed.

### The visitor cannot be the judge

Writing the visitor's next line and judging whether the player contradicted
themselves were one model call, on the theory that they are the same thought: a
visitor notices the thing that does not add up and *then* decides what to ask.

It reads beautifully. It scored badly — **two false positives every run**, and
always the same ones: a grown-up being vague, or admitting they did not know
where someone was, came back as a contradiction.

The premise was wrong. **A character whose whole job is to catch you out, asked
in the same breath to judge impartially, will find something.** The two jobs
also want opposite settings — the character needs a high temperature or it
repeats itself, the judge needs none or it wanders. One call cannot have both.

| | correct | false positives |
| --- | --- | --- |
| one call, in character, 0.9 | 6–7 of 9 | **2, every run** |
| one call, in character, 0.25 | 6–7 of 9 | **2, every run** |
| split: hot character + cold judge | 5–8 of 9 | **0** |

A second model call asking the *inverse* question was also tried, and
**reverted** — over three runs it cost recall and bought no precision.

What finally removed the last false positives needed no model at all. Both were
the same shape: *"honestly I couldn't tell you where she is"* scored as clashing
with *"she's at work until nine"*. An admission of ignorance asserts nothing for
an earlier statement to collide with, and deciding that is a regex.

**Precision is the number quoted, not accuracy**, because the two ways of being
wrong are not equal. A missed contradiction costs the player nothing. A false
one takes 26 points off them for something they did not say.

> I also had to correct myself here. An earlier version of this README claimed
> the judge was right "5 times out of 5 with no false positives". That was one
> sample of a call running at temperature 0.9, reported as a property of the
> system. It was not. `node scripts/judge-check.mjs` now runs nine cases and
> reports misses and false positives separately, so the claim can be checked
> instead of believed.

### Suspicion is scored in code, and that is a measurement

Six signals move the meter. Five are measured in code: dead air, answering in
the wrong voice, a twelve-year-old's vocabulary, evasion, and conviction — read
from filler density, the pauses between words, and loudness against the
player's own baseline.

Only **contradiction** goes to the model, because only contradiction needs
memory and meaning.

That split was going to be a preference — the plan wanted it for tunability.
The measurement made it a rule. Asked to judge four answers each written to trip
exactly one flag, the models blurred the categories: the best of them read a
reply full of hesitation as *childish* rather than *evasive*. That is a fair
reading of the text, and a useless signal — because the code does not have to
guess. It can hear the hesitation and time the gaps.

Writing the scorer as a pure function (facts in, points out — no model, no
clock, no audio) meant it could be compiled on its own and run against written
answers. That caught two things the design had wrong:

- **Conviction was cancelling the penalties.** A confidently delivered kid-slip
  scored +6 instead of +14, which would have taught players that volume beats
  keeping your story straight.
- **A long pause cost nothing.** It only suppressed the bonus, so a 1.4 s stall
  mid-sentence scored exactly zero. Stalling and dodging look the same from a
  doorstep.

### Every hidden rule got a tell

Three things governed your score and none of them were visible.

**Shouting** puts the loud words in CAPS and the voice leans on them — measured
at **25% longer** on the same sentence. Nothing said so, so nobody would find
it. There is a level meter beside whoever is answering now, with a notch where
shouting starts, scaled so that notch sits in the same place whoever is
talking — because the game scores a shout against *your own* normal level.

**Dead air** moved the meter after seven seconds of silence, and the first
notice was the penalty. A rule you can only learn by being punished by it reads
as unfair rather than hard. The silence now drains in the same strip the voice
meter fills — they are the same thing, the state of your turn — and two thirds
of the way through, the visitor raps once.

**How close they are to leaving** is pips beside their name. Knowing you need
one more answer is a completely different feeling from not knowing when this
ends.

### It is a door, not a dashboard

The screen was stacked grey panels with headings and a scrollbar, which is what
a settings page looks like.

The fix came from *Papers, Please*, where the lesson is not the pixel art but
that **the interface is the workplace**. There is no dashboard reporting your
state; there is a booth, a desk and a stamp, in one cramped view with nowhere to
look away to. The stress is the layout.

So: three zones in one viewport that never scrolls — what is beyond the door,
the door itself, and your side of it.

Colour has three jobs and they never swap. Cold blue-grey is everything
outside: the visitor, their voice, the dark. **Amber is light from inside the
house and nothing else** — your keys, your words, never a background and never a
decoration. Red is suspicion and nothing else.

Which is why the meter is the light under the door. It widens as they lean in,
and past 65 it stops being your hallway lamp.

### Voice cloning: investigated, declined

AssemblyAI shipped voice cloning during the build, and the original plan had a
stretch goal to clone a teammate as Uncle. It was read properly and turned
down, for reasons worth recording:

- **There is no API for making a clone.** Every path goes through the
  dashboard; the voices API documents one verb, `DELETE`. So it could only ever
  be three different `voice_id` strings in a source file, never something a
  player does.
- **A clone expires hard** — 60 days, and `voice_expired` is not retryable and
  cannot be renewed after the fact. That is a poor thing to stand between a
  judge and a working demo.
- **It is not a built-in voice**, so it cold-starts — which is exactly what the
  three grown-ups were cast to avoid.

Full notes in [docs/API-NOTES.md](docs/API-NOTES.md).

---

## What auditing the rules found

A green build says nothing about whether a game can be played badly. Reading
the rules rather than the code found nine faults. Not one of them would have
been caught by a typechecker, and two of them were introduced by a feature I
had already verified was working.

**A door could be cleared without speaking.** Prepared lines counted toward the
answers a visitor needed. The first door needs three. There are exactly three
excuse slots. So writing three lines and tapping 7, 8, 9 beat the pizza driver
at *minus thirty* on the meter — in a game whose entire subject is the voice. A
prepared line now does everything except satisfy the person at the door.

**The judge could not see the night it was judging.** Claims were trimmed to
the last eight; a night makes sixteen. Everything the first two visitors were
told had fallen out of the window before the last one arrived — which is
precisely what a run exists for.

**The game could go deaf and never say so.** A streaming session is capped, and
when it ran out nothing threw: `send` and `ForceEndpoint` both no-op on a
closed socket. The player would hold a key, talk, let go, and nothing would
answer, for ever. A closed socket is now an event the game reports.

**`/api/visitor` was unmetered and unbounded** — a public URL spending two model
calls per request on our own key, with entry counts capped and their lengths
not, which bounds nothing. A 4.8 MB body went straight through.

**Alt-tabbing mid-sentence hung the game**, because a `keyup` goes to whichever
window has focus.

**The shout read the wrong audio from the second door onward.** Word times are
relative to their session, a night opens a session per door, and the microphone
kept one clock for the whole night.

**We asked for 16 kHz and never checked we got it.** The rate is a request, not
a guarantee — and labelling 48 kHz audio as 16 kHz makes the server hear
everything at a third speed.

**A slow door lost its voice.** The TTS token authorises every line the house
speaks and expired at five minutes, while a door is capped at seven.

**Prep could be handed in twice**, by pressing the button as the countdown hit
zero — which opened the door twice, two openers talking over each other.

### Two the audit cleared rather than changed

**An idle tab is not a leak.** Dead air climbs twelve at a time and ends the
night in seven or eight silences, about ninety seconds. It terminates on its
own, so it was left alone.

**The first door is nearly unloseable, and should be.** A mediocre player
finishes it around 52 of 100. Losing your first encounter in forty seconds is
how somebody closes the tab.

---

## What a night costs

Streaming bills on **how long the socket stays open, idle or not** — the API
docs name unclosed sessions as the commonest cause of a surprise invoice.

One session spanning a whole night therefore billed three minutes of somebody
typing excuses, and an abandoned tab billed until the cap. Each door now opens
and closes its own session: a night's streaming drops from about nine minutes
to six, and an abandoned tab costs one door rather than one night.

That required the hourly guard to stop counting *tokens* and start counting
*nights* — the first door starts a run, the rest refill free against the same
run id. Verified: four doors, one run id, a fresh token each, and the cap moving
by exactly one.

With abandonment bounded to a single door, the cap can afford to be generous:
**five nights per browser, twenty-five per address.** The address cap is what
actually stops a farm — counting cookies alone was not a guard at all, since
anything that declines to keep cookies had no limit.

---

## Watching it

There is a shot list for the demo video in [docs/DEMO.md](docs/DEMO.md),
including the two things about this game that will quietly ruin a take: the
live link allows five nights an hour, and the shout cannot be demonstrated on
the first answer of a run because the game has not heard your voice yet.

## Running it

```bash
npm install
cp .env.example .env.local   # then add your AssemblyAI key
npm run dev
```

Two scripts re-measure the claims in this README, neither needing a microphone:

```bash
node scripts/probe.mjs        # voice latency, prosody, model comparison, ForceEndpoint
node scripts/judge-check.mjs  # the nine contradiction cases, misses and false positives apart
```

Run them before a demo. A number that has moved changes a decision above.

> One trap worth passing on: do not run `npm run build` while the dev server is
> up. Both write `.next`, and the dev server then serves a 404 for its own
> stylesheet — which looks exactly like a CSS syntax error and is not one.

## Deploying

Any host that runs Next.js 15. Set `ASSEMBLYAI_API_KEY`; the two budget
settings have sane defaults in code, so a deploy that forgets them is still
guarded. See [.env.example](.env.example).

The key never reaches the browser. `/api/token` mints short-lived tokens and
the browser talks to AssemblyAI directly with those, which also takes a hop off
the critical path between releasing the key and hearing the adult voice.

---

## The honest part

Every number above is measured, and several replaced a guess that was wrong in
an interesting way. The architecture was changed three times by evidence: the
latency fallbacks were deleted because they were not needed, the judge was
split in two because the combined call was unfair to players, and the scorer
was made a pure function so its arithmetic could be checked without a browser.

Two things are still estimates rather than measurements, and are marked as such
in [docs/SPIKE-FINDINGS.md](docs/SPIKE-FINDINGS.md): the per-level
`startSuspicion` and `turnsToWin` values, which only play can settle, and
whether the three grown-up voices actually *sound* like a tired father, a
too-helpful mother and an unreliable uncle. They were cast on measured
time-to-first-audio, which is not the same thing as an audition.
