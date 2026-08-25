import type Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const SIDECAR_SCHEMA = 'trekforge';
const LEGACY_IMPORT_ID = 'legacy-core-columns-v1';
const PRE_V33_UPSTREAM_SCHEMA_VERSION = 160;
const LAST_LEGACY_FORK_SCHEMA_VERSION = 176;

export interface TripSettings {
  schedule_margin_minutes: number;
  routing_provider: 'osrm' | 'google_maps' | 'google_maps_mobile';
  routing_optimism: number;
  routing_avoid_tolls: number;
  routing_avoid_highways: number;
  routing_avoid_ferries: number;
}

export interface AssignmentSettings {
  duration_minutes: number;
  margin_before_minutes: number;
  margin_after_minutes: number;
}

/** Per-assignment routing override; null clears it back to the trip-wide profile. */
export type AssignmentTransportMode = 'driving' | 'walking' | 'cycling' | 'transit';

function tableExists(db: Database.Database, table: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function columnExists(db: Database.Database, table: string, column: string): boolean {
  if (!tableExists(db, table)) return false;
  return Boolean(
    db.prepare(`SELECT 1 FROM pragma_table_info('${table.replace(/'/g, "''")}') WHERE name = ?`).get(column),
  );
}

function attached(db: Database.Database): boolean {
  return (db.prepare('PRAGMA database_list').all() as Array<{ name: string }>).some(
    (row) => row.name === SIDECAR_SCHEMA,
  );
}

export function resolveTrekForgeDbPath(coreDbPath: string): string {
  if (process.env.TREK_FORGE_DB_FILE) return process.env.TREK_FORGE_DB_FILE;
  if (coreDbPath === ':memory:') return ':memory:';
  return path.join(path.dirname(coreDbPath), 'trekforge.db');
}

/** Rewind only recognizable legacy fork databases so upstream can apply 161+. */
export function prepareLegacyForkUpgrade(db: Database.Database): void {
  if (!tableExists(db, 'schema_version') || !columnExists(db, 'trips', 'schedule_margin_minutes')) return;

  const current = db.prepare('SELECT version FROM schema_version LIMIT 1').get() as { version: number } | undefined;
  if (
    !current ||
    current.version <= PRE_V33_UPSTREAM_SCHEMA_VERSION ||
    current.version > LAST_LEGACY_FORK_SCHEMA_VERSION
  ) return;

  const hasUpstream161To165 =
    tableExists(db, 'plugin_entity_metadata') &&
    columnExists(db, 'budget_settlements', 'currency') &&
    columnExists(db, 'users', 'display_name') &&
    columnExists(db, 'plugins', 'dependencies') &&
    tableExists(db, 'plugin_user_config');

  if (!hasUpstream161To165) {
    db.prepare('UPDATE schema_version SET version = ?').run(PRE_V33_UPSTREAM_SCHEMA_VERSION);
    console.log(
      `[TrekForge] Rewound legacy fork schema ${current.version} to upstream ${PRE_V33_UPSTREAM_SCHEMA_VERSION} for compatibility`,
    );
  }
}

export function initializeTrekForgeDb(db: Database.Database, coreDbPath = ':memory:'): void {
  // Several isolated unit tests replace the database module with a narrow mock
  // because the code under test never touches persistence. Do not turn module
  // loading itself into a database requirement for those tests.
  const candidate = db as unknown as { prepare?: (sql: string) => unknown; exec?: (sql: string) => unknown } | null;
  if (!candidate || typeof candidate.prepare !== 'function' || typeof candidate.exec !== 'function') return;
  try {
    const probe = candidate.prepare('PRAGMA database_list') as { all?: () => unknown } | undefined;
    if (!probe || typeof probe.all !== 'function') return;
  } catch {
    return;
  }

  if (!attached(db)) {
    const sidecarPath = resolveTrekForgeDbPath(coreDbPath);
    if (sidecarPath !== ':memory:') fs.mkdirSync(path.dirname(sidecarPath), { recursive: true });
    db.prepare(`ATTACH DATABASE ? AS ${SIDECAR_SCHEMA}`).run(sidecarPath);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS ${SIDECAR_SCHEMA}.schema_changes (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS ${SIDECAR_SCHEMA}.trip_settings (
      trip_id INTEGER PRIMARY KEY,
      schedule_margin_minutes INTEGER NOT NULL DEFAULT 0,
      routing_provider TEXT NOT NULL DEFAULT 'osrm',
      routing_optimism REAL NOT NULL DEFAULT 0.33,
      routing_avoid_tolls INTEGER NOT NULL DEFAULT 0,
      routing_avoid_highways INTEGER NOT NULL DEFAULT 0,
      routing_avoid_ferries INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS ${SIDECAR_SCHEMA}.day_settings (
      day_id INTEGER PRIMARY KEY,
      wake_up_time TEXT
    );
    CREATE TABLE IF NOT EXISTS ${SIDECAR_SCHEMA}.assignment_settings (
      assignment_id INTEGER PRIMARY KEY,
      duration_minutes INTEGER NOT NULL DEFAULT 60,
      margin_before_minutes INTEGER NOT NULL DEFAULT 0,
      margin_after_minutes INTEGER NOT NULL DEFAULT 0,
      transport_mode TEXT
    );
  `);

  // Sidecar DBs created before the per-assignment transport-mode override need
  // the column added in place (CREATE TABLE IF NOT EXISTS won't touch them).
  if (
    db.prepare(`SELECT 1 FROM ${SIDECAR_SCHEMA}.sqlite_master WHERE type = 'table' AND name = 'assignment_settings'`).get() &&
    !db.prepare(`SELECT 1 FROM ${SIDECAR_SCHEMA}.pragma_table_info('assignment_settings') WHERE name = 'transport_mode'`).get()
  ) {
    db.exec(`ALTER TABLE ${SIDECAR_SCHEMA}.assignment_settings ADD COLUMN transport_mode TEXT`);
  }

  if (tableExists(db, 'trips') && tableExists(db, 'days') && tableExists(db, 'day_assignments')) {
    importLegacyCoreColumns(db);
    pruneTrekForgeData(db);
  }
}

function importLegacyCoreColumns(db: Database.Database): void {
  const imported = db.prepare(`SELECT 1 FROM ${SIDECAR_SCHEMA}.schema_changes WHERE id = ?`).get(LEGACY_IMPORT_ID);
  if (imported) return;

  db.transaction(() => {
    if (columnExists(db, 'trips', 'schedule_margin_minutes')) {
      const provider = columnExists(db, 'trips', 'routing_provider') ? "COALESCE(routing_provider, 'osrm')" : "'osrm'";
      const optimism = columnExists(db, 'trips', 'routing_optimism') ? 'COALESCE(routing_optimism, 0.33)' : '0.33';
      const tolls = columnExists(db, 'trips', 'routing_avoid_tolls') ? 'COALESCE(routing_avoid_tolls, 0)' : '0';
      const highways = columnExists(db, 'trips', 'routing_avoid_highways')
        ? 'COALESCE(routing_avoid_highways, 0)'
        : '0';
      const ferries = columnExists(db, 'trips', 'routing_avoid_ferries') ? 'COALESCE(routing_avoid_ferries, 0)' : '0';
      db.exec(`
        INSERT OR IGNORE INTO ${SIDECAR_SCHEMA}.trip_settings
          (trip_id, schedule_margin_minutes, routing_provider, routing_optimism,
           routing_avoid_tolls, routing_avoid_highways, routing_avoid_ferries)
        SELECT id, COALESCE(schedule_margin_minutes, 0), ${provider}, ${optimism}, ${tolls}, ${highways}, ${ferries}
        FROM main.trips
      `);
    }

    if (columnExists(db, 'days', 'wake_up_time')) {
      db.exec(
        `INSERT OR IGNORE INTO ${SIDECAR_SCHEMA}.day_settings (day_id, wake_up_time) SELECT id, wake_up_time FROM main.days`,
      );
    }

    if (columnExists(db, 'day_assignments', 'duration_minutes')) {
      const before = columnExists(db, 'day_assignments', 'margin_before_minutes')
        ? 'COALESCE(da.margin_before_minutes, 0)'
        : '0';
      const after = columnExists(db, 'day_assignments', 'margin_after_minutes')
        ? 'COALESCE(da.margin_after_minutes, 0)'
        : '0';
      db.exec(`
        INSERT OR IGNORE INTO ${SIDECAR_SCHEMA}.assignment_settings
          (assignment_id, duration_minutes, margin_before_minutes, margin_after_minutes)
        SELECT da.id, COALESCE(da.duration_minutes, p.duration_minutes, 60), ${before}, ${after}
        FROM main.day_assignments da JOIN main.places p ON p.id = da.place_id
      `);
    }

    db.prepare(`INSERT INTO ${SIDECAR_SCHEMA}.schema_changes (id) VALUES (?)`).run(LEGACY_IMPORT_ID);
  })();
}

export function pruneTrekForgeData(db: Database.Database): void {
  db.exec(`
    DELETE FROM ${SIDECAR_SCHEMA}.trip_settings WHERE trip_id NOT IN (SELECT id FROM main.trips);
    DELETE FROM ${SIDECAR_SCHEMA}.day_settings WHERE day_id NOT IN (SELECT id FROM main.days);
    DELETE FROM ${SIDECAR_SCHEMA}.assignment_settings WHERE assignment_id NOT IN (SELECT id FROM main.day_assignments);
  `);
}

export function setTripSettings(db: Database.Database, tripId: number | bigint | string, settings: TripSettings): void {
  db.prepare(
    `
    INSERT INTO ${SIDECAR_SCHEMA}.trip_settings
      (trip_id, schedule_margin_minutes, routing_provider, routing_optimism,
       routing_avoid_tolls, routing_avoid_highways, routing_avoid_ferries)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(trip_id) DO UPDATE SET
      schedule_margin_minutes=excluded.schedule_margin_minutes,
      routing_provider=excluded.routing_provider,
      routing_optimism=excluded.routing_optimism,
      routing_avoid_tolls=excluded.routing_avoid_tolls,
      routing_avoid_highways=excluded.routing_avoid_highways,
      routing_avoid_ferries=excluded.routing_avoid_ferries
  `,
  ).run(
    tripId,
    settings.schedule_margin_minutes,
    settings.routing_provider,
    settings.routing_optimism,
    settings.routing_avoid_tolls,
    settings.routing_avoid_highways,
    settings.routing_avoid_ferries,
  );
}

export function setDayWakeUpTime(
  db: Database.Database,
  dayId: number | bigint | string,
  wakeUpTime: string | null,
): void {
  db.prepare(
    `
    INSERT INTO ${SIDECAR_SCHEMA}.day_settings (day_id, wake_up_time) VALUES (?, ?)
    ON CONFLICT(day_id) DO UPDATE SET wake_up_time=excluded.wake_up_time
  `,
  ).run(dayId, wakeUpTime);
}

export function setAssignmentTransportMode(
  db: Database.Database,
  assignmentId: number | bigint | string,
  transportMode: AssignmentTransportMode | null,
): void {
  // Insert-only upsert so duration/margin defaults are untouched; the dedicated
  // statement also lets null explicitly CLEAR an override (setAssignmentSettings
  // must never clobber the mode when callers omit it).
  db.prepare(
    `
    INSERT INTO ${SIDECAR_SCHEMA}.assignment_settings (assignment_id, transport_mode) VALUES (?, ?)
    ON CONFLICT(assignment_id) DO UPDATE SET transport_mode=excluded.transport_mode
  `,
  ).run(assignmentId, transportMode);
}

export function setAssignmentSettings(
  db: Database.Database,
  assignmentId: number | bigint | string,
  settings: AssignmentSettings,
): void {
  db.prepare(
    `
    INSERT INTO ${SIDECAR_SCHEMA}.assignment_settings
      (assignment_id, duration_minutes, margin_before_minutes, margin_after_minutes)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(assignment_id) DO UPDATE SET
      duration_minutes=excluded.duration_minutes,
      margin_before_minutes=excluded.margin_before_minutes,
      margin_after_minutes=excluded.margin_after_minutes
  `,
  ).run(assignmentId, settings.duration_minutes, settings.margin_before_minutes, settings.margin_after_minutes);
}
