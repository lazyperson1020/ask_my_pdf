// AskMyPDF server: log in, upload PDFs, and chat with them.
require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const authRoutes = require("./routes/auth");
const documentRoutes = require("./routes/documents");
const askRoutes = require("./routes/ask");

// Without these the app can't work, so stop right away with a clear message
for (const name of ["MONGO_URI", "GEMINI_API_KEY", "JWT_SECRET"]) {
  if (!process.env[name]) {
    console.error(`Missing ${name} in server/.env (see .env.example).`);
    process.exit(1);
  }
}

const app = express();
app.use(cors({ origin: process.env.CLIENT_URL }));
app.use(express.json());

// Serve the built React app (client/dist) so the whole project runs as one website
app.use(express.static(path.join(__dirname, "../client/dist")));

// Health check
app.get("/health", (req, res) => {
  res.send("ok");
});

app.use("/auth", authRoutes); // sign up, log in
app.use("/documents", documentRoutes); // upload, list and delete PDFs, saved chats
app.use("/ask", askRoutes); // ask a question (normal or streamed)

// Handle errors from the routes (wrong file type, file too large, broken JSON)
app.use((err, req, res, next) => {
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({ error: "File is too large (max 10 MB)." });
  }
  res.status(err.status || 400).json({ error: err.message });
});

// Connect to MongoDB, then start the server
async function start() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB");
    const port = process.env.PORT || 5000;
    const server = app.listen(port, () => console.log(`Server running on http://localhost:${port}`));
    // e.g. the port is already used by another server
    server.on("error", (err) => {
      console.error("Could not start server:", err.message);
      process.exit(1);
    });
  } catch (err) {
    console.error("Could not connect to MongoDB:", err.message);
  }
}

start();
