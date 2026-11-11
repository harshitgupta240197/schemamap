// Progressive enhancement for the waitlist form. Without this file the form posts normally and
// /api/join answers with a small page. With it, the same post goes through fetch and the answer
// appears under the button.

const form = document.getElementById("join-form");
const status = document.getElementById("status");
const button = form?.querySelector("button[type=submit]");

const FALLBACK =
  "Sorry, we could not reach the server. Nothing was lost on your side. Please try again in a few minutes.";

function show(message, state) {
  status.textContent = message;
  status.dataset.state = state;
}

async function submit(event) {
  event.preventDefault();
  button.disabled = true;
  show("Sending…", "pending");
  try {
    const response = await fetch(form.action, {
      method: "POST",
      headers: { accept: "application/json" },
      body: new URLSearchParams(new FormData(form)),
    });
    const result = await response.json();
    if (typeof result.message !== "string") {
      throw new Error("unexpected answer");
    }
    show(result.message, result.ok === true ? "ok" : "error");
    if (result.ok === true) {
      form.reset();
    }
  } catch {
    show(FALLBACK, "error");
  } finally {
    button.disabled = false;
  }
}

if (form !== null && status !== null && button !== null && button !== undefined) {
  form.addEventListener("submit", submit);
}
