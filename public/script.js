
require("dotenv").config();

const express = require("express");
const rateLimit = require("express-rate-limit");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const API_KEY = process.env.NVIDIA_API_KEY;
const BASE_URL = (
  process.env.NVIDIA_BASE_URL ||
  "https://integrate.api.nvidia.com/v1"
).replace(/\/+$/, "");

const DEFAULT_MODEL = process.env.NVIDIA_MODEL || "";

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});

let modelCache = [];
let modelCacheTime = 0;
const MODEL_CACHE_MS = 5 * 60 * 1000;

function getFriendlyName(id) {
  const name = id.split("/").pop() || id;

  return name
    .replace(/[-_]/g, " ")
    .replace(/\b(llm|instruct)\b/gi, (word) =>
      word.toLowerCase() === "llm" ? "LLM" : "Instruct"
    )
    .replace(/\s+/g, " ")
    .trim();
}

async function getAvailableModels(forceRefresh = false) {
  if (
    !forceRefresh &&
    modelCache.length &&
    Date.now() - modelCacheTime < MODEL_CACHE_MS
  ) {
    return modelCache;
  }

  if (!API_KEY) {
    throw new Error("NVIDIA_API_KEY fehlt in der Render-Umgebung.");
  }

  const response = await fetch(`${BASE_URL}/models`, {
    headers: {
      Authorization: `Bearer ${API_KEY}`,
    },
    signal: AbortSignal.timeout(20000),
  });

  if (!response.ok) {
    throw new Error(`NVIDIA-Modellabfrage: HTTP ${response.status}`);
  }

  const result = await response.json();

  const data = Array.isArray(result.data)
    ? result.data
    : Array.isArray(result.models)
      ? result.models
      : [];

  modelCache = data
    .map((item) => ({
      id: item.id || item.name,
      label: getFriendlyName(item.id || item.name || ""),
    }))
    .filter((model) => model.id)
    // Textmodelle bevorzugen; offensichtliche Spezialmodelle ausschließen.
    .filter(
      (model) =>
        !/embed|rerank|reward|guard|safety|classifier|whisper|tts|asr/i.test(
          model.id
        )
    );

  modelCacheTime = Date.now();

  if (!modelCache.length) {
    throw new Error("NVIDIA hat keine passenden Textmodelle geliefert.");
  }

  return modelCache;
}

// Heuristische Bewertung: Qualität zuerst, passend zur Aufgabenart.
// Das ist eine Auswahlhilfe, kein unabhängiger Qualitätstest.
function scoreModel(model, task) {
  const id = model.id.toLowerCase();
  let score = 0;

  // Häufig geeignete allgemeine Chat-/Instruct-Modelle bevorzugen.
  if (/instruct|chat/i.test(id)) score += 20;
  if (/reasoning|reasoner|thinking|deepseek-r|qwq/i.test(id)) {
    score += task === "reasoning" || task === "coding" ? 35 : 10;
  }

  // Bekannte Modellfamilien als grobe Heuristik.
  if (/deepseek|qwen|llama|nemotron|kimi|glm|mistral/i.test(id)) {
    score += 15;
  }

  if (/70b|72b|110b|120b|235b|405b|671b|large|ultra/i.test(id)) {
    score += 25;
  }
  if (/8b|7b|3b|1b|nano|tiny|mini/i.test(id)) {
    score -= 15;
  }

  if (task === "coding") {
    if (/coder|code|codestral|deepseek/i.test(id)) score += 35;
  }

  if (task === "creative") {
    if (/llama|qwen|mistral|kimi|large/i.test(id)) score += 15;
  }

  if (task === "reasoning") {
    if (/reason|thinking|deepseek|qwq|nemotron/i.test(id)) score += 30;
  }

  if (task === "general" && /instruct|chat/i.test(id)) score += 10;

  return score;
}

function detectTask(messages) {
  const text = messages
    .filter((message) => message.role === "user")
    .map((message) => message.content)
    .join("\n")
    .toLowerCase();

  if (
    /programmier|programming|code\b|javascript|python|html|css|bug|fehler im code|api bauen|server\.js/.test(
      text
    )
  ) {
    return "coding";
  }

  if (
    /beweise|beweisführung|logik|mathematisch|komplexe analyse|schritt für schritt herleiten|strateg|debugg/.test(
      text
    )
  ) {
    return "reasoning";
  }

  if (
    /roman|geschichte|kapitel|dialog|kreativ|kreative|figur|charakter|story|gedicht|schreib.*szene/.test(
      text
    )
  ) {
    return "creative";
  }

  return "general";
}

function getErrorText(body) {
  if (typeof body?.error === "string") return body.error;
  if (body?.error?.message) return body.error.message;
  return "";
}

function shouldTryFallback(status, errorText = "") {
  // Bei Authentifizierungsfehlern nicht blind weitere Modelle probieren.
  if (status === 401 || status === 403) return false;

  // Bei ungültigem Modell, Überlastung oder Serverfehlern wechseln.
  return (
    [400, 404, 408, 409, 422, 429, 500, 502, 503, 504].includes(status) ||
    /model.*(not found|unavailable|unsupported)|overload|temporarily unavailable/i.test(
      errorText
    )
  );
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    provider: "NVIDIA",
    configured: Boolean(API_KEY),
    mode: "automatic-quality-first",
  });
});

// Nur für optionale Anzeige in den Antwortdetails.
app.get("/api/models", async (req, res) => {
  try {
    const models = await getAvailableModels();

    res.json({
      mode: "automatic",
      models: models.map((model) => ({
        id: model.id,
        label: model.label,
      })),
    });
  } catch (error) {
    console.error("Modellliste fehlgeschlagen:", error.message);
    res.status(502).json({
      error: "Die Modellliste konnte nicht geladen werden.",
    });
  }
});

app.post("/api/chat", chatLimiter, async (req, res) => {
  try {
    if (!API_KEY) {
      return res.status(500).json({
        error: "Der NVIDIA-API-Key ist auf dem Server nicht eingerichtet.",
      });
    }

    const messages = req.body?.messages;

    if (
      !Array.isArray(messages) ||
      messages.length === 0 ||
      messages.length > 60
    ) {
      return res.status(400).json({
        error: "Bitte sende einen gültigen Chatverlauf.",
      });
    }

    const safeMessages = messages
      .filter(
        (message) =>
          message &&
          ["user", "assistant"].includes(message.role) &&
          typeof message.content === "string"
      )
      .slice(-30)
      .map((message) => ({
        role: message.role,
        content: message.content.slice(0, 30000),
      }));

    if (!safeMessages.length || safeMessages.at(-1).role !== "user") {
      return res.status(400).json({
        error: "Die letzte Nachricht muss eine Nutzernachricht sein.",
      });
    }

    const task = detectTask(safeMessages);
    const available = await getAvailableModels();

    // Optionales festes Modell aus Render wird nur bevorzugt,
    // wenn es tatsächlich in der Modellliste steht.
    const pinned = DEFAULT_MODEL
      ? available.find((model) => model.id === DEFAULT_MODEL)
      : null;

    const ranked = [...available].sort(
      (a, b) => scoreModel(b, task) - scoreModel(a, task)
    );

    if (pinned) {
      ranked.unshift(pinned);
    }

    const uniqueModels = [
      ...new Map(ranked.map((model) => [model.id, model])).values(),
    ];

    // Maximal drei Versuche, um lange Wartezeiten zu begrenzen.
    const candidates = uniqueModels.slice(0, 3);
    let lastStatus = 502;
    let lastError = "Kein Modell konnte die Anfrage beantworten.";

    for (let i = 0; i < candidates.length; i++) {
      const model = candidates[i];

      try {
        const response = await fetch(`${BASE_URL}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: model.id,
            messages: safeMessages,
            temperature: task === "creative" ? 0.8 : 0.3,
            max_tokens: 2048,
            stream: false,
          }),
          signal: AbortSignal.timeout(90000),
        });

        const raw = await response.text();
        let data;

        try {
          data = JSON.parse(raw);
        } catch {
          data = {};
        }

        if (response.ok) {
          const answer = data.choices?.[0]?.message?.content;

          if (typeof answer !== "string" || !answer.trim()) {
            lastStatus = 502;
            lastError = "Das Modell hat keine Textantwort zurückgegeben.";
          } else {
            return res.json({
              answer: answer.trim(),
              model: model.id,
              modelName: model.label,
              mode: "automatic",
              task,
              fallbackUsed: i > 0,
            });
          }
        } else {
          lastStatus = response.status;
          lastError =
            getErrorText(data) || `NVIDIA antwortete mit HTTP ${response.status}.`;

          console.warn(
            `Modellversuch ${i + 1}/${candidates.length} fehlgeschlagen:`,
            model.id,
            response.status,
            lastError.slice(0, 300)
          );

          if (
            !shouldTryFallback(response.status, lastError) ||
            i === candidates.length - 1
          ) {
            break;
          }
        }
      } catch (error) {
        lastStatus = 502;
        lastError = error.name === "TimeoutError"
          ? "Zeitüberschreitung beim Modellaufruf."
          : error.message || "Netzwerkfehler beim Modellaufruf.";

        console.warn("Modellaufruf fehlgeschlagen:", model.id, lastError);

        if (i === candidates.length - 1) break;
      }
    }

    // Keine internen Details oder Zugangsdaten an den Browser senden.
    console.error("Alle Modellversuche fehlgeschlagen:", lastStatus, lastError);

    if (lastStatus === 401 || lastStatus === 403) {
      return res.status(lastStatus).json({
        error:
          "NVIDIA hat den Zugriff abgelehnt. Prüfe den API-Key und die Berechtigungen für Chat-Anfragen.",
      });
    }

    if (lastStatus === 429) {
      return res.status(429).json({
        error:
          "NVIDIA meldet ein Nutzungslimit. Bitte warte kurz und versuche es erneut.",
      });
    }

    return res.status(502).json({
      error:
        "Keines der getesteten Modelle konnte antworten. Bitte versuche es später erneut.",
    });
  } catch (error) {
    console.error("Chat-Fehler:", error.message);

    return res.status(500).json({
      error: "Die Anfrage konnte nicht verarbeitet werden.",
    });
  }
});

app.listen(PORT, () => {
  console.log(`KI-Chat läuft auf Port ${PORT}`);
});
