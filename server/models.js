// Mongoose models: one for documents, one for chunks.
const mongoose = require("mongoose");

const documentSchema = new mongoose.Schema({
  filename: String,
  createdAt: { type: Date, default: Date.now },
});

const chunkSchema = new mongoose.Schema({
  documentId: { type: mongoose.Schema.Types.ObjectId, ref: "Document" },
  text: String,
  embedding: [Number],
});

// Mongoose stores these in the "documents" and "chunks" collections.
const Document = mongoose.model("Document", documentSchema);
const Chunk = mongoose.model("Chunk", chunkSchema);

module.exports = { Document, Chunk };
