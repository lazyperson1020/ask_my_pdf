// Sign up, log in, and "who am I?".
const express = require("express");
const bcrypt = require("bcryptjs");
const { User } = require("../models");
const { createToken, requireAuth } = require("../auth");
const config = require("../config");

const router = express.Router();

// The parts of a user that are safe to send to the browser
function publicUser(user) {
  return { id: user._id, email: user.email };
}

// Check the email and password. Returns an error message, or null if they are fine.
function checkCredentials(email, password) {
  if (typeof email !== "string" || typeof password !== "string") {
    return "Email and password are required.";
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Please enter a valid email.";
  return null;
}

// POST /auth/signup  { email, password } -> { token, user }
router.post("/signup", async (req, res) => {
  try {
    const { email, password } = req.body;
    const inputError = checkCredentials(email, password);
    if (inputError) return res.status(400).json({ error: inputError });
    if (password.length < config.MIN_PASSWORD_LENGTH) {
      return res
        .status(400)
        .json({ error: `Password must be at least ${config.MIN_PASSWORD_LENGTH} characters.` });
    }

    // Store only a bcrypt hash of the password, never the password itself
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ email, passwordHash });
    res.status(201).json({ token: createToken(user), user: publicUser(user) });
  } catch (err) {
    // 11000 = MongoDB "duplicate key": this email already has an account
    if (err.code === 11000) {
      return res.status(409).json({ error: "An account with this email already exists." });
    }
    console.error(err);
    res.status(500).json({ error: "Sign up failed." });
  }
});

// POST /auth/login  { email, password } -> { token, user }
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const inputError = checkCredentials(email, password);
    if (inputError) return res.status(400).json({ error: inputError });

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    // Same message for "no such user" and "wrong password", so nobody can find out
    // which emails have accounts
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: "Wrong email or password." });
    }
    res.json({ token: createToken(user), user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Log in failed." });
  }
});

// GET /auth/me -> { user }  (the page uses this to stay logged in after a refresh)
router.get("/me", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(401).json({ error: "Please log in." });
    res.json({ user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load your account." });
  }
});

module.exports = router;
