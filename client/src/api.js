// Everything that talks to our Express server is in this file.

// Address of our Express server: localhost while developing, the site itself once deployed
const API_URL = import.meta.env.DEV ? "http://localhost:5000" : window.location.origin;

// The login token is kept in localStorage so you stay logged in after a refresh
const TOKEN_KEY = "askmypdf-token";
export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (token) => localStorage.setItem(TOKEN_KEY, token);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

// Called when the server says our token is no longer valid (App.jsx sets it)
let onLoggedOut = () => {};
export function setLoggedOutHandler(handler) {
  onLoggedOut = handler;
}

// fetch() with the login token added. body can be an object (sent as JSON) or FormData.
async function send(path, { method = "GET", body } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(body);
  }

  const res = await fetch(API_URL + path, { method, headers, body });
  if (res.status === 401 && token) {
    // Session expired: forget the token and go back to the login page
    clearToken();
    onLoggedOut();
  }
  return res;
}

// A normal request: returns the JSON reply, or throws an Error with the server's message
export async function api(path, options) {
  const res = await send(path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return data;
}

// Read a Server-Sent Events stream from a fetch response.
// Events look like "event: chunk\ndata: <JSON>\n\n"; onEvent(name, data) is called for each one.
async function readEvents(res, onEvent) {
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    const events = buffer.split("\n\n");
    buffer = events.pop(); // the last part may be an event that is not complete yet
    for (const block of events) {
      let name = "message";
      let data = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event: ")) name = line.slice(7);
        else if (line.startsWith("data: ")) data += line.slice(6);
      }
      if (data) onEvent(name, JSON.parse(data));
    }
  }
}

// Ask a question and get the answer streamed in. onText is called with each new piece.
// Returns the sources once the answer is finished; throws an Error if something goes wrong.
export async function askStream(documentId, question, onText) {
  const res = await send("/ask/stream", { method: "POST", body: { documentId, question } });
  // Bad input is answered with normal JSON, not a stream
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed (${res.status}).`);
  }

  let sources = null;
  await readEvents(res, (event, data) => {
    if (event === "chunk") onText(data);
    else if (event === "done") sources = data;
    else if (event === "error") throw new Error(data);
  });
  if (!sources) throw new Error("The connection to the server was lost.");
  return sources;
}
