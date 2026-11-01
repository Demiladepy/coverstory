# AssemblyAI — verified API notes

Read from the live docs on 1 Nov 2026. TTS shipped 28 Oct 2026, so none of this
is guessable from memory. Everything below was confirmed on the docs pages
linked at the bottom; don't change a URL or a field name here without re-reading
the page.

## Streaming STT

`wss://streaming.assemblyai.com/v3/ws`

- Browsers can't set headers on a WebSocket handshake, so auth goes in the
  `token` query parameter. Mint it server-side.
- Default model is `universal-3-6-pro`, 16 kHz `pcm_s16le`, mono.
- **`format_turns` is Universal Streaming (English/Multilingual) only** — it is
  *not* available on `universal-3-6-pro` or `universal-3-5-pro`. This is the
  crux of the hesitation question: on the pro models there is no
  formatted/unformatted switch, you get what the model gives. If the pro model
  strips "uh"s, the fallback is `speech_model=universal-streaming-english` with
  `format_turns=false`, which returns raw unformatted words.
- `prompt` (3.5-pro only) carries *context about the audio*, not instructions —
  it cannot be used to ask for verbatim output.
- **No idle timeout by default.** Sessions stay open until `Terminate` or the
  3-hour cap; `KeepAlive` is only needed if you set `inactivity_timeout`. (The
  120 s idle timeout in the project plan is the *TTS* session's, not this one.)

Client → server: raw binary PCM frames, plus
`{"type":"ForceEndpoint"}` (ends the turn now — this is the push-to-talk
release), `{"type":"Terminate"}`, `{"type":"KeepAlive"}`,
`{"type":"UpdateConfiguration", ...}`.

Server → client: `Begin` (`id`, `expires_at`, `configuration`),
`SpeechStarted`, `Turn`, `Termination`, `Heartbeat`.

```json
{ "type": "Turn", "turn_order": 0, "end_of_turn": true, "turn_is_formatted": true,
  "transcript": "Hello world.", "end_of_turn_confidence": 1,
  "words": [{ "text": "Hello", "start": 0, "end": 500, "confidence": 0.99 }] }
```

`include_partial_turns` defaults to true — partials are the live caption while
the key is held.

There is also an `llm_gateway` connect parameter that runs a completion on each
finalised turn and returns `LLMGatewayResponse` straight to the socket. It skips
a round trip to our server. Worth reaching for only if the measured turn is too
slow, since it leaves the visitor's memory of past claims out of the loop.

### STT token

`GET https://streaming.assemblyai.com/v3/token?expires_in_seconds=60`,
API key in the `Authorization` header. Returns `{ "token": "..." }`.
`expires_in_seconds` 1–600. `max_session_duration_seconds` 60–10800 caps the
session. A token is **not** single-use — mint one per connection and keep the
window short.

## TTS

Two routes, and we use both for different jobs.

### HTTP — the player's re-voiced line

`POST https://tts.us.assemblyai.com/v1/speech/events`, `Authorization` header.
Takes the Create-speech body and answers **server-sent events** instead of raw
audio: `Begin`, `Audio` (base64 raw PCM, ~80 ms per event), `FlushDone`,
`WordBoundaries`, `Termination`. This is the one route that gives audio *and*
word timings over HTTP, which is exactly what a captioned replay needs.

MP3, WAV, `bit_rate` and `"stream": false` are refused here, because the word
times are positions in the raw audio.

`POST /v1/speech` is the plain version: returns audio bytes, `container: "wav"`
for a playable file, and no word timings.

Response headers carry the truth about what ran: `x-tts-sample-rate`,
`x-tts-voice-id`, `x-tts-model`, `x-tts-billed-characters`,
`x-tts-audio-duration-ms`, `x-request-id`. Read the sample rate from there, not
from the request.

**Every TTS route answers cross-origin requests from any origin**, and a
temporary token works in the `Authorization` header wherever a key does. So the
browser can call TTS directly with a minted token — one less hop on the critical
path, and the key still never ships.

### WebSocket — the visitor's lines

`wss://tts.us.assemblyai.com/v1/ws?voice_id=...&language=english&sample_rate=24000&encoding=pcm_s16le&token=...`

Frames out: `Generate {text}`, `Flush`, `Cancel`, `KeepAlive`, `Terminate`.
Frames in: `Begin`, `Audio {audio: base64, flush_id}`, `FlushDone {flush_id,
audio_duration_ms}`, `WordBoundaries`, `Termination`, `Error`.

- Each `Flush` concludes one request and takes the next `flush_id` (from 0).
  Ids skip after a `Cancel`, so read them off the frames.
- Consecutive `Generate` texts are joined **with no separator** — keep the
  spaces at the edges.
- Raw PCM, no header. It will not play from an `<audio>` element or a `Blob`;
  decode and schedule it, or write a WAV header.
- Session lasts at most 1 hour and dies after **120 s with no frame either
  way** — send `KeepAlive` through the prep phase.
- `Cancel` is the barge-in.

### Word boundaries

On by default on the wire (`word_boundaries=false` turns them off); the SDKs
have them off unless asked. One frame per request, after that request's
`FlushDone`.

```json
{ "type": "WordBoundaries", "flush_id": 0, "audio_start_ms": 0,
  "words": [{ "word": "Hello", "start": 265, "end": 530, "confidence": 0.47 }] }
```

- One entry per **whitespace-delimited token of your text**, in order, with
  punctuation still attached.
- `start`/`end` are positions on the **session's** continuous audio timeline,
  not the request's. **Do not add `audio_start_ms`** — subtract it to get a
  position inside the request's own audio.
- Tokens that make no sound (`-`, a lone `?`, `[laughs]`, an emoji) get
  zero-length entries with confidence 0. Skip those when highlighting.
- **Best effort.** A request can complete and never get a frame. Check
  `Begin.configuration.word_boundaries` — if the service can't supply them it
  echoes `false` even when you asked for `true`. Captions must degrade to no
  captions, never to a broken player.

### Voices

`voice_id` takes a library slug (`aai-jane`), a UUID, or one of your own cloned
voices' slugs. Default is `aai-jane`.

**Built-in voices are always loaded**: `aai-jane`, `aai-alba`, `aai-anna`,
`aai-charles`, `aai-eve`, `aai-george`, `aai-jean`, `aai-mary`, `aai-michael`,
`aai-paul`, `aai-vera`. Every other catalog voice is loaded when a session with
it opens, and the first use after a while waits longer for its first audio.

That split decides our casting. The three grown-ups are on the critical path —
the player releases the key and the adult must speak *now* — so they get
built-in voices. The visitor's lines come over a WebSocket opened at level
start, which has the whole level intro to warm up, so the visitor can afford a
characterful catalog voice.

Catalog voices worth auditioning for visitors: `aai-dorsey` (older man, raspy,
nasal, breathy), `aai-ewald` (middle-aged American man, fast), `aai-audrey`
(middle-aged American woman, even), `aai-peter` (middle-aged American man,
soft-spoken), `aai-buford` (older British man, energetic), `aai-lilla`
(middle-aged British woman, nasal, expressive).

`language` takes a full English name (`english`, `spanish`, …), not a code —
unlike the STT APIs, which take codes.

### TTS token

`GET https://token.us.assemblyai.com/v1/token?product=tts&expires_in_seconds=60`,
API key in `Authorization`. Note this is a **different host and shape** from the
STT token route. Returns `{ "token": "...", "expires_in_seconds": 60 }`.

## LLM Gateway

`POST https://llm-gateway.assemblyai.com/v1/chat/completions`,
`Authorization: <key>` (no `Bearer`).

```json
{ "model": "claude-sonnet-4-6",
  "messages": [{ "role": "user", "content": "..." }],
  "max_tokens": 1000 }
```

Response: `{ request_id, choices: [{ message: { role, content }, finish_reason }],
usage: { input_tokens, output_tokens, total_tokens } }`.

Other parameters: `stream`, `temperature`, `post_processing_steps`,
`transcript_id`, `model_region: "global"`, `aai_prompt` + `prompt_replacements`.
Structured outputs are documented under `/docs/llm-gateway/structured-outputs`.

## Sources

- https://www.assemblyai.com/docs/streaming/api-spec/streaming-websocket
- https://www.assemblyai.com/docs/streaming/authenticate-with-a-temporary-token
- https://www.assemblyai.com/docs/tts/getting-started/quickstart
- https://www.assemblyai.com/docs/tts/word-boundaries
- https://www.assemblyai.com/docs/tts/voices
- https://www.assemblyai.com/docs/tts/authenticate-with-a-temporary-token
- https://www.assemblyai.com/docs/llm-gateway/chat-completions
