// Ask a question about one of your PDFs. The answer is saved to the PDF's chat.
const express = require("express");
const mongoose = require("mongoose");
const { Document, Chunk, Message } = require("../models");
const { requireAuth } = require("../auth");
const { createEmbedding, askLLM, askLLMStream, isRateLimit } = require("../ai");
const config = require("../config");

const router = express.Router();
router.use(requireAuth);

const NO_ANSWER = "I don't know based on this document.";

// Check the question and load the user's document.
// Returns { error, status } if something is wrong, or { doc, question, history } if it is fine.
async function prepareQuestion(req) {
  const { documentId } = req.body;
  const question = typeof req.body.question === "string" ? req.body.question.trim() : "";
  if (!documentId || !question) return { status: 400, error: "documentId and question are required." };
  if (question.length > config.MAX_QUESTION_LENGTH) {
    return { status: 400, error: `Questions can be at most ${config.MAX_QUESTION_LENGTH} characters.` };
  }

  const doc = await Document.findOwned(documentId, req.userId);
  if (!doc) return { status: 404, error: "PDF not found." };

  // The last few questions and answers of this chat, oldest first, so follow-ups make sense
  const recent = await Message.find({ documentId: doc._id })
    .sort({ createdAt: -1 })
    .limit(config.HISTORY_LIMIT);
  const history = recent.reverse().map((m) => ({ question: m.question, answer: m.answer }));

  return { doc, question, history };
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
    { $project: { _id: 0, text: 1, kind: 1, page: 1, score: { $meta: "vectorSearchScore" } } },
  ]);
}

// Turn an error into a short message for the user
function errorMessage(err) {
  if (isRateLimit(err)) return "The AI usage limit was reached. Please try again later.";
  return "Something went wrong: " + err.message;
}

// POST /ask  { documentId, question } -> { answer, sources }  (the full answer at once)
router.post("/", async (req, res) => {
  try {
    const { error, status, doc, question, history } = await prepareQuestion(req);
    if (error) return res.status(status).json({ error });

    const chunks = await findChunks(doc._id, question, history);
    // No chunks found: don't call the LLM
    const answer = chunks.length ? await askLLM(question, chunks, history) : NO_ANSWER;

    await Message.create({ documentId: doc._id, question, answer, sources: chunks });
    res.json({ answer, sources: chunks });
  } catch (err) {
    console.error(err);
    res.status(isRateLimit(err) ? 429 : 500).json({ error: errorMessage(err) });
  }
});

// POST /ask/search  { documentId, query } -> { sources }
// Only the vector search: no LLM call and nothing is saved to the chat.
// Used by the MCP server, so an AI assistant can read the best passages and answer itself.
router.post("/search", async (req, res) => {
  try {
    const query = typeof req.body.query === "string" ? req.body.query.trim() : "";
    if (!req.body.documentId || !query) {
      return res.status(400).json({ error: "documentId and query are required." });
    }
    if (query.length > config.MAX_QUESTION_LENGTH) {
      return res.status(400).json({ error: `Queries can be at most ${config.MAX_QUESTION_LENGTH} characters.` });
    }

    const doc = await Document.findOwned(req.body.documentId, req.userId);
    if (!doc) return res.status(404).json({ error: "PDF not found." });

    res.json({ sources: await findChunks(doc._id, query, []) });
  } catch (err) {
    console.error(err);
    res.status(isRateLimit(err) ? 429 : 500).json({ error: errorMessage(err) });
  }
});

// POST /ask/stream  { documentId, question } -> the answer streamed with Server-Sent Events.
// The response stays open and the server writes events to it:
// "chunk" (many times, a piece of the answer), then "done" (the sources) or "error".
router.post("/stream", async (req, res) => {
  let prepared;
  try {
    prepared = await prepareQuestion(req);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: errorMessage(err) });
  }
  const { error, status, doc, question, history } = prepared;
  if (error) return res.status(status).json({ error });

  // Tell the browser this is an event stream, and send the headers right away
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();

  // One SSE event: "event: <name>" + "data: <JSON>" + a blank line
  function send(event, data) {
    if (res.writableEnded || res.destroyed) return; // the browser has gone away
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  try {
    const chunks = await findChunks(doc._id, question, history);
    let answer = "";

    if (chunks.length === 0) {
      // No chunks found: don't call the LLM
      answer = NO_ANSWER;
      send("chunk", answer);
    } else {
      // Send each piece of the answer to the browser as soon as it arrives
      await askLLMStream(question, chunks, history, (text) => {
        answer += text;
        send("chunk", text);
      });
    }

    // Save the finished answer to the chat, then tell the browser we're done
    await Message.create({ documentId: doc._id, question, answer, sources: chunks });
    send("done", chunks); // the sources
  } catch (err) {
    console.error(err);
    send("error", errorMessage(err));
  }
  res.end();
});

module.exports = router;
