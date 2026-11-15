#!/usr/bin/env node
// AskMyPDF MCP server: lets AI assistants (Claude Desktop, Claude Code, ...) use your PDFs as tools.
// It talks to the normal AskMyPDF REST API, so login, "your PDFs only" and the RAG pipeline
// all work exactly like in the website.
//
// Settings (environment variables):
//   ASKMYPDF_URL       where the AskMyPDF server runs (default http://localhost:5000)
//   ASKMYPDF_EMAIL     your AskMyPDF account
//   ASKMYPDF_PASSWORD  its password
//
// Note: MCP talks over stdin/stdout, so never console.log here; use console.error for logs.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_URL = (process.env.ASKMYPDF_URL || "http://localhost:5000").replace(/\/$/, "");
const EMAIL = process.env.ASKMYPDF_EMAIL;
const PASSWORD = process.env.ASKMYPDF_PASSWORD;

// ---------- Talking to the AskMyPDF API ----------

let token = null; // login token, fetched the first time a tool is used

async function login() {
  if (!EMAIL || !PASSWORD) {
    throw new Error("Set ASKMYPDF_EMAIL and ASKMYPDF_PASSWORD for the AskMyPDF MCP server.");
  }
  const res = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Login failed: ${data.error || res.status}`);
  token = data.token;
}

// Call the API with our login token. body can be an object (sent as JSON) or FormData.
// If the token has expired (401), log in again once and retry.
async function api(apiPath, { method = "GET", body } = {}, retried = false) {
  if (!token) await login();

  const headers = { Authorization: `Bearer ${token}` };
  let payload = body;
  if (body && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(API_URL + apiPath, { method, headers, body: payload });
  } catch {
    throw new Error(`Could not reach the AskMyPDF server at ${API_URL}. Is it running?`);
  }

  if (res.status === 401 && !retried) {
    token = null;
    return api(apiPath, { method, body }, true);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return data;
}

// ---------- Helpers for tool results ----------

const text = (value) => ({ content: [{ type: "text", text: value }] });

// Run a tool; turn any error into a tool error the assistant can read (instead of crashing)
function safely(handler) {
  return async (args) => {
    try {
      return await handler(args);
    } catch (err) {
      return { ...text(`Error: ${err.message}`), isError: true };
    }
  };
}

// "[1] (score 0.842) some text..." for each source chunk
function formatSources(sources) {
  if (sources.length === 0) return "No matching passages found in this PDF.";
  return sources.map((s, i) => `[${i + 1}] (score ${s.score.toFixed(3)})\n${s.text}`).join("\n\n");
}

const documentId = z.string().describe("The PDF's id, from list_documents.");

// ---------- The MCP server and its tools ----------

const server = new McpServer({ name: "askmypdf", version: "1.0.0" });

server.registerTool(
  "list_documents",
  {
    title: "List my PDFs",
    description: "List the PDFs in the user's AskMyPDF account, newest first, with their ids.",
    annotations: { readOnlyHint: true },
  },
  safely(async () => {
    const { documents } = await api("/documents");
    if (documents.length === 0) return text("No PDFs uploaded yet.");
    const lines = documents.map(
      (d) =>
        `- ${d.filename} (id: ${d._id}, ${d.pageCount} pages, uploaded ${d.createdAt.slice(0, 10)})`,
    );
    return text(lines.join("\n"));
  }),
);

server.registerTool(
  "search_document",
  {
    title: "Search a PDF",
    description:
      "Semantic (vector) search in one PDF. Returns the 4 passages that best match the query, " +
      "with similarity scores. Use this to read what the PDF says and answer in your own words.",
    inputSchema: {
      documentId,
      query: z.string().min(1).max(1000).describe("What to look for, in plain language."),
    },
    annotations: { readOnlyHint: true },
  },
  safely(async ({ documentId, query }) => {
    const { sources } = await api("/ask/search", { method: "POST", body: { documentId, query } });
    return text(formatSources(sources));
  }),
);

server.registerTool(
  "ask_document",
  {
    title: "Ask a PDF",
    description:
      "Ask AskMyPDF a question about one PDF. Its own AI answers using only the PDF and returns " +
      "the answer with the source passages. The question and answer are saved to that PDF's chat.",
    inputSchema: {
      documentId,
      question: z.string().min(1).max(1000).describe("The question to ask about the PDF."),
    },
  },
  safely(async ({ documentId, question }) => {
    const { answer, sources } = await api("/ask", { method: "POST", body: { documentId, question } });
    return text(`${answer}\n\nSources:\n${formatSources(sources)}`);
  }),
);

server.registerTool(
  "upload_pdf",
  {
    title: "Upload a PDF",
    description: "Upload a PDF file from this computer to AskMyPDF (max 10 MB). Returns its id.",
    inputSchema: {
      filePath: z.string().describe("Absolute path to a .pdf file on this computer."),
    },
  },
  safely(async ({ filePath }) => {
    if (!filePath.toLowerCase().endsWith(".pdf")) throw new Error("Only .pdf files can be uploaded.");
    const bytes = await readFile(filePath);
    const formData = new FormData();
    formData.append("file", new Blob([bytes], { type: "application/pdf" }), path.basename(filePath));
    const { document: doc, warning } = await api("/documents", { method: "POST", body: formData });
    return text(
      `Uploaded ${doc.filename} (id: ${doc._id}, ${doc.pageCount} pages, ${doc.imageCount} images described` +
        `${doc.scanned ? ", scanned" : ""}). ${warning ? warning + " " : ""}` +
        "Wait a few seconds before searching it, while the vector index catches up.",
    );
  }),
);

// Start talking to the assistant over stdin/stdout
await server.connect(new StdioServerTransport());
console.error(`AskMyPDF MCP server running (API: ${API_URL})`);
