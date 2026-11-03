# Cover Story

You are twelve. You are home alone. Someone is at the door, and they want to
speak to an adult.

Hold a key and talk. Whatever you say comes back out of the house in a
grown-up's voice — Dad, Mom or Uncle — hesitations, stammers and raised voice
included. Keep the story straight long enough and they leave. Slip once too
often and they stop believing you.

The joke only works because nothing is cleaned up. Your "uh" is Dad's "uh". If
you shout, Dad shouts.

## Playing

| | |
| --- | --- |
| **1 / 2 / 3** | hold to answer as Dad, Mom or Uncle — the key you hold is the voice that speaks |
| **7 / 8 / 9** | fire a line you wrote during prep |
| let go | the turn ends immediately |

Holding a number picks the grown-up *and* opens the mic, because at a door
those are the same decision. It also means "which voice answered" is simply
which key was down — the signal the wrong-voice penalty reads.

Before each encounter there are 45 seconds to write three lines and choose who
says each. A prepared line is instant and perfectly fluent, so none of the live
tells can catch it — but it was written before you knew the question, so it can
be the wrong voice, it can clash with your story, and the visitor will notice
if they have heard it before.

Four encounters: a pizza driver, a neighbour who has not seen your mother's car
all week, the school attendance office on the phone, and a carload of relatives
on Christmas Eve.

## The three AssemblyAI products, and what each one does

**Streaming Speech-to-Text** hears the player. Push-to-talk means turn
detection is never relied on: releasing the key sends `ForceEndpoint` and the
turn ends at once. Hesitations are kept deliberately — a re-voiced line only
sounds human if the "uh"s survive, and on `universal-3-6-pro` they do.

**LLM Gateway** is the visitor. It writes every line after the opener, in
character, pressing for what it came for. A second, colder call answers the
single judgement the game trusts a model with: does what the house just said
clash with something the house said earlier?

**Text-to-Speech** is the whole cast — the visitor at the door and the three
grown-ups who answer. It runs over `/v1/speech/events`, the one route that
returns audio *and* word timings together, which is what makes the captioned
replay possible.

## What was measured, not assumed

Text-to-Speech shipped three days before this was built, so none of its shape
was guessable. Every API detail was read from the live docs
([docs/API-NOTES.md](docs/API-NOTES.md)) and every number below was measured
([docs/SPIKE-FINDINGS.md](docs/SPIKE-FINDINGS.md)).

| | |
| --- | --- |
| key release to final transcript | **315 ms** median |
| transcript to the first adult word | **~270 ms** |
| the gap the player actually feels | **~585 ms**, against a 1500 ms budget |
| CAPS on a word | 25% longer on the same sentence — the voice leans on it |
| a whole run, in speech | about $0.03 |

Two of those changed the build. The gap came in so far under budget that none
of the planned latency fallbacks were needed. And a 41-second reading that
looked like catastrophic latency turned out to be a clock bug — the mic was
streaming continuously instead of only while the key was held, so a turn ended
before any release and the timer subtracted zero.

## Why suspicion is scored in code

The meter moves on six signals. Five are measured here: dead air, answering in
the wrong voice, a twelve-year-old's vocabulary, evasion, and conviction —
read from filler density, the pauses between words, and loudness against the
player's own baseline.

Only **contradiction** is the model's, because only contradiction needs memory
and meaning.

That split is a measurement, not a preference. Asked to judge four answers
written to trip one flag each, the models blurred the categories — the best of
them read a reply full of hesitation as childish rather than evasive. That is a
fair reading of the *text*, and a useless signal, because the code does not
have to guess: it can hear the hesitation and time the gaps. The model is asked
the one question text alone can answer.

It is asked on its own, by a second call with no persona at all, at temperature
zero. That was not the first design — writing the visitor's line and judging
the answer were one call, because they feel like one thought. Measured over
nine cases, that call produced two false positives every run: a grown-up being
vague, or admitting they did not know, came back as a contradiction. A
character whose whole job is to catch you out, asked in the same breath to
judge impartially, will find something.

Split in two and fired together, six consecutive runs gave 5 to 8 of 9 correct
and **zero false positives in 54 judgements**.

The asymmetry is deliberate, and it is why precision is the number quoted
rather than accuracy. A missed contradiction costs the player nothing; a false
one costs 26 points for something they did not do. Recall is noisy; you
sometimes get away with a slip, and you are never caught out unfairly.

`node scripts/judge-check.mjs` re-runs the suite against a local server.

## Why it looks like that

One screen, and it never scrolls. Three zones: what is beyond the door, the
door itself, and your side of it.

That shape is borrowed from *Papers, Please*, where the lesson is not the pixel
art but that the interface **is** the workplace. There is no dashboard
reporting your state; there is a booth, a desk and a stamp, all in one cramped
view with nowhere to look away to. The stress is the layout. This started life
as stacked panels with headings and a scrollbar, which is what a settings page
looks like.

Colour has three jobs and they never swap. Cold blue-grey is everything
outside — the visitor, their voice, the dark. Amber is light from inside the
house and nothing else: your keys, your words, never a background and never a
decoration. Red is suspicion and nothing else.

Which is why the meter is the light under the door. It widens as they lean in,
and past 65 it stops being your hallway lamp. You read it without looking at
it, and the number is still there when you want it.

## Running it

```bash
npm install
cp .env.example .env.local   # then add your AssemblyAI key
npm run dev
```

Then open the printed URL. Chrome or Edge; it needs a microphone, and there is
no playing around that.

`node scripts/probe.mjs` re-measures everything that does not need a
microphone — voice latency, prosody, the model comparison, `ForceEndpoint`
timing. Run it before a demo; a number that has moved changes a decision in the
findings.

## Deploying

Any host that runs Next.js 15. Set `ASSEMBLYAI_API_KEY`,
`MAX_RUNS_PER_BROWSER_PER_HOUR` and `MAX_RUN_SECONDS` in the host's
environment — see [.env.example](.env.example) for what each one is for.

The key never reaches the browser. `/api/token` mints short-lived tokens and
the browser talks to AssemblyAI directly with those, which also takes a hop off
the critical path between releasing the key and hearing the adult voice.

A public link is guarded at both ends: a per-browser hourly run cap, and a hard
session cap baked into the minted tokens themselves, because a streaming
session bills for as long as its socket is open. The run counter is in memory,
so it resets on redeploy and does not span instances — the right size of guard
for a demo link. If it ever has to be real it moves to a KV store, not to a
bigger map.
