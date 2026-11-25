import { InputError } from "./domain.js";

const spans = { month: 1, quarter: 3, year: 12 };

function monthKey(index) {
  const year = String(Math.floor(index / 12)).padStart(4, "0");
  const month = String(index % 12 + 1).padStart(2, "0");
  return year + "-" + month;
}

export function expensePeriod(mode, anchor, today) {
  const selection = anchor ?? today.slice(0, 7);
  const match = typeof selection === "string" && /^(\d{4})-(0[1-9]|1[0-2])$/.exec(selection);
  if (typeof mode !== "string" || !Object.hasOwn(spans, mode) || !match || Number(match[1]) < 1 || Number(match[1]) > 9998) {
    throw new InputError("Выберите месяц, квартал или год.");
  }
  const size = spans[mode];
  const month = Number(match[1]) * 12 + Number(match[2]) - 1;
  const start = Math.floor(month / size) * size;
  return {
    mode, months: size, anchor: monthKey(start), start: monthKey(start) + "-01", end: monthKey(start + size) + "-01",
    previous: start - size >= 12 ? monthKey(start - size) : null,
    next: start + size < 9999 * 12 ? monthKey(start + size) : null,
  };
}

export function expenseDay(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new InputError("Выберите дату расходов.");
  }
  const date = new Date(value + "T00:00:00Z");
  if (!Number.isFinite(+date) || date.toISOString().slice(0, 10) !== value) {
    throw new InputError("Выберите дату расходов.");
  }
  return value;
}

export async function expenseReport(store, selection, today, pageSize) {
  const { mode, anchor, vehicleId = null, display = "calendar", page = 0 } = selection;
  if (display !== "calendar" && display !== "list") throw new InputError("Выберите календарь или список.");
  if (!Number.isInteger(page) || page < 0 || page > 10_000) throw new InputError("Некорректная страница расходов.");
  const period = expensePeriod(mode, anchor, today);
  const last = new Date(Date.parse(period.end) - 86_400_000).toISOString().slice(0, 10);
  const [rows, entries] = await Promise.all([
    store.expenses(period, vehicleId),
    display === "list" ? store.expenseEntries(period.start, last, vehicleId, pageSize + 1, page * pageSize) : [],
  ]);
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  return { period, rows, total, entries: entries.slice(0, pageSize), hasMore: entries.length > pageSize };
}
