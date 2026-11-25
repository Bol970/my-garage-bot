import { garageAccess } from "./access.js";
import { filters, InputError, localDate, parseEntry, parseVehicle } from "./domain.js";
import { expenseDay, expensePeriod } from "./expenses.js";
import { GarageStore } from "./store.js";
import { appClient } from "./mini-app-client.js";
import { appPage, appStyles } from "./mini-app-page.js";

const encoder = new TextEncoder();
const idPattern = /^[0-9a-f]{16}$/;
const pageSize = 12;
const writeActions = new Set(["create-car", "save-entry", "resolve"]);
const checkActions = new Set(["check-car", "check-entry"]);

async function hmacKey(value) {
  return crypto.subtle.importKey("raw", value, { name: "HMAC", hash: "SHA-256" },
    false, ["sign", "verify"]);
}

async function telegramUser(header, token, now) {
  const data = header?.startsWith("tma ") ? header.slice(4) : "";
  if (!data || data.length > 8192 || !token) return null;
  const fields = new URLSearchParams(data);
  if (new Set(fields.keys()).size !== fields.size) return null;
  const hash = fields.get("hash") ?? "";
  const authDate = Number(fields.get("auth_date"));
  const age = Math.floor(now.getTime() / 1000) - authDate;
  if (!/^[0-9a-f]{64}$/i.test(hash) || !Number.isSafeInteger(authDate) || age < -30 || age > 3600) return null;
  fields.delete("hash");
  fields.sort();
  const check = Array.from(fields, ([key, value]) => key + "=" + value).join("\n");
  const root = await hmacKey(encoder.encode("WebAppData"));
  const key = await hmacKey(await crypto.subtle.sign("HMAC", root, encoder.encode(token)));
  const digest = Uint8Array.from(hash.match(/../g), (value) => Number.parseInt(value, 16));
  if (!await crypto.subtle.verify("HMAC", key, digest, encoder.encode(check))) return null;
  try {
    const user = JSON.parse(fields.get("user"));
    return user?.id ?? null;
  } catch {
    return null;
  }
}

const json = (body, status = 200) => Response.json(body, {
  status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
});

function publicVehicle(car) {
  const { id, nickname, model, model_year, initial_mileage } = car;
  return { id, nickname, model, model_year, initial_mileage };
}

function publicEntry(entry) {
  const { id, happened_on, mileage, kind, title, details, resolved_on, cost_minor, valid_until } = entry;
  return { id, happened_on, mileage, kind, title, details, resolved_on, cost_minor, valid_until };
}

function typedText(payload) {
  if (typeof payload.text !== "string" || !payload.text.trim() || payload.text.length > 800) {
    throw new InputError("Введите текст до 800 символов.");
  }
  return payload.text;
}

function validId(value) {
  return typeof value === "string" && idPattern.test(value);
}

function referenceDate(payload, today) {
  const checked = payload.referenceDate;
  if (checked == null || checked === today) return today;
  const previous = new Date(Date.parse(today) - 86_400_000).toISOString().slice(0, 10);
  if (checked !== previous) throw new InputError("Проверьте запись заново. Изменилась дата.");
  return checked;
}

async function write(store, payload, car, today) {
  if (!await store.lock()) return json({ error: "Гараж обновляется. Повторите попытку." }, 409);
  try {
    if (payload.action === "create-car") {
      if (!validId(payload.id)) throw new InputError("Откройте форму добавления заново.");
      await store.addVehicle(payload.id, parseVehicle(typedText(payload), today));
      return json({ id: payload.id });
    }
    const id = payload.entryId || payload.id;
    if (!validId(id)) throw new InputError("Откройте форму записи заново.");
    if (payload.entryId && !await store.entry(id, car.id)) {
      return json({ error: "Запись не найдена." }, 404);
    }
    if (payload.action === "resolve") {
      if (!payload.entryId) throw new InputError("Выберите проблему из истории.");
      await store.resolve(id, car.id, today);
    } else {
      const entry = parseEntry(typedText(payload), referenceDate(payload, today));
      if (payload.entryId) await store.editEntry(id, car.id, entry);
      else await store.addEntry(id, car.id, entry);
    }
    return json({ id });
  } finally {
    await store.release().catch(() => console.error("Mini App lease release failed"));
  }
}


async function calendar(store, payload, today) {
  const vehicleId = payload.vehicleId ?? null;
  if (vehicleId !== null && (!validId(vehicleId) || !await store.vehicle(vehicleId))) {
    return json({ error: "Автомобиль не найден." }, 404);
  }
  if (payload.action === "expense-day") {
    const day = expenseDay(payload.day);
    const entries = await store.expensesOn(day, vehicleId);
    return json({ day, entries });
  }
  const period = expensePeriod(payload.mode, payload.anchor, today);
  const [rows, vehicles] = await Promise.all([store.expenses(period, vehicleId), store.cars()]);
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  return json({ period, today, rows, total, cars: vehicles.map(publicVehicle) });
}

async function appApi(request, env, now) {
  const actor = await telegramUser(request.headers.get("Authorization"), env.TELEGRAM_BOT_TOKEN, now);
  const access = garageAccess(env, actor);
  if (!access) return json({ error: "Откройте гараж из меню Telegram под разрешённым аккаунтом." }, 403);
  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload.action !== "string") return json({ error: "Не удалось прочитать запрос." }, 400);
  const store = new GarageStore(env.DB, access.viewer, access.owner);

  if ((writeActions.has(payload.action) || checkActions.has(payload.action)) && !store.canEdit) {
    return json({ error: "Вам доступен просмотр гаража." }, 403);
  }

  try {
    const today = localDate(env.TIMEZONE, now);
    if (payload.action === "expenses" || payload.action === "expense-day") {
      return await calendar(store, payload, today);
    }
    if (payload.action === "home") {
      return json({ canEdit: store.canEdit, cars: (await store.cars()).map(publicVehicle) });
    }
    if (payload.action === "check-car") return json(parseVehicle(typedText(payload), today));
    if (payload.action === "create-car") return await write(store, payload, null, today);
    if (payload.action === "check-entry") return json({ ...parseEntry(typedText(payload), today), referenceDate: today });

    const car = validId(payload.vehicleId) ? await store.vehicle(payload.vehicleId) : null;
    if (!car) return json({ error: "Автомобиль не найден." }, 404);
    switch (payload.action) {
      case "car": {
        const filter = Object.hasOwn(filters, payload.filter) ? payload.filter : "all";
        const page = payload.page ?? 0;
        if (!Number.isInteger(page) || page < 0 || page > 10_000) throw new InputError("Некорректная страница истории.");
        const [summary, entries] = await Promise.all([
          store.summary(car.id),
          store.history(car.id, filter, page * pageSize, pageSize + 1),
        ]);
        return json({
          car: publicVehicle(car), summary, entries: entries.slice(0, pageSize).map(publicEntry),
          hasMore: entries.length > pageSize,
        });
      }
      case "entry": {
        const entry = validId(payload.entryId) ? await store.entry(payload.entryId, car.id) : null;
        return entry ? json(publicEntry(entry)) : json({ error: "Запись не найдена." }, 404);
      }
      case "save-entry":
      case "resolve":
        return await write(store, payload, car, today);
      default:
        return json({ error: "Неизвестное действие." }, 400);
    }
  } catch (error) {
    if (error instanceof InputError) return json({ error: error.message }, 400);
    console.error("Mini App request failed");
    return json({ error: "Не удалось обновить гараж. Попробуйте ещё раз." }, 503);
  }
}

const assets = {
  "/app": ["text/html; charset=utf-8", appPage],
  "/app.css": ["text/css; charset=utf-8", appStyles],
  "/app.js": ["application/javascript; charset=utf-8", appClient],
};

export function miniApp(request, env, now, pathname) {
  if (pathname === "/app/api") {
    return request.method === "POST" ? appApi(request, env, now) : json({ error: "Требуется POST." }, 405);
  }
  if (request.method !== "GET") return json({ error: "Требуется GET." }, 405);
  const [type, body] = assets[pathname];
  return new Response(body, { headers: {
    "content-type": type,
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; script-src 'self' https://telegram.org; " +
      "style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'",
  } });
}
