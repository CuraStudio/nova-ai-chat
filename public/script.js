const modelSelect = document.getElementById("modelSelect");
const messagesElement = document.getElementById("messages");
const welcome = document.getElementById("welcome");
const form = document.getElementById("chatForm");
const input = document.getElementById("messageInput");
const sendButton = document.getElementById("sendButton");
const connectionStatus = document.getElementById("connectionStatus");
const modelStatus = document.getElementById("modelStatus");

let conversation = [];
let busy = false;

function addMessage(role, content) {
const article = document.createElement("article");
article.className = "message ${role}";

const label = document.createElement("div");
label.className = "message-label";
label.textContent = role === "user" ? "Du" : "KI-Assistent";

const body = document.createElement("div");
body.className = "message-content";
body.textContent = content;

article.append(label, body);
messagesElement.appendChild(article);
article.scrollIntoView({ behavior: "smooth", block: "end" });

return body;
}

function showError(message) {
const article = document.createElement("article");
article.className = "message assistant";

const label = document.createElement("div");
label.className = "message-label";
label.textContent = "Hinweis";

const body = document.createElement("div");
body.className = "message-content error-text";
body.textContent = message;

article.append(label, body);
messagesElement.appendChild(article);
}

function updateLayout() {
const hasMessages = conversation.length > 0;
welcome.hidden = hasMessages;
messagesElement.hidden = !hasMessages;
}

async function loadModels() {
modelSelect.replaceChildren(
new Option("Modelle werden geladen …", "")
);
connectionStatus.textContent = "Verbindung wird geprüft …";

try {
const response = await fetch("/api/models");
const data = await response.json();

if (!response.ok) {
  throw new Error(data.error || "Modelle nicht verfügbar.");
}

const models = data.models || [];

if (!models.length) {
  throw new Error("Der Anbieter hat keine Modelle gemeldet.");
}

modelSelect.replaceChildren();

for (const model of models) {
  modelSelect.add(
    new Option(model.name || model.id, model.id)
  );
}

connectionStatus.textContent =
  `${models.length} Modelle gemeldet`;
modelStatus.textContent = "NVIDIA · Modell auswählen";

} catch (error) {
modelSelect.replaceChildren(
new Option("Keine Modelle verfügbar", "")
);
connectionStatus.textContent = "Verbindung nicht verfügbar";
modelStatus.textContent = "Verbindung prüfen";
showError(error.message);
}
}

async function sendMessage(text) {
const message = text.trim();

if (!message || busy) return;

if (!modelSelect.value) {
showError("Bitte wähle zuerst ein verfügbares Modell aus.");
return;
}

busy = true;
sendButton.disabled = true;
input.disabled = true;

welcome.hidden = true;
messagesElement.hidden = false;

conversation.push({ role: "user", content: message });
addMessage("user", message);

input.value = "";

const history = conversation.slice(-40);
const loading = addMessage("assistant", "Antwort wird erstellt …");

try {
const response = await fetch("/api/chat", {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify({
model: modelSelect.value,
messages: history
})
});

const data = await response.json();

if (!response.ok) {
  throw new Error(data.error || "Die Anfrage ist fehlgeschlagen.");
}

const answer = typeof data.answer === "string"
  ? data.answer
  : JSON.stringify(data.answer);

loading.textContent = answer || "Die KI hat leer geantwortet.";

if (answer) {
  conversation.push({
    role: "assistant",
    content: answer
  });
}

modelStatus.textContent = data.model || modelSelect.value;

} catch (error) {
loading.textContent = "Fehler: ${error.message}";
loading.classList.add("error-text");

// Die nicht beantwortete Nachricht aus dem Verlauf entfernen.
conversation.pop();

} finally {
busy = false;
sendButton.disabled = false;
input.disabled = false;
input.focus();
}
}

form.addEventListener("submit", event => {
event.preventDefault();
sendMessage(input.value);
});

input.addEventListener("keydown", event => {
if (event.key === "Enter" && !event.shiftKey) {
event.preventDefault();
form.requestSubmit();
}
});

document.querySelectorAll("[data-prompt]").forEach(button => {
button.addEventListener("click", () => {
input.value = button.dataset.prompt;
input.focus();
});
});

function resetChat() {
if (busy) return;

conversation = [];
messagesElement.replaceChildren();
updateLayout();
input.value = "";
input.focus();
}

document.getElementById("newChat").addEventListener("click", resetChat);
document.getElementById("clearButton").addEventListener("click", resetChat);
document.getElementById("refreshModels").addEventListener("click", loadModels);

document.getElementById("menuButton").addEventListener("click", () => {
document.getElementById("sidebar").classList.toggle("open");
});

modelSelect.addEventListener("change", () => {
modelStatus.textContent = modelSelect.value || "Modell auswählen";
});

messagesElement.hidden = true;
loadModels();

welcome.hidden = true;
messagesElement.hidden = false;
