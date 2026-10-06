import process from "node:process";
import { createWebServer } from "./server.js";

const portValue = Number(process.env.PORT ?? 3000);
const port = Number.isInteger(portValue) && portValue > 0 && portValue <= 65_535 ? portValue : 3000;
const host = process.env.HOST ?? "127.0.0.1";

const server = createWebServer();
server.listen(port, host, () => {
  process.stdout.write(`Расчёт отопления ИВОК: http://${host}:${port}\n`);
});

function shutdown(): void {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
