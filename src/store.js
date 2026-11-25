import { shortId } from "./domain.js";

export class GarageStore {
  constructor(db, owner) {
    this.db = db;
    this.owner = owner;
    this.lease = null;
  }

  query(sql, ...args) {
    return this.db.prepare(sql).bind(...args);
  }

  async lock() {
    await this.query("INSERT OR IGNORE INTO garages (owner_id) VALUES (?)", this.owner).run();
    const token = shortId();
    const now = Date.now();
    const result = await this.query(
      `UPDATE garages SET lease_token = ?, lease_until = ?
        WHERE owner_id = ? AND lease_until <= ?`,
      token, now + 90_000, this.owner, now,
    ).run();
    if (!result.meta.changes) return false;
    this.lease = token;
    return true;
  }

  async processed(updateId) {
    return Boolean(await this.query(
      "SELECT 1 FROM garage_updates WHERE update_id = ? AND owner_id = ?", updateId, this.owner,
    ).first());
  }

  async finish(updateId, state) {
    const mark = this.query(
      `INSERT OR IGNORE INTO garage_updates (update_id, owner_id, processed_at)
       SELECT ?, owner_id, ? FROM garages WHERE owner_id = ? AND lease_token = ?`,
      updateId, Date.now(), this.owner, this.lease,
    );
    if (!state) {
      await mark.run();
      return;
    }
    const save = this.query(
      "UPDATE garages SET state = ? WHERE owner_id = ? AND lease_token = ?",
      JSON.stringify(state), this.owner, this.lease,
    );
    const [result] = await this.db.batch([save, mark]);
    if (!result.meta.changes) throw new Error("Garage lease expired");
  }

  async release() {
    await this.query(
      "UPDATE garages SET lease_token = NULL, lease_until = 0 WHERE owner_id = ? AND lease_token = ?",
      this.owner, this.lease,
    ).run();
  }

  async load() {
    const { state } = await this.query("SELECT state FROM garages WHERE owner_id = ?", this.owner).first();
    return { screen: "garage", filter: "all", page: 0, ...JSON.parse(state) };
  }

  async cars() {
    const { results } = await this.query(
      "SELECT * FROM vehicles WHERE owner_id = ? ORDER BY is_demo, created_at, id", this.owner,
    ).all();
    return results;
  }

  async vehicle(id) {
    return id
      ? this.query("SELECT * FROM vehicles WHERE owner_id = ? AND id = ?", this.owner, id).first()
      : null;
  }

  insertVehicle(id, vehicle, demo = 0) {
    return this.query(
      `INSERT OR IGNORE INTO vehicles (id, owner_id, nickname, model, model_year, initial_mileage, is_demo)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id, this.owner, vehicle.nickname, vehicle.model, vehicle.modelYear, vehicle.initialMileage, demo,
    );
  }

  async addVehicle(id, vehicle) {
    await this.insertVehicle(id, vehicle).run();
  }

  insertEntry(id, vehicleId, entry) {
    return this.query(
      `INSERT OR IGNORE INTO entries
       (id, owner_id, vehicle_id, happened_on, mileage, kind, title, details, tags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, this.owner, vehicleId, entry.date, entry.mileage, entry.kind,
      entry.title, entry.details, JSON.stringify(entry.tags),
    );
  }

  async addEntry(id, vehicleId, entry) {
    await this.insertEntry(id, vehicleId, entry).run();
  }

  async editEntry(id, vehicleId, entry) {
    await this.query(
      `UPDATE entries SET happened_on = ?, mileage = ?, kind = ?, title = ?, details = ?, tags = ?,
       resolved_on = CASE WHEN kind = 'problem' AND ? = 'problem' AND resolved_on >= ? THEN resolved_on END
       WHERE owner_id = ? AND vehicle_id = ? AND id = ?`,
      entry.date, entry.mileage, entry.kind, entry.title, entry.details, JSON.stringify(entry.tags),
      entry.kind, entry.date, this.owner, vehicleId, id,
    ).run();
  }

  async history(vehicleId, filter, offset, limit) {
    const { results } = await this.query(
      `SELECT * FROM entries AS e WHERE owner_id = ? AND vehicle_id = ?
        AND (? = 'all' OR kind = ? OR EXISTS (SELECT 1 FROM json_each(e.tags) WHERE value = ?))
        ORDER BY happened_on DESC, created_at DESC, id DESC LIMIT ? OFFSET ?`,
      this.owner, vehicleId, filter, filter, filter, limit, offset,
    ).all();
    return results;
  }

  async entry(id, vehicleId) {
    return this.query(
      "SELECT * FROM entries WHERE owner_id = ? AND vehicle_id = ? AND id = ?",
      this.owner, vehicleId, id,
    ).first();
  }

  async resolve(id, vehicleId, today) {
    await this.query(
      `UPDATE entries SET resolved_on = ? WHERE owner_id = ? AND vehicle_id = ? AND id = ?
        AND kind = 'problem' AND resolved_on IS NULL`,
      today, this.owner, vehicleId, id,
    ).run();
  }

  async summary(vehicleId) {
    return this.query(
      `SELECT count(*) AS count,
        max(CASE WHEN kind = 'service' THEN happened_on END) AS last_service,
        max(CASE WHEN EXISTS (SELECT 1 FROM json_each(tags) WHERE value = 'oil_change') THEN happened_on END) AS last_oil,
        max(CASE WHEN EXISTS (SELECT 1 FROM json_each(tags) WHERE value = 'filter_change') THEN happened_on END) AS last_filters,
        max(mileage) AS mileage,
        count(CASE WHEN kind = 'problem' AND resolved_on IS NULL THEN 1 END) AS open_problems
        FROM entries WHERE owner_id = ? AND vehicle_id = ?`,
      this.owner, vehicleId,
    ).first();
  }

  async demo() {
    const existing = await this.query(
      "SELECT id FROM vehicles WHERE owner_id = ? AND is_demo = 1 LIMIT 1", this.owner,
    ).first();
    if (existing) return existing.id;
    const id = shortId();
    await this.db.batch([
      this.insertVehicle(id, {
        nickname: "Демо-универсал", model: "Вымышленный автомобиль", modelYear: 2021, initialMileage: 84200,
      }, 1),
      this.insertEntry(shortId(), id, {
        date: "2026-10-15", mileage: 82400, kind: "service", title: "Замена масла и масляного фильтра",
        details: "Моторное масло 5W-30 и масляный фильтр.", tags: ["oil", "filters", "oil_change", "filter_change"],
      }),
      this.insertEntry(shortId(), id, {
        date: "2026-11-10", mileage: 83600, kind: "repair", title: "Замена передних колодок",
        details: "После работ тормоза проверили на короткой поездке.", tags: [],
      }),
      this.insertEntry(shortId(), id, {
        date: "2026-11-20", mileage: 84200, kind: "problem", title: "Стук на неровностях",
        details: "Замечен спереди справа на малой скорости.", tags: [],
      }),
    ]);
    return id;
  }
}
