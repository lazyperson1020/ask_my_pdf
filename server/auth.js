// Login helpers: create a token for a user, and check the token on every request.
const jwt = require("jsonwebtoken");
const config = require("./config");

// A JWT is a signed string that says "this is user <id>". Only our server can create
// a valid one, because only it knows JWT_SECRET.
function createToken(user) {
  return jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
    expiresIn: config.TOKEN_EXPIRES_IN,
  });
}

// Middleware: only let the request through if it has a valid token.
// The browser sends it in the header "Authorization: Bearer <token>".
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Please log in." });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = payload.userId; // the routes use this to find the user's own data
    next();
  } catch {
    res.status(401).json({ error: "Your session has expired. Please log in again." });
  }
}

module.exports = { createToken, requireAuth };
