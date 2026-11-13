// All Gemini (AI) calls are in this file.
const { GoogleGenAI } = require("@google/genai");
const config = require("./config");

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Turn a piece of text into an embedding (an array of numbers).
async function createEmbedding(text) {
  const response = await ai.models.embedContent({
    model: config.EMBEDDING_MODEL,
    contents: text,
    config: { outputDimensionality: config.EMBEDDING_DIMENSIONS },
  });
  return response.embeddings[0].values;
}

// Build the prompt: the rules, the chunks we found, the chat so far, and the question.
// history = previous [{ question, answer }] pairs, so follow-up questions make sense.
function buildPrompt(question, chunks, history = []) {
  const context = chunks.map((c) => c.text).join("\n---\n");
  const conversation = history
    .map((h) => `User: ${h.question}\nAssistant: ${h.answer}`)
    .join("\n");

  return `Answer only using the context below. If the answer is not in the context, say 'I don't know based on this document.' Keep the answer short and simple.
Use the previous conversation only to understand what the question refers to.

Context:
${context}

Previous conversation:
${conversation || "(none)"}

Question: ${question}`;
}

// Ask the LLM and wait for the full answer (used by the POST /ask route).
async function askLLM(question, chunks, history) {
  const response = await ai.models.generateContent({
    model: config.CHAT_MODEL,
    contents: buildPrompt(question, chunks, history),
  });
  return response.text;
}

// Ask the LLM and get the answer in small pieces as it is written (used by Socket.IO).
// onText is called with each new piece of text.
async function askLLMStream(question, chunks, history, onText) {
  const stream = await ai.models.generateContentStream({
    model: config.CHAT_MODEL,
    contents: buildPrompt(question, chunks, history),
  });
  for await (const piece of stream) {
    if (piece.text) onText(piece.text);
  }
}

module.exports = { createEmbedding, askLLM, askLLMStream };
