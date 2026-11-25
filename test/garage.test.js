import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createWorker } from "../src/index.js";
import { callTelegramApi } from "../src/telegram.js";
import { parseEntry } from "../src/domain.js";
import { garageSeedSql } from "../scripts/seed-garage.js";

function sqliteD1() {
  const sql = new DatabaseSync(":memory:");
  for (const name of ["0001_garage.sql", "0002_insurance_and_cost.sql", "0003_expenses_and_reminders.sql"]) {
    sql.exec(readFileSync(new URL("../migrations/" + name, import.meta.url), "utf8"));
  }
  return {
    sql,
    prepare(query) {
      const statement = sql.prepare(query);
      return {
        bind(...values) {
          const run = () => ({ meta: statement.run(...values) });
          return {
            run,
            first: () => statement.get(...values) ?? null,
            all: () => ({ results: statement.all(...values) }),
          };
        },
      };
    },
    batch(statements) {
      sql.exec("BEGIN");
      try {
        const result = statements.map((statement) => statement.run());
        sql.exec("COMMIT");
        return result;
      } catch (error) {
        sql.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function harness(style = "rich", widgetAvailable = false, clock = () => new Date("2026-11-25T19:00:00Z")) {
  const DB = sqliteD1();
  const calls = [];
  const cards = new Map();
  let messageId = 50;
  let updateId = 0;
  let editError;
  const http = async (url, request) => {
    const method = new URL(url).pathname.split("/").at(-1);
    const body = JSON.parse(request.body);
    calls.push({ method, body });
    if (method === "answerCallbackQuery") return Response.json({ ok: true, result: true });
    if (method === "sendWidget" && !widgetAvailable) {
      return Response.json({ ok: false, error_code: 400, description: "INPUT_MEDIA_WIDGET_NOT_ALLOWED" },
        { status: 400 });
    }
    if (method === "editMessageText" && editError) {
      const { code, description } = editError;
      editError = null;
      return Response.json({ ok: false, error_code: code, description }, { status: code });
    }
    if (method.startsWith("send")) {
      const result = { ...body, message_id: messageId++ };
      cards.set(body.chat_id, result);
      return Response.json({ ok: true, result });
    }
    assert.equal(body.message_id, cards.get(body.chat_id).message_id);
    const result = { ...cards.get(body.chat_id), ...body };
    cards.set(body.chat_id, result);
    return Response.json({ ok: true, result });
  };
  const worker = createWorker(http, clock);
  const env = {
    DB, CARD_STYLE: style, OWNER_TELEGRAM_ID: "5101", TEACHER_TELEGRAM_ID: "5102",
    TELEGRAM_BOT_TOKEN: "fixture-token", TELEGRAM_WEBHOOK_SECRET: "fixture-secret",
  };
  const send = (update, secret = env.TELEGRAM_WEBHOOK_SECRET) => worker.fetch(
    new Request("https://garage.example/telegram/webhook", {
      method: "POST",
      headers: { "X-Telegram-Bot-Api-Secret-Token": secret },
      body: JSON.stringify(update),
    }),
    env,
  );
  const chat = (id) => ({ chat: { id, type: "private" }, from: { id } });
  const say = (text, id = 5101) => send({ update_id: ++updateId, message: { ...chat(id), text } });
  const press = (data, id = 5101, target = cards.get(id).message_id, event = ++updateId) => send({
    update_id: event,
    callback_query: { id: String(event), data, from: { id }, message: { ...chat(id), message_id: target } },
  });
  const key = (prefix, id = 5101) => cards.get(id).reply_markup.inline_keyboard.flat()
    .map((button) => button.callback_data).find((data) => data.startsWith(prefix));
  return { worker, env, DB, calls, cards, chat, say, press, key, send,
    interruptNextEdit() { editError = { code: 500 }; },
    hidePreviousCard(description) { editError = { code: 400, description }; } };
}

test("гараж, замена и история обновляют одно сообщение", async () => {
  const { DB, calls, cards, say, press, key } = harness();
  await say("/start");
  const messageId = cards.get(5101).message_id;
  await press("new-car");
  await say("Зелёный седан | Example S | 2020 | 86 000");
  assert.equal(DB.sql.prepare("SELECT count(*) AS n FROM vehicles").get().n, 0);
  const confirmed = key("save:");
  await press(confirmed);
  await press("add");
  await say("Вчера на 86 400 км заменил масло 5W-30 и фильтр");
  const preview = cards.get(5101).rich_message.blocks;
  assert(preview.some((block) => block.text?.includes("24.11.2026")));
  assert(preview.some((block) => block.type === "expandable_blockquote" &&
    block.blocks.some((child) => child.text.includes("5W-30"))));
  await press(confirmed);
  assert.equal(DB.sql.prepare("SELECT count(*) AS n FROM entries").get().n, 0);
  const save = key("save:");
  assert.equal((await press(save, 5101, messageId, 4450)).status, 200);
  assert.equal((await press(save, 5101, messageId, 4450)).status, 200);
  assert.equal(DB.sql.prepare("SELECT count(*) AS n FROM entries").get().n, 1);
  await press("c");
  const table = cards.get(5101).rich_message.blocks.find((block) => block.type === "table");
  assert.equal(table.cells[2][1].text, "24.11.2026");
  assert.equal(table.cells[3][1].text, "24.11.2026");
  await press("h:oil:0");
  assert(cards.get(5101).rich_message.blocks.some((block) => block.text?.includes("5W-30")));
  assert.equal(cards.get(5101).message_id, messageId);
  assert.equal(calls.filter(({ method }) => method === "sendRichMessage").length, 1);
  assert(calls.filter(({ method }) => method === "editMessageText").every(({ body }) =>
    body.message_id === messageId && !Object.hasOwn(body, "text")));
});

test("преподаватель читает гараж владельца и не может менять записи", async () => {
  const { DB, calls, cards, chat, send, say, press, key } = harness();
  assert.equal((await send({ update_id: 900, message: { ...chat(5101), text: "/start" } }, "wrong")).status, 403);
  await say("/start", 5103);
  assert.equal(calls.length, 0);
  await say("/start", 5102);
  assert.equal(key("new-car", 5102), undefined);

  await say("/start");
  await press("new-car");
  await say("Зелёный седан");
  await press(key("save:"));
  await say("Сегодня появился стук на неровностях");
  await press(key("save:"));
  const ownerCard = cards.get(5101);
  const entry = DB.sql.prepare("SELECT id, details, resolved_on FROM entries").get();
  await say("/garage", 5102);
  const carControl = key("v:", 5102);
  assert(carControl);
  await press(carControl, 5102);
  assert.equal(key("add", 5102), undefined);
  await press("h:problem:0", 5102);
  await press(key("e:", 5102), 5102);
  assert(cards.get(5102).rich_message.blocks.some((block) => block.text?.includes("стук на неровностях")));
  assert.equal(key("edit:", 5102), undefined);
  assert.equal(key("resolve:", 5102), undefined);

  await press("new-car", 5102);
  await press("edit:" + entry.id, 5102);
  await press("resolve:" + entry.id, 5102);
  await press("save:" + entry.id, 5102);
  await say("Новая запись преподавателя", 5102);
  assert(calls.some(({ method, body }) =>
    method === "answerCallbackQuery" && body.text === "Вам доступен просмотр гаража."));
  assert.equal(DB.sql.prepare("SELECT count(*) AS n FROM vehicles").get().n, 1);
  assert.deepEqual(DB.sql.prepare("SELECT id, details, resolved_on FROM entries").get(), entry);
  assert.equal(cards.get(5101), ownerCard);

  await press(key("resolve:"));
  assert(cards.get(5101).rich_message.blocks.some((block) => block.text === "Решено 25.11.2026"));
  await press("e:" + entry.id, 5102);
  assert(cards.get(5102).rich_message.blocks.some((block) => block.text === "Решено 25.11.2026"));
});

test("страховка и стоимость сохраняются, отображаются и редактируются", async () => {
  const { DB, cards, say, press, key } = harness();
  await say("/start");
  await press("new-car");
  await say("Автомобиль");
  await press(key("save:"));
  await say("Купил ОСАГО 15.11.2026 за 9 800,25 ₽. Действует до 15.11.2027.");
  assert(cards.get(5101).rich_message.blocks.some((b) => b.text === "Дата покупки · 15.11.2026"));
  await press(key("save:"));
  const row = DB.sql.prepare("SELECT kind, happened_on, valid_until, cost_minor FROM entries").get();
  assert.deepEqual({ ...row }, {
    kind: "insurance", happened_on: "2026-11-15", valid_until: "2027-11-15", cost_minor: 980025,
  });
  await press("c");
  const table = cards.get(5101).rich_message.blocks.find((block) => block.type === "table");
  assert.deepEqual(table.cells.at(-1).map((cell) => cell.text), ["Страховка действует до", "15.11.2027"]);
  await press("h:insurance:0");
  await press(key("e:"));
  await press(key("edit:"));
  await say("Купил ОСАГО 15.11.2026 за 8 400 ₽ до 14.11.2027.");
  await press(key("save:"));
  assert.equal(DB.sql.prepare("SELECT count(*) AS n FROM entries").get().n, 1);
  const updated = DB.sql.prepare("SELECT valid_until, cost_minor FROM entries").get();
  assert.deepEqual({ ...updated }, { valid_until: "2027-11-14", cost_minor: 840000 });
  assert.throws(() => parseEntry("Купил ОСАГО 15.11.2026 до 14.11.2026", "2026-11-25"), /покупки/);
});

test("владелец получает три машины с ТО, ремонтом, страховкой и суммой", () => {
  const { sql } = sqliteD1();
  const statements = garageSeedSql("5101");
  sql.exec(statements);
  sql.exec(statements);
  assert.equal(sql.prepare("SELECT count(*) AS n FROM vehicles WHERE owner_id = '5101'").get().n, 3);
  assert.equal(sql.prepare("SELECT count(*) AS n FROM entries WHERE cost_minor > 0").get().n, 9);
  const grouped = sql.prepare("SELECT kind, count(*) AS n FROM entries GROUP BY kind ORDER BY kind").all();
  assert.deepEqual(grouped.map(({ kind, n }) => [kind, n]), [["insurance", 3], ["repair", 3], ["service", 3]]);
  assert.equal(sql.prepare("SELECT count(*) AS n FROM entries WHERE valid_until > happened_on").get().n, 3);
  assert.equal(sql.prepare("SELECT count(*) AS n FROM vehicles WHERE owner_id = '5102'").get().n, 0);
});

test("повтор успешен после временного сбоя редактирования", async () => {
  const { DB, say, press, cards, key, interruptNextEdit } = harness();
  await say("/garage");
  await press("new-car");
  await say("Вымышленная машина");
  const id = cards.get(5101).message_id;
  const save = key("save:");
  interruptNextEdit();
  assert.equal((await press(save, 5101, id, 1900)).status, 503);
  assert.equal((await press(save, 5101, id, 1900)).status, 200);
  assert.equal(DB.sql.prepare("SELECT count(*) AS n FROM vehicles").get().n, 1);
  assert(cards.get(5101).rich_message.blocks.some((block) => block.text === "Автомобиль добавлен."));
});

test("HTML-виджет обновляет chat_data и сохраняет идентификатор", async () => {
  const { calls, cards, say, press } = harness("widget", true);
  await say("/start");
  const id = cards.get(5101).message_id;
  await press("new-car");
  const widgetEdit = calls.find(({ method }) => method === "editMessageWidgetData").body;
  assert.equal(widgetEdit.message_id, id);
  assert.equal(JSON.parse(widgetEdit.chat_data).t, "Новый автомобиль");
  assert(!Object.hasOwn(widgetEdit, "public_data"));
});

test("при запрете виджетов Telegram бот использует Rich Messages", async () => {
  const { calls, say, press } = harness("widget");
  await say("/start");
  await press("new-car");
  assert.deepEqual(calls.map(({ method }) => method),
    ["sendWidget", "sendRichMessage", "answerCallbackQuery", "editMessageText"]);
});

test("упоминание масла и замена масляного фильтра не считаются заменой масла", () => {
  const today = "2026-11-25";
  assert.equal(parseEntry("Появилась течь масла", today).kind, "problem");
  assert(!parseEntry("Появилась течь масла", today).tags.includes("oil_change"));
  assert(!parseEntry("Заменил масляный фильтр", today).tags.includes("oil_change"));
  assert(parseEntry("Заменил масляный фильтр", today).tags.includes("filter_change"));
  assert(!parseEntry("Пора заменить масло", today).tags.includes("oil_change"));
});

test("стоимость словами в тысячах и замена ступицы разбираются правильно", () => {
  const today = "2026-11-25";
  for (const [cost, expected] of [
    ["21 тысяча рублей", 2_100_000],
    ["32 тысячи рублей", 3_200_000],
    ["18 тысяч рублей", 1_800_000],
    ["18 тыщ рублей", 1_800_000],
    ["14,5 тыс. руб.", 1_450_000],
    ["14 тысяч", 1_400_000],
    ["14 тысяч.", 1_400_000],
    ["14 500 ₽", 1_450_000],
    ["14 ₽", 1_400],
  ]) {
    const entry = parseEntry("Замена подшипника ступицы вчера за " + cost, today);
    assert.equal(entry.costMinor, expected, cost);
    assert.equal(entry.kind, "repair");
    assert.equal(entry.date, "2026-11-24");
    assert.equal(entry.title, "Замена подшипника ступицы");
  }
});

test("пробег и стоимость учитывают единицы, а ТО и ремонт распознаются по контексту", () => {
  const today = "2026-11-25";
  assert.equal(parseEntry("Прошёл ТО на 85 тысяч км за 3 500 рублей", today).mileage, 85_000);
  assert.equal(parseEntry("Сделал ТО за 3 500 ₽", today).kind, "service");
  assert.equal(parseEntry("Заменил ступичный подшипник, стук пропал", today).kind, "repair");
  assert.equal(parseEntry("Отремонтировали машину за 2 дня", today).costMinor, null);
  assert.equal(parseEntry("Заменили колодки за 250 евро", today).costMinor, null);
  assert.throws(() => parseEntry("Ремонт генератора за -3000 рублей", today), /стоимость/);
});

function signMiniApp(userId, botToken, at = Date.parse("2026-11-25T19:00:00Z")) {
  const init = new URLSearchParams({
    auth_date: String(at / 1000),
    query_id: "fixture",
    user: JSON.stringify({ id: userId, first_name: "Test" }),
  });
  init.sort();
  const key = createHmac("sha256", "WebAppData").update(botToken).digest();
  const check = Array.from(init, ([name, value]) => name + "=" + value).join("\n");
  init.set("hash", createHmac("sha256", key).update(check).digest("hex"));
  return init.toString();
}

test("Mini App проверяет подпись Telegram и даёт преподавателю только чтение", async () => {
  const { worker, env, DB, calls } = harness();
  const owner = signMiniApp(5101, env.TELEGRAM_BOT_TOKEN);
  const teacher = signMiniApp(5102, env.TELEGRAM_BOT_TOKEN);
  const outsider = signMiniApp(5103, env.TELEGRAM_BOT_TOKEN);
  const old = signMiniApp(5101, env.TELEGRAM_BOT_TOKEN, Date.parse("2026-11-25T12:00:00Z"));
  const call = (data, init = owner) => worker.fetch(new Request("https://garage.example/app/api", {
    method: "POST", body: JSON.stringify(data), headers: { "Authorization": "tma " + init },
  }), env);
  const request = async (data, init) => {
    const response = await call(data, init);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    return response.json();
  };

  for (const init of ["", old, outsider, teacher.replace("5102", "5101"), owner + "&auth_date=1"]) {
    assert.equal((await call({ action: "home" }, init)).status, 403);
  }
  assert.equal((await request({ action: "home" })).canEdit, true);
  const vehicleId = "f101000000000000";
  const entryId = "f200000000000000";
  assert.equal((await request({ action: "check-car", text: "Учётная машина | Example S" })).model, "Example S");
  await request({ action: "create-car", id: vehicleId, text: "Учётная машина | Example S" });
  assert.deepEqual(await request({ action: "home" }, teacher), {
    canEdit: false, cars: [{ id: vehicleId, initial_mileage: null, model: "Example S",
      model_year: null, nickname: "Учётная машина" }],
  });
  const text = "Вчера заменил ступичный подшипник за 18 тысяч рублей";
  const preview = await request({ action: "check-entry", text });
  assert.equal(preview.costMinor, 1_800_000);
  assert.equal(preview.date, "2026-11-24");
  assert.equal(preview.kind, "repair");
  assert.equal(DB.sql.prepare("SELECT count(*) AS n FROM entries").get().n, 0);
  const save = { action: "save-entry", vehicleId, id: entryId, text };
  assert.equal((await call(save, teacher)).status, 403);
  await request(save);
  await request(save);
  assert.equal(DB.sql.prepare("SELECT count(*) AS n FROM entries").get().n, 1);
  const car = await request({ action: "car", vehicleId, filter: "repair" }, teacher);
  assert.equal(car.entries[0].cost_minor, 1_800_000);
  assert.equal(car.summary.total_cost, 1_800_000);
  assert.equal((await request({ action: "entry", vehicleId, entryId }, teacher)).kind, "repair");
  assert.equal((await call({ action: "save-entry", vehicleId, entryId, text }, teacher)).status, 403);
  assert.equal((await call({ action: "resolve", vehicleId, entryId }, teacher)).status, 403);
  assert.equal(calls.length, 0, "Mini App does not post to Telegram");

  const page = await worker.fetch(new Request("https://garage.example/app"), env);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /telegram-web-app\.js/);
  const script = await worker.fetch(new Request("https://garage.example/app.js"), env);
  const js = await script.text();
  assert.doesNotThrow(() => new Function(js));
  assert.match(script.headers.get("Content-Type"), /javascript/);
});

test("Mini App сохраняет подтверждённую дату после полуночи", async () => {
  let now = new Date("2026-11-25T20:59:00Z");
  const { worker, env, DB } = harness("rich", false, () => now);
  const init = signMiniApp(5101, env.TELEGRAM_BOT_TOKEN, +now);
  const request = async (payload) => {
    const response = await worker.fetch(new Request("https://garage.example/app/api", {
      method: "POST", body: JSON.stringify(payload), headers: { Authorization: "tma " + init },
    }), env);
    assert.equal(response.status, 200);
    return response.json();
  };

  const vehicleId = "f101000000000000";
  await request({ action: "create-car", id: vehicleId, text: "Автомобиль" });
  const text = "Вчера заменил масло";
  const preview = await request({ action: "check-entry", text });
  assert.equal(preview.date, "2026-11-24");
  now = new Date("2026-11-25T21:01:00Z");
  await request({ action: "save-entry", vehicleId, id: "f200000000000000", text,
    referenceDate: preview.referenceDate });
  assert.equal(DB.sql.prepare("SELECT happened_on FROM entries").get().happened_on, "2026-11-24");
});

test("меню Mini App передаётся как форма Telegram", async () => {
  const button = { type: "web_app", text: "Гараж", web_app: { url: "https://garage.example/app" } };
  const fields = new URLSearchParams({ menu_button: JSON.stringify(button) });
  const checked = await callTelegramApi("fixture-token", "setChatMenuButton", fields, async (url, init) => {
    const request = new Request(url, init);
    assert.match(request.headers.get("Content-Type"), /^application\/x-www-form-urlencoded/);
    assert.deepEqual(JSON.parse(new URLSearchParams(await request.text()).get("menu_button")), button);
    return Response.json({ ok: true, result: true });
  });
  assert.equal(checked, true);
});

test("календарь суммирует расходы за месяц, квартал и год по всем машинам и по одной", async () => {
  const { worker, env, DB } = harness();
  DB.sql.exec(garageSeedSql("5101"));
  const outsider = "5103";
  const request = (data, id = 5101) => worker.fetch(new Request("https://garage.example/app/api", {
    method: "POST", body: JSON.stringify(data),
    headers: { Authorization: "tma " + signMiniApp(id, env.TELEGRAM_BOT_TOKEN) },
  }), env);
  const read = async (data, id) => {
    const response = await request(data, id);
    assert.equal(response.status, 200);
    return response.json();
  };
  const november = await read({ action: "expenses", mode: "month" });
  assert.equal(november.period.start, "2026-11-01");
  assert.equal(november.period.end, "2026-12-01");
  assert.equal(november.total, 3_770_000);
  assert.deepEqual(november.rows.map(({ bucket }) => bucket), ["2026-11-04", "2026-11-11"]);
  assert.equal(november.cars.length, 3);
  const kia = november.cars.find((car) => car.model === "Kia Rio X").id;
  const rav4 = november.cars.find((car) => car.model === "Toyota RAV4").id;

  const quarter = await read({ action: "expenses", mode: "quarter", anchor: "2026-11" });
  assert.equal(quarter.total, 5_625_000);
  assert.equal(quarter.period.start, "2026-10-01");
  assert.equal(quarter.period.end, "2027-01-01");
  assert.equal(quarter.period.next, "2027-01");
  assert.deepEqual(quarter.rows.map(({ bucket }) => bucket), ["2026-10", "2026-11"]);
  assert.equal((await read({ action: "expenses", mode: "quarter", anchor: "2026-12", vehicleId: kia })).total, 1_855_000);
  assert.equal((await read({ action: "expenses", mode: "year", anchor: "2026-11" }, 5102)).total, 13_880_000);
  assert.equal((await read({ action: "expenses", mode: "year", anchor: "2026-02", vehicleId: rav4 })).total, 5_550_000);

  const yearList = await read({ action: "expenses", mode: "year", anchor: "2026-11", display: "list" }, 5102);
  assert.equal(yearList.total, 13_880_000);
  assert.equal(yearList.entries.length, 9);
  assert.equal(yearList.entries[0].happened_on, "2026-11-11");
  assert.equal(new Set(yearList.entries.map((entry) => entry.vehicle_id)).size, 3);
  const scopedList = await read({ action: "expenses", mode: "year", anchor: "2026-02", vehicleId: rav4, display: "list" });
  assert.equal(scopedList.total, 5_550_000);
  assert.equal(scopedList.entries.length, 3);
  assert(scopedList.entries.every((entry) => entry.vehicle_id === rav4));

  const insert = DB.sql.prepare(
    "INSERT INTO entries (id, owner_id, vehicle_id, happened_on, kind, title, cost_minor) VALUES (?, '5101', ?, '2026-03-25', 'repair', 'Работа', 1000)",
  );
  for (let i = 0; i < 22; i++) insert.run("extra-fixture-" + i, rav4);
  const requestPage = { action: "expenses", mode: "month", anchor: "2026-03", display: "list", vehicleId: rav4 };
  const first = await read(requestPage);
  const second = await read({ ...requestPage, page: 1 });
  assert.equal(first.total, 1_342_000);
  assert.equal(second.total, first.total);
  assert.equal(first.entries.length, 20);
  assert.equal(second.entries.length, 3);
  assert.equal(new Set([...first.entries, ...second.entries].map((entry) => entry.id)).size, 23);
  assert.equal(first.hasMore, true);
  assert.equal(second.hasMore, false);

  const day = await read({ action: "expense-day", day: "2026-11-04" }, 5102);
  assert.equal(day.entries[0].vehicle_id, rav4);
  assert.equal(day.entries[0].cost_minor, 2_650_000);
  assert.deepEqual((await read({ action: "expense-day", day: "2026-11-04", vehicleId: kia })).entries, []);
  assert.equal((await request({ action: "expenses", mode: "month" }, Number(outsider))).status, 403);
  assert.equal((await request({ action: "expenses", mode: "month", anchor: "2026-13" })).status, 400);
  assert.equal((await request({ action: "expense-day", day: "2026-02-29" })).status, 400);
  assert.equal((await request({ action: "expenses", mode: "year", vehicleId: "ffffffffffffffff" })).status, 404);
});

test("ОСАГО уведомляет владельца за 30, 7 и 1 день и не дублирует уведомления", async () => {
  const { worker, env, DB, calls } = harness();
  DB.sql.exec(garageSeedSql("5101"));
  const vehicle = DB.sql.prepare("SELECT id FROM vehicles WHERE model = 'Toyota RAV4'").get().id;
  const addPolicy = DB.sql.prepare(
    "INSERT INTO entries (id, owner_id, vehicle_id, happened_on, kind, title, valid_until) VALUES (?, ?, ?, ?, 'insurance', ?, ?)",
  );
  addPolicy.run("fixture-kasko", "5101", vehicle, "2026-11-15", "Купил КАСКО", "2027-03-05");
  addPolicy.run("fixture-older", "5101", vehicle, "2026-02-01", "Купил ОСАГО", "2027-02-20");
  const tick = (date) => worker.scheduled({ scheduledTime: Date.parse(date + "T07:00:00Z") }, env);
  await tick("2027-02-08");
  assert.equal(calls.length, 0);
  await Promise.all([tick("2027-02-09"), tick("2027-02-09")]);
  await tick("2027-02-10");
  await tick("2027-03-04");
  await tick("2027-03-10");
  await tick("2027-03-11");
  assert.deepEqual(calls.map(({ method }) => method), ["sendMessage", "sendMessage", "sendMessage"]);
  assert(calls.every(({ body }) => body.chat_id === 5101 && body.protect_content && body.text.includes("11.03.2027")));
  assert(calls[0].body.text.includes("30"));
  assert(calls[1].body.text.includes("7"));
  assert(calls[2].body.text.includes("1 день"));
  const sent = DB.sql.prepare("SELECT days_before, sent_at FROM osago_reminders ORDER BY days_before").all();
  assert.deepEqual(sent.map(({ days_before }) => days_before), [1, 7, 30]);
  assert(sent.every(({ sent_at }) => sent_at));
});

test("напоминание учитывает продление ОСАГО и догоняет ближайший срок", async () => {
  const { worker, env, DB, calls } = harness();
  DB.sql.exec(garageSeedSql("5101"));
  const vehicle = DB.sql.prepare("SELECT id FROM vehicles WHERE model = 'Toyota RAV4'").get().id;
  const tick = (date) => worker.scheduled({ scheduledTime: Date.parse(date + "T07:00:00Z") }, env);
  await tick("2027-02-15");
  assert.equal(calls.length, 1);
  assert(calls[0].body.text.includes("24"));
  DB.sql.prepare(
    "INSERT INTO entries (id, owner_id, vehicle_id, happened_on, kind, title, valid_until) VALUES (?, ?, ?, ?, 'insurance', ?, ?)",
  ).run("fixture-renewal", "5101", vehicle, "2027-02-20", "ОСАГО продлено", "2028-03-11");
  await tick("2027-03-04");
  assert.equal(calls.length, 1);
});

test("отклонённое Telegram напоминание можно отправить повторно", async () => {
  const { env, DB } = harness();
  DB.sql.exec(garageSeedSql("5101"));
  let attempts = 0;
  const worker = createWorker(async () => {
    attempts++;
    return attempts === 1
      ? Response.json({ ok: false, error_code: 429 }, { status: 429 })
      : Response.json({ ok: true, result: { message_id: 7 } });
  });
  const at = Date.parse("2027-02-09T07:00:00Z");
  await worker.scheduled({ scheduledTime: at }, env);
  assert.equal(DB.sql.prepare("SELECT count(*) AS n FROM osago_reminders").get().n, 0);
  await worker.scheduled({ scheduledTime: at }, env);
  await worker.scheduled({ scheduledTime: at }, env);
  assert.equal(attempts, 2);
  assert.equal(DB.sql.prepare("SELECT count(sent_at) AS n FROM osago_reminders").get().n, 1);
});

test("Telegram-команды открывают календарь и список по гаражу и автомобилю", async () => {
  const { DB, say, press, cards, key, calls } = harness();
  DB.sql.exec(garageSeedSql("5101"));
  const car = DB.sql.prepare("SELECT id, nickname FROM vehicles WHERE model = 'Toyota RAV4'").get();
  const blocks = (id = 5101) => cards.get(id).rich_message.blocks;
  const texts = (id = 5101) => blocks(id).map(({ text }) => text?.replace(/\s+/gu, " ")).filter(Boolean);
  assert.equal((await say("/expenses year all")).status, 200);
  const messageId = cards.get(5101).message_id;
  assert(texts().includes("Расходы списком"));
  assert(texts().includes("Весь гараж"));
  assert(texts().includes("За период · 138 800 ₽"));
  assert(key("x:page:1"));
  await press("x:page:1");
  assert(texts().some((line) => line.includes("12.03.2026")));

  await say("/calendar quarter all");
  assert(texts().includes("Календарь расходов"));
  assert(texts().includes("За период · 56 250 ₽"));
  const quarter = blocks().find((block) => block.type === "table");
  assert.equal(quarter.cells.length, 4);

  await press("x:scope:0");
  assert.equal(texts()[0], "Расходы по автомобилю");
  await press("x:vehicle:" + car.id);
  assert(texts().includes(car.nickname));
  assert(texts().includes("За период · 26 500 ₽"));
  await press("x:display:list");
  assert(texts().includes("Расходы списком"));
  assert(texts().includes(car.nickname));
  await press(key("x:entry:"));
  assert(texts().some((line) => line.includes("ступичный подшипник")));
  await press("x:back");
  assert.equal(texts()[0], "Расходы списком");
  assert.equal(cards.get(5101).message_id, messageId);

  await say("/calendar month car", 5102);
  assert.equal(texts(5102)[0], "Расходы по автомобилю");
  await press("x:vehicle:" + car.id, 5102);
  const month = blocks(5102).find((block) => block.type === "table");
  assert.equal(month.cells[0].length, 7);
  assert(month.cells.some((row) => row.some((cell) => cell.text.includes("₽"))));
  assert.equal(key("edit:", 5102), undefined);
  assert.equal(calls.filter(({ method, body }) => method === "sendRichMessage" && body.chat_id === 5101).length, 1);

  await say("/garage");
  assert(key("x:garage"));
  await press("v:" + car.id);
  await press("x:current");
  assert(texts().includes(car.nickname));
  await press("x:all");
  assert(texts().includes("Весь гараж"));
  assert(texts().includes("За период · 37 700 ₽"));
});

test("команда /garage открывает видимую карточку даже если Telegram ещё позволяет менять скрытую", async () => {
  const { cards, calls, DB, chat, press, say, send } = harness();
  DB.sql.exec(garageSeedSql("5101"));
  await say("/start");
  const oldId = cards.get(5101).message_id;
  const update = { update_id: 999, message: { ...chat(5101), text: "/garage" } };
  assert.equal((await send(update)).status, 200);
  const newId = cards.get(5101).message_id;
  assert.notEqual(newId, oldId);
  assert.equal((await send(update)).status, 200);
  assert.deepEqual(calls.map(({ method }) => method), ["sendRichMessage", "sendRichMessage"]);

  await press("x:garage", 5101, oldId);
  assert.equal(calls.at(-1).method, "answerCallbackQuery");
  assert.equal(calls.at(-1).body.text, "Карточка обновилась. Откройте /garage.");
  await press("x:garage");
  assert.equal(calls.at(-1).method, "editMessageText");
  assert.equal(calls.at(-1).body.message_id, newId);
  assert(cards.get(5101).rich_message.blocks.some((block) => block.text === "Расходы списком"));
  assert.equal(DB.sql.prepare("SELECT count(*) AS n FROM entries").get().n, 9);
});

test("удалённая карточка переоткрывается при MESSAGE_ID_INVALID", async () => {
  const { cards, calls, say, hidePreviousCard } = harness();
  await say("/garage");
  const oldId = cards.get(5101).message_id;
  hidePreviousCard("Bad Request: MESSAGE_ID_INVALID");
  assert.equal((await say("/calendar")).status, 200);
  assert.notEqual(cards.get(5101).message_id, oldId);
  assert.deepEqual(calls.map(({ method }) => method), ["sendRichMessage", "editMessageText", "sendRichMessage"]);
});
