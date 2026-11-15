// A user's PDFs: upload, list, delete, and their saved chats.
const express = require("express");
const multer = require("multer");
const { PDFParse } = require("pdf-parse");
const { Document, Chunk, Message } = require("../models");
const { requireAuth } = require("../auth");
const { createEmbedding, readPdfVisuals, isRateLimit } = require("../ai");
const { splitIntoChunks } = require("../chunker");

const router = express.Router();
router.use(requireAuth); // every route here needs a logged-in user

// Keep uploaded files in memory only (never saved to disk). PDFs only, max 10 MB.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf") cb(null, true);
    else cb(new Error("Only PDF files are allowed."));
  },
});

// The fields of a document the page shows in the "My PDFs" list
const LIST_FIELDS = "filename pageCount chunkCount imageCount scanned createdAt";

// GET /documents -> the user's PDFs, newest first
router.get("/", async (req, res) => {
  try {
    const documents = await Document.find({ userId: req.userId })
      .sort({ createdAt: -1 })
      .select(LIST_FIELDS);
    res.json({ documents });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load your PDFs." });
  }
});

// Squash all whitespace (new lines, double spaces) into single spaces
const clean = (text) => text.replace(/\s+/g, " ").trim();

// Turn the PDF into the pieces we embed: [{ text, kind, page }].
// The text layer gives the normal text. Gemini looks at the pages to describe images, and
// for scanned PDFs (no text layer) it also reads the text. Returns { pieces, ...info }.
async function extractPieces(pdfBuffer) {
  const parser = new PDFParse({ data: pdfBuffer });
  const result = await parser.getText({ pageJoiner: "" }); // no "-- 1 of 3 --" page markers
  await parser.destroy();
  const text = clean(result.text);
  const scanned = !text;

  let visuals = [];
  let warning = null;
  try {
    visuals = await readPdfVisuals(pdfBuffer, scanned);
  } catch (err) {
    if (scanned) {
      // Without Gemini a scanned PDF has nothing we can use, so the upload fails
      if (isRateLimit(err)) throw err;
      throw new Error("This PDF looks scanned, and its pages could not be read.");
    }
    // A normal PDF still works without the images: keep going with just the text
    console.error("Could not read the PDF's images:", err.message);
    warning = isRateLimit(err)
      ? "The AI usage limit was reached, so images in this PDF were skipped. Only its text was used."
      : "Images in this PDF could not be read. Only its text was used.";
  }

  const pieces = [];
  // Normal text: chunked like before
  if (text) {
    for (const chunk of splitIntoChunks(text)) pieces.push({ text: chunk, kind: "text" });
  }
  // Scanned text, page by page, so each chunk knows its page
  for (const v of visuals.filter((v) => v.kind === "text" && scanned)) {
    for (const chunk of splitIntoChunks(clean(v.content))) {
      pieces.push({ text: chunk, kind: "text", page: v.page });
    }
  }
  // Image descriptions, marked so the LLM (and the user) can tell they describe a picture
  const images = visuals.filter((v) => v.kind === "image");
  for (const v of images) {
    for (const chunk of splitIntoChunks(clean(v.content))) {
      pieces.push({ text: `[Image, page ${v.page}] ${chunk}`, kind: "image", page: v.page });
    }
  }

  return { pieces, pageCount: result.total, imageCount: images.length, scanned, warning };
}

// POST /documents  form-data "file" -> { document, warning }
// Read the PDF (text + images), chunk it, embed each chunk, and save everything to MongoDB.
router.post("/", upload.single("file"), async (req, res) => {
  let doc = null;
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Please choose a PDF file." });
    }

    const { pieces, pageCount, imageCount, scanned, warning } = await extractPieces(req.file.buffer);
    if (pieces.length === 0) {
      return res.status(400).json({ error: "No text or images could be read from this PDF." });
    }

    doc = await Document.create({
      userId: req.userId,
      filename: req.file.originalname,
      pageCount,
      chunkCount: pieces.length,
      imageCount,
      scanned,
    });

    // Create an embedding for each piece and save it
    for (const piece of pieces) {
      const embedding = await createEmbedding(piece.text);
      await Chunk.create({ documentId: doc._id, ...piece, embedding });
    }

    res.status(201).json({ document: await Document.findById(doc._id).select(LIST_FIELDS), warning });
  } catch (err) {
    console.error(err);
    // Don't leave a half-processed PDF behind
    if (doc) {
      await Chunk.deleteMany({ documentId: doc._id });
      await Document.deleteOne({ _id: doc._id });
    }
    if (isRateLimit(err)) {
      return res.status(429).json({ error: "The AI usage limit was reached. Please try again later." });
    }
    res.status(500).json({ error: "Upload failed: " + err.message });
  }
});

// DELETE /documents/:id -> removes the PDF, its chunks and its chat
router.delete("/:id", async (req, res) => {
  try {
    const doc = await Document.findOwned(req.params.id, req.userId);
    if (!doc) return res.status(404).json({ error: "PDF not found." });

    await Chunk.deleteMany({ documentId: doc._id });
    await Message.deleteMany({ documentId: doc._id });
    await doc.deleteOne();
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not delete the PDF." });
  }
});

// GET /documents/:id/messages -> the saved chat for this PDF, oldest first
router.get("/:id/messages", async (req, res) => {
  try {
    const doc = await Document.findOwned(req.params.id, req.userId);
    if (!doc) return res.status(404).json({ error: "PDF not found." });

    const messages = await Message.find({ documentId: doc._id }).sort({ createdAt: 1 });
    res.json({ messages });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load the chat." });
  }
});

// DELETE /documents/:id/messages -> clears the chat (the PDF stays)
router.delete("/:id/messages", async (req, res) => {
  try {
    const doc = await Document.findOwned(req.params.id, req.userId);
    if (!doc) return res.status(404).json({ error: "PDF not found." });

    await Message.deleteMany({ documentId: doc._id });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not clear the chat." });
  }
});

module.exports = router;
