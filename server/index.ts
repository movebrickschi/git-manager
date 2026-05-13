import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import apiRoutes from "./routes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3847;

const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGINS ?? "http://localhost:5173,http://localhost:3847"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error(`CORS denied: ${origin}`));
    },
    credentials: false,
    maxAge: 86400,
  })
);

const HIGH_LIMIT_ROUTES = ["/api/conflict/resolve", "/api/commit"];
app.use((req, res, next) => {
  const limit = HIGH_LIMIT_ROUTES.some((p) => req.path.startsWith(p)) ? "10mb" : "1mb";
  express.json({ limit })(req, res, next);
});

app.use("/api", apiRoutes);

const distPath = path.join(__dirname, "../dist");
app.use(express.static(distPath));
app.get("*", (_req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Git Manager Web Server running at http://localhost:${PORT}`);
});
