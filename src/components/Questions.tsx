import { useState } from "react";
import type { PendingQuestion, PendingRequest } from "../lib/t3";

type Answers = Record<string, string | string[]>;

/** An option's answer value, as T3 sends it. */
const valueOf = (o: PendingQuestion["options"][number]) => o.value ?? o.label;

/**
 * An agent's question(s), answerable with a click. A single single-choice question sends on
 * the first click (fast while dead); anything else gets an Answer button.
 */
function RequestCard({ request, onAnswer }: { request: PendingRequest; onAnswer: (answers: Answers) => Promise<void> }) {
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [custom, setCustom] = useState<Record<string, string>>(() =>
    Object.fromEntries(request.questions.map((q) => [q.id, q.initialAnswer ?? ""])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const oneClick =
    request.questions.length === 1 && !request.questions[0].multiSelect && request.questions[0].options.length > 0;

  // Same precedence as T3: typed text wins, else the picked option(s).
  const answerFor = (q: PendingQuestion, pickedNow = picked): string | string[] | null => {
    const text = custom[q.id]?.trim();
    if (text && q.allowCustomAnswer !== false) return text;
    const values = pickedNow[q.id] ?? [];
    if (q.multiSelect) return values.length > 0 ? values : null;
    return values[0] ?? null;
  };

  const submit = async (pickedNow = picked) => {
    const answers: Answers = {};
    for (const q of request.questions) {
      const a = answerFor(q, pickedNow);
      if (a === null) {
        if (q.required !== false) return setError(`Answer "${q.header || q.question}" first.`);
        continue;
      }
      answers[q.id] = a;
    }
    setBusy(true);
    setError(null);
    try {
      await onAnswer(answers);
    } catch (e) {
      setError(e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e));
      setBusy(false);
    }
  };

  const pick = (q: PendingQuestion, value: string) => {
    const current = picked[q.id] ?? [];
    const next = q.multiSelect
      ? current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value]
      : [value];
    const updated = { ...picked, [q.id]: next };
    setPicked(updated);
    if (oneClick && !custom[q.id]?.trim()) submit(updated);
  };

  return (
    <div className="question-card">
      {request.questions.map((q) => (
        <div key={q.id} className="question">
          {q.header && <div className="question-header">{q.header}</div>}
          <div className="question-text">{q.question}</div>
          <div className="question-options">
            {q.options.map((o) => {
              const on = (picked[q.id] ?? []).includes(valueOf(o));
              return (
                <button
                  key={valueOf(o)}
                  className={`question-option${on ? " on" : ""}`}
                  disabled={busy}
                  onClick={() => pick(q, valueOf(o))}
                  title={o.description || undefined}
                >
                  {q.multiSelect && <span className="check">{on ? "☑" : "☐"}</span>}
                  <span className="option-label">{o.label}</span>
                  {o.description && <span className="option-desc">{o.description}</span>}
                </button>
              );
            })}
          </div>
          {q.allowCustomAnswer !== false && (
            <input
              className="question-custom"
              placeholder={q.options.length > 0 ? "Or type your own answer…" : "Your answer…"}
              value={custom[q.id] ?? ""}
              disabled={busy}
              onChange={(e) => setCustom({ ...custom, [q.id]: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
              }}
            />
          )}
        </div>
      ))}
      <div className="question-foot">
        {error && <span className="send-error inline">{error}</span>}
        <span className="spacer" />
        {(!oneClick || request.questions[0].allowCustomAnswer !== false) && (
          <button className="question-submit" disabled={busy} onClick={() => submit()}>
            {busy ? "Sending…" : "Answer"}
          </button>
        )}
      </div>
    </div>
  );
}

export function Questions({
  requests,
  onAnswer,
}: {
  requests: PendingRequest[];
  onAnswer: (requestId: string, answers: Answers) => Promise<void>;
}) {
  if (requests.length === 0) return null;
  return (
    <div className="questions">
      {requests.map((r) => (
        <RequestCard key={r.requestId} request={r} onAnswer={(answers) => onAnswer(r.requestId, answers)} />
      ))}
    </div>
  );
}
