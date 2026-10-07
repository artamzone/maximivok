const form = document.querySelector("#works-form");
const controls = document.querySelector("#works-controls");
const list = document.querySelector("#works-list");
const message = document.querySelector("#works-message");
const errorBox = document.querySelector("#works-error");
const markupInput = document.querySelector("#works-markup");
const reload = document.querySelector("#works-reload");
let catalog = null;
let busy = false;
let dirty = false;

function updateIvokPrices() {
  if (!catalog) return;
  const markup = Number(markupInput.value);
  if (!Number.isFinite(markup) || markup < 0 || markup > 10000) return;
  for (const input of list.querySelectorAll("input[data-work-id]")) {
    const item = catalog.items.find((entry) => entry.id === input.dataset.workId);
    if (item) list.querySelector(`[data-ivok-price="${item.id}"]`).textContent = `${Number(input.value || 0) * (1 + markup / 100)} ₽ / ${item.unit}`;
  }
}
function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function setBusy(value) {
  busy = value;
  controls.disabled = busy || catalog === null;
  reload.disabled = busy;
  form.setAttribute("aria-busy", String(value));
}
async function api(options) {
  const response = await fetch("/api/works", options);
  const data = await response.json();
  if (!response.ok) throw new Error([data.error, ...(data.issues ?? [])].filter(Boolean).join("\n") || "Не удалось выполнить запрос.");
  return data;
}
function render(data) {
  catalog = data;
  markupInput.value = String(data.markupPercent);
  list.replaceChildren();
  for (const item of data.items) {
    const row = node("div", undefined, "work-row");
    const details = node("div");
    const title = node("label", item.name);
    title.htmlFor = `work-${item.id}`;
    details.append(title, node("p", item.appliedToHeating ? "Применяется к новым расчётам отопления" : "Справочно — автоматический расчёт пока не подключён", "hint"));
    const price = node("div");
    const input = node("input");
    input.id = `work-${item.id}`;
    input.dataset.workId = item.id;
    input.type = "number";
    input.inputMode = "decimal";
    input.min = "0";
    input.step = "0.01";
    input.required = true;
    input.value = String(item.priceRub);
    input.addEventListener("input", updateIvokPrices);
    input.setAttribute("aria-label", `${item.name}: базовая цена, рублей за ${item.unit}`);
    const ivokPrice = node("output", `${item.ivokPriceRub} ₽ / ${item.unit}`);
    ivokPrice.dataset.ivokPrice = item.id;
    price.append(node("p", `Базовая цена, ₽ / ${item.unit}`, "hint"), input,
      node("p", "Цена ИВОК с наценкой", "hint"), ivokPrice);
    row.append(details, price);
    list.append(row);
  }
  dirty = false;
}
function showError(error) {
  errorBox.textContent = error instanceof Error ? error.message : "Не удалось загрузить или сохранить цены.";
  errorBox.hidden = false;
  message.textContent = catalog === null ? "Цены не загружены." : "Не удалось подтвердить результат запроса. Введённые значения оставлены в форме.";
}
async function load() {
  if (busy || (dirty && !window.confirm("Загрузить сохранённые цены и отменить несохранённые изменения?"))) return;
  setBusy(true);
  errorBox.hidden = true;
  message.textContent = "Загрузка актуальных цен…";
  try {
    render(await api());
    message.textContent = `Версия цен: ${catalog.revision}${catalog.revision === 0 ? " — начальные значения из ТЗ" : ""}.`;
  } catch (error) { showError(error); }
  finally { setBusy(false); }
}
form.addEventListener("input", () => {
  dirty = true;
  updateIvokPrices();
  message.textContent = "Есть несохранённые изменения. Новые расчёты пока используют прежние цены.";
});
markupInput.addEventListener("input", () => {
  dirty = true;
  updateIvokPrices();
  message.textContent = "Есть несохранённые изменения. Новые расчёты пока используют прежние цены.";
});
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy || catalog === null || !form.reportValidity()) return;
  const prices = [...list.querySelectorAll("input")].map((input) => ({ id: input.dataset.workId, priceRub: Number(input.value) }));
  const markupPercent = Number(markupInput.value);
  if (!Number.isFinite(markupPercent) || markupPercent < 0 || markupPercent > 10000) {
    markupInput.setCustomValidity("Наценка должна быть от 0 до 10000 процентов.");
    markupInput.reportValidity();
    return;
  }
  markupInput.setCustomValidity("");
  const baseRevision = catalog.revision;
  setBusy(true);
  errorBox.hidden = true;
  message.textContent = "Сохранение цен…";
  try {
    render(await api({ method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ baseRevision, markupPercent, prices }) }));
    message.textContent = catalog.revision === baseRevision ? "Изменений нет. Цены актуальны."
      : `Справочник сохранён. Версия ${catalog.revision}. Новые расчёты отопления используют базовые цены тёплого пола и пеноплекса; старые отчёты не изменены.`;
  } catch (error) { showError(error); }
  finally { setBusy(false); }
});
reload.addEventListener("click", () => { void load(); });
window.addEventListener("beforeunload", (event) => {
  if (dirty || busy) { event.preventDefault(); event.returnValue = ""; }
});
void load();
