import { formatCost, formatDate } from "./domain.js";
import { expenseReport } from "./expenses.js";

export const expenseModes = { month: "Месяц", quarter: "Квартал", year: "Год" };
export const expenseDisplays = { calendar: "Календарь", list: "Список" };
const pageSize = 5;
const dateName = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" });
const monthName = new Intl.DateTimeFormat("ru-RU", { month: "long", timeZone: "UTC" });
const compact = new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 });
const dayMs = 86_400_000;
const button = (text, callback_data) => ({ text, callback_data });
const garage = button("‹ Гараж", "g");

function card(title, lines, buttons, table = []) {
  return { title, lines, buttons, table, details: [] };
}

function heading(period) {
  const start = new Date(period.start + "T00:00:00Z");
  if (period.mode === "year") return String(start.getUTCFullYear());
  if (period.mode === "quarter") {
    return ["I", "II", "III", "IV"][start.getUTCMonth() / 3] + " квартал " + start.getUTCFullYear();
  }
  return dateName.format(start);
}

function calendarRows(period, rows) {
  const totals = new Map(rows.map((item) => [item.bucket, item.amount]));
  const start = new Date(period.start + "T00:00:00Z");
  if (period.mode !== "month") {
    const months = [];
    for (let i = 0; i < period.months; i++) {
      const month = start.toISOString().slice(0, 7);
      months.push([monthName.format(start), totals.has(month) ? formatCost(totals.get(month)) : "—"]);
      start.setUTCMonth(start.getUTCMonth() + 1);
    }
    return [["Месяц", "Расходы"], ...months];
  }

  const blank = " ";
  const days = Array((start.getUTCDay() + 6) % 7).fill(blank);
  const count = (Date.parse(period.end) - +start) / dayMs;
  for (let i = 0; i < count; i++) {
    const key = new Date(+start + i * dayMs).toISOString().slice(0, 10);
    const amount = totals.get(key);
    days.push(String(i + 1) + (amount == null ? "" : "\n" + compact.format(amount / 100) + " ₽"));
  }
  while (days.length % 7) days.push(blank);
  const weeks = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return [["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"], ...weeks];
}

function switchButtons(labels, selection, action) {
  return Object.entries(labels).map(([key, label]) =>
    button((key === selection ? "✓ " : "") + label, "x:" + action + ":" + key));
}

export async function expenseScopeCard(store, state) {
  const cars = await store.cars();
  const page = Math.min(state.expenseCarPage ?? 0, Math.max(0, Math.ceil(cars.length / pageSize) - 1));
  const choices = cars.slice(page * pageSize, (page + 1) * pageSize);
  const pages = [
    ...(page > 0 ? [button("‹", "x:scope:" + (page - 1))] : []),
    ...((page + 1) * pageSize < cars.length ? [button("›", "x:scope:" + (page + 1))] : []),
  ];
  return card("Расходы по автомобилю", choices.length ? [] : ["В гараже пока нет автомобилей."], [
    ...choices.map((car) => [button(car.nickname, "x:vehicle:" + car.id)]),
    ...(pages.length ? [pages] : []),
    [button("Весь гараж", "x:all"), button("‹ Расходы", "x:back")],
  ]);
}

export async function expenseChatCard(store, selection, today) {
  const { vehicleId, mode, display, page } = selection;
  const [selected, report] = await Promise.all([
    store.vehicle(vehicleId),
    expenseReport(store, selection, today, pageSize),
  ]);
  const { period, rows, total, entries, hasMore } = report;
  const title = display === "calendar" ? "Календарь расходов" : "Расходы списком";
  const lines = [selected?.nickname || "Весь гараж", heading(period), "За период · " + formatCost(total)];
  if (!rows.length) lines.push("За этот период расходов нет.");
  lines.push(...entries.map((entry) => [
    formatDate(entry.happened_on), entry.title, ...(vehicleId ? [] : [entry.vehicle]), formatCost(entry.cost_minor),
  ].join(" · ")));

  const periodNav = [
    ...(period.previous ? [button("‹ Период", "x:month:" + period.previous)] : []),
    ...(period.next ? [button("Период ›", "x:month:" + period.next)] : []),
  ];
  const pages = [
    ...(page > 0 ? [button("‹ Страница", "x:page:" + (page - 1))] : []),
    ...(hasMore ? [button("Страница ›", "x:page:" + (page + 1))] : []),
  ];
  const buttons = [
    switchButtons(expenseDisplays, display, "display"),
    switchButtons(expenseModes, mode, "mode"),
    periodNav,
    [button("Весь гараж", "x:all"), button("Выбрать авто", "x:scope:0")],
    ...entries.map((entry) => [button(entry.title.slice(0, 34), "x:entry:" + entry.vehicle_id + "." + entry.id)]),
    ...(pages.length ? [pages] : []),
    [garage],
  ];
  return card(title, lines, buttons, display === "calendar" ? calendarRows(period, rows) : []);
}
