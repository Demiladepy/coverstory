# Submission text

Everything written to be read as a person wrote it. Copy the parts you need.

---

## YouTube title

**Cover Story: a voice game where you talk your way past the front door**

Alternative, if you want the hook in the title:

**You are twelve and home alone. The man at the door wants an adult.**

---

## YouTube description

> You are twelve. You are home alone. Somebody knocks, and they will not deal
> with a child.
>
> Cover Story is a game you play by talking. You hold a key, say whatever you
> want in your own words, and the house answers in a grown-up's voice. Not a
> menu, not a dialogue tree. Whatever you actually said.
>
> Four people knock over one night: a delivery driver, a neighbour who is too
> interested, the school office, and on Christmas Eve, an aunt who has known
> your family for twenty years. They get harder, and they compare notes.
> Whatever you told the driver at eight is still on the record when the
> neighbour knocks at nine. Say Dad is in the garage, then say he is at work,
> and she will ask you which.
>
> Raise your voice and the grown-up raises theirs. That is measured against
> how loudly you normally speak, not a fixed threshold, so it works whether
> you are loud or quiet by nature.
>
> Play it: https://coverstory-eta.vercel.app/play
> Code: https://github.com/Demiladepy/coverstory
>
> Built for the AssemblyAI hackathon.
> Streaming speech to text hears the player. The LLM Gateway writes the
> visitor and separately judges whether the player contradicted themselves.
> Text to speech is the entire cast, including the player's own grown-up
> voice.
>
> 0:00 The thing it does
> 0:14 What it is
> 0:26 Writing your excuses before the knock
> 0:36 The driver will not take no
> 0:56 He gives up
> 1:12 The neighbour is not buying it
> 1:34 Christmas Eve, and the aunt asks who is actually speaking
> 2:00 Why you would play it

---

## Why I built this

Most things built on a voice API are an assistant. You talk, it helps. I
wanted the opposite: something where talking is the risk, not the service.

The idea came from a specific feeling rather than a technical one. Being a
kid home alone and hearing a knock, and the whole decision being whether to
answer and what to say. Everyone who was ever that age knows that feeling.
The gap between what you are and what you need to sound like is already a
game, and nobody had made it, because until recently you could not make it.
You needed to hear a real person speak, understand it fast enough that the
reply did not feel like a form submission, and answer in a different voice
than the one that went in. That is three separate hard problems that stopped
being hard quite recently.

I also wanted the AI to be the obstacle, not the helper. In most demos the
model is on your side. Here it is the person on the other side of the door
who does not believe you, and it is the thing quietly checking whether your
story holds. That felt like a more honest use of a model than another
chatbot with a different hat on.

The design reference was Papers, Please. Not the look, the structure. That
game puts the whole job on one cramped screen with nowhere to look away to,
and the interface is the booth rather than a readout about the booth. So
this is one screen, no scrolling: what is beyond the door, the door, and
your side of it.

---

## What I ran into building it

Written plainly, including the parts where I was wrong, because that is
where the actual information is.

**The visitor and the judge had to be two separate calls.** My first version
asked one model to both play the character and decide whether the player had
contradicted themselves. It produced two false accusations in every single
run. A model told to be a suspicious neighbour will find something
suspicious, because that is what you asked it to be. Splitting it fixed it
completely: one call is a character, written hot, allowed to be
unreasonable. The other has no persona at all, runs at temperature zero, and
is asked exactly one question against the record of everything said that
night. The judge also runs deliberately conservative, because accusing a
player of something they did not say is far worse than missing something
they did.

**I measured the latency instead of guessing, and deleted three fixes I did
not need.** I had planned a filler line, a typing indicator and a cached
fallback to cover the gap between the player releasing the key and the
grown-up's voice starting. Then I actually measured it: 315ms to finalise
the transcript, about 270ms to the first adult syllable, roughly 585ms
total against a budget of 1500ms. All three fallbacks went in the bin
unwritten. I nearly built a solution to a problem I had not checked existed.

**A 41 second gap that was not latency at all.** Early on I was seeing an
enormous delay and started optimising the audio path. The number was wrong:
I was computing elapsed time against a variable that was still zero. I then
made it worse by announcing I had confirmed the cause before I had, and
three subsequent runs disproved me. Measure, then say.

**Streaming speech to text bills for how long the socket is open, not for
what goes through it.** This is stated in the docs and extremely easy to
read past, and it decides architecture more than anything else about the
API. Once I understood it, I moved from one session per night to one per
door, which cut billed time from about nine minutes to about six, and it
also meant that sending digital silence between turns is free.

**The bug that cost me a full day was not a bug in anything.** Sessions kept
dying mid-game. The close code and reason were available on every single
close and my code threw both away, showing one fixed sentence instead. So I
reasoned from symptoms, decided it was an idle timeout, and shipped a fix
for it. Then I tested the service directly, outside the browser: a session
left completely silent for sixty seconds does not close. Neither does one
sent an undersized chunk, nor one sent forty seven consecutive endpoint
requests. My fix was treating something that did not exist.

When I finally printed the close code it was 1005 with an empty reason,
which means no close frame arrived at all. Nothing had hung up on me. The
connection was being torn out locally, by a screen recorder extension in my
own browser that was holding the microphone. I had been recording my demo
with the thing that was breaking my demo.

The lesson is not about extensions. It is that I spent a day guessing at
something the system was reporting the whole time, because I had written
code that discarded the report.

**So the game now reconnects rather than giving up.** I cannot tell a judge
which browser extensions to run. An unexpected close now takes a fresh
token, opens a fresh socket, and hands the floor back with one line saying
what happened, twice per door before it gives in.

**And one I caused myself an hour later.** That reconnect handed control
back the instant the line returned, which was sometimes while the visitor
was still mid reply, so two voices spoke at once. Answering is not a moment,
it is several seconds of audio and model calls, and none of it needs the
socket. The engine now counts how many speaking flows are in the air and
only returns the floor when nobody is talking.

**The interface was unreadable before it was unfair.** Somebody played three
doors without working out what ends a door. The only indicator was five grey
dots with the count hidden in a tooltip. It now says "two more answers and
they go" in words. The game had not been too hard. It had been silent about
its own rules, which is a different problem and an easier one to fix.

---

## What I would do next

Honest about what is missing rather than a roadmap nobody asked for.

**Let the visitor hear hesitation.** The transcript carries word timings and
right now I only use them for volume. The gap before an answer is at least
as revealing as its content, and a visitor who notices you took four seconds
to remember your own father's job would be genuinely unsettling.

**More than three voices.** Dad, Mom and Uncle cover most situations and run
out exactly when you want a fourth. An older sibling would change the game,
because a sixteen year old is believable to some visitors and useless to
others.

**A shared seed.** Four fixed doors means everyone's night is different in
dialogue but identical in shape. A daily seed, where everybody faces the
same four visitors and can compare how far they got, is the thing that would
make it worth coming back to.

**Say less at the door.** The suspicion meter explains every change in
words, which was right for building it and is probably wrong for playing it.
Finding out why you got caught after the night is over is a better story
than watching a number move.

**Mobile.** It plays on a phone and it is laid out for one, but push to talk
with a keyboard key is a desktop idea. It needs a thumb-sized hold button
before it is honestly playable on a phone.
