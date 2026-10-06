import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { calculateHeating } from "./calculator.js";
import { InputValidationError, parseHeatingInput } from "./validation.js";

const publicDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../../public");
const maxRequestBytes = 1_000_000;

const staticFiles = new Map([
  ["/", { file: "index.html", contentType: "text/html; charset=utf-8" }],
  ["/app.js", { file: "app.js", contentType: "text/javascript; charset=utf-8" }],
  ["/styles.css", { file: "styles.css", contentType: "text/css; charset=utf-8" }],
]);

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(`${JSON.stringify(payload)}\n`);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maxRequestBytes) throw new RequestTooLargeError();
    chunks.push(buffer);
  }
  const body = Buffer.concat(chunks).toString("utf8");
  if (body.trim() === "") throw new SyntaxError("Пустое тело запроса");
  return JSON.parse(body) as unknown;
}

class RequestTooLargeError extends Error {}

async function serveStatic(pathname: string, response: ServerResponse): Promise<boolean> {
  const asset = staticFiles.get(pathname);
  if (asset === undefined) return false;
  try {
    const content = await readFile(resolve(publicDirectory, asset.file));
    response.writeHead(200, {
      "content-type": asset.contentType,
      "cache-control": "no-store",
    });
    response.end(content);
  } catch {
    sendJson(response, 500, { error: "Не удалось загрузить веб-интерфейс." });
  }
  return true;
}

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;

  if (request.method === "GET" && (await serveStatic(pathname, response))) return;

  if (request.method === "POST" && pathname === "/api/calculate") {
    try {
      const input = parseHeatingInput(await readJsonBody(request));
      sendJson(response, 200, calculateHeating(input));
    } catch (error: unknown) {
      if (error instanceof RequestTooLargeError) {
        sendJson(response, 413, { error: "Запрос превышает допустимый размер 1 МБ." });
        return;
      }
      if (error instanceof InputValidationError) {
        sendJson(response, 400, { error: "Некорректные входные данные.", issues: error.issues });
        return;
      }
      if (error instanceof SyntaxError) {
        sendJson(response, 400, { error: "Тело запроса должно содержать корректный JSON." });
        return;
      }
      sendJson(response, 500, { error: "Не удалось выполнить расчёт." });
    }
    return;
  }

  sendJson(response, 404, { error: "Страница не найдена." });
}

export function createWebServer(): Server {
  return createServer((request, response) => {
    void handleRequest(request, response);
  });
}
