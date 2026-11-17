import "dotenv/config";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { router } from "./routes";
import { HttpError } from "./services/http-error";

const app = express();
app.disable("x-powered-by");
app.use(helmet());
app.use(cors({ origin: (process.env.WEB_ORIGIN ?? "http://localhost:3000").split(",").map((value) => value.trim()), credentials: true }));
app.use(express.json({ limit: "32kb" }));
app.use("/api", router);
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
  console.error("API request failed", error);
  res.status(500).json({ error: "Não foi possível concluir a solicitação." });
});
const defaultPort = process.env.RENDER === "true" ? 10000 : 4000;
const port = Number(process.env.PORT ?? defaultPort);
const host = "0.0.0.0";
app.listen(port, host, () => console.info(`Educonnect API listening on http://${host}:${port}`));
