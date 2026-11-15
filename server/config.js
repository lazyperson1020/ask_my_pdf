// All easy-to-change settings live here.
module.exports = {
  EMBEDDING_MODEL: "gemini-embedding-001",
  EMBEDDING_DIMENSIONS: 768, // must match "numDimensions" in the Atlas vector index
  CHAT_MODEL: "gemini-3.5-flash-lite", // "lite" = faster, bigger free daily limit
  VISION_MODEL: "gemini-3.5-flash-lite", // reads images and scanned pages in PDFs
  CHUNK_SIZE: 500,
  CHUNK_OVERLAP: 50,
  HISTORY_LIMIT: 3, // how many previous question/answer pairs to send with a question
  MIN_PASSWORD_LENGTH: 8,
  MAX_QUESTION_LENGTH: 1000,
  TOKEN_EXPIRES_IN: "7d", // how long a login lasts
};
