# AskMyPDF

Create an account, upload PDFs and chat with them. Answers come only from the PDF's text, the app shows the parts of the PDF it used, and you can ask follow-up questions.

Built with React (Vite), Node.js, Express, Server-Sent Events, MongoDB Atlas (Vector Search) and the Gemini API.

## Features

- Sign up and log in (passwords hashed with bcrypt, sessions with JWT tokens)
- Each user has their own PDFs: upload (max 10 MB), list, open and delete them
- Answers use only the PDF's content, with source chunks and similarity scores
- Chats are saved in MongoDB, so they are still there after a refresh or the next login; "Clear chat" starts over
- Follow-up questions that use the earlier chat
- Answers stream in piece by piece (Server-Sent Events)
- Sentence-aware chunking with overlap
- Reads images too: charts, diagrams and photos are described by Gemini, and scanned PDFs are read page by page
- MCP server, so AI assistants like Claude can search and ask your PDFs

## Project structure

```
ask_my_pdf/
├── client/                 React app (Vite)
│   └── src/
│       ├── App.jsx         Shows the login page or the main page
│       ├── AuthPage.jsx    Log in / sign up form
│       ├── MainPage.jsx    Logged-in page: holds the PDFs and the chat
│       ├── Sidebar.jsx     Your account, upload, "My PDFs" list
│       ├── ChatPanel.jsx   The chat with answers and sources
│       └── api.js          All requests to the server (+ reading the SSE stream)
├── server/
│   ├── index.js            Starts Express and connects the routes
│   ├── routes/
│   │   ├── auth.js         POST /auth/signup, POST /auth/login, GET /auth/me
│   │   ├── documents.js    Upload, list and delete PDFs; saved chats
│   │   └── ask.js          Vector search + answers (normal and streamed)
│   ├── auth.js             JWT helpers and the requireAuth middleware
│   ├── ai.js               All Gemini calls (embeddings, answers)
│   ├── chunker.js          Splits text into overlapping chunks
│   ├── models.js           Mongoose models: User, Document, Chunk, Message
│   ├── config.js           Models, embedding size, chunk size, login settings
│   ├── cosine.js           Cosine similarity example (for learning)
│   └── .env.example        Environment variables template
├── mcp/
│   └── server.js           MCP server (tools for AI assistants)
└── sample.pdf              Small PDF to try the app with
```

## How login works

1. **Sign up:** `server/routes/auth.js` hashes the password with bcrypt and saves only the hash in the `users` collection.
2. **Token:** after sign up or log in, the server returns a JWT (a signed string that says "this is user X", valid for 7 days). The page keeps it in `localStorage`.
3. **Every request:** the page sends `Authorization: Bearer <token>`. The `requireAuth` middleware in `server/auth.js` checks it and sets `req.userId`.
4. **Your data only:** every PDF is saved with its `userId`, and every route looks PDFs up by id *and* `userId`, so you can't see, ask about or delete someone else's PDF (you get `404`).

## How RAG and vector search work here

1. **Upload:** `server/routes/documents.js` pulls the text out of the PDF, and `server/chunker.js` packs whole sentences into chunks of up to 500 characters, with about 50 characters (whole words) of overlap between chunks.
   **Images:** the PDF is also sent to Gemini (`readPdfVisuals` in `server/ai.js`), which returns a description of every chart, diagram, photo or picture-table, with its page number. Each description becomes its own chunk starting with `[Image, page N]`, so questions like "which region sold the most?" can be answered from a chart. If the PDF has no text layer (a scan), Gemini also reads the text of each page. If the image step fails for a normal PDF, the upload still works with just the text and the page shows a warning.
2. **Embed:** `server/ai.js` turns each chunk into an embedding, a list of 768 numbers that captures its meaning, and saves it in MongoDB.
3. **Search:** When you ask a question, the question (plus your previous question, for follow-ups) is embedded the same way, and `$vectorSearch` finds the 4 chunks whose vectors are closest to it (cosine similarity, see `server/cosine.js`).
4. **Augment:** Those 4 chunks are pasted into the prompt as "context", together with your question and the last 3 questions and answers of the chat (loaded from the `messages` collection).
5. **Generate:** Gemini writes a short answer using only that context. The answer is streamed to the page piece by piece with Server-Sent Events, and the chunks are sent back as sources. The question, answer and sources are saved as a message.

## Before you start

- **Node.js** 18 or newer
- **MongoDB Atlas** account with a cluster (the free M0 tier works). You need its connection string.
- **Gemini API key** from https://aistudio.google.com/apikey

## 1. Set up the server

```bash
cd server
npm install
cp .env.example .env
```

Fill in `server/.env`:

```
MONGO_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/askmypdf
GEMINI_API_KEY=your-gemini-api-key
PORT=5000
CLIENT_URL=http://localhost:5173
JWT_SECRET=a-long-random-string
```

`JWT_SECRET` signs the login tokens. Use a long random value and keep it secret, for example the output of:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

In Atlas, open **Network Access** and allow your IP address.

## 2. Create the Atlas Vector Search index

Sign up and upload one PDF first so that the `askmypdf` database and the `chunks` collection exist. (You can also create the collection by hand in Atlas.)

1. In Atlas, open your cluster and click **Atlas Search** (called **Search & Vector Search** in some versions).
2. Click **Create Search Index**, choose **Vector Search**, then the **JSON Editor**.
3. Pick the database `askmypdf` and the collection `chunks`.
4. Name the index **`vector_index`** and paste this JSON:

```json
{
  "fields": [
    {
      "type": "vector",
      "path": "embedding",
      "numDimensions": 768,
      "similarity": "cosine"
    },
    {
      "type": "filter",
      "path": "documentId"
    }
  ]
}
```

5. Click **Create** and wait until the status shows **Active** (usually under a minute).

`numDimensions` must equal `EMBEDDING_DIMENSIONS` in `server/config.js`. If you change one, change the other, then delete your old chunks and upload the PDFs again.

## 3. Run the app

In two terminals:

```bash
# Terminal 1
cd server
npm start          # http://localhost:5000
```

```bash
# Terminal 2
cd client
npm install
npm run dev        # http://localhost:5173
```

Open http://localhost:5173, create an account, upload a PDF (try `sample.pdf`), wait for "PDF ready", and ask a question, for example "How many vacation days do full-time employees get?"

**Note:** Atlas needs a few seconds to index new chunks after an upload. If your first question returns "I don't know based on this document." right after uploading, wait 5 to 10 seconds and ask again.

## Deploy (Render)

The server also serves the built React app, so the whole project deploys as one web service.

1. In Atlas → Network Access, allow access from anywhere (`0.0.0.0/0`).
2. On https://render.com create a **Web Service** from this repo:
   - Build Command: `npm run build`
   - Start Command: `npm start`
   - Environment variables: `MONGO_URI`, `GEMINI_API_KEY`, `JWT_SECRET`, `CLIENT_URL` (your Render URL). Render sets `PORT` itself.
3. Every push to `main` redeploys the site. On the free plan the app sleeps when idle, so the first visit can take up to a minute.

## API

Every route except `/health`, `/auth/signup` and `/auth/login` needs the header `Authorization: Bearer <token>`. Without a valid token you get `401`. A PDF that isn't yours gives `404`.

| Method | Route | Body | Returns |
| ------ | ----- | ---- | ------- |
| GET    | `/health` | | `ok` |
| POST   | `/auth/signup` | `{ email, password }` (password ≥ 8 chars) | `{ token, user }` |
| POST   | `/auth/login` | `{ email, password }` | `{ token, user }` |
| GET    | `/auth/me` | | `{ user }` |
| GET    | `/documents` | | `{ documents: [{ _id, filename, pageCount, chunkCount, createdAt }] }` |
| POST   | `/documents` | form-data `file` (PDF, ≤10 MB) | `{ document, warning }` (`document` has `imageCount` and `scanned`) |
| DELETE | `/documents/:id` | | `{ ok: true }` (also deletes its chunks and chat) |
| GET    | `/documents/:id/messages` | | `{ messages: [{ question, answer, sources, createdAt }] }` |
| DELETE | `/documents/:id/messages` | | `{ ok: true }` (clears the chat) |
| POST   | `/ask` | `{ documentId, question }` | `{ answer, sources: [{ text, score }] }` |
| POST   | `/ask/search` | `{ documentId, query }` | `{ sources: [{ text, score, kind, page }] }` (vector search only, nothing saved) |
| POST   | `/ask/stream` | `{ documentId, question }` | event stream (see below) |

The server reads the earlier chat from the database itself, so you only send the new question. Every answer is saved to the PDF's chat.

### Server-Sent Events (streamed answers)

The page asks questions with `POST /ask/stream` (same body as `/ask`), so the answer appears while Gemini is still writing it. The response is a `text/event-stream`:

| Event   | Data                                  |
| ------- | ------------------------------------- |
| `chunk` | the next piece of the answer (text)   |
| `done`  | the sources `[{ text, score }]`       |
| `error` | an error message                      |

Every `data:` line is JSON. The browser's `EventSource` only supports GET requests, so the page reads the stream with `fetch` instead (see `readEvents` in `client/src/App.jsx`). Bad input (missing `documentId` or `question`) gets a normal `400` JSON error instead of a stream.

`POST /ask` still works and returns the full answer at once (handy for testing with curl). To watch the stream in a terminal (get a token from `/auth/login` first):

```bash
curl -N -X POST http://localhost:5000/ask/stream \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"documentId":"<id>","question":"How many vacation days?"}'
```

## MCP server (use your PDFs from Claude)

`mcp/server.js` is a [Model Context Protocol](https://modelcontextprotocol.io) server. It lets AI assistants such as Claude Code or Claude Desktop use your AskMyPDF account as tools. It logs in with your account and calls the normal REST API, so you only ever see your own PDFs.

| Tool | What it does |
| ---- | ------------ |
| `list_documents` | Lists your PDFs with their ids |
| `search_document` | Vector search in one PDF: the 4 best passages with scores (no Gemini call) |
| `ask_document` | AskMyPDF's own grounded answer plus sources (saved to that PDF's chat) |
| `upload_pdf` | Uploads a PDF from your computer |

Set it up:

```bash
cd mcp
npm install
```

Add it to **Claude Code** (use your deployed URL, or `http://localhost:5000` while the server runs locally):

```bash
claude mcp add askmypdf \
  -e ASKMYPDF_URL=http://localhost:5000 \
  -e ASKMYPDF_EMAIL=you@example.com \
  -e ASKMYPDF_PASSWORD=your-password \
  -- node /full/path/to/ask_my_pdf/mcp/server.js
```

Or add it to **Claude Desktop** in `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "askmypdf": {
      "command": "node",
      "args": ["/full/path/to/ask_my_pdf/mcp/server.js"],
      "env": {
        "ASKMYPDF_URL": "http://localhost:5000",
        "ASKMYPDF_EMAIL": "you@example.com",
        "ASKMYPDF_PASSWORD": "your-password"
      }
    }
  }
}
```

Then ask things like *"List my PDFs and tell me what the handbook says about vacation days."*

To debug it, run `npx @modelcontextprotocol/inspector node mcp/server.js` (with the same environment variables) to call the tools by hand.
