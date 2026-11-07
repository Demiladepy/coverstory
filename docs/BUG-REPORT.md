# Bug reports for AssemblyAI

Three findings from building a real-time voice game on Streaming STT v3 and
the LLM Gateway. Each one is written so it can be pasted into a form on its
own. Reproduction steps are included and every claim here was measured, not
assumed.

Contact: ayekudemilade43@gmail.com
Project: Cover Story, https://coverstory-eta.vercel.app/play

---

# Report 1

## Title

Streaming v3: ForceEndpoint on an empty buffer returns no Turn at all, so a
push-to-talk client hangs forever

## Severity

High for any push-to-talk integration. It is an unrecoverable hang with no
client-visible signal.

## What happens

In a push-to-talk design the client sends audio only while a key is held,
then sends `{"type":"ForceEndpoint"}` on release and waits for the Turn that
closes the utterance.

If the audio the server received contained nothing it considered speech, no
Turn message is sent in response to ForceEndpoint. Not an empty Turn, not an
error, nothing. The socket stays open and healthy.

A client that awaits the Turn after ForceEndpoint therefore waits forever.
From the user's side the application silently stops responding: they hold the
key, speak, release, and nothing ever happens again.

## Why this is worse than it sounds

The failure is indistinguishable from the application being broken, because
every signal available to the client says the connection is fine. The socket
is open, `readyState` is 1, no Error message arrives, and no close frame
arrives. There is nothing to catch, log, or retry on.

The condition is also common in exactly the situation where it hurts most: a
muted input, the wrong input device selected, or a user who pressed and
released without speaking. All three are ordinary user error and all three
produce a permanent hang rather than a recoverable state.

## Steps to reproduce

1. Open a Streaming v3 session.
2. Send a short run of digital silence, for example 500 ms of zeroed
   `pcm_s16le` at 16 kHz.
3. Send `{"type":"ForceEndpoint"}`.
4. Wait.

Expected: a Turn message, with an empty or near-empty transcript, closing the
utterance.

Actual: no Turn message. The socket remains open indefinitely.

## What we would like

Either a Turn in response to every ForceEndpoint, empty transcript included,
or an explicit message saying there was nothing to endpoint. Either one lets
a client distinguish "you said nothing" from "we are still thinking", which
is currently impossible.

## Workaround we shipped

A three second watchdog armed on release. If no Turn arrives, the client
assumes none is coming, hands control back to the user, and shows a message.
Measured normal finalise latency for us is 315 ms, so three seconds is a wide
margin, but it is a timer standing in for a protocol guarantee.

---

# Report 2

## Title

Streaming v3: WebSocket close codes and reasons are not documented, so a
client cannot tell a quota problem from a network problem

## Severity

Medium. Not a crash, but it makes every production failure undiagnosable.

## What happens

When a Streaming v3 session ends unexpectedly the client receives a WebSocket
close frame. We could not find documentation mapping close codes and reasons
to causes, so when sessions started closing mid-use we had no way to tell
which of these was happening:

- the temporary token expired
- a concurrent session limit was reached
- an account quota or credit limit was reached
- a maximum session duration was reached
- the audio format or declared sample rate was rejected
- an ordinary network interruption

All of them present to the client as the same thing: a close frame.

## Why this matters

We lost most of a day to this. Because there was no documented meaning for
the close, we reasoned from symptoms instead, and built and shipped a fix for
an idle timeout that, when we finally tested it directly, turned out not to
exist. See the measurements below. That work would not have happened if the
close frame had carried a documented reason.

## Steps to reproduce

Open a Streaming v3 session and keep it open until it closes on its own, or
use a token near expiry. Read `event.code` and `event.reason` on the close
event and try to determine the cause from the documentation.

## What we would like

A table in the Streaming v3 documentation listing each close code the service
sends, the reason string that accompanies it, and what the client should do
about it, specifically which are retryable and which are not.

## Measurements, in case they are useful

Tested directly against Streaming v3 with a temporary token, `pcm_s16le`,
16 kHz, outside a browser. Each row is a hypothesis we held and then
disproved, which is itself evidence that guessing is the only option a client
currently has:

| What we sent | For | Result |
|---|---|---|
| Nothing at all after connecting | 60 s | Session stayed open |
| Continuous digital silence | 60 s | Session stayed open |
| One 2 ms chunk, far below the documented 20 ms minimum, among normal chunks | 60 s | Session stayed open, no error |
| 47 consecutive ForceEndpoint messages, one per second | 60 s | Session stayed open |

Two of those are worth noting on their own. There appears to be no idle
timeout at the one minute scale, which contradicts a reasonable reading of
the guidance about closing unused sessions. And an undersized chunk is
accepted silently rather than rejected, which makes the documented 20 ms
minimum hard to rely on in either direction.

---

# Report 3

## Title

Streaming v3: billing is by socket-open duration, which is correct but is not
prominent enough for real-time designs

## Severity

Low. A documentation and guidance issue, not a defect.

## What happens

Streaming sessions bill for how long the socket is open, whether or not audio
is flowing. This is stated, but it is easy to read past, and it shapes
architecture more than almost any other fact about the API.

In our case it decided two separate design questions:

1. Whether to keep one session open for a whole play session or open one per
   encounter. Per encounter cut our billed time from roughly nine minutes to
   roughly six.
2. Whether to send digital silence between utterances. Since the cost is the
   same either way, silence is free, which is not obvious until the billing
   model is clear.

## What we would like

A short note in the Streaming v3 overview, near the top, saying plainly that
the meter runs on socket-open time, with one sentence on what that means for
push-to-talk designs. The cost of missing it is a surprise bill, and the
people most likely to miss it are the ones building their first real-time
integration.

---

# Notes on all three

Built during the AssemblyAI hackathon, November 2026, on Streaming STT v3,
the TTS `/v1/speech/events` endpoint, and the LLM Gateway.

Happy to supply the reproduction script, which is about a hundred lines of
Node with no dependencies beyond the built-in WebSocket, on request.
