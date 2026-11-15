import { useEffect, useRef, useState } from "react";
import { api, askStream } from "./api";
import Sidebar from "./Sidebar";
import ChatPanel from "./ChatPanel";

// The page you see once you are logged in: your PDFs on the left, the chat on the right.
function MainPage({ user, onLogout }) {
  const [documents, setDocuments] = useState([]); // the user's PDFs, newest first
  const [selectedId, setSelectedId] = useState(null); // the PDF we are chatting with
  const [messages, setMessages] = useState([]); // its chat: [{ question, answer, sources }]
  const [loadingChat, setLoadingChat] = useState(false);
  const [busy, setBusy] = useState(false); // true while uploading, answering or deleting
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const openRequest = useRef(0); // counts chat loads, so a slow old one can't overwrite a newer one

  const selectedDoc = documents.find((d) => d._id === selectedId) || null;

  // Open a PDF (or none, with null) and load its saved chat
  function openDocument(id) {
    setSelectedId(id);
    setMessages([]);
    if (!id) return;
    const request = ++openRequest.current;
    setLoadingChat(true);
    api(`/documents/${id}/messages`)
      .then((data) => request === openRequest.current && setMessages(data.messages))
      .catch((err) => request === openRequest.current && setError(err.message))
      .finally(() => request === openRequest.current && setLoadingChat(false));
  }

  // Load the user's PDFs once, and open the newest one
  useEffect(() => {
    api("/documents")
      .then((data) => {
        setDocuments(data.documents);
        if (data.documents.length > 0) openDocument(data.documents[0]._id);
      })
      .catch((err) => setError(err.message));
  }, []);

  // Change the last message in the chat (the one being answered right now)
  function updateLastMessage(change) {
    setMessages((prev) => [...prev.slice(0, -1), change(prev[prev.length - 1])]);
  }

  // Upload a PDF, add it to the list and open it. Returns true if it worked.
  async function handleUpload(file) {
    setBusy(true);
    setError("");
    setStatus("Reading your PDF... this can take a little while for big files.");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const data = await api("/documents", { method: "POST", body: formData });
      setDocuments((prev) => [data.document, ...prev]);
      openDocument(data.document._id);
      setStatus("PDF ready. Ask a question below.");
      if (data.warning) setError(data.warning); // e.g. the images could not be read
      return true;
    } catch (err) {
      setError(err.message);
      setStatus("");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function handleSelect(id) {
    if (id !== selectedId) openDocument(id);
    setError("");
    setStatus("");
  }

  // Delete a PDF (with its chat) after asking first
  async function handleDelete(doc) {
    if (!window.confirm(`Delete "${doc.filename}" and its chat?`)) return;
    setBusy(true);
    setError("");
    try {
      await api(`/documents/${doc._id}`, { method: "DELETE" });
      setDocuments((prev) => prev.filter((d) => d._id !== doc._id));
      if (doc._id === selectedId) openDocument(null);
      setStatus("");
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  // Ask a question; the answer streams into the last message
  async function handleAsk(question) {
    setBusy(true);
    setError("");
    setStatus("");
    // Add the new message with an empty answer; the streamed pieces will fill it in
    setMessages((prev) => [...prev, { question, answer: "", sources: [] }]);
    try {
      const sources = await askStream(selectedId, question, (text) => {
        updateLastMessage((m) => ({ ...m, answer: m.answer + text }));
      });
      updateLastMessage((m) => ({ ...m, sources }));
    } catch (err) {
      // Show the error and remove the unfinished message
      setError(err.message);
      setMessages((prev) => prev.slice(0, -1));
    }
    setBusy(false);
  }

  // Delete every message in this PDF's chat
  async function handleClear() {
    if (!window.confirm("Clear this chat? The PDF stays.")) return;
    setError("");
    try {
      await api(`/documents/${selectedId}/messages`, { method: "DELETE" });
      setMessages([]);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="layout">
      <Sidebar
        user={user}
        documents={documents}
        selectedId={selectedId}
        busy={busy}
        onUpload={handleUpload}
        onSelect={handleSelect}
        onDelete={handleDelete}
        onLogout={onLogout}
      />
      <div className="main">
        {status && <p className="status">{status}</p>}
        {error && <p className="error">{error}</p>}
        <ChatPanel
          doc={selectedDoc}
          messages={messages}
          loadingChat={loadingChat}
          busy={busy}
          onAsk={handleAsk}
          onClear={handleClear}
        />
      </div>
    </div>
  );
}

export default MainPage;
