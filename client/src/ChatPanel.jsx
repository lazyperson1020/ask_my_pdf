import { useEffect, useRef, useState } from "react";

// The right column: the chat for the selected PDF and the question box.
function ChatPanel({ doc, messages, loadingChat, busy, onAsk, onClear }) {
  const [question, setQuestion] = useState("");
  const bottomRef = useRef(null);

  // Keep the newest message in view as the answer streams in
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  if (!doc) {
    return (
      <main className="chat empty">
        <p className="muted">Upload a PDF or pick one from the list to start chatting.</p>
      </main>
    );
  }

  function handleSubmit(e) {
    e.preventDefault(); // stop the form from reloading the page
    if (!question.trim()) return;
    onAsk(question.trim());
    setQuestion("");
  }

  return (
    <main className="chat">
      <div className="chat-header">
        <h2 title={doc.filename}>{doc.filename}</h2>
        {messages.length > 0 && (
          <button className="link" onClick={onClear} disabled={busy}>Clear chat</button>
        )}
      </div>

      <div className="messages">
        {loadingChat && <p className="muted">Loading chat...</p>}
        {!loadingChat && messages.length === 0 && (
          <p className="muted">Ask anything about this PDF. Answers only use what is in it.</p>
        )}

        {/* Every question with its answer and sources */}
        {messages.map((m, i) => (
          <div className="message" key={m._id || i}>
            <p className="question">{m.question}</p>
            <div className="answer">{m.answer || <span className="muted">Thinking...</span>}</div>
            {m.sources?.length > 0 && (
              <details>
                <summary>Sources ({m.sources.length})</summary>
                {m.sources.map((s, j) => (
                  <div className="source" key={j}>
                    <small>Score: {s.score.toFixed(3)}</small>
                    <p>{s.text}</p>
                  </div>
                ))}
              </details>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <form className="row ask" onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="Ask a question about your PDF"
          maxLength={1000}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <button type="submit" className="primary" disabled={busy || !question.trim()}>Ask</button>
      </form>
    </main>
  );
}

export default ChatPanel;
