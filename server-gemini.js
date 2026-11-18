import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { fileURLToPath } from "node:url";

const app = express();
const port = Number(process.env.PORT || 3000);
const apiKey = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));

const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",").map((item) => item.trim()).filter(Boolean);

if (allowedOrigins.length) {
  app.use(cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Origin not allowed"));
    },
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"]
  }));
}

app.use(express.json({ limit: "10kb" }));

const chatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many messages. Please wait before trying again." }
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "HANZA AI backend",
    provider: "Gemini",
    aiConnected: Boolean(apiKey)
  });
});

app.post("/api/chat", chatLimiter, async (req, res) => {
  try {
    const message = typeof req.body?.message === "string"
      ? req.body.message.trim() : "";

    if (!message) {
      return res.status(400).json({ error: "Please enter a message." });
    }

    if (message.length > 4000) {
      return res.status(400).json({
        error: "Please keep messages under 4,000 characters."
      });
    }

    if (!apiKey) {
      return res.status(503).json({
        error: "Gemini is not configured yet. Please try again later."
      });
    }

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/interactions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          model,
          input: message,
          system_instruction: [
            "You are HANZA AI, a helpful, honest and age-appropriate assistant.",
            "Use clear, respectful language suitable for teenagers and adults.",
            "Do not provide explicit sexual content, self-harm instructions, or practical guidance for dangerous wrongdoing.",
            "For high-stakes health, legal or financial topics, provide general information and encourage help from a qualified professional or trusted adult when appropriate.",
            "Never claim a service, payment or tool is available unless it really is.",
            "If unsure, say so."
          ].join(" "),
          store: false
        }),
        signal: AbortSignal.timeout(30000)
    });
    const data = await response.json();

    if (!response.ok) {
      console.error("Gemini request failed:", response.status, data?.error?.code || "unknown", data?.error?.message || "No error message returned");
      return res.status(502).json({
        error: "HANZA AI could not answer right now. Please try again."
      });
    }

    const reply = (data.steps || [])
      .filter((step) => step.type === "model_output")
      .flatMap((step) => step.content || [])
      .filter((part) => part.type === "text")
      .map((part) => part.text || "")
      .join("\n").trim();

    if (!reply) {
      return res.status(502).json({
        error: "The AI did not return a response. Please try again."
      });
    }

    return res.json({ reply });

  } catch (error) {
    console.error("HANZA Gemini request failed:", error?.name || "unknown_error");
    return res.status(500).json({
      error: "HANZA AI could not answer right now. Please try again later."
    });
  }
});

app.use(express.static(fileURLToPath(new URL("./frontend", import.meta.url))));

app.use((err, _req, res, _next) => {
  if (err?.message === "Origin not allowed") {
    return res.status(403).json({
      error: "This website is not allowed to use the HANZA AI API."
    });
  }
  console.error("Backend error:", err?.name || "unknown_error");
  return res.status(500).json({ error: "A server error occurred." });
});

app.listen(port, () => {
  console.log(`HANZA AI Gemini backend listening on port ${port}`);
});
