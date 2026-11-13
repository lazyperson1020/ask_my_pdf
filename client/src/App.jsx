import { useEffect, useState } from "react";
import { io } from "socket.io-client";

// Address of our Express server: localhost while developing, the site itself once deployed
const API_URL = import.meta.env.DEV ? "http://localhost:5000" : window.location.origin;

// One Socket.IO connection to the server, used to stream answers
const socket = io(API_URL);

function App() {
  const [file, setFile] = useState(null);
  const [documentId, setDocumentId] = useState(null);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState([]); // chat history: [{ question, answer, sources }]
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Change the last message in the chat (the one being answered right now)
  function updateLastMessage(change) {
    setMessages((prev) => [...prev.slice(0, -1), change(prev[prev.length - 1])]);
  }

  // Listen for the streamed answer from the server
  useEffect(() => {
    // A new piece of the answer arrived: add it to the end
    socket.on("answer-chunk", (text) => {
      updateLastMessage((m) => ({ ...m, answer: m.answer + text }));
    });
    // The answer is finished: save the sources
    socket.on("answer-done", (sources) => {
      updateLastMessage((m) => ({ ...m, sources }));
      setLoading(false);
    });
    // Something went wrong: show the error and remove the unfinished message
    socket.on("answer-error", (message) => {
      setError(message);
      setMessages((prev) => prev.slice(0, -1));
      setLoading(false);
    });
    // Stop listening when the component is removed
    return () => {
      socket.off("answer-chunk");
      socket.off("answer-done");
      socket.off("answer-error");
    };
  }, []);

  // Send the PDF to the server
  async function handleUpload() {
    if (!file) return setError("Please choose a PDF first.");
    setLoading(true);
    setError("");
    setDocumentId(null);
    setMessages([]); // new PDF = new chat
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`${API_URL}/upload`, { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setDocumentId(data.documentId);
    } catch (err) {
      setError(err.message || "Upload failed.");
    }
    setLoading(false);
  }

  // Send the question (and the chat so far) to the server over the socket
  function handleAsk(e) {
    e.preventDefault(); // stop the form from reloading the page
    if (!question.trim()) return setError("Please type a question.");
    if (!socket.connected) return setError("Not connected to the server.");
    setLoading(true);
    setError("");

    // The server only needs the questions and answers, not the sources
    const history = messages.map((m) => ({ question: m.question, answer: m.answer }));
    socket.emit("ask", { documentId, question, history });

    // Add the new message with an empty answer; the streamed pieces will fill it in
    setMessages([...messages, { question, answer: "", sources: [] }]);
    setQuestion("");
  }

  return (
    <div className="container">
      <h1>AskMyPDF</h1>

      <div className="row">
        <input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files[0])} />
        <button onClick={handleUpload} disabled={loading}>Upload</button>
      </div>

      {documentId && <p className="ready">PDF ready</p>}

      {/* The chat: every question with its answer and sources */}
      {messages.map((m, i) => (
        <div className="message" key={i}>
          <p className="question">{m.question}</p>
          {m.answer && <div className="answer">{m.answer}</div>}
          {m.sources.length > 0 && (
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

      {loading && <p>Loading...</p>}
      {error && <p className="error">{error}</p>}

      {documentId && (
        <form className="row" onSubmit={handleAsk}>
          <input
            type="text"
            placeholder="Ask a question about your PDF"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <button type="submit" disabled={loading}>Ask</button>
        </form>
      )}
    </div>
  );
}

export default App;
