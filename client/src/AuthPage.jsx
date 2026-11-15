import { useState } from "react";
import { api } from "./api";

// The log in / sign up page. onLogin(token, user) is called when it works.
function AuthPage({ onLogin }) {
  const [mode, setMode] = useState("login"); // "login" or "signup"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const isSignup = mode === "signup";

  async function handleSubmit(e) {
    e.preventDefault(); // stop the form from reloading the page
    setLoading(true);
    setError("");
    try {
      const data = await api(`/auth/${mode}`, { method: "POST", body: { email, password } });
      onLogin(data.token, data.user);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  // Switch between log in and sign up
  function switchMode() {
    setMode(isSignup ? "login" : "signup");
    setError("");
  }

  return (
    <div className="container auth">
      <h1>AskMyPDF</h1>
      <p className="muted">Upload a PDF and chat with it.</p>

      <form className="auth-form" onSubmit={handleSubmit}>
        <h2>{isSignup ? "Create an account" : "Log in"}</h2>
        <input
          type="email"
          placeholder="Email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder={isSignup ? "Password (at least 8 characters)" : "Password"}
          autoComplete={isSignup ? "new-password" : "current-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <button type="submit" className="primary" disabled={loading}>
          {loading ? "Please wait..." : isSignup ? "Sign up" : "Log in"}
        </button>
        {error && <p className="error">{error}</p>}
      </form>

      <p className="muted">
        {isSignup ? "Already have an account? " : "New here? "}
        <button type="button" className="link" onClick={switchMode}>
          {isSignup ? "Log in" : "Create an account"}
        </button>
      </p>
    </div>
  );
}

export default AuthPage;
