// Mongoose models: users, their documents, the chunks of each document, and chat messages.
const mongoose = require("mongoose");
const { ObjectId } = mongoose.Schema.Types;

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true }, // never the plain password
  createdAt: { type: Date, default: Date.now },
});

const documentSchema = new mongoose.Schema({
  userId: { type: ObjectId, ref: "User", required: true, index: true },
  filename: String,
  pageCount: Number,
  chunkCount: Number,
  imageCount: { type: Number, default: 0 }, // charts, diagrams, photos Gemini described
  scanned: { type: Boolean, default: false }, // true if the text came from Gemini reading page images
  createdAt: { type: Date, default: Date.now },
});

const chunkSchema = new mongoose.Schema({
  documentId: { type: ObjectId, ref: "Document" },
  text: String,
  embedding: [Number],
  kind: { type: String, enum: ["text", "image"], default: "text" }, // "image" = a description of a visual
  page: Number, // known for image descriptions and scanned pages
});

// Find a document only if it belongs to this user (null for a bad id or someone else's PDF)
documentSchema.statics.findOwned = function (documentId, userId) {
  if (!mongoose.Types.ObjectId.isValid(documentId)) return null;
  return this.findOne({ _id: documentId, userId });
};

// One question and its answer in a document's chat
const messageSchema = new mongoose.Schema({
  documentId: { type: ObjectId, ref: "Document", required: true, index: true },
  question: String,
  answer: String,
  sources: [{ _id: false, text: String, score: Number, kind: String, page: Number }],
  createdAt: { type: Date, default: Date.now },
});

// Mongoose stores these in the "users", "documents", "chunks" and "messages" collections.
const User = mongoose.model("User", userSchema);
const Document = mongoose.model("Document", documentSchema);
const Chunk = mongoose.model("Chunk", chunkSchema);
const Message = mongoose.model("Message", messageSchema);

module.exports = { User, Document, Chunk, Message };
