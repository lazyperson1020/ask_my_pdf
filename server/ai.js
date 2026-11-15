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
Context passages that start with "[Image, page N]" describe a picture, chart or diagram on that page of the PDF.

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

// Ask the LLM and get the answer in small pieces as it is written (used by POST /ask/stream).
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

// Let Gemini look at the PDF itself (it can see images, not just text).
// Returns [{ page, kind: "text" | "image", content }]:
//   - "image": a description of a chart, diagram, photo or table that is drawn as a picture
//   - "text": the page's text, only when transcribe is true (scanned PDFs have no text layer)
async function readPdfVisuals(pdfBuffer, transcribe) {
  const task = transcribe
    ? `This PDF is scanned (its pages are images). For every page, return:
- one "text" item with all the text on the page, in reading order
- one "image" item for each chart, diagram, photo or figure on the page, described as below`
    : `Return one "image" item for each chart, graph, diagram, photo, figure, or table drawn as an
image. The text of the PDF is extracted separately, so:
- Do NOT return the normal text of the PDF, and do NOT summarise or describe pages.
- A page that is only text (headings, paragraphs, bullet lists) is NOT a visual, even though
  you see it as a picture of the page. Never describe a page as a "screenshot".
- Skip logos, icons, decorations and backgrounds.
Most PDFs have few or no visuals. If there are none, return an empty list [].`;

  const response = await ai.models.generateContent({
    model: config.VISION_MODEL,
    contents: [
      { inlineData: { mimeType: "application/pdf", data: pdfBuffer.toString("base64") } },
      {
        text: `${task}
Describe each visual so someone could answer questions about it without seeing it: what it shows,
its title, labels, axes, and the important numbers and trends. "page" is the 1-based page number.`,
      },
    ],
    config: {
      // Ask for JSON in a fixed shape, so we don't have to guess how to read the reply
      responseMimeType: "application/json",
      responseJsonSchema: {
        type: "array",
        items: {
          type: "object",
          properties: {
            page: { type: "integer" },
            kind: { type: "string", enum: ["text", "image"] },
            content: { type: "string" },
          },
          required: ["page", "kind", "content"],
        },
      },
    },
  });

  const items = JSON.parse(response.text);
  return items.filter((item) => item.content?.trim());
}

// True if Gemini refused because the free daily/minute limit was reached (HTTP 429)
function isRateLimit(err) {
  return err.status === 429 || String(err.message).includes("429");
}

module.exports = { createEmbedding, askLLM, askLLMStream, readPdfVisuals, isRateLimit };
