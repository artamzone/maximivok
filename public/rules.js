const panel = document.querySelector("#rules-panel");
const list = document.querySelector("#rules-list");
const message = document.querySelector("#rules-message");
const errorBox = document.querySelector("#rules-error");
const retry = document.querySelector("#rules-retry");
const number = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 20 });
let busy = false;

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

async function load() {
  if (busy) return;
  busy = true;
  panel.setAttribute("aria-busy", "true");
  retry.hidden = true;
  errorBox.hidden = true;
  list.hidden = true;
  list.replaceChildren();
  message.textContent = "Загрузка правил…";
  try {
    const response = await fetch("/api/rules", { cache: "no-store" });
    if (!response.ok) throw new Error("Не удалось загрузить действующие правила. Повторите загрузку.");
    const data = await response.json();
    if (data?.readOnly !== true || !Array.isArray(data.items) || data.items.length !== 7 ||
        !data.items.every((item) => item && typeof item.value === "number" && Number.isFinite(item.value) &&
          [item.name, item.unit, item.description].every((text) => typeof text === "string" && text.trim() !== ""))) {
      throw new Error("Сервер вернул неполные сведения о правилах. Повторите загрузку.");
    }
    for (const item of data.items) {
      const row = node("div", undefined, "rule-row");
      const definition = node("dd");
      definition.append(node("strong", `${number.format(item.value)} ${item.unit}`, "rule-value"),
        node("p", item.description, "hint"));
      row.append(node("dt", item.name), definition);
      list.append(row);
    }
    list.hidden = false;
    message.textContent = `Показано правил: ${data.items.length}. Редактирование отключено.`;
  } catch (error) {
    errorBox.textContent = error instanceof Error ? error.message : "Не удалось загрузить правила.";
    errorBox.hidden = false;
    retry.hidden = false;
    message.textContent = "Правила не загружены. Значения по умолчанию не подставлены.";
  } finally {
    busy = false;
    panel.setAttribute("aria-busy", "false");
  }
}
retry.addEventListener("click", () => { void load(); });
void load();
