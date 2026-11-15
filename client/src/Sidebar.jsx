import { useState } from "react";

// The left column: the logged-in user, the upload box, and the list of the user's PDFs.
function Sidebar({ user, documents, selectedId, busy, onUpload, onSelect, onDelete, onLogout }) {
  const [file, setFile] = useState(null);

  async function handleUpload(e) {
    e.preventDefault();
    const uploaded = await onUpload(file);
    if (uploaded) {
      setFile(null);
      e.target.reset(); // clear the file input
    }
  }

  return (
    <aside className="sidebar">
      <div className="user">
        <span title={user.email}>{user.email}</span>
        <button className="link" onClick={onLogout}>Log out</button>
      </div>

      <form className="upload" onSubmit={handleUpload}>
        <input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files[0])} />
        <button type="submit" className="primary" disabled={busy || !file}>Upload PDF</button>
      </form>

      <h3>My PDFs</h3>
      {documents.length === 0 && <p className="muted">No PDFs yet. Upload one to start.</p>}
      <ul className="doc-list">
        {documents.map((d) => (
          <li key={d._id} className={d._id === selectedId ? "selected" : ""}>
            <button className="doc" onClick={() => onSelect(d._id)} disabled={busy}>
              <span className="doc-name">{d.filename}</span>
              <small className="muted">
                {d.pageCount} {d.pageCount === 1 ? "page" : "pages"}
                {d.imageCount > 0 && ` · ${d.imageCount} ${d.imageCount === 1 ? "image" : "images"}`}
                {d.scanned && " · scanned"} ·{" "}
                {new Date(d.createdAt).toLocaleDateString()}
              </small>
            </button>
            <button
              className="delete"
              title="Delete this PDF"
              onClick={() => onDelete(d)}
              disabled={busy}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}

export default Sidebar;
