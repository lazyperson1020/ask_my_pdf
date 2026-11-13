# AskMyPDF

Upload a PDF and chat with it. Answers come only from the PDF's text, the app shows the parts of the PDF it used, and you can ask follow-up questions.

Built with React (Vite), Node.js, Express, Socket.IO, MongoDB Atlas (Vector Search) and the Gemini API.

## Features

- Upload a PDF (max 10 MB) and ask questions about it
- Answers use only the PDF's content, with source chunks and similarity scores
- Follow-up questions that use the earlier chat
- Answers stream in word by word (Socket.IO)
- Sentence-aware chunking with overlap

## Project structure

```
ask_my_pdf/
├── client/               React app (Vite)
│   └── src/App.jsx       The whole page: upload, chat, sources
├── server/
│   ├── index.js          Express routes + Socket.IO streaming
│   ├── ai.js             All Gemini calls (embeddings, answers)
│   ├── chunker.js        Splits text into overlapping chunks
│   ├── models.js         Mongoose models: Document, Chunk
│   ├── config.js         Models, embedding size, chunk size
│   ├── cosine.js         Cosine similarity example (for learning)
│   └── .env.example      Environment variables template
└── sample.pdf            Small PDF to try the app with
```

## How RAG and vector search work here

1. **Upload:** `server/index.js` pulls the text out of the PDF, and `server/chunker.js` packs whole sentences into chunks of up to 500 characters, with about 50 characters (whole words) of overlap between chunks.
2. **Embed:** `server/ai.js` turns each chunk into an embedding, a list of 768 numbers that captures its meaning, and saves it in MongoDB.
3. **Search:** When you ask a question, the question (plus your previous question, for follow-ups) is embedded the same way, and `$vectorSearch` finds the 4 chunks whose vectors are closest to it (cosine similarity, see `server/cosine.js`).
4. **Augment:** Those 4 chunks are pasted into the prompt as "context", together with your question and the last 3 questions and answers of the chat.
5. **Generate:** Gemini writes a short answer using only that context. The answer is streamed to the page piece by piece over Socket.IO, and the chunks are sent back as sources.

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
```

In Atlas, open **Network Access** and allow your IP address.

## 2. Create the Atlas Vector Search index

Upload one PDF first so that the `askmypdf` database and the `chunks` collection exist. (You can also create the collection by hand in Atlas.)

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

Open http://localhost:5173, upload a PDF (try `sample.pdf`), wait for "PDF ready", and ask a question, for example "How many vacation days do full-time employees get?"

**Note:** Atlas needs a few seconds to index new chunks after an upload. If your first question returns "I don't know based on this document." right after uploading, wait 5 to 10 seconds and ask again.

## Deploy (Render)

The server also serves the built React app, so the whole project deploys as one web service.

1. In Atlas → Network Access, allow access from anywhere (`0.0.0.0/0`).
2. On https://render.com create a **Web Service** from this repo:
   - Build Command: `npm run build`
   - Start Command: `npm start`
   - Environment variables: `MONGO_URI`, `GEMINI_API_KEY`, `CLIENT_URL` (your Render URL). Render sets `PORT` itself.
3. Every push to `main` redeploys the site. On the free plan the app sleeps when idle, so the first visit can take up to a minute.

## API

| Method | Route     | Body                         | Returns                         |
| ------ | --------- | ---------------------------- | ------------------------------- |
| GET    | `/health` |                              | `ok`                            |
| POST   | `/upload` | form-data `file` (PDF, ≤10 MB) | `{ documentId }`              |
| POST   | `/ask`    | `{ documentId, question, history }` | `{ answer, sources: [{ text, score }] }` |

`history` is optional: a list of earlier `{ question, answer }` pairs. The chat lives in the browser only, so it resets when you refresh the page or upload a new PDF.

### Socket.IO (streamed answers)

The page asks questions over Socket.IO so the answer appears while Gemini is still writing it.

| Direction | Event | Data |
| --------- | ----- | ---- |
| browser → server | `ask` | `{ documentId, question, history }` |
| server → browser | `answer-chunk` | the next piece of the answer (text) |
| server → browser | `answer-done` | the sources `[{ text, score }]` |
| server → browser | `answer-error` | an error message |

`POST /ask` still works and returns the full answer at once (handy for testing with curl).
