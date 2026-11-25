import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { parseEntry, parseVehicle } from "../src/domain.js";

const referenceDate = "2026-11-25";
const vehicles = [
  {
    vehicle: "Городской хэтчбек | Kia Rio X | 2019 | 74 200",
    entries: [
      "ТО 16.10.2026 на 73 500 км, заменил масло 5W-30, масляный и салонный фильтры за 8 900 ₽",
      "Ремонт 08.09.2026 на 72 100 км, заменил передние тормозные колодки за 12 400 ₽",
      "Купил ОСАГО 05.10.2026 за 9 650 ₽. Действует до 04.10.2027",
    ],
  },
  {
    vehicle: "Семейный кроссовер | Toyota RAV4 | 2021 | 58 500",
    entries: [
      "ТО 21.08.2026 на 55 000 км, заменил масло 0W-20 и масляный фильтр за 15 800 ₽",
      "Ремонт 04.11.2026 на 58 100 км, заменил задний ступичный подшипник за 26 500 ₽",
      "Купил ОСАГО 12.03.2026 за 13 200 ₽. Действует до 11.03.2027",
    ],
  },
  {
    vehicle: "Рабочий универсал | Lada Vesta SW | 2020 | 108 900",
    entries: [
      "ТО 11.11.2026 на 108 600 км, заменил масло 5W-40, воздушный и топливный фильтры за 11 200 ₽",
      "Ремонт 19.07.2026 на 101 000 км, заменил комплект сцепления за 32 400 ₽",
      "Купил ОСАГО 06.06.2026 за 8 750 ₽. Действует до 05.06.2027",
    ],
  },
];

const quote = (value) => value == null ? "NULL" : "'" + String(value).replaceAll("'", "''") + "'";

export function garageSeedSql(owner) {
  if (typeof owner !== "string" || !/^[1-9]\d{0,15}$/.test(owner)) {
    throw new Error("Задайте OWNER_TELEGRAM_ID.");
  }
  const id = (index, row) => createHash("sha256").update([owner, "garage-fixture", index, row].join(":"))
    .digest("hex").slice(0, 16);
  const statements = ["INSERT OR IGNORE INTO garages (owner_id) VALUES (" + quote(owner) + ");"];
  for (const [index, sample] of vehicles.entries()) {
    const car = parseVehicle(sample.vehicle, referenceDate);
    const carId = id(index, "car");
    const values = [carId, owner, car.nickname, car.model, car.modelYear, car.initialMileage];
    statements.push("INSERT OR IGNORE INTO vehicles (id, owner_id, nickname, model, model_year, initial_mileage) VALUES ("
      + values.map(quote).join(", ") + ");");

    for (const [row, text] of sample.entries.entries()) {
      const entry = parseEntry(text, referenceDate);
      const fields = [id(index, row), owner, carId, entry.date, entry.mileage, entry.kind, entry.title, entry.details,
        JSON.stringify(entry.tags), entry.costMinor, entry.validUntil];
      statements.push("INSERT OR IGNORE INTO entries "
        + "(id, owner_id, vehicle_id, happened_on, mileage, kind, title, details, tags, cost_minor, valid_until) VALUES ("
        + fields.map(quote).join(", ") + ");");
    }
  }
  return statements.join("\n") + "\n";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(garageSeedSql(process.env.OWNER_TELEGRAM_ID));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
