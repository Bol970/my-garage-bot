export const kinds = {
  service: "ТО и замены",
  repair: "Ремонт",
  problem: "Проблема",
  insurance: "Страховка",
  note: "Заметка",
};

export const filters = {
  all: "Вся история",
  service: "ТО",
  oil: "Масло",
  filters: "Фильтры",
  repair: "Ремонт",
  problem: "Проблемы",
  insurance: "Страховка",
};

export class InputError extends Error {}

export function shortId() {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 16);
}

export function localDate(timezone, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone || "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return [values.year, values.month, values.day].join("-");
}

function shiftDate(date, days) {
  const value = new Date(date + "T00:00:00Z");
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function checkedDate(iso, today, allowFuture = false) {
  const value = new Date(iso + "T00:00:00Z");
  if (!Number.isFinite(+value) || value.toISOString().slice(0, 10) !== iso) {
    throw new InputError("Дата не существует. Укажите её в формате ДД.ММ.ГГГГ.");
  }
  if (!allowFuture && iso > today) throw new InputError("Для истории укажите сегодняшнюю или прошедшую дату.");
  return iso;
}

export function clean(value, max) {
  return typeof value === "string"
    ? value.replace(/[\p{Cc}\p{Cf}]+/gu, " ").replace(/\s+/gu, " ").trim().slice(0, max)
    : "";
}

function mileageNumber(raw, thousands = false) {
  const compact = raw.replace(/[\s\u00a0\u202f]/g, "").replace(",", ".");
  const value = Number(compact) * (thousands ? 1000 : 1);
  if (!/^\d+(?:\.\d+)?$/.test(compact) || !Number.isInteger(value) || value > 9_999_999) {
    throw new InputError("Укажите пробег целым числом в километрах, например 86 400.");
  }
  return value;
}

export function parseVehicle(text, today) {
  const parts = text.split("|").map((part) => part.trim());
  if (parts.length > 4) throw new InputError("Укажите до четырёх полей через |.");
  const [name, model = "", year = "", mileage = ""] = parts;
  const nickname = clean(name, 36);
  if (!nickname || name.length > 36 || model.length > 64) {
    throw new InputError("Нужно название до 36 символов. Марка и модель могут занимать до 64 символов.");
  }
  if (year && (!/^\d{4}$/.test(year) || +year < 1886 || +year > +today.slice(0, 4) + 1)) {
    throw new InputError("Укажите год выпуска четырьмя цифрами.");
  }
  return {
    nickname, model: clean(model, 64),
    modelYear: year ? +year : null,
    initialMileage: mileage ? mileageNumber(mileage) : null,
  };
}

const insuranceWords = /осаго|каско|страховк|страховой полис|полис/iu;
const policyEnd = /(?:^|\s)(?:действует\s+)?(?:до|по)\s+(\d{4}-\d{2}-\d{2}|\d{1,2}\.\d{1,2}\.\d{4})(?!\d)/iu;
const rubles = /(?<![\d.,])(?:за\s+|стоимость\s*[:=]?\s*|стоило\s+)?(\d+(?:[ \u00a0\u202f]\d{3})*(?:[.,]\d{1,2})?)\s*(тыс\.?)?\s*(?:₽|руб(?:ль|ля|лей)?\.?(?![а-яё])|р\.(?![а-яё])|RUB\b)/iu;
const labelledCost = /(?:^|\s)(?:за|стоимость|стоило|цена|заплатил[аи]?|оплатил[аи]?)\s*[:=]?\s*(\d+(?:[ \u00a0\u202f]\d{3})*(?:[.,]\d{1,2})?)(?:\s*(тыс\.?))?(?![\d.а-яё]|\s*(?:км|\d))/iu;

function toIso(value) {
  if (!value.includes(".")) return value;
  const [day, month, year] = value.split(".");
  return [year, month.padStart(2, "0"), day.padStart(2, "0")].join("-");
}

function moneyMinor(match) {
  if (!match) return null;
  const digits = match[1].replace(/\s/gu, "").replace(",", ".");
  const cost = Math.round(Number(digits) * (match[2] ? 100_000 : 100));
  if (!Number.isSafeInteger(cost) || cost > 10_000_000_000) {
    throw new InputError("Укажите стоимость в рублях и копейках.");
  }
  return cost;
}

function classify(text) {
  const title = text.toLocaleLowerCase("ru");
  const tags = [];
  if (/(?<![а-яё])масл(?:о|а|у|ом|е)(?![а-яё])|\boil\b/u.test(title)) tags.push("oil");
  if (/фильтр|\bfilter/u.test(title)) tags.push("filters");
  const change = /замен|поменя|смен[аи]|поставил[аи]? нов/u.test(title)
    && !/предстоит|планиру|нужно|надо|надлежит|пора|не (?:замен|поменя|смен)/u.test(title);
  if (change && tags.includes("oil")) tags.push("oil_change");
  if (change && tags.includes("filters")) tags.push("filter_change");
  if (/стук|шум|свист|теч[ьеё]|проблем|вибраци|не завод|не включ|загорел|скрип/u.test(title)
      && !/устранил|исправил|отремонтировал/u.test(title)) {
    return { kind: "problem", tags };
  }
  if (/ремонт|устранил|починил|исправил|отремонтировал/u.test(title)) return { kind: "repair", tags };
  if (change || /^(?:то(?:\s|$)|прош[её]л то\b)|техобслуж|обслуживани[ея]/u.test(title)) {
    return { kind: "service", tags };
  }
  return { kind: "note", tags };
}

export function parseEntry(text, today) {
  const raw = clean(text, 800);
  if (!raw || text.length > 800) throw new InputError("Опишите событие сообщением до 800 символов.");
  let remaining = raw;
  let date = today;
  let validUntil = null;
  const isInsurance = insuranceWords.test(raw);
  if (isInsurance) {
    const end = policyEnd.exec(raw);
    if (end) {
      validUntil = checkedDate(toIso(end[1]), today, true);
      remaining = remaining.replace(end[0], " ");
    }
  }
  const explicitDate = /(?<!\d)(?:\d{4}-\d{2}-\d{2}|\d{1,2}\.\d{1,2}\.\d{4})(?!\d)/u.exec(remaining);
  const relative = /(?:^|\s)(позавчера|вчера|сегодня)(?=\s|[,.!?]|$)/iu.exec(remaining);
  if (explicitDate) {
    date = toIso(explicitDate[0]);
    remaining = remaining.replace(explicitDate[0], " ");
  } else if (relative) {
    const offsets = { позавчера: -2, вчера: -1, сегодня: 0 };
    date = shiftDate(today, offsets[relative[1].toLocaleLowerCase("ru")]);
    remaining = remaining.replace(relative[0], " ");
  }
  checkedDate(date, today);
  if (validUntil && validUntil < date) {
    throw new InputError("Окончание страховки должно быть в день покупки или позже.");
  }
  const distance = /(?<![\d,.])(?:пробег\s*|на\s+)?(\d+(?:[\s\u00a0\u202f]\d{3})*(?:[.,]\d+)?)\s*(тыс\.?\s*)?км(?![а-яё])/iu.exec(remaining)
    || /(?:^|\s)пробег\s+(\d+(?:\s\d{3})*)(?!\d)/iu.exec(remaining);
  const mileage = distance ? mileageNumber(distance[1], Boolean(distance[2])) : null;
  if (distance) remaining = remaining.replace(distance[0], " ");
  const cost = rubles.exec(remaining) || labelledCost.exec(remaining);
  const costMinor = moneyMinor(cost);
  if (cost) remaining = remaining.replace(cost[0], " ");
  const details = clean(remaining, 650).replace(/^[ ,.!:—–-]+|[ ,.!:—–-]+$/gu, "");
  if (!details) throw new InputError("Добавьте описание события, например «заменил масло и фильтр».");
  const classification = isInsurance ? { kind: "insurance", tags: [] } : classify(details);
  return { date, mileage, costMinor, validUntil, title: details.slice(0, 90), details, ...classification };
}

export function formatDate(date) {
  return date.split("-").reverse().join(".");
}

export function formatMileage(value) {
  return value == null ? "Пробег не указан" : new Intl.NumberFormat("ru-RU").format(value) + " км";
}

export function formatCost(costMinor) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    minimumFractionDigits: costMinor % 100 === 0 ? 0 : 2,
  }).format(costMinor / 100);
}
