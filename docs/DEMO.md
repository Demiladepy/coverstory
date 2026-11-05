# The demo video

A shot list, and the handful of things about this particular game that will
ruin a take if nobody warns you about them.

Target: **two minutes fifteen**. Judges watch a lot of these. Everything here
earns its seconds or it is cut.

---

## Before you record

**Raise the run cap, or rehearse locally.** The live link allows five nights an
hour. Four rehearsals and a take will lock you out mid-shoot. Rehearse on
`npm run dev`, where `.env.local` allows sixty, and save the live link for the
final take.

**Do not demonstrate the shout on the first answer of a run.** The shout is
scored against *your own* normal speaking level, and at the very first hold of
a night the game has never heard you — it falls back to a default. Give it one
ordinary answer first, then shout on the second. By then it knows your voice
and the notch is where it should be.

**Wear headphones and capture both audio sources.** You want the viewer to hear
your real voice and then the grown-up's, because the gap between the two *is*
the product. Record the microphone and system audio on separate tracks so you
can balance them: your voice slightly under, the house at full.

**Quiet room.** Background noise raises your measured baseline, which makes the
shout harder to trigger.

**Plan the sentences, play them for real.** Nothing below is faked, but every
line is chosen so the beat lands. Know what you are going to say.

---

## The shot list

### 0:00–0:15 — No introduction

Open on the game. Knock, visitor speaks, you answer, Dad answers for you. Cut.

> **Driver:** "Evening! Large pepperoni, two garlic breads. I just need an
> adult to sign for it."
> **You, aloud:** "Uh — yeah, just leave it on the step, mate."
> **Dad's voice:** *"Uh — yeah, just leave it on the step, mate."*

Fifteen seconds, no narration, and the viewer understands the entire game.
Resist every urge to explain first. The words lighting up as each voice speaks
does the explaining.

### 0:15–0:22 — One line of context

Only now, a title card or one spoken sentence:

> *You're twelve. You're home alone. Four people are going to knock tonight.*

Nothing else. No feature list.

### 0:22–0:45 — The shout

Second answer of the door, so the game knows your voice. Watch the level meter
beside **DAD IS ANSWERING** and push past the notch on one word.

> **You, aloud:** "He's in the shower — come back LATER."

Three things land at once and all three are visible: the meter crosses into
amber, the transcript keeps your raised word, and Dad leans on it. Let the
viewer *see* the notch being crossed. This is the single most screenshot-able
moment in the game.

### 0:45–1:05 — The meter moves, and says why

Let the visitor ask for someone specific, then answer as the wrong person.

> **Neighbour:** "Is your mother in?"
> *(hold 3, not 2)* **Uncle's voice:** "She's upstairs, I'll get her."

The light under the door widens, the tone falls, and **Wrong voice +18** appears
at the foot of the door. Say one sentence over it: *the meter is scored in
code, so it can always tell you what you did.*

### 1:05–1:45 — The one that wins it

The cross-door contradiction. Set it up at the first door and spring it at a
later one.

> **Door one, to the driver:** "Dad's out in the garage, he'll sign."
> *(get through the door, let the next one knock)*
> **Door two, to the neighbour:** "Dad's at work till nine."
> **Neighbour:** *— catches it —* "But you said he was in the garage?"

Hold on the **Doesn't add up +26** and the light going red. This is the beat no
other submission will have: the model is not being asked whether the answer
*sounds* suspicious, it is being asked one question against a record of
everything the house has said all night.

Make the clash blatant. A subtle one may not be caught — the judge runs
conservative on purpose, because punishing a player for something they did not
say is far worse than missing something they did.

### 1:45–1:55 — Prepared lines, fast

Flash the prep screen, then fire one at the door with a keypress.

> *(tap 7)* **Mom's voice:** "I'm on a call — just leave it by the step."

One sentence: *written before you knew the question, so it buys you a moment,
not an answer.*

### 1:55–2:10 — The tape

Open the replay. Let it play with the captions lighting word by word across
both voices, then show **Download the tape**.

Say what it is: *every line of the night, with the word timings the speech API
returned, stitched into one file.*

### 2:10–2:15 — Close

The three products, one breath each, over the end screen:

> *Streaming speech-to-text hears me. The LLM Gateway writes the visitor and
> judges whether I contradicted myself. Text-to-speech is the whole cast.*

Then the link, on screen and held.

---

## If a take goes wrong

**The visitor says something dull.** Re-roll it — the line is generated fresh
each time. Two or three attempts at the opening beat is normal.

**The contradiction is not caught.** Make it blunter. "He's in the garage"
against "he's at work" is a clean clash; "he's busy" against "he's around" is
not, and the judge is deliberately conservative.

**You get caught early.** Keep it. A short night that ends in being caught is a
*better* video than a flawless one — it proves the game can be lost, which is
the only thing that makes winning mean anything. The end screen says how many
doors you survived.

**The meter does not move the way you expected.** Do not fight it on camera.
Cut, and set the beat up again deliberately.

---

## What not to put in

- The `/spike` page. It is a measurement tool with the old styling and it is
  not advertised to players for a reason.
- A walkthrough of the code. The README is the argument; the video is the
  product.
- An explanation before the first voice. The first fifteen seconds are the
  whole pitch and narration will spend them.
