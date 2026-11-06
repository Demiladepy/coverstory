# The demo video

A shot list for the finished game, written from the screens as they actually
are, plus the handful of things about this build that will ruin a take if
nobody warns you.

Target: **two minutes fifteen**. Judges watch a lot of these.

---

## Before you press record

**Rehearse locally, record on the live link.** The live link allows five
nights an hour. Four rehearsals and a take will lock you out mid-shoot. Run
`npm run dev` and rehearse at `localhost:3200/play`, where the local settings
allow sixty.

**Do not demonstrate the shout on the first answer of a run.** A shout is
scored against your own normal speaking level, and at the very first hold of
a night the game has never heard you, so it falls back to a default and the
notch sits in the wrong place. Give it one ordinary answer first. By the
second it knows your voice.

**Headphones, and record the microphone and system audio on separate tracks.**
The viewer has to hear your real voice and then the grown-up's, because the
gap between the two is the product. Separate tracks let you balance them:
your voice slightly under, the house at full.

**A quiet room.** Background noise raises your measured baseline, which makes
the shout harder to trigger.

**Know your lines.** Nothing below is faked, but every sentence is chosen so
the beat lands.

---

## The shot list

### 0:00 to 0:06, the cover, silent

Open on the opening screen and let it breathe. If `public/cover.jpg` is in
place that is your key art; if not it is the drawn door, with light under it
and a shadow crossing that light every nine seconds, pausing in the middle.

Wait for the shadow to stop before you click. It is the only moment in the
video with nothing to read.

### 0:06 to 0:16, prep, fast

Click **Get your story straight**. Three slots appear on keys 7, 8 and 9, each
with a Dad/Mom/Uncle choice, and a countdown in the corner.

Type one line only, into slot 7, and move on:

> *He's in the shower, can you come back?*

Filling one slot rather than three is faster on camera and shows that they are
optional. Click **Let them knock** rather than waiting out the clock.

### 0:16 to 0:34, the first answer, no narration

Three knocks. The driver speaks, and his words light one at a time as he says
them. Then hold **1** and answer out loud:

> **Driver:** "Evening! Large pepperoni, two garlic breads. I just need an
> adult to sign for it."
> **You, aloud:** "Uh, yeah, just leave it on the step, mate."
> **Dad's voice:** *"Uh, yeah, just leave it on the step, mate."*

Say nothing over this. Eighteen seconds, no explanation, and the viewer
understands the whole game. The words lighting up in two different voices do
the explaining better than any sentence.

### 0:34 to 0:40, one line of context

Only now, a title card or one spoken line:

> *You are twelve. You are home alone. Four people are going to knock tonight.*

Nothing else. No feature list.

### 0:40 to 1:00, the shout

Second answer of the door, so the game knows your voice. Watch the short bar
beside **DAD IS ANSWERING** and push one word past the notch:

> **You, aloud:** "He's in the shower, come back LATER."

Three things land at once and all three are on screen: the bar crosses into
amber, the live transcript keeps your raised word, and Dad comes back with it
heavier and brighter in his mouth. Let the viewer see the notch being crossed.
This is the most screenshot-able moment in the game.

### 1:00 to 1:15, the meter moves and says why

Let the next visitor ask for someone by name, then answer as the wrong person.

> **Neighbour:** "Is your mother in?"
> *(hold 3, not 2)* **Uncle's voice:** "She's upstairs, I'll get her."

The light under the door widens, a low tone falls, and **Wrong voice +18**
appears along the foot of the door. One sentence over it:

> *The meter is scored in code, so it can always tell you what you did.*

### 1:15 to 1:50, the one that wins it

The cross-door contradiction. Set it at the first door and spring it at the
second.

> **Door one, to the driver:** "Dad's out in the garage, he'll sign."
> *(get through the door, let the next one knock)*
> **Door two, to the neighbour:** "Dad's at work till nine."
> **Neighbour:** *catches it* "But you said he was in the garage?"

Hold on **Doesn't add up +26** and the light going red. This is the beat no
other submission has: the model is not being asked whether an answer sounds
suspicious, it is being asked one question against a record of everything the
house has said all night.

Make the clash blatant. A subtle one may not be caught, because the judge runs
conservative on purpose: punishing a player for something they did not say is
far worse than missing something they did.

### 1:50 to 1:58, the prepared line

At the next question, tap **7** instead of speaking.

> **Mom's voice:** "I'm on a call, just leave it by the step."

One sentence:

> *Written before I knew the question, so it buys a moment, not an answer.*

### 1:58 to 2:10, the tape

When the night ends, the end screen carries the whole thing. Open the replay
and let it run: each door is marked by name, the visitor's lines sit left and
the house's right, and the words light across both voices. Then show
**Download the tape**.

> *Every line of the night, with the word timings the speech API returned,
> stitched into one file.*

### 2:10 to 2:15, close

Over the end screen, one breath each:

> *Streaming speech-to-text hears me. The LLM Gateway writes the visitor and
> judges whether I contradicted myself. Text-to-speech is the whole cast.*

Then the link, on screen and held.

---

## If a take goes wrong

**The visitor says something dull.** Re-roll it. The line is generated fresh
every time, and two or three attempts at the opening beat is normal.

**The contradiction is not caught.** Make it blunter. "In the garage" against
"at work" is a clean clash; "busy" against "around" is not.

**You get caught early.** Keep it. A night that ends in being caught is a
better video than a flawless one, because it proves the game can be lost,
which is the only thing that makes surviving it mean anything. The end screen
says how many doors you got through.

**The meter does not move the way you expected.** Do not argue with it on
camera. Cut, and set the beat up again deliberately.

---

## What to leave out

- The `/spike` page. It is a measurement tool wearing the old styling and it
  is deliberately not linked from the game.
- Any walkthrough of the code. The README is the argument; the video is the
  product.
- Narration before the first voice. The opening is the whole pitch and talking
  over it spends it.
