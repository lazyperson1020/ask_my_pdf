import { useEffect, useState } from "react";
import { api, getToken, setToken, clearToken, setLoggedOutHandler } from "./api";
import AuthPage from "./AuthPage";
import MainPage from "./MainPage";

// Shows the login page or the main page, depending on whether you are logged in.
function App() {
  const [user, setUser] = useState(null);
  // If we have a saved token, check it with the server before showing anything
  const [checking, setChecking] = useState(Boolean(getToken()));

  useEffect(() => {
    // If the server rejects our token later (e.g. it expired), go back to the login page
    setLoggedOutHandler(() => setUser(null));

    if (!getToken()) return;
    api("/auth/me")
      .then((data) => setUser(data.user))
      .catch(() => clearToken())
      .finally(() => setChecking(false));
  }, []);

  function handleLogin(token, loggedInUser) {
    setToken(token);
    setUser(loggedInUser);
  }

  function handleLogout() {
    clearToken();
    setUser(null);
  }

  if (checking) return <p className="container muted">Loading...</p>;
  if (!user) return <AuthPage onLogin={handleLogin} />;
  return <MainPage key={user.id} user={user} onLogout={handleLogout} />;
}

export default App;
