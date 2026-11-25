import { filters, formatDate, formatMileage, kinds } from "./domain.js";

const size = 5;
const button = (text, callback_data) => ({ text, callback_data });
const garage = button("‹ Гараж", "g");
const carButton = button("‹ Автомобиль", "c");
const history = button("История", "h:all:0");
const addEntry = button("＋ Запись", "add");
const date = (value) => value ? formatDate(value) : "—";

function vehicleInfo(car) {
  return [car.model, car.model_year, car.is_demo ? "Демо" : ""].filter(Boolean).join(" · ");
}

function entryInfo(entry) {
  return [
    formatDate(entry.happened_on),
    entry.mileage == null ? "" : formatMileage(entry.mileage),
    entry.kind === "problem" ? (entry.resolved_on ? "Решено" : "Открыто") : kinds[entry.kind],
  ].filter(Boolean).join(" · ");
}

function view(title, lines, buttons, details = [], table = []) {
  return { title, lines: lines.filter(Boolean), buttons, details: details.filter(Boolean), table };
}

export async function makeView(env, store, state) {
  const car = await store.vehicle(state.vehicleId);
  const carName = car?.nickname || "";
  let card;

  switch (state.screen) {
    case "garage": {
      const cars = await store.cars();
      const page = Math.max(0, Math.min(state.carPage || 0, Math.ceil(cars.length / size) - 1));
      const choices = cars.slice(page * size, (page + 1) * size);
      const navigation = [
        ...(page > 0 ? [button("‹", "g:" + (page - 1))] : []),
        ...((page + 1) * size < cars.length ? [button("›", "g:" + (page + 1))] : []),
      ];
      card = view(env.APP_NAME || "Мой гараж",
        choices.length ? choices.map((item) => [item.nickname, vehicleInfo(item)].filter(Boolean).join(" · "))
          : ["Добавьте автомобиль, чтобы начать журнал."],
        [...choices.map((item) => [button(item.nickname, "v:" + item.id)]),
          ...(navigation.length ? [navigation] : []),
          [button("＋ Автомобиль", "new-car"), button("Демо", "demo")]],
        ["Выберите автомобиль для просмотра последних замен и истории.",
          "Демо создаёт отдельную карточку с вымышленными записями."]);
      break;
    }
    case "vehicle-input":
      card = view("Новый автомобиль", [
        "Отправьте название одним сообщением.",
        "Марку, год и пробег можно добавить через |.",
        "Пример: Ласточка | Toyota Corolla | 2020 | 86 400",
      ], [[garage]]);
      break;
    case "car": {
      const summary = await store.summary(car.id);
      const mileage = Math.max(car.initial_mileage ?? -1, summary.mileage ?? -1);
      card = view(carName, [
        vehicleInfo(car),
        mileage >= 0 ? "Пробег · " + formatMileage(mileage) : "",
        "Записей · " + summary.count + "   •   Открытых проблем · " + summary.open_problems,
      ], [[addEntry, history], [garage]], [
        "Откройте историю, чтобы посмотреть записи по маслу, фильтрам, ремонту и проблемам.",
      ], [
        ["Обслуживание", "Дата"],
        ["Последнее ТО", date(summary.last_service)],
        ["Замена масла", date(summary.last_oil)],
        ["Замена фильтров", date(summary.last_filters)],
      ]);
      break;
    }
    case "history": {
      const { page, filter } = state;
      const entries = await store.history(car.id, filter, page * size, size + 1);
      const shown = entries.slice(0, size);
      const navigation = [
        ...(page > 0 ? [button("‹", "h:" + filter + ":" + (page - 1))] : []),
        ...(entries.length > size ? [button("›", "h:" + filter + ":" + (page + 1))] : []),
      ];
      const pick = (key) => button((key === filter ? "✓ " : "") + filters[key], "h:" + key + ":0");
      card = view(carName + " · " + filters[filter],
        shown.map((entry, i) => (i + 1) + ". " + entry.title + " · " + entryInfo(entry))
          .concat(shown.length ? [] : ["В этом разделе пока нет записей."]),
        [...shown.map((entry, i) => [button((i + 1) + ". " + entry.title.slice(0, 34), "e:" + entry.id)]),
          ...(navigation.length ? [navigation] : []),
          [pick("all"), pick("service"), pick("oil")],
          [pick("filters"), pick("repair"), pick("problem")], [carButton, addEntry]]);
      break;
    }
    case "entry-input":
      card = view(state.editId ? "Исправить запись" : "Новая запись", [
        carName,
        "Отправьте описание одним сообщением. Если даты нет, подставлю сегодняшнюю.",
        "Пример: вчера на 86 400 км заменил масло 5W-30 и фильтр.",
      ], [[carButton]]);
      break;
    case "preview": {
      const { draft } = state;
      const data = draft.data;
      card = draft.type === "vehicle" ? view("Проверьте автомобиль", [
        data.nickname, data.model, data.modelYear ? String(data.modelYear) : "", formatMileage(data.initialMileage),
      ], [[button("Сохранить", "save:" + draft.id)], [button("Исправить", "new-car"), garage]]) :
        view("Проверьте запись", [
          carName, data.title, kinds[data.kind] + " · " + formatDate(data.date), formatMileage(data.mileage),
        ], [[button("Сохранить", "save:" + draft.id)], [button("Исправить", "redo"), carButton]], [data.details]);
      break;
    }
    case "detail": {
      const entry = await store.entry(state.entryId, car.id);
      const controls = [button("Исправить", "edit:" + entry.id)];
      if (entry.kind === "problem" && !entry.resolved_on) controls.push(button("Проблема решена", "resolve:" + entry.id));
      card = view(entry.title, [
        carName, entryInfo(entry), entry.resolved_on ? "Решено " + formatDate(entry.resolved_on) : "",
      ], [controls, [carButton, history]], [entry.details]);
      break;
    }
    default:
      throw new Error("Unknown garage screen");
  }
  if (state.notice) card.lines.unshift(state.notice);
  return card;
}

export function richMessage(card) {
  const paragraph = (text) => ({ type: "paragraph", text });
  return {
    blocks: [
      { type: "heading", size: 2, text: card.title },
      ...card.lines.map(paragraph),
      ...(card.table.length ? [{
        type: "table", is_bordered: true, is_compact: true,
        cells: card.table.map((row, i) => row.map((text) => i === 0 ? { text, is_header: true } : { text })),
      }] : []),
      ...(card.details.length ? [{ type: "expandable_blockquote", blocks: card.details.map(paragraph) }] : []),
    ],
  };
}
