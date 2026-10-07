let materialPicker = null;
if (new URLSearchParams(location.search).has("objectId")) {
  try {
    materialPicker = await (await import("./materials.js")).initializeMaterials();
  } catch {
    document.querySelector("#materials-panel").hidden = false;
    document.querySelector("#materials-message").textContent = "Материалы не загружены.";
    const error = document.querySelector("#materials-error");
    error.textContent = "Не удалось загрузить интерфейс материалов. После обновления приложения перезапустите локальный сервер и обновите страницу.";
    error.hidden = false;
  }
}
const form = document.querySelector("#catalog-search");
const queryInput = document.querySelector("#catalog-query");
const categoryInput = document.querySelector("#catalog-category");
const results = document.querySelector("#catalog-results");
const list = document.querySelector("#catalog-list");
const status = document.querySelector("#catalog-status");
const errorBox = document.querySelector("#catalog-error");
const emptyBox = document.querySelector("#catalog-empty");
const pageLabel = document.querySelector("#catalog-page");
const previous = document.querySelector("#catalog-previous");
const next = document.querySelector("#catalog-next");
const money = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 20 });
let filters = { query: "", category: "" };
let currentPage = 1;
let requestId = 0;
let controller;

function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function productLink(product) {
  try {
    const url = new URL(product.url);
    if (url.protocol !== "https:" || url.hostname !== "san-baza.ru" || url.port
      || url.username || url.password || url.search || url.hash || !url.pathname.startsWith("/catalog/")) return null;
    const link = element("a", "", product.name);
    link.href = url.href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    return link;
  } catch {
    return null;
  }
}

function renderProduct(product) {
  const item = element("li", "catalog-item");
  const heading = element("h3", "");
  heading.append(productLink(product) ?? document.createTextNode(product.name));
  const price = product.priceRub === null
    ? "Цена не указана"
    : `${money.format(product.priceRub)} / ${product.unit}${product.priceRub === 0 ? " — требует проверки" : ""}`;
  const loadedAt = new Date(product.updatedAt);
  item.append(
    heading,
    element("p", "muted", product.category),
    element("p", "catalog-price", price),
    element("p", "", `Артикул: ${product.article ?? "не указан"}`),
    element("p", "muted", `Единица: ${product.unit} · Источник: ${product.source}`),
    element("p", "muted", Number.isNaN(loadedAt.getTime()) ? "Дата загрузки не указана" : `Загружено: ${loadedAt.toLocaleString("ru-RU")}`),
  );
  if (materialPicker) {
    const add = element("button", "secondary material-add", "Добавить в материалы объекта");
    add.type = "button";
    add.addEventListener("click", () => materialPicker.addProduct(product));
    item.append(add);
  }
  return item;
}

function renderCategories(categories, selected) {
  const all = document.createElement("option");
  all.value = "";
  all.textContent = "Все категории";
  const options = [all];
  // Keep an applied category visible even if the latest import moved its last product.
  const values = selected && !categories.includes(selected) ? [...categories, selected] : categories;
  for (const category of values) {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    options.push(option);
  }
  categoryInput.replaceChildren(...options);
  categoryInput.value = selected;
}

async function loadCatalog(page) {
  controller?.abort();
  controller = new AbortController();
  const id = ++requestId;
  const requestedFilters = { ...filters };
  results.setAttribute("aria-busy", "true");
  previous.disabled = true;
  next.disabled = true;
  errorBox.hidden = true;
  emptyBox.hidden = true;
  list.replaceChildren();
  status.textContent = "Загрузка каталога…";
  pageLabel.textContent = "Загрузка…";
  try {
    const params = new URLSearchParams({ ...requestedFilters, page: String(page) });
    const response = await fetch(`/api/catalog?${params}`, { signal: controller.signal });
    if (!response.ok) throw new Error("Не удалось загрузить каталог. Повторите поиск.");
    const data = await response.json();
    if (id !== requestId) return;
    renderCategories(data.categories, requestedFilters.category);
    list.replaceChildren(...data.products.map(renderProduct));
    currentPage = data.page;
    status.textContent = `Найдено: ${data.total} из ${data.catalogTotal}`;
    pageLabel.textContent = `Страница ${data.page}`;
    previous.disabled = data.page <= 1;
    next.disabled = data.page * data.pageSize >= data.total;
    if (data.products.length === 0) {
      emptyBox.textContent = data.catalogTotal === 0
        ? "Каталог пока пуст. Сначала загрузите Excel командой catalog:import."
        : "На этой странице товаров нет. Измените фильтры или вернитесь на предыдущую страницу.";
      emptyBox.hidden = false;
    }
  } catch (error) {
    if (id !== requestId || error.name === "AbortError") return;
    status.textContent = "Каталог не загружен.";
    pageLabel.textContent = "—";
    errorBox.textContent = "Не удалось загрузить каталог. Проверьте соединение с локальным сервером и нажмите «Найти» для повтора.";
    errorBox.hidden = false;
  } finally {
    if (id === requestId) results.setAttribute("aria-busy", "false");
  }
}

function search() {
  filters = { query: queryInput.value.trim(), category: categoryInput.value };
  void loadCatalog(1);
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  search();
});
categoryInput.addEventListener("change", search);
document.querySelector("#catalog-reset").addEventListener("click", () => {
  form.reset();
  search();
});
previous.addEventListener("click", () => { void loadCatalog(currentPage - 1); });
next.addEventListener("click", () => { void loadCatalog(currentPage + 1); });
void loadCatalog(1);
