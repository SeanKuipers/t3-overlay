export interface VoiceView {
  phase: "recording" | "transcribing" | "sending" | "sent" | "error";
  target?: string;
  text?: string;
  message?: string;
}

const LABEL: Record<VoiceView["phase"], string> = {
  recording: "Listening…",
  transcribing: "Transcribing…",
  sending: "Sending…",
  sent: "Sent",
  error: "Voice",
};

export function VoiceHud({ voice }: { voice: VoiceView }) {
  return (
    <div className={`voice glass ${voice.phase}`}>
      {voice.phase === "recording" ? (
        <span className="wave">
          <i />
          <i />
          <i />
          <i />
          <i />
        </span>
      ) : voice.phase === "sent" ? (
        <span className="ok">✓</span>
      ) : voice.phase === "error" ? (
        <span className="err">!</span>
      ) : (
        <span className="spinner" />
      )}
      <span className="voice-label">{LABEL[voice.phase]}</span>
      <span className="voice-text">{voice.message ?? (voice.text ? `“${voice.text}”` : "")}</span>
      {voice.target && <span className="key">→ {voice.target}</span>}
    </div>
  );
}
