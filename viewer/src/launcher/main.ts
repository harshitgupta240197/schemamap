import { healthMessage } from "./api";
import { takeToken } from "./token";

/** sessionStorage, or a store that keeps nothing when site data is blocked. */
function sessionStore(): Pick<Storage, "getItem" | "setItem"> {
  try {
    return window.sessionStorage;
  } catch {
    return { getItem: () => null, setItem: () => undefined };
  }
}

const token = takeToken(window.location, sessionStore(), window.history);
const status = document.getElementById("status");
if (status !== null) {
  void healthMessage(token).then((message) => {
    // Text only: nothing from the server is ever parsed as HTML.
    status.textContent = message;
  });
}
