import { richMessage } from "./cards.js";
import { widgetHtml, widgetState } from "./widget.js";

export class TelegramError extends Error {
  constructor(method, code, description = "") {
    super("Telegram " + method + " returned " + code);
    this.method = method;
    this.code = code;
    this.description = description;
  }
}

export async function callTelegramApi(token, method, payload, http = fetch) {
  const form = payload instanceof FormData;
  const response = await http("https://api.telegram.org/bot" + token + "/" + method, {
    method: "POST",
    headers: form ? undefined : { "content-type": "application/json" },
    body: form ? payload : JSON.stringify(payload),
    signal: AbortSignal.timeout(8_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) {
    throw new TelegramError(method, body?.error_code ?? response.status, body?.description);
  }
  return body.result;
}

const matches = (error, pattern) => error instanceof TelegramError &&
  error.code === 400 && pattern.test(error.description);

async function edit(call, method, payload) {
  try {
    await call(method, payload);
  } catch (error) {
    if (!matches(error, /message is not modified|MESSAGE_NOT_MODIFIED/i)) throw error;
  }
}

export async function deliverCard(call, chatId, state, card, preferredStyle) {
  const base = { chat_id: chatId, reply_markup: { inline_keyboard: card.buttons } };
  if (state.messageId) {
    try {
      const target = { chat_id: chatId, message_id: state.messageId };
      if (state.cardStyle === "widget") {
        const { chat_data, caption } = widgetState(card);
        await edit(call, "editMessageWidgetData", { ...target, chat_data });
        await edit(call, "editMessageCaption", { ...base, ...target, caption });
      } else {
        await edit(call, "editMessageText", { ...base, ...target, rich_message: richMessage(card) });
      }
      return { messageId: state.messageId, cardStyle: state.cardStyle || "rich" };
    } catch (error) {
      if (!matches(error, /message to edit not found|message is not found|message can't be edited/i)) throw error;
    }
  }

  if (preferredStyle === "widget" && state.cardStyle !== "rich") {
    try {
      const result = await call("sendWidget", {
        ...base, ...widgetState(card), html: widgetHtml, protect_content: true,
      });
      return { messageId: result.message_id, cardStyle: "widget" };
    } catch (error) {
      if (!matches(error, /INPUT_MEDIA_WIDGET_NOT_ALLOWED|WIDGETS?_NOT_ALLOWED/i)) throw error;
    }
  }

  const result = await call("sendRichMessage", {
    ...base, protect_content: true, rich_message: richMessage(card),
  });
  return { messageId: result.message_id, cardStyle: "rich" };
}
