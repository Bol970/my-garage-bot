import { shortId } from "./domain.js";

export class GarageStore {
  constructor(db, viewer, owner = viewer) {
    this.db = db;
    this.viewer = viewer;
    this.owner = owner;
    this.lease = null;
  }

  get canEdit() {
    return this.viewer === this.owner;
  }

  query(sql, ...args) {
    return this.db.prepare(sql).bind(...args);
  }

  async lock() {
    await this.query("INSERT OR IGNORE INTO garages (owner_id) VALUES (?)", this.viewer).run();
    const token = shortId();
    const now = Date.now();
    const result = await this.query(
      `UPDATE garages SET lease_token = ?, lease_until = ?
        WHERE owner_id = ? AND lease_until <= ?`,
      token, now + 90_000, this.viewer, now,
    ).run();
    if (!result.meta.changes) return false;
    this.lease = token;
    return true;
  }

  async processed(updateId) {
    return Boolean(await this.query(
      "SELECT 1 FROM garage_updates WHERE update_id = ? AND owner_id = ?", updateId, this.viewer,
    ).first());
  }

  async finish(updateId, state) {
    const mark = this.query(
      `INSERT OR IGNORE INTO garage_updates (update_id, owner_id, processed_at)
       SELECT ?, owner_id, ? FROM garages WHERE owner_id = ? AND lease_token = ?`,
      updateId, Date.now(), this.viewer, this.lease,
    );
    if (!state) {
      await mark.run();
      return;
    }
    const save = this.query(
      "UPDATE garages SET state = ? WHERE owner_id = ? AND lease_token = ?",
      JSON.stringify(state), this.viewer, this.lease,
    );
    const [result] = await this.db.batch([save, mark]);
    if (!result.meta.changes) throw new Error("Garage lease expired");
  }

  async release() {
    await this.query(
      "UPDATE garages SET lease_token = NULL, lease_until = 0 WHERE owner_id = ? AND lease_token = ?",
      this.viewer, this.lease,
    ).run();
  }

  async load() {
    const { state } = await this.query("SELECT state FROM garages WHERE owner_id = ?", this.viewer).first();
    return { screen: "garage", filter: "all", page: 0, ...JSON.parse(state) };
  }

  async cars() {
    const { results } = await this.query(
      "SELECT * FROM vehicles WHERE owner_id = ? ORDER BY created_at, id", this.owner,
    ).all();
    return results;
  }

  async vehicle(id) {
    return id
      ? this.query("SELECT * FROM vehicles WHERE owner_id = ? AND id = ?", this.owner, id).first()
      : null;
  }

  async addVehicle(id, vehicle) {
    await this.query(
      `INSERT OR IGNORE INTO vehicles (id, owner_id, nickname, model, model_year, initial_mileage)
       VALUES (?, ?, ?, ?, ?, ?)`,
      id, this.viewer, vehicle.nickname, vehicle.model, vehicle.modelYear, vehicle.initialMileage,
    ).run();
  }

  async addEntry(id, vehicleId, entry) {
    await this.query(
      `INSERT OR IGNORE INTO entries
       (id, owner_id, vehicle_id, happened_on, mileage, kind, title, details, tags, cost_minor, valid_until)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, this.viewer, vehicleId, entry.date, entry.mileage, entry.kind,
      entry.title, entry.details, JSON.stringify(entry.tags), entry.costMinor ?? null, entry.validUntil ?? null,
    ).run();
  }

  async editEntry(id, vehicleId, entry) {
    await this.query(
      `UPDATE entries SET happened_on = ?, mileage = ?, kind = ?, title = ?, details = ?, tags = ?,
       cost_minor = ?, valid_until = ?,
       resolved_on = CASE WHEN kind = 'problem' AND ? = 'problem' AND resolved_on >= ? THEN resolved_on END
       WHERE owner_id = ? AND vehicle_id = ? AND id = ?`,
      entry.date, entry.mileage, entry.kind, entry.title, entry.details, JSON.stringify(entry.tags),
      entry.costMinor ?? null, entry.validUntil ?? null, entry.kind, entry.date, this.viewer, vehicleId, id,
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
      today, this.viewer, vehicleId, id,
    ).run();
  }

  async summary(vehicleId) {
    return this.query(
      `SELECT count(*) AS count,
        max(CASE WHEN kind = 'service' THEN happened_on END) AS last_service,
        max(CASE WHEN EXISTS (SELECT 1 FROM json_each(tags) WHERE value = 'oil_change') THEN happened_on END) AS last_oil,
        max(CASE WHEN EXISTS (SELECT 1 FROM json_each(tags) WHERE value = 'filter_change') THEN happened_on END) AS last_filters,
        max(mileage) AS mileage,
        max(valid_until) AS policy_until,
        sum(cost_minor) AS total_cost,
        count(CASE WHEN kind = 'problem' AND resolved_on IS NULL THEN 1 END) AS open_problems
        FROM entries WHERE owner_id = ? AND vehicle_id = ?`,
      this.owner, vehicleId,
    ).first();
  }
}
