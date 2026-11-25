export const appClient = String.raw`
const telegram = window.Telegram?.WebApp;
const heading = document.querySelector("#heading");
const content = document.querySelector("#content");
const statusLine = document.querySelector("#status");
const dock = document.querySelector("#dock");
const title = {
  service: "ТО и замены", repair: "Ремонт", problem: "Проблемы", note: "Заметка", insurance: "Страховка",
};
const filterOptions = {
  all: "Вся история", service: "ТО", repair: "Ремонт", problem: "Проблемы",
  oil: "Масло", filters: "Фильтры", insurance: "Страховка",
};
let canEdit = false;
let busy = false;

const displayDate = (value) => value ? value.split("-").reverse().join(".") : "—";
const mileage = (value) => value == null ? "—" : new Intl.NumberFormat("ru-RU").format(value) + " км";
const cost = (value) => value == null ? "—" : new Intl.NumberFormat("ru-RU", {
  style: "currency", currency: "RUB", minimumFractionDigits: value % 100 === 0 ? 0 : 2,
}).format(value / 100);
const randomId = () => crypto.randomUUID().replaceAll("-", "").slice(0, 16);

function el(tag, text, classes) {
  const item = document.createElement(tag);
  if (text) item.textContent = text;
  if (classes) item.className = classes;
  return item;
}

async function run(fn, control) {
  if (busy) return;
  busy = true;
  if (control) control.disabled = true;
  statusLine.textContent = "";
  try {
    await fn();
  } catch (error) {
    statusLine.textContent = error.message || "Попробуйте ещё раз.";
  } finally {
    busy = false;
    if (control) control.disabled = false;
  }
}

function button(text, fn, classes) {
  const control = el("button", text, classes);
  control.type = "button";
  control.addEventListener("click", () => run(fn, control));
  return control;
}

function record(text, small, fn) {
  const control = button("", fn, "record");
  control.append(el("span", text, "record-title"), el("span", small, "muted"));
  return control;
}

async function api(action, params = {}) {
  let response;
  let result;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    response = await fetch("/app/api", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "tma " + telegram.initData },
      body: JSON.stringify({ action, ...params }),
      signal: controller.signal,
    });
    result = await response.json().catch(() => ({}));
  } catch {
    throw new Error("Связь прервалась. Попробуйте ещё раз.");
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new Error(result.error || "Не удалось открыть гараж.");
  return result;
}

function view(name, elements, actions = []) {
  heading.textContent = name;
  content.replaceChildren(...elements);
  dock.replaceChildren(...actions);
  window.scrollTo(0, 0);
}

function stats(rows) {
  const items = el("dl", "", "amounts card");
  for (const [label, value] of rows) {
    const group = el("div");
    group.append(el("dt", label), el("dd", value));
    items.append(group);
  }
  return items;
}

function label(text, control) {
  const group = el("label", text);
  group.append(control);
  return group;
}

function makeForm(fields, onCheck) {
  const form = el("form", "", "stack");
  const submit = el("button", "Проверить", "primary");
  submit.type = "submit";
  form.append(...fields, submit);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    run(onCheck, submit);
  });
  return form;
}

function carName(car) {
  return [car.model, car.model_year].filter(Boolean).join(" · ");
}

async function home() {
  const data = await api("home");
  canEdit = data.canEdit;
  const cars = data.cars.map((car) => record(car.nickname, carName(car), () => showCar(car.id)));
  if (!cars.length) cars.push(el("p", "В гараже пока нет автомобилей.", "muted"));
  if (!canEdit) cars.unshift(el("p", "Режим просмотра", "muted"));
  view("Гараж", cars, canEdit ? [button("＋ Автомобиль", () => carForm(), "primary")] : []);
}

function carForm(prefilled = [], id = randomId()) {
  const fields = [
    ["Название", "Городская машина", 36, "text"],
    ["Марка и модель", "Toyota Corolla", 64, "text"],
    ["Год выпуска", "2020", 4, "numeric"],
    ["Пробег, км", "86400", 10, "numeric"],
  ];
  const inputs = fields.map(([name, placeholder, limit, mode], index) => {
    const input = el("input");
    input.maxLength = limit;
    input.placeholder = placeholder;
    input.inputMode = mode;
    input.value = prefilled[index] || "";
    input.required = !index;
    return { input, field: label(name, input) };
  });
  const form = makeForm(inputs.map(({ field }) => field), async () => {
    const values = inputs.map(({ input }) => input.value.trim());
    const text = values.join(" | ");
    const preview = await api("check-car", { text });
    view("Проверьте автомобиль", [stats([
      ["Название", preview.nickname], ["Марка и модель", preview.model || "—"],
      ["Год", preview.modelYear ? String(preview.modelYear) : "—"], ["Пробег", mileage(preview.initialMileage)],
    ])], [
      button("Исправить", () => carForm(values, id)),
      button("Сохранить", async () => {
        await api("create-car", { text, id });
        await showCar(id);
        statusLine.textContent = "Автомобиль добавлен.";
      }, "primary"),
    ]);
  });
  view("Новый автомобиль", [form], [button("‹ Гараж", home)]);
}

function line(entry) {
  return [displayDate(entry.happened_on), title[entry.kind], entry.cost_minor == null ? "" : cost(entry.cost_minor)]
    .filter(Boolean).join(" · ");
}

async function showCar(vehicleId, filter = "all", page = 0) {
  const { car, summary, entries, hasMore } = await api("car", { vehicleId, filter, page });
  const select = el("select");
  for (const [key, name] of Object.entries(filterOptions)) {
    const item = el("option", name);
    item.value = key;
    item.selected = key === filter;
    select.append(item);
  }
  select.addEventListener("change", () => {
    const next = select.value;
    select.value = filter;
    run(() => showCar(vehicleId, next), select);
  });
  const history = entries.map((entry) => record(entry.title, line(entry),
    () => showEntry(vehicleId, entry.id, filter, page)));
  if (!history.length) history.push(el("p", "В этом разделе пока нет записей.", "muted"));
  const steps = el("div", "", "row");
  if (page > 0) steps.append(button("‹ Предыдущая", () => showCar(vehicleId, filter, page - 1)));
  if (hasMore) steps.append(button("Следующая ›", () => showCar(vehicleId, filter, page + 1)));
  const values = [car.initial_mileage, summary.mileage].filter((n) => n != null);
  const main = [
    el("p", carName(car), "muted"),
    stats([["Пробег", mileage(values.length ? Math.max(...values) : null)],
      ["Расходы по журналу", cost(summary.total_cost)], ["Последнее ТО", displayDate(summary.last_service)],
      ["Страховка до", displayDate(summary.policy_until)], ["Масло", displayDate(summary.last_oil)],
      ["Фильтры", displayDate(summary.last_filters)]]),
    label("История", select), ...history,
  ];
  if (steps.childElementCount) main.push(steps);
  const actions = [button("‹ Гараж", home)];
  if (canEdit) actions.push(button("＋ Запись", () => entryForm(vehicleId), "primary"));
  view(car.nickname, main, actions);
}

async function showEntry(vehicleId, entryId, filter = "all", page = 0) {
  const entry = await api("entry", { vehicleId, entryId });
  const values = [[entry.kind === "insurance" ? "Дата покупки" : "Дата", displayDate(entry.happened_on)],
    ["Категория", title[entry.kind]], ["Стоимость", cost(entry.cost_minor)]];
  if (entry.kind === "insurance") values.push(["Действует до", displayDate(entry.valid_until)]);
  else values.push(["Пробег", mileage(entry.mileage)]);
  if (entry.kind === "problem") values.push(["Статус", entry.resolved_on ? "Решено " + displayDate(entry.resolved_on) : "Открыто"]);
  const main = [stats(values)];
  if (entry.details !== entry.title) main.push(el("p", entry.details, "entry-text card"));
  if (canEdit && entry.kind === "problem" && !entry.resolved_on) {
    main.push(button("Проблема решена", async () => {
      await api("resolve", { vehicleId, entryId });
      await showEntry(vehicleId, entryId, filter, page);
    }));
  }
  const actions = [button("‹ История", () => showCar(vehicleId, filter, page))];
  if (canEdit) actions.push(button("Исправить", () => entryForm(vehicleId, entry), "primary"));
  view(entry.title, main, actions);
}

function entrySource(entry) {
  if (!entry) return "";
  return [entry.happened_on, entry.details, entry.mileage == null ? "" : entry.mileage + " км",
    entry.cost_minor == null ? "" : "за " + String(entry.cost_minor / 100).replace(".", ",") + " ₽",
    entry.valid_until ? "действует до " + entry.valid_until : ""].filter(Boolean).join(" ");
}

function entryForm(vehicleId, entry, prefilled = entrySource(entry), id = randomId()) {
  const input = el("textarea");
  input.value = prefilled;
  input.maxLength = 800;
  input.required = true;
  input.placeholder = "Вчера заменил ступичный подшипник за 18 тысяч рублей";
  const form = makeForm([label("Что произошло", input)], async () => {
    const text = input.value.trim();
    const preview = await api("check-entry", { text });
    const insurance = preview.kind === "insurance";
    const values = [[insurance ? "Дата покупки" : "Дата", displayDate(preview.date)],
      ["Категория", title[preview.kind]], ["Стоимость", cost(preview.costMinor)],
      [insurance ? "Действует до" : "Пробег", insurance ? displayDate(preview.validUntil) : mileage(preview.mileage)]];
    view("Проверьте запись", [el("h2", preview.title), stats(values)], [
      button("Исправить", () => entryForm(vehicleId, entry, text, id)),
      button("Сохранить", async () => {
        const saved = await api("save-entry", {
          vehicleId, entryId: entry?.id, id, text, referenceDate: preview.referenceDate,
        });
        await showEntry(vehicleId, saved.id);
        statusLine.textContent = "Запись сохранена.";
      }, "primary"),
    ]);
  });
  const hint = el("p", "Для страховки укажите дату покупки, стоимость и дату окончания.", "muted");
  view(entry ? "Исправить запись" : "Новая запись", [form, hint],
    [button("‹ Автомобиль", () => showCar(vehicleId))]);
}

if (telegram?.initData) {
  telegram.ready();
  telegram.expand();
  dock.replaceChildren(button("Открыть гараж", home, "primary"));
  run(home);
} else {
  statusLine.textContent = "Откройте гараж через кнопку «Гараж» в Telegram.";
}
`;
