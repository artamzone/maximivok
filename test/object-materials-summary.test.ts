import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test, { type TestContext } from "node:test";

// Minimal DOM boundary for the public controller; real layout/events are also checked in Chrome.
class Element {
  public children: Element[] = [];
  public hidden = false;
  public open = false;
  public href = "";
  public className = "";
  public title = "";
  public tabIndex = -1;
  public attributes = new Map<string, string>();
  public listeners = new Map<string, () => void>();
  #text = "";
  public constructor(public tagName = "div") {}
  public set textContent(value: string) { this.#text = value; this.children = []; }
  public get textContent(): string { return this.#text + this.children.map((child) => child.textContent).join(""); }
  public append(...nodes: Element[]): void { this.children.push(...nodes); }
  public replaceChildren(...nodes: Element[]): void { this.#text = ""; this.children = [...nodes]; }
  public setAttribute(key: string, value: string): void { this.attributes.set(key, value); }
  public addEventListener(key: string, handler: () => void): void { this.listeners.set(key, handler); }
}

type Controller = { setObject(id: string | null): Promise<void>; refresh(): Promise<void> };
const ids = ["object-materials-panel", "object-materials-details", "object-materials-summary", "object-materials-content", "materials-link-hint", "object-materials-link", "object-materials-error", "object-materials-retry"];

async function setup(t: TestContext) {
  const elements = new Map(ids.map((id) => [id, new Element()]));
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    querySelector: (selector: string) => elements.get(selector.slice(1)),
    createElement: (tag: string) => new Element(tag),
  } });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else Reflect.deleteProperty(globalThis, "document");
  });
  const module = await import(pathToFileURL(resolve("public/materials.js")).href);
  const controller: Controller = module.createObjectMaterialsSummary();
  return { controller, get: (id: string) => elements.get(id)! };
}

function collection(id: string, count = 1) {
  return {
    object: { id }, versions: [],
    latest: count === 0 ? null : {
      id: "v1", versionNumber: 1, createdAt: "2026-01-01T12:00:00Z",
      items: Array.from({ length: count }, (_, index) => ({
        name: index === 0 ? '<img src=x> Радиатор' : `Товар ${index}`, article: "001",
        quantity: 2.5, unit: "шт", priceRub: index === 0 ? 2.5 : index === 1 ? null : 0,
        lineTotalKopecks: index === 0 ? 625 : index === 1 ? null : 0,
      })),
      knownTotalKopecks: 625, unpricedCount: count >= 2 ? 1 : 0, zeroPriceCount: count >= 3 ? 1 : 0,
    },
  };
}

const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });

test("сводка закрыта при выборе объекта, показывает сохранённые строки и точные суммы без редактора", async (t) => {
  const { controller, get } = await setup(t);
  const requests: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => { requests.push(url); return response(collection("a", 3)); });
  await controller.setObject(null);
  assert.equal(requests.length, 0);
  assert.equal(get("object-materials-link").hidden, true);
  assert.match(get("materials-link-hint").textContent, /сохраните карточку/);
  get("object-materials-details").open = true;
  await controller.setObject("a");
  assert.equal(get("object-materials-details").open, false);
  assert.equal(get("object-materials-summary").textContent, "Товаров отобрано — 3 позиции");
  assert.equal(get("object-materials-link").textContent, "Перейти в материалы");
  assert.equal(get("object-materials-link").href, "/catalog?objectId=a");
  const content = get("object-materials-content");
  assert.match(content.textContent, /Версия 1/);
  assert.match(content.textContent, /Цена в каталоге/);
  assert.match(content.textContent, /Цена не указана/);
  assert.match(content.textContent, /не входят в КП/);
  assert.match(content.textContent, /<img src=x> Радиатор/);
  function flatten(node: Element): Element[] { return [node, ...node.children.flatMap(flatten)]; }
  assert.equal(flatten(content).some((node) => ["input", "select", "button", "img"].includes(node.tagName)), false);
  get("object-materials-details").open = true;
  await controller.refresh();
  assert.equal(get("object-materials-details").open, true);
  await controller.setObject(null);
  assert.equal(get("object-materials-details").open, false);
  assert.equal(content.textContent, "");
});

test("пустой объект предлагает добавить материалы, ошибки не маскируются пустым списком, повтор работает", async (t) => {
  const { controller, get } = await setup(t);
  let fail = false;
  t.mock.method(globalThis, "fetch", async () => fail ? new Response('{"error":"Ошибка загрузки"}', { status: 500 }) : response(collection("a", 0)));
  await controller.setObject("a");
  assert.equal(get("object-materials-summary").textContent, "Товаров отобрано — 0 позиций");
  assert.equal(get("object-materials-link").textContent, "Добавить материалы");
  assert.match(get("materials-link-hint").textContent, /пока не отобраны/);
  fail = true;
  await controller.refresh();
  assert.equal(get("object-materials-error").hidden, false);
  assert.equal(get("object-materials-retry").hidden, false);
  assert.match(get("object-materials-summary").textContent, /не загружены/);
  assert.equal(get("object-materials-link").hidden, false);
  fail = false;
  await controller.refresh();
  assert.equal(get("object-materials-error").hidden, true);
  assert.equal(get("object-materials-retry").hidden, true);
});

test("пустая сохранённая версия показывает дату и нулевой итог, но не строки прежней версии", async (t) => {
  const { controller, get } = await setup(t);
  const data = collection("a", 1);
  data.latest!.versionNumber = 4;
  data.latest!.items = [];
  data.latest!.knownTotalKopecks = 0;
  t.mock.method(globalThis, "fetch", async () => response(data));
  await controller.setObject("a");
  assert.match(get("object-materials-content").textContent, /Версия 4/);
  assert.match(get("object-materials-content").textContent, /не входят в КП/);
  assert.equal(get("object-materials-link").textContent, "Добавить материалы");
  assert.doesNotMatch(get("object-materials-content").textContent, /Радиатор/);
});

test("ответ старого объекта или запроса не заменяет актуальную сводку", async (t) => {
  const { controller, get } = await setup(t);
  const pending: ((value: Response) => void)[] = [];
  t.mock.method(globalThis, "fetch", () => new Promise<Response>((resolve) => pending.push(resolve)));
  const old = controller.setObject("a");
  const current = controller.setObject("b");
  pending[1]!(response(collection("b", 3)));
  await current;
  pending[0]!(response(collection("a", 1)));
  await old;
  assert.equal(get("object-materials-link").href, "/catalog?objectId=b");
  assert.match(get("object-materials-summary").textContent, /3 позиции/);
  const earlier = controller.refresh();
  const later = controller.refresh();
  pending[3]!(response(collection("b", 1)));
  await later;
  pending[2]!(response(collection("b", 3)));
  await earlier;
  assert.match(get("object-materials-summary").textContent, /1 позиция/);
  const last = controller.refresh();
  await controller.setObject(null);
  pending[4]!(response(collection("b", 3)));
  await last;
  assert.equal(get("object-materials-link").hidden, true);
  assert.equal(get("object-materials-content").textContent, "");
});
