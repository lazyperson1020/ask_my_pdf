// Splits text into chunks without cutting words or sentences in half.
const config = require("./config");

// Split a too-long sentence into pieces of whole words.
function splitByWords(sentence, maxLength) {
  const pieces = [];
  let current = "";
  for (const word of sentence.split(" ")) {
    if (current && (current + " " + word).length > maxLength) {
      pieces.push(current);
      current = "";
    }
    current = current ? current + " " + word : word;
  }
  if (current) pieces.push(current);
  return pieces;
}

// Take the last few whole words of a chunk (up to maxLength characters) for the overlap.
function lastWords(text, maxLength) {
  const words = text.split(" ");
  let overlap = "";
  for (let i = words.length - 1; i >= 0; i--) {
    const next = overlap ? words[i] + " " + overlap : words[i];
    if (next.length > maxLength) break;
    overlap = next;
  }
  return overlap;
}

function splitIntoChunks(text) {
  const size = config.CHUNK_SIZE;
  const overlapSize = config.CHUNK_OVERLAP;

  // Longest allowed sentence, so overlap + space + sentence still fits in one chunk
  const maxSentence = size - overlapSize - 1;

  // 1. Split into sentences (a sentence ends with . ! or ? followed by a space)
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .flatMap((s) => (s.length > maxSentence ? splitByWords(s, maxSentence) : [s]));

  // 2. Add whole sentences to a chunk until the next one would not fit
  const chunks = [];
  let current = "";
  let hasNewText = false; // true once the chunk has more than just the overlap
  for (const sentence of sentences) {
    if (hasNewText && (current + " " + sentence).length > size) {
      chunks.push(current);
      // 3. Start the next chunk with the last few words of this one (the overlap)
      current = lastWords(current, overlapSize);
      hasNewText = false;
    }
    current = current ? current + " " + sentence : sentence;
    hasNewText = true;
  }
  if (hasNewText) chunks.push(current);

  return chunks;
}

module.exports = { splitIntoChunks };
