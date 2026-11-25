export const appCalendarClient = String.raw`
const periodModes = { month: "Месяц", quarter: "Квартал", year: "Год" };
const russianMonth = new Intl.DateTimeFormat("ru-RU", { month: "long", timeZone: "UTC" });
const monthYear = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" });
const compactCost = new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 });
const weekdays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const quarterNames = ["I", "II", "III", "IV"];

function periodCaption(period) {
  const start = new Date(period.start + "T00:00:00Z");
  if (period.mode === "month") return monthYear.format(start);
  if (period.mode === "quarter") {
    return quarterNames[start.getUTCMonth() / 3] + " квартал " + start.getUTCFullYear();
  }
  return String(start.getUTCFullYear());
}

function monthGrid(period, rows, today, choose) {
  const grid = el("div", "", "calendar-grid");
  for (const weekday of weekdays) grid.append(el("span", weekday, "calendar-weekday"));
  const start = Date.parse(period.start);
  const initial = (new Date(start).getUTCDay() + 6) % 7;
  for (let i = 0; i < initial; i++) grid.append(el("span"));

  const values = new Map(rows.map((row) => [row.bucket, row]));
  const count = (Date.parse(period.end) - start) / 86_400_000;
  for (let i = 0; i < count; i++) {
    const day = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
    const row = values.get(day);
    const cell = row ? button("", () => choose(day), "calendar-day expense-day") : el("div", "", "calendar-day");
    cell.append(el("span", String(i + 1)));
    if (row) {
      cell.setAttribute("aria-label", displayDate(day) + " · " + cost(row.amount));
      cell.title = cost(row.amount);
      cell.append(el("small", compactCost.format(row.amount / 100), "calendar-amount"));
    }
    if (day === today) cell.classList.add("calendar-today");
    grid.append(cell);
  }
  return grid;
}

function periodMonths(period, rows, choose) {
  const grid = el("div", "", "calendar-months");
  const amounts = new Map(rows.map((row) => [row.bucket, row.amount]));
  const date = new Date(period.start + "T00:00:00Z");
  for (let i = 0; i < period.months; i++) {
    const month = date.toISOString().slice(0, 7);
    grid.append(record(russianMonth.format(date), cost(amounts.get(month)), () => choose(month)));
    date.setUTCMonth(date.getUTCMonth() + 1);
  }
  return grid;
}

function expenseRecord(entry, back, label, showVehicle) {
  const info = [showVehicle ? entry.vehicle : "", title[entry.kind], cost(entry.cost_minor)];
  return record(entry.title, info.filter(Boolean).join(" · "),
    () => showEntry(entry.vehicle_id, entry.id, "all", 0, back, label));
}

function expenseList(entries, back, showVehicle) {
  const list = el("div", "", "stack");
  let group;
  let date;
  for (const entry of entries) {
    if (entry.happened_on !== date) {
      date = entry.happened_on;
      group = el("section", "", "stack expense-date-group");
      group.append(el("h2", displayDate(date)));
      list.append(group);
    }
    group.append(expenseRecord(entry, back, "‹ К списку", showVehicle));
  }
  return list;
}

function expenseSegments(items, selected, jump, className) {
  const group = el("div", "", className);
  for (const [key, name] of Object.entries(items)) {
    const control = button(name, () => jump(key), key === selected ? "primary" : "");
    control.setAttribute("aria-pressed", String(key === selected));
    group.append(control);
  }
  return group;
}

async function showExpenses(mode = "month", anchor, vehicleId = null, display = "calendar", page = 0) {
  const { period, today, rows, total, cars, entries, hasMore } =
    await api("expenses", { mode, anchor, vehicleId, display, page });
  const focusMonth = anchor ?? today.slice(0, 7);
  const chooseScope = el("select");
  for (const [value, name] of [["", "Весь гараж"], ...cars.map((car) => [car.id, car.nickname])]) {
    const option = el("option", name);
    option.value = value;
    chooseScope.append(option);
  }
  chooseScope.value = vehicleId || "";
  chooseScope.addEventListener("change", () => {
    const selected = chooseScope.value || null;
    chooseScope.value = vehicleId || "";
    run(() => showExpenses(mode, focusMonth, selected, display), chooseScope);
  });
  const modeButtons = expenseSegments(periodModes, mode,
    (value) => showExpenses(value, focusMonth, vehicleId, display), "calendar-modes");
  const viewButtons = expenseSegments({ calendar: "Календарь", list: "Список" }, display,
    (value) => showExpenses(mode, focusMonth, vehicleId, value), "expense-views");
  const navigation = el("div", "", "calendar-navigation");
  const previous = button("‹", () => showExpenses(mode, period.previous, vehicleId, display));
  const next = button("›", () => showExpenses(mode, period.next, vehicleId, display));
  previous.setAttribute("aria-label", "Предыдущий период");
  next.setAttribute("aria-label", "Следующий период");
  previous.disabled = !period.previous;
  next.disabled = !period.next;
  navigation.append(previous, el("h2", periodCaption(period)), next);

  const main = [
    label("Машины", chooseScope), modeButtons, navigation,
    stats([["За период", cost(total)]]), viewButtons,
  ];
  if (display === "list") {
    const back = () => showExpenses(mode, focusMonth, vehicleId, display, page);
    main.push(expenseList(entries, back, vehicleId === null));
    const pages = el("div", "", "row");
    if (page > 0) pages.append(button("‹ Предыдущая", () => showExpenses(mode, focusMonth, vehicleId, display, page - 1)));
    if (hasMore) pages.append(button("Следующая ›", () => showExpenses(mode, focusMonth, vehicleId, display, page + 1)));
    if (pages.childElementCount) main.push(pages);
  } else {
    main.push(mode === "month"
      ? monthGrid(period, rows, today, (day) => showExpenseDay(day, mode, focusMonth, vehicleId))
      : periodMonths(period, rows, (month) => showExpenses("month", month, vehicleId)));
  }
  if (!rows.length) main.push(el("p", "За этот период расходов нет.", "muted"));
  view("Расходы", main, [button("‹ Гараж", home)]);
}

async function showExpenseDay(day, mode, anchor, vehicleId) {
  const { entries } = await api("expense-day", { day, vehicleId });
  const back = () => showExpenseDay(day, mode, anchor, vehicleId);
  const main = entries.map((entry) => expenseRecord(entry, back, "‹ Расходы за день", vehicleId === null));
  if (!main.length) main.push(el("p", "За этот день расходов нет.", "muted"));
  view("Расходы за " + displayDate(day), main, [button("‹ Календарь", () => showExpenses(mode, anchor, vehicleId))]);
}
`;
