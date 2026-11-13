import { connectMessage } from "./api";
import { startSession } from "./session";

/** sessionStorage, or a store that keeps nothing when site data is blocked. */
function sessionStore(): Pick<Storage, "getItem" | "setItem"> {
  try {
    return window.sessionStorage;
  } catch {
    return { getItem: () => null, setItem: () => undefined };
  }
}

const status = document.getElementById("status");
if (status !== null) {
  void startSession(window.location, sessionStore(), window.history)
    .then((session) => connectMessage(session))
    .then((message) => {
      // Text only: nothing from the server is ever parsed as HTML.
      status.textContent = message;
    });
}
