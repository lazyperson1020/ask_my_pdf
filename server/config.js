// All easy-to-change settings live here.
module.exports = {
  EMBEDDING_MODEL: "gemini-embedding-001",
  EMBEDDING_DIMENSIONS: 768, // must match "numDimensions" in the Atlas vector index
  CHAT_MODEL: "gemini-3.5-flash",
  CHUNK_SIZE: 500,
  CHUNK_OVERLAP: 50,
  HISTORY_LIMIT: 3, // how many previous question/answer pairs to send with a question
};
