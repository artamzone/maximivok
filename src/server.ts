import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import process from "node:process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { calculateHeating } from "./calculator.js";
import type { ProjectRepository } from "./projects.js";
import {
  parseCalculationDraft,
  parseCreateObjectDraft,
  parseObjectCardDraft,
} from "./project-validation.js";
import { SqliteProjectRepository } from "./storage.js";
import { InputValidationError, parseHeatingInput } from "./validation.js";

const publicDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../../public");
const maxRequestBytes = 1_000_000;
const defaultDatabasePath = resolve(process.cwd(), "data", "ivok.sqlite");

const staticFiles = new Map([
  ["/", { file: "index.html", contentType: "text/html; charset=utf-8" }],
  ["/app.js", { file: "app.js", contentType: "text/javascript; charset=utf-8" }],
  ["/styles.css", { file: "styles.css", contentType: "text/css; charset=utf-8" }],
]);

export interface WebServerOptions {
  repository?: ProjectRepository;
  databasePath?: string;
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
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

function objectRoute(pathname: string): { objectId: string; calculations: boolean } | null {
  const match = /^\/api\/objects\/([^/]+)(\/calculations)?$/.exec(pathname);
  if (match?.[1] === undefined) return null;
  try {
    return { objectId: decodeURIComponent(match[1]), calculations: match[2] !== undefined };
  } catch {
    return null;
  }
}

function sendRequestError(response: ServerResponse, error: unknown): void {
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
  sendJson(response, 500, { error: "Не удалось обработать запрос." });
}

async function handleApiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  repository: ProjectRepository,
): Promise<boolean> {
  if (request.method === "POST" && pathname === "/api/calculate") {
    const input = parseHeatingInput(await readJsonBody(request));
    sendJson(response, 200, calculateHeating(input));
    return true;
  }

  if (request.method === "GET" && pathname === "/api/objects") {
    sendJson(response, 200, { objects: repository.listObjects() });
    return true;
  }

  if (request.method === "POST" && pathname === "/api/objects") {
    const draft = parseCreateObjectDraft(await readJsonBody(request));
    const report = draft.calculation === null ? null : calculateHeating(draft.calculation.input);
    const details = repository.createObject(draft, report);
    sendJson(response, 201, details);
    return true;
  }

  const route = objectRoute(pathname);
  if (route === null) return false;

  if (request.method === "GET" && !route.calculations) {
    const details = repository.getObject(route.objectId);
    if (details === null) sendJson(response, 404, { error: "Объект не найден." });
    else sendJson(response, 200, details);
    return true;
  }

  if (request.method === "PATCH" && !route.calculations) {
    const draft = parseObjectCardDraft(await readJsonBody(request));
    const details = repository.updateObject(route.objectId, draft.client, draft.object);
    if (details === null) sendJson(response, 404, { error: "Объект не найден." });
    else sendJson(response, 200, details);
    return true;
  }

  if (request.method === "POST" && route.calculations) {
    const draft = parseCalculationDraft(await readJsonBody(request));
    const calculation = repository.addCalculation(route.objectId, draft, calculateHeating(draft.input));
    if (calculation === null) sendJson(response, 404, { error: "Объект не найден." });
    else sendJson(response, 201, calculation);
    return true;
  }

  return false;
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  repository: ProjectRepository,
): Promise<void> {
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  if (request.method === "GET" && (await serveStatic(pathname, response))) return;
  try {
    if (await handleApiRequest(request, response, pathname, repository)) return;
  } catch (error: unknown) {
    sendRequestError(response, error);
    return;
  }
  sendJson(response, 404, { error: "Страница не найдена." });
}

export function createWebServer(options: WebServerOptions = {}): Server {
  if (options.repository !== undefined && options.databasePath !== undefined) {
    throw new Error("Укажите repository или databasePath, но не оба параметра.");
  }
  const ownsRepository = options.repository === undefined;
  const repository = options.repository ?? new SqliteProjectRepository(
    options.databasePath ?? process.env.IVOK_DATABASE_PATH ?? defaultDatabasePath,
  );
  const server = createServer((request, response) => {
    void handleRequest(request, response, repository).catch(() => {
      if (!response.headersSent) sendJson(response, 500, { error: "Не удалось обработать запрос." });
      else response.destroy();
    });
  });
  if (ownsRepository) server.once("close", () => repository.close());
  return server;
}
