const express = require("express");
const path = require("path");
const dotenv = require("dotenv");
const rateLimit = require("express-rate-limit");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";

app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));

app.use("/api/", rateLimit({
windowMs: 60 * 1000,
limit: 20,
standardHeaders: "draft-7",
legacyHeaders: false,
message: {
error: "Zu viele Anfragen. Bitte warte eine Minute."
}
}));

app.use(express.static(path.join(__dirname, "public")));

function requireApiKey(res) {
if (!NVIDIA_API_KEY) {
res.status(503).json({
error: "Der NVIDIA-API-Key ist auf dem Server nicht eingerichtet."
});
return false;
}
return true;
}

async function nvidiaRequest(endpoint, options = {}) {
const response = await fetch(
`${NVIDIA_BASE_URL}${endpoint}`,
{
...options,
headers: {
Authorization: "Bearer ${NVIDIA_API_KEY}",
"Content-Type": "application/json",
...options.headers
},
signal: AbortSignal.timeout(60000)
}
);

const data = await response.json().catch(() => ({}));

if (!response.ok) {
const error = new Error(
data?.error?.message ||
data?.detail ||
"NVIDIA-API-Fehler (${response.status})"
);
error.status = response.status;
throw error;
}

return data;
}

app.get("/api/health", (req, res) => {
res.json({
status: "ok",
provider: "NVIDIA",
configured: Boolean(NVIDIA_API_KEY)
});
});

app.get("/api/models", async (req, res) => {
if (!requireApiKey(res)) return;

try {
const data = await nvidiaRequest("/models");

const models = (data.data || [])
  .filter(model => model.id)
  .map(model => ({
    id: model.id,
    name: model.id
  }));

res.json({ models });

} catch (error) {
console.error("Modellliste fehlgeschlagen:", error.message);
res.status(error.status || 502).json({
error: "Die Modellliste konnte nicht geladen werden.",
details: error.status ? error.message : undefined
});
}
});

app.post("/api/chat", async (req, res) => {
if (!requireApiKey(res)) return;

const { model, messages } = req.body || {};

if (
typeof model !== "string" ||
model.length > 200 ||
!Array.isArray(messages) ||
messages.length === 0 ||
messages.length > 40
) {
return res.status(400).json({
error: "Ungültiges Modell oder ungültiger Chatverlauf."
});
}

const validMessages = messages.every(message =>
message &&
["system", "user", "assistant"].includes(message.role) &&
typeof message.content === "string" &&
message.content.length <= 12000
);

if (!validMessages) {
return res.status(400).json({
error: "Eine oder mehrere Nachrichten sind ungültig."
});
}

try {
// Modell-ID gegen die vom Anbieter gemeldete Liste prüfen.
const available = await nvidiaRequest("/models");
const allowed = (available.data || [])
.some(item => item.id === model);

if (!allowed) {
  return res.status(400).json({
    error: "Dieses Modell wird in der aktuellen Modellliste nicht angeboten."
  });
}

const result = await nvidiaRequest("/chat/completions", {
  method: "POST",
  body: JSON.stringify({
    model,
    messages,
    temperature: 0.7,
    max_tokens: 1200,
    stream: false
  })
});

res.json({
  answer: result.choices?.[0]?.message?.content || "",
  model: result.model || model
});

} catch (error) {
console.error("Chat-Anfrage fehlgeschlagen:", error.message);

res.status(error.status || 502).json({
  error: "Die KI-Anfrage ist fehlgeschlagen.",
  details: error.status ? error.message : undefined
});

}
});

app.get("/", (req, res) => {
res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
console.log("Multi-KI-Chat läuft auf Port ${PORT}");
});
