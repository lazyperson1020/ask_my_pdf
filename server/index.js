// AskMyPDF server: upload a PDF, then ask questions about it.
require("dotenv").config();
const http = require("http");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const mongoose = require("mongoose");
const { PDFParse } = require("pdf-parse");
const { Document, Chunk } = require("./models");
const { Server } = require("socket.io");
const { createEmbedding, askLLM, askLLMStream } = require("./ai");
const { splitIntoChunks } = require("./chunker");
const config = require("./config");

const app = express();
const server = http.createServer(app); // Express and Socket.IO share this server
const io = new Server(server, { cors: { origin: process.env.CLIENT_URL } });
app.use(cors({ origin: process.env.CLIENT_URL }));
app.use(express.json());

// Keep uploaded files in memory only (never saved to disk). PDFs only, max 10 MB.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf") cb(null, true);
    else cb(new Error("Only PDF files are allowed."));
  },
});

// 1. Health check
app.get("/health", (req, res) => {
  res.send("ok");
});

// 2. Upload a PDF: extract text, chunk it, embed each chunk, save to MongoDB.
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Please choose a PDF file." });
    }

    // Read the text out of the PDF
    const parser = new PDFParse({ data: req.file.buffer });
    const result = await parser.getText({ pageJoiner: "" }); // no "-- 1 of 3 --" page markers
    await parser.destroy();
    const text = result.text.replace(/\s+/g, " ").trim();

    if (!text) {
      return res
        .status(400)
        .json({ error: "This PDF has no readable text (it may be a scanned image)." });
    }

    // Save the document
    const doc = await Document.create({ filename: req.file.originalname });

    // Create an embedding for each chunk and save it
    const pieces = splitIntoChunks(text);
    for (const piece of pieces) {
      const embedding = await createEmbedding(piece);
      await Chunk.create({ documentId: doc._id, text: piece, embedding });
    }

    res.json({ documentId: doc._id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Upload failed: " + err.message });
  }
});

// Check the input for a question. Returns an error message, or null if it is fine.
function checkQuestion(documentId, question) {
  if (!documentId || !question) return "documentId and question are required.";
  if (!mongoose.Types.ObjectId.isValid(documentId)) return "Invalid documentId.";
  return null;
}

// Find the 4 chunks of this document that best match the question.
async function findChunks(documentId, question, history) {
  // For follow-ups like "what about part-timers?", search with the previous question too
  const lastQuestion = history.at(-1)?.question || "";
  const questionEmbedding = await createEmbedding(`${lastQuestion} ${question}`.trim());

  return Chunk.aggregate([
    {
      $vectorSearch: {
        index: "vector_index",
        path: "embedding",
        queryVector: questionEmbedding,
        numCandidates: 100,
        limit: 4,
        filter: { documentId: new mongoose.Types.ObjectId(documentId) },
      },
    },
    { $project: { _id: 0, text: 1, score: { $meta: "vectorSearchScore" } } },
  ]);
}

const NO_ANSWER = "I don't know based on this document.";

// 3. Ask a question about an uploaded PDF (returns the full answer at once).
app.post("/ask", async (req, res) => {
  try {
    const { documentId, question, history } = req.body;
    const inputError = checkQuestion(documentId, question);
    if (inputError) return res.status(400).json({ error: inputError });

    // Keep only the last few question/answer pairs from the chat
    const recentHistory = Array.isArray(history) ? history.slice(-config.HISTORY_LIMIT) : [];
    const chunks = await findChunks(documentId, question, recentHistory);

    // No chunks found: don't call the LLM
    if (chunks.length === 0) return res.json({ answer: NO_ANSWER, sources: [] });

    // Ask the LLM using only these chunks
    const answer = await askLLM(question, chunks, recentHistory);
    res.json({ answer, sources: chunks });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong: " + err.message });
  }
});

// Socket.IO: the same question, but the answer is streamed piece by piece.
// Browser sends "ask" -> server sends "answer-chunk" (many times), then "answer-done" or "answer-error".
io.on("connection", (socket) => {
  socket.on("ask", async ({ documentId, question, history } = {}) => {
    try {
      const inputError = checkQuestion(documentId, question);
      if (inputError) return socket.emit("answer-error", inputError);

      const recentHistory = Array.isArray(history) ? history.slice(-config.HISTORY_LIMIT) : [];
      const chunks = await findChunks(documentId, question, recentHistory);

      // No chunks found: don't call the LLM
      if (chunks.length === 0) {
        socket.emit("answer-chunk", NO_ANSWER);
        return socket.emit("answer-done", []);
      }

      // Send each piece of the answer to the browser as soon as it arrives
      await askLLMStream(question, chunks, recentHistory, (text) => {
        socket.emit("answer-chunk", text);
      });
      socket.emit("answer-done", chunks); // the sources
    } catch (err) {
      console.error(err);
      socket.emit("answer-error", "Something went wrong: " + err.message);
    }
  });
});

// Handle upload errors (wrong file type, file too large)
app.use((err, req, res, next) => {
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({ error: "File is too large (max 10 MB)." });
  }
  res.status(400).json({ error: err.message });
});

// Connect to MongoDB, then start the server
async function start() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB");
    const port = process.env.PORT || 5000;
    // e.g. the port is already used by another server
    server.on("error", (err) => {
      console.error("Could not start server:", err.message);
      process.exit(1);
    });
    server.listen(port, () => console.log(`Server running on http://localhost:${port}`));
  } catch (err) {
    console.error("Could not connect to MongoDB:", err.message);
  }
}

start();
