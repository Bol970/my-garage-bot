import { readFile } from "node:fs/promises";
import { callTelegramApi, TelegramError } from "../src/telegram.js";

const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const target = URL.parse(process.argv[2] || "");
if (!token || !secret || !/^[A-Za-z0-9_-]{1,256}$/.test(secret) || target?.protocol !== "https:" ||
    target.username || target.password || target.search || target.hash) {
  console.error("Укажите TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET и HTTPS-адрес Worker.");
  process.exit(1);
}

const call = (method, payload) => callTelegramApi(token, method, payload);

try {
  await call("setMySettings", {
    can_join_groups: false, supports_inline_queries: false, callback_query_mode: "default",
  });
  await call("setMyCommands", {
    commands: [
      { command: "garage", description: "Открыть гараж" },
      { command: "cancel", description: "Вернуться в гараж" },
    ],
  });
  const image = await readFile(new URL("../assets/avatar.jpg", import.meta.url));
  const photo = new FormData();
  photo.append("photo", JSON.stringify({ type: "static", photo: "attach://avatar" }));
  photo.append("avatar", new Blob([image], { type: "image/jpeg" }), "avatar.jpg");
  await call("setMyProfilePhoto", photo);
  await call("setWebhook", {
    url: new URL("/telegram/webhook", target).href,
    secret_token: secret,
    allowed_updates: ["message", "callback_query"],
  });
  console.log("Аватарка, меню и вебхук настроены.");
} catch (error) {
  console.error(error instanceof TelegramError ? error.message : "Не удалось настроить бота.");
  process.exitCode = 1;
}
