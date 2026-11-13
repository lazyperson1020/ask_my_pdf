// Cosine similarity: how similar two vectors are (1 = same direction, 0 = unrelated).
// NOT used by the app. Atlas Vector Search does this for us. Kept here to explain the idea.
function cosineSimilarity(a, b) {
  let dot = 0;
  let sizeA = 0;
  let sizeB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    sizeA += a[i] * a[i];
    sizeB += b[i] * b[i];
  }
  return dot / (Math.sqrt(sizeA) * Math.sqrt(sizeB));
}

module.exports = { cosineSimilarity };

// Example: node cosine.js
if (require.main === module) {
  console.log(cosineSimilarity([1, 2, 3], [1, 2, 3])); // 1 (same)
  console.log(cosineSimilarity([1, 0], [0, 1])); // 0 (unrelated)
}
