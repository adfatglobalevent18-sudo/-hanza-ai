import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import OpenAI from "openai";

const app = express();
const port = Number(process.env.PORT || 3000);

if (!process.env.OPENAI_API_KEY) {
  console.error("Missing OPENAI_API_KEY. Add it to backend/.env (never to frontend files).");
  process.exit(1);
}

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",").map((item) => item.trim()).filter(Boolean);

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin(origin, callback) {
    // Non-browser/local health checks may omit Origin. Browser origins must be explicitly allowed.
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origin not allowed"));
  },
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"]
}));
app.use(express.json({ limit: "10kb" }));

const chatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many messages. Please wait a little before trying again." }
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "HANZA AI backend", aiConnected: true });
});

app.post("/api/chat", chatLimiter, async (req, res) => {
  try {
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    if (!message) return res.status(400).json({ error: "Please enter a message." });
    if (message.length > 4000) {
      return res.status(400).json({ error: "Please keep messages under 4,000 characters." });
    }

    // Check incoming text before sending it to the model.
    const inputCheck = await client.moderations.create({
      model: "omni-moderation-latest",
      input: message
    });
    if (inputCheck.results?.[0]?.flagged) {
      return res.status(400).json({
        error: "I can't help with that request. Please try a safer, age-appropriate question."
      });
    }

    const result = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      instructions: [
        "You are HANZA AI, a helpful, honest, age-appropriate assistant.",
        "Use clear, respectful language suitable for a broad audience, including teenagers.",
        "Do not provide explicit sexual content, instructions for self-harm, or practical guidance for dangerous wrongdoing.",
        "For health, legal, financial, or other high-stakes topics, provide general information and encourage help from a qualified trusted adult or professional when appropriate.",
        "Do not claim that tools, accounts, payments, or services are available unless they really are.",
        "If you are unsure, say so."
      ].join(" "),
      input: message,
      max_output_tokens: 500,
      store: false
    });

    const reply = (result.output_text || "").trim();
    if (!reply) return res.status(502).json({ error: "The AI did not return a response. Please try again." });

    // Check generated text before returning it to the app.
    const outputCheck = await client.moderations.create({
      model: "omni-moderation-latest",
      input: reply
    });
    if (outputCheck.results?.[0]?.flagged) {
      return res.json({ reply: "I can't provide that response. Please try asking in a different way." });
    }

    // Do not log message content or API credentials.
    return res.json({ reply });
  } catch (error) {
    console.error("HANZA chat request failed:", error?.status || error?.name || "unknown_error");
    return res.status(500).json({ error: "HANZA AI could not answer right now. Please try again later." });
  }
});

// Generic error handler: avoid exposing stack traces or provider details to app users.
app.use((err, _req, res, _next) => {
  if (err?.message === "Origin not allowed") {
    return res.status(403).json({ error: "This website is not allowed to use the HANZA AI API." });
  }
  console.error("Backend middleware error:", err?.name || "unknown_error");
  return res.status(500).json({ error: "A server error occurred." });
});

app.listen(port, () => {
  console.log(`HANZA AI backend listening on port ${port}`);
});
