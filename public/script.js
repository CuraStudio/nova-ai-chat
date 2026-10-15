
"use strict";

// Omni AI – Bedienung passend zur vorhandenen index.html

const $ = (id) => document.getElementById(id);

const elements = {
  sidebar: $("sidebar"),
  menuButton: $("menuButton"),
  newChat: $("newChat"),
  clearButton: $("clearButton"),
  chatForm: $("chatForm"),
  messageInput: $("messageInput"),
  sendButton: $("sendButton"),
  messages: $("messages"),
  welcome: $("welcome"),
  modelSelect: $("modelSelect"),
  refreshModels: $("refreshModels"),
  connectionStatus: $("connectionStatus"),
  modelStatus: $("modelStatus"),
};

const STORAGE_KEY = "omni-ai-conversations-v2";

let messages = [];
let busy = false;
let currentChatId = createId();
let currentModelDetails = null;
let availableModels = [];

function createId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function setStatus(text) {
  if (elements.connectionStatus) {
    elements.connectionStatus.textContent = text;
  }
}

function setModelStatus(text) {
  if (elements.modelStatus) {
    elements.modelStatus.textContent = text;
  }
}

function setBusy(value) {
  busy = value;

  if (elements.sendButton) {
    elements.sendButton.disabled = value;
    elements.sendButton.textContent = value ? "…" : "↑";
  }

  if (elements.messageInput) {
    elements.messageInput.disabled = value;
  }
}

function getSavedChats() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function saveCurrentChat() {
  if (!messages.length) return;

  const chats = getSavedChats();
  const firstUserMessage = messages.find((item) => item.role === "user");

  const chat = {
    id: currentChatId,
    title: firstUserMessage
      ? firstUserMessage.content.slice(0, 60)
      : "Neuer Chat",
    messages,
    updatedAt: Date.now(),
  };

  const index = chats.findIndex((item) => item.id === currentChatId);

  if (index >= 0) {
    chats[index] = chat;
  } else {
    chats.unshift(chat);
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(chats.slice(0, 30)));
  } catch (error) {
    console.warn("Chat konnte nicht gespeichert werden:", error.message);
  }
}

function renderMessage(message) {
  const article = document.createElement("article");
  article.className = `message ${message.role}`;

  const label = document.createElement("div");
  label.className = "message-role";
  label.textContent = message.role === "user" ? "Du" : "Omni AI";

  const content = document.createElement("div");
  content.className = "message-content";
  content.textContent = message.content;

  article.append(label, content);

  if (message.role === "assistant" && message.details) {
    const details = document.createElement("details");
    details.className = "answer-details";

    const summary = document.createElement("summary");
    summary.textContent = "Antwortdetails";

    const info = document.createElement("div");
    info.className = "answer-model-info";

    const model = document.createElement("p");
    model.textContent =
      "Modell: " +
      (message.details.modelName ||
        message.details.model ||
        "Automatisch ausgewählt");

    info.appendChild(model);

    const taskNames = {
      coding: "Programmieren",
      creative: "Kreatives Schreiben",
      reasoning: "Analyse und logisches Denken",
      general: "Allgemeine Anfrage",
    };

    if (message.details.task) {
      const task = document.createElement("p");
      task.textContent =
        "Aufgabe: " + (taskNames[message.details.task] || "Allgemein");
      info.appendChild(task);
    }

    if (message.details.fallbackUsed) {
      const fallback = document.createElement("p");
      fallback.textContent =
        "Ein alternatives Modell wurde verwendet.";
      info.appendChild(fallback);
    }

    details.append(summary, info);
    article.appendChild(details);
  }

  elements.messages.appendChild(article);
}

function renderMessages() {
  if (!elements.messages) return;

  elements.messages.replaceChildren();

  for (const message of messages) {
    renderMessage(message);
  }

  if (elements.welcome) {
    elements.welcome.hidden = messages.length > 0;
  }

  elements.messages.scrollTop = elements.messages.scrollHeight;
}

function showError(text) {
  renderMessage({
    role: "assistant",
    content: "Fehler: " + text,
  });

  if (elements.messages) {
    elements.messages.scrollTop = elements.messages.scrollHeight;
  }
}

function startNewChat() {
  messages = [];
  currentChatId = createId();
  currentModelDetails = null;

  renderMessages();
  setModelStatus("Automatische KI-Auswahl");

  if (elements.sidebar) {
    elements.sidebar.classList.remove("open");
  }

  if (elements.messageInput) {
    elements.messageInput.value = "";
    elements.messageInput.focus();
  }
}

function clearCurrentChat() {
  if (!messages.length) {
    startNewChat();
    return;
  }

  if (!confirm("Möchtest du diesen Chat wirklich leeren?")) return;

  const remaining = getSavedChats().filter(
    (chat) => chat.id !== currentChatId
  );

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(remaining));
  } catch (error) {
    console.warn("Chatverlauf konnte nicht aktualisiert werden.");
  }

  startNewChat();
}

async function checkConnection() {
  try {
    const response = await fetch("/api/health", {
      cache: "no-store",
    });

    const data = await response.json();

    if (!response.ok || data.status !== "ok") {
      throw new Error("Backend nicht erreichbar");
    }

    setStatus(data.configured ? "Verbunden" : "API-Key fehlt");
  } catch (error) {
    setStatus("Verbindung prüfen");
    console.warn("Verbindungstest:", error.message);
  }
}

async function loadModels() {
  // Die Auswahl erfolgt automatisch. Die Liste wird nur intern
  // zur Anzeige bzw. Diagnose geladen.
  if (elements.modelSelect) {
    elements.modelSelect.replaceChildren();

    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Automatische Auswahl";
    elements.modelSelect.appendChild(option);

    // Technische Modellliste aus der Oberfläche entfernen.
    const row = elements.modelSelect.closest(".model-row");
    if (row) row.hidden = true;
  }

  setModelStatus("Automatische KI-Auswahl");

  try {
    const response = await fetch("/api/models", {
      cache: "no-store",
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Modellliste nicht verfügbar");
    }

    availableModels = Array.isArray(data.models) ? data.models : [];

    setStatus("Verbunden");
    console.log(
      `Omni AI: ${availableModels.length} Modelle gefunden.`
    );
  } catch (error) {
    // Chatversuche bleiben möglich; das Backend meldet gegebenenfalls
    // einen konkreten Fehler bei der eigentlichen Anfrage.
    console.warn("Modellliste nicht verfügbar:", error.message);
  }
}

async function sendMessage(event) {
  if (event) event.preventDefault();

  if (busy || !elements.messageInput || !elements.messages) return;

  const text = elements.messageInput.value.trim();
  if (!text) return;

  messages.push({
    role: "user",
    content: text,
  });

  if (elements.welcome) {
    elements.welcome.hidden = true;
  }

  renderMessages();
  saveCurrentChat();

  elements.messageInput.value = "";
  elements.messageInput.style.height = "";

  setBusy(true);
  setModelStatus("KI analysiert deine Anfrage …");

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: messages
          .filter((item) =>
            ["user", "assistant"].includes(item.role)
          )
          .slice(-30)
          .map((item) => ({
            role: item.role,
            content: item.content,
          })),
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data.error ||
          `Die Anfrage ist fehlgeschlagen (HTTP ${response.status}).`
      );
    }

    if (typeof data.answer !== "string" || !data.answer.trim()) {
      throw new Error("Die KI hat keine Antwort zurückgegeben.");
    }

    const assistantMessage = {
      role: "assistant",
      content: data.answer.trim(),
      details: {
        model: data.model,
        modelName: data.modelName,
        task: data.task,
        fallbackUsed: data.fallbackUsed,
      },
    };

    messages.push(assistantMessage);
    currentModelDetails = assistantMessage.details;

    renderMessages();
    saveCurrentChat();

    setModelStatus(
      data.fallbackUsed
        ? "Automatische Auswahl · Ersatzmodell verwendet"
        : "Automatische KI-Auswahl"
    );
  } catch (error) {
    // Nutzernachricht bleibt im Chat, damit sie erneut gesendet werden kann.
    showError(error.message || "Unbekannter Fehler");
    setModelStatus("Anfrage fehlgeschlagen");
  } finally {
    setBusy(false);

    if (elements.messageInput) {
      elements.messageInput.focus();
    }
  }
}

// Formular: Klick auf den Senden-Button und Formular-Submit.
if (elements.chatForm) {
  elements.chatForm.addEventListener("submit", sendMessage);
}

// Menü für Smartphones.
if (elements.menuButton && elements.sidebar) {
  elements.menuButton.addEventListener("click", () => {
    elements.sidebar.classList.toggle("open");
  });
}

// Neuer Chat.
if (elements.newChat) {
  elements.newChat.addEventListener("click", startNewChat);
}

// Aktuellen Chat leeren.
if (elements.clearButton) {
  elements.clearButton.addEventListener("click", clearCurrentChat);
}

// Modellliste erneut prüfen.
if (elements.refreshModels) {
  elements.refreshModels.addEventListener("click", loadModels);
}

// Vorschlagskarten befüllen das Eingabefeld.
document.querySelectorAll("[data-prompt]").forEach((button) => {
  button.addEventListener("click", () => {
    if (!elements.messageInput || busy) return;

    elements.messageInput.value = button.dataset.prompt || "";
    elements.messageInput.focus();

    if (elements.sidebar) {
      elements.sidebar.classList.remove("open");
    }
  });
});

// Eingabefeld wächst beim Schreiben mit.
if (elements.messageInput) {
  elements.messageInput.addEventListener("input", () => {
    elements.messageInput.style.height = "auto";
    elements.messageInput.style.height =
      Math.min(elements.messageInput.scrollHeight, 180) + "px";
  });
}

// Begrüßung und Verbindung initialisieren.
setModelStatus("Automatische KI-Auswahl");
renderMessages();
checkConnection();
loadModels();
