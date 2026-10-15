
const promptInput = document.getElementById("prompt");
const chatForm = document.getElementById("chatForm");
const sendBtn = document.getElementById("sendBtn");
const messagesEl = document.getElementById("messages");
const welcomeEl = document.getElementById("welcome");

const sidebar = document.getElementById("sidebar");
const openSidebarBtn = document.getElementById("openSidebar");
const closeSidebarBtn = document.getElementById("closeSidebar");
const newChatBtn = document.getElementById("newChat");
const clearChatBtn = document.getElementById("clearChat");
const historyEl = document.getElementById("history");

const STORAGE_KEY = "nova-ai-chats-v1";

let chat = {
  id: String(Date.now()),
  title: "Neuer Chat",
  messages: [],
  updatedAt: Date.now(),
};

let busy = false;

function loadChats() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function saveChats() {
  const chats = loadChats();
  const index = chats.findIndex((item) => item.id === chat.id);

  if (chat.messages.length) {
    if (index >= 0) {
      chats[index] = chat;
    } else {
      chats.unshift(chat);
    }
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(chats.slice(0, 50)));
  renderHistory();
}

function renderHistory() {
  if (!historyEl) return;

  historyEl.replaceChildren();

  for (const item of loadChats()) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "history-item";
    button.textContent = item.title || "Chat";
    button.addEventListener("click", () => {
      chat = {
        ...item,
        messages: Array.isArray(item.messages) ? item.messages : [],
      };
      renderMessages();
      if (sidebar) sidebar.classList.remove("open");
    });
    historyEl.appendChild(button);
  }
}

function addMessage(role, content, details = null) {
  const article = document.createElement("article");
  article.className = `message ${role}`;

  const roleLabel = document.createElement("div");
  roleLabel.className = "message-role";
  roleLabel.textContent = role === "user" ? "Du" : "KI";

  const body = document.createElement("div");
  body.className = "message-content";
  body.textContent = content;

  article.append(roleLabel, body);

  if (role === "assistant" && details) {
    const detailBox = document.createElement("details");
    detailBox.className = "answer-details";

    const summary = document.createElement("summary");
    summary.textContent = "Antwortdetails";

    const info = document.createElement("div");
    info.className = "answer-model-info";

    const modelLine = document.createElement("p");
    modelLine.textContent = `Modell: ${details.modelName || details.model || "Automatisch ausgewählt"}`;

    const taskLine = document.createElement("p");
    const taskNames = {
      coding: "Programmieren",
      creative: "Kreatives Schreiben",
      reasoning: "Analyse und logisches Denken",
      general: "Allgemeine Anfrage",
    };
    taskLine.textContent = `Aufgabentyp: ${taskNames[details.task] || "Allgemein"}`;

    info.append(modelLine, taskLine);

    if (details.fallbackUsed) {
      const fallbackLine = document.createElement("p");
      fallbackLine.textContent = "Ein alternatives Modell wurde verwendet.";
      info.appendChild(fallbackLine);
    }

    detailBox.append(summary, info);
    article.appendChild(detailBox);
  }

  messagesEl.appendChild(article);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderMessages() {
  messagesEl.replaceChildren();

  const hasMessages = chat.messages.length > 0;

  if (welcomeEl) {
    welcomeEl.hidden = hasMessages;
  }

  for (let i = 0; i < chat.messages.length; i++) {
    const message = chat.messages[i];

    // Antwortdetails werden lokal mitgespeichert, falls vorhanden.
    addMessage(message.role, message.content, message.details || null);
  }

  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function startNewChat() {
  chat = {
    id: String(Date.now()),
    title: "Neuer Chat",
    messages: [],
    updatedAt: Date.now(),
  };

  renderMessages();

  if (promptInput) promptInput.focus();
  if (sidebar) sidebar.classList.remove("open");
}

function setBusy(value) {
  busy = value;

  if (sendBtn) {
    sendBtn.disabled = value;
    sendBtn.textContent = value ? "Denke nach …" : "Senden";
  }

  if (promptInput) {
    promptInput.disabled = value;
  }
}

async function sendMessage(event) {
  event?.preventDefault();

  if (busy || !promptInput || !messagesEl) return;

  const text = promptInput.value.trim();
  if (!text) return;

  chat.messages.push({ role: "user", content: text });

  if (chat.title === "Neuer Chat") {
    chat.title = text.length > 45 ? `${text.slice(0, 45)}…` : text;
  }

  chat.updatedAt = Date.now();
  promptInput.value = "";

  renderMessages();
  saveChats();
  setBusy(true);

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: chat.messages.slice(-30).map((message) => ({
          role: message.role,
          content: message.content,
        })),
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || `Anfrage fehlgeschlagen (${response.status}).`);
    }

    if (typeof data.answer !== "string" || !data.answer.trim()) {
      throw new Error("Die KI hat keine Textantwort zurückgegeben.");
    }

    const assistantMessage = {
      role: "assistant",
      content: data.answer,
      details: {
        model: data.model,
        modelName: data.modelName,
        task: data.task,
        fallbackUsed: data.fallbackUsed,
      },
    };

    chat.messages.push(assistantMessage);
    chat.updatedAt = Date.now();

    renderMessages();
    saveChats();
  } catch (error) {
    addMessage(
      "assistant",
      `Fehler: ${error.message || "Die Anfrage ist fehlgeschlagen."}`
    );
  } finally {
    setBusy(false);
    if (promptInput) promptInput.focus();
  }
}

if (chatForm) {
  chatForm.addEventListener("submit", sendMessage);
}

if (openSidebarBtn && sidebar) {
  openSidebarBtn.addEventListener("click", () => {
    sidebar.classList.add("open");
  });
}

if (closeSidebarBtn && sidebar) {
  closeSidebarBtn.addEventListener("click", () => {
    sidebar.classList.remove("open");
  });
}

if (newChatBtn) {
  newChatBtn.addEventListener("click", startNewChat);
}

if (clearChatBtn) {
  clearChatBtn.addEventListener("click", () => {
    if (!confirm("Möchtest du diesen Chat wirklich löschen?")) return;

    const chats = loadChats().filter((item) => item.id !== chat.id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(chats));
    startNewChat();
    renderHistory();
  });
}

// Verhindert, dass eine vorhandene Modellauswahl nötig ist.
document.querySelectorAll(
  "#modelSelect, #modelSelector, .model-selector"
).forEach((element) => {
  element.hidden = true;
});

renderHistory();
renderMessages();
