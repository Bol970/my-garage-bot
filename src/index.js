import { garageAccess } from "./access.js";
import { makeView } from "./cards.js";
import { filters, InputError, localDate, parseEntry, parseVehicle, shortId } from "./domain.js";
import { miniApp } from "./mini-app.js";
import { sendOsagoReminders } from "./osago-reminders.js";
import { enrichEntry } from "./openrouter.js";
import { GarageStore } from "./store.js";
import { callTelegramApi, deliverCard, TelegramError } from "./telegram.js";

const viewActions = new Set(["g", "v", "c", "h", "e"]);
const viewScreens = new Set(["garage", "car", "history", "detail"]);
const idPattern = /^[0-9a-f]{16}$/;
const reply = (status = 200) => new Response(status === 200 ? "ok" : null, { status });

function show(state, screen, extra = {}) {
  const { draft, editId, entryId, notice, ...result } = state;
  return { ...result, screen, ...extra };
}

function sameSecret(received, configured) {
  if (!received || !configured || received.length !== configured.length) return false;
  let difference = 0;
  for (let index = 0; index < received.length; index++) {
    difference |= received.charCodeAt(index) ^ configured.charCodeAt(index);
  }
  return difference === 0;
}

async function confirm(store, state, id) {
  if (state.screen !== "preview" || state.draft.id !== id) return state;
  const { draft } = state;
  if (draft.type === "vehicle") {
    await store.addVehicle(draft.id, draft.data);
    return show(state, "car", { vehicleId: draft.id, notice: "Автомобиль добавлен." });
  }
  if (draft.editId) {
    await store.editEntry(draft.editId, state.vehicleId, draft.data);
  } else {
    await store.addEntry(draft.id, state.vehicleId, draft.data);
  }
  return show(state, "detail", {
    entryId: draft.editId || draft.id, notice: draft.editId ? "Изменения сохранены." : "Запись сохранена.",
  });
}

async function callback(store, state, data, today) {
  const [action, value, page] = data.split(":");
  if (action === "g") {
    return show(state, "garage", { vehicleId: null, carPage: Number(value) || 0 });
  }
  if (action === "new-car") return show(state, "vehicle-input", { vehicleId: null });
  if (action === "v" && idPattern.test(value) && await store.vehicle(value)) {
    return show(state, "car", { vehicleId: value });
  }
  if (action === "save" && idPattern.test(value)) return confirm(store, state, value);
  if (!await store.vehicle(state.vehicleId)) return show(state, "garage", { vehicleId: null });

  switch (action) {
    case "c":
      return show(state, "car");
    case "add":
      return show(state, "entry-input");
    case "redo":
      return state.draft?.type === "entry" ?
        show(state, "entry-input", { editId: state.draft.editId }) : state;
    case "h":
      return Object.hasOwn(filters, value) && /^\d{1,5}$/.test(page)
        ? show(state, "history", { filter: value, page: Number(page) }) : state;
    case "e":
    case "edit":
    case "resolve": {
      const entry = idPattern.test(value) && await store.entry(value, state.vehicleId);
      if (!entry) return state;
      if (action === "edit") return show(state, "entry-input", { editId: entry.id });
      if (action === "resolve") await store.resolve(entry.id, state.vehicleId, today);
      return show(state, "detail", { entryId: entry.id });
    }
    default:
      return state;
  }
}

async function message(env, store, state, text, today, http) {
  const command = /^\/([a-z]+)(?:@\w+)?(?:\s|$)/i.exec(text)?.[1]?.toLowerCase();
  if (command === "start" || command === "garage" || command === "help" || command === "cancel") {
    return show(state, "garage", { vehicleId: null, carPage: 0 });
  }
  if (command) return { ...state, notice: "Откройте гараж командой /garage." };
  if (!store.canEdit) return { ...state, notice: "Вам доступен просмотр гаража." };

  try {
    if (state.screen === "vehicle-input" || state.draft?.type === "vehicle") {
      const draft = { id: shortId(), type: "vehicle", data: parseVehicle(text, today) };
      return show(state, "preview", { draft });
    }
    if (await store.vehicle(state.vehicleId)) {
      const data = await enrichEntry(env, parseEntry(text, today), http);
      const draft = { id: shortId(), type: "entry", data, editId: state.editId || state.draft?.editId };
      return show(state, "preview", { draft });
    }
    return { ...state, notice: "Добавьте или выберите автомобиль, чтобы внести запись." };
  } catch (error) {
    if (!(error instanceof InputError)) throw error;
    return { ...state, notice: error.message };
  }
}

function context(update, env) {
  const action = update?.callback_query;
  const source = action?.message || update?.message;
  const user = action?.from || source?.from;
  const access = garageAccess(env, user?.id);
  if (!Number.isSafeInteger(update?.update_id) || source?.chat?.type !== "private" ||
      !access || user.id !== source.chat.id || user.is_bot) return null;
  if (action && (typeof action.id !== "string" || typeof action.data !== "string" || action.data.length > 64)) {
    return null;
  }
  if (!action && typeof source.text !== "string") return null;
  return { source, ...access, action };
}

async function ack(call, id, text) {
  try {
    await call("answerCallbackQuery", {
      callback_query_id: id, ...(text ? { text } : {}),
    });
  } catch (error) {
    if (!(error instanceof TelegramError) || error.code !== 400 ||
        !/query is too old|query ID is invalid|QUERY_ID_INVALID|QUERY_TOO_OLD/i.test(error.description)) throw error;
  }
}

export function createWorker(http = fetch, clock = () => new Date()) {
  return {
    async scheduled(controller, env) {
      await sendOsagoReminders(env, new Date(controller.scheduledTime), http);
    },
    async fetch(request, env) {
      const { pathname } = new URL(request.url);
      if (["/app", "/app.css", "/app.js", "/app/api"].includes(pathname)) {
        return miniApp(request, env, clock(), pathname);
      }
      if (pathname === "/health" && request.method === "GET") return reply();
      if (pathname !== "/telegram/webhook") return reply(404);
      if (request.method !== "POST") return reply(405);
      if (!sameSecret(request.headers.get("X-Telegram-Bot-Api-Secret-Token"), env.TELEGRAM_WEBHOOK_SECRET)) {
        return reply(403);
      }
      if (!env.TELEGRAM_BOT_TOKEN) return reply(503);
      const update = await request.json().catch(() => null);
      const event = context(update, env);
      if (!event) return reply();
      const { source, viewer, owner, action } = event;
      const store = new GarageStore(env.DB, viewer, owner);
      const call = (method, payload) => callTelegramApi(env.TELEGRAM_BOT_TOKEN, method, payload, http);

      try {
        if (!await store.lock()) return reply(503);
        if (await store.processed(update.update_id)) return reply();
        const loaded = await store.load();
        const state = !store.canEdit && !viewScreens.has(loaded.screen)
          ? show(loaded, "garage", { vehicleId: null, carPage: 0 }) : loaded;
        const stale = action && source.message_id !== state.messageId;
        const denied = action && !store.canEdit && !viewActions.has(action.data.split(":")[0]);
        if (action) {
          const notice = stale ? "Карточка обновилась. Откройте /garage."
            : (denied ? "Вам доступен просмотр гаража." : "");
          await ack(call, action.id, notice);
        }
        let savedState;
        if (!stale && !denied) {
          const today = localDate(env.TIMEZONE, clock());
          const next = action ? await callback(store, state, action.data, today)
            : await message(env, store, state, source.text, today, http);
          if (next !== state) {
            const card = await makeView(env, store, next);
            const current = await deliverCard(call, source.chat.id, next, card, env.CARD_STYLE);
            savedState = { ...next, ...current };
          }
        }
        await store.finish(update.update_id, savedState);
        return reply();
      } catch (error) {
        if (error instanceof TelegramError) console.error("Telegram request failed", error.method, error.code);
        else console.error("Garage update failed");
        return reply(503);
      } finally {
        if (store.lease) {
          await store.release().catch(() => console.error("Garage lease release failed"));
        }
      }
    },
  };
}

export default createWorker();
