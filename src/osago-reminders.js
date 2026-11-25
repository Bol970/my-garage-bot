import { formatDate, localDate } from "./domain.js";
import { GarageStore } from "./store.js";
import { callTelegramApi, TelegramError } from "./telegram.js";

const thresholds = [1, 7, 30];
const dayMs = 86_400_000;

function reminderText(policy, days) {
  const remaining = days === 1 ? "Остался 1 день." : "Осталось дней: " + days + ".";
  return "Пора продлить ОСАГО\n\n" + policy.nickname + " · полис до " + formatDate(policy.valid_until) + "\n" + remaining;
}

export async function sendOsagoReminders(env, now, http) {
  const owner = env.OWNER_TELEGRAM_ID;
  if (!env.TELEGRAM_BOT_TOKEN || !/^[1-9]\d*$/.test(owner ?? "") || !Number.isSafeInteger(Number(owner))) return;
  const today = localDate(env.TIMEZONE, now);
  const store = new GarageStore(env.DB, owner);
  const policies = await store.insurancePolicies(today);
  const vehicles = new Set();

  for (const policy of policies) {
    if (!/(?<![\p{L}\p{N}])осаго(?![\p{L}\p{N}])/iu.test(policy.title + " " + policy.details)
        || vehicles.has(policy.vehicle_id)) continue;
    vehicles.add(policy.vehicle_id);
    const days = (Date.parse(policy.valid_until) - Date.parse(today)) / dayMs;
    const threshold = thresholds.find((limit) => days > 0 && days <= limit);
    if (!threshold || !await store.reserveReminder(policy, threshold)) continue;

    try {
      await callTelegramApi(env.TELEGRAM_BOT_TOKEN, "sendMessage", {
        chat_id: Number(owner), text: reminderText(policy, days), protect_content: true,
      }, http);
    } catch (error) {
      // Telegram may have delivered a message before a network timeout. Retry only explicit rejection.
      if (error instanceof TelegramError && error.code >= 400 && error.code < 500) {
        await store.releaseReminder(policy, threshold);
      }
      console.error("OSAGO notification failed", error instanceof TelegramError ? error.code : "transport");
      continue;
    }
    await store.confirmReminder(policy, threshold);
  }
}
