/**
 * The realtime transcript socket.
 *
 * Push-to-talk means we never rely on turn detection: the player holds a key,
 * we stream, they let go, we send ForceEndpoint and the turn ends at once. The
 * silence timings the model would otherwise use are irrelevant to us, which is
 * one less thing to tune.
 */

export type SttWord = { text: string; start: number; end: number; confidence: number };

export type SttTurn = {
  transcript: string;
  words: SttWord[];
  turnOrder: number;
  isFormatted: boolean;
};

export type SttOptions = {
  token: string;
  /**
   * The rate the audio is actually at. Not a constant: a browser may hand back
   * a different rate than the one requested, and the server trusts this number
   * over the bytes, so a wrong one is heard as speech at the wrong speed.
   */
  sampleRate?: number;
  /** omit for the default, universal-3-6-pro */
  speechModel?: "universal-3-6-pro" | "universal-3-5-pro" | "universal-streaming-english";
  /** Universal Streaming only. Ignored by the pro models. */
  formatTurns?: boolean;
  /** every parsed frame, with the wall clock, so a spike can see the sequence */
  onAny?: (message: Record<string, unknown>, atMs: number) => void;
  onBegin?: (info: { id: string; configuration: Record<string, unknown> }) => void;
  onPartial?: (text: string) => void;
  onTurn?: (turn: SttTurn) => void;
  onError?: (message: string) => void;
  onClose?: (code: number, reason: string) => void;
};

export type SttSession = {
  send: (pcm: Int16Array) => void;
  /** Ends the current turn immediately. This is the key release. */
  forceEndpoint: () => void;
  terminate: () => void;
  readonly ready: boolean;
};

export async function openStt(opts: SttOptions): Promise<SttSession> {
  const params = new URLSearchParams({
    token: opts.token,
    sample_rate: String(opts.sampleRate ?? 16000),
    encoding: "pcm_s16le",
  });
  if (opts.speechModel) params.set("speech_model", opts.speechModel);
  if (opts.formatTurns !== undefined) params.set("format_turns", String(opts.formatTurns));

  const ws = new WebSocket(`wss://streaming.assemblyai.com/v3/ws?${params}`);
  ws.binaryType = "arraybuffer";

  let ready = false;

  await new Promise<void>((resolve, reject) => {
    const failed = (reason: string) => reject(new Error(reason));

    ws.onopen = () => resolve();
    ws.onerror = () => failed("the transcript connection failed to open");
    ws.onclose = (event) => {
      if (!ready) failed(`the transcript connection closed: ${event.code} ${event.reason}`);
    };
  });

  ws.onmessage = (event) => {
    if (typeof event.data !== "string") return;

    let message: Record<string, unknown>;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }

    opts.onAny?.(message, performance.now());

    switch (message.type) {
      case "Begin":
        ready = true;
        opts.onBegin?.({
          id: String(message.id),
          configuration: (message.configuration ?? {}) as Record<string, unknown>,
        });
        break;

      case "Turn": {
        const transcript = String(message.transcript ?? "");
        if (message.end_of_turn) {
          opts.onTurn?.({
            transcript,
            words: (message.words ?? []) as SttWord[],
            turnOrder: Number(message.turn_order ?? 0),
            isFormatted: Boolean(message.turn_is_formatted),
          });
        } else {
          opts.onPartial?.(transcript);
        }
        break;
      }

      case "Error":
        opts.onError?.(String(message.error ?? "transcript error"));
        break;
    }
  };

  ws.onclose = (event) => {
    ready = false;
    opts.onClose?.(event.code, event.reason);
  };

  return {
    get ready() {
      return ready;
    },

    send(pcm) {
      if (ws.readyState === WebSocket.OPEN) ws.send(pcm.buffer as ArrayBuffer);
    },

    forceEndpoint() {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ForceEndpoint" }));
    },

    terminate() {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "Terminate" }));
      ws.close();
    },
  };
}
