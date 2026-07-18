import { runMigrations } from '../../../src/db/migrations';
import { createTables } from '../../../src/db/schema';
import { initializeTrekForgeDb, prepareLegacyForkUpgrade } from '../../../src/db/trekforge';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

function createLegacyForkDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  createTables(db);
  runMigrations(db);

  // Reproduce a pre-v3.3 fork DB: its positional 161-165 represented TrekForge
  // columns, not the upstream migrations now occupying those versions.
  db.exec(`
    DROP TABLE plugin_entity_metadata;
    DROP TABLE plugin_user_config;
    ALTER TABLE budget_settlements DROP COLUMN currency;
    ALTER TABLE budget_settlements DROP COLUMN exchange_rate;
    ALTER TABLE users DROP COLUMN display_name;
    ALTER TABLE plugins DROP COLUMN dependencies;

    ALTER TABLE trips ADD COLUMN schedule_margin_minutes INTEGER DEFAULT 0;
    ALTER TABLE trips ADD COLUMN routing_provider TEXT DEFAULT 'osrm';
    ALTER TABLE trips ADD COLUMN routing_optimism REAL DEFAULT 0.33;
    ALTER TABLE trips ADD COLUMN routing_avoid_tolls INTEGER DEFAULT 0;
    ALTER TABLE trips ADD COLUMN routing_avoid_highways INTEGER DEFAULT 0;
    ALTER TABLE trips ADD COLUMN routing_avoid_ferries INTEGER DEFAULT 0;
    ALTER TABLE days ADD COLUMN wake_up_time TEXT DEFAULT '08:00';
    ALTER TABLE day_assignments ADD COLUMN duration_minutes INTEGER DEFAULT 60;
    ALTER TABLE day_assignments ADD COLUMN margin_before_minutes INTEGER DEFAULT 0;
    ALTER TABLE day_assignments ADD COLUMN margin_after_minutes INTEGER DEFAULT 0;

    INSERT INTO users (id, username, email, password_hash, role)
      VALUES (1, 'legacy', 'legacy@example.com', 'hash', 'admin');
    INSERT INTO trips (id, user_id, title, schedule_margin_minutes, routing_provider,
      routing_optimism, routing_avoid_tolls, routing_avoid_highways, routing_avoid_ferries)
      VALUES (1, 1, 'Legacy Trip', 25, 'google_maps_mobile', 0.7, 1, 0, 1);
    INSERT INTO days (id, trip_id, day_number, date, wake_up_time)
      VALUES (1, 1, 1, '2026-10-01', '09:15');
    INSERT INTO places (id, trip_id, name, duration_minutes)
      VALUES (1, 1, 'Museum', 75);
    INSERT INTO day_assignments (id, day_id, place_id, duration_minutes,
      margin_before_minutes, margin_after_minutes)
      VALUES (1, 1, 1, 105, 10, 20);
    UPDATE schema_version SET version = 176;
  `);
  return db;
}

describe('TrekForge sidecar upgrade', () => {
  it('repairs skipped upstream migrations and imports all legacy fork values', () => {
    const db = createLegacyForkDb();

    prepareLegacyForkUpgrade(db);
    expect(db.prepare('SELECT version FROM schema_version').get()).toEqual({ version: 160 });

    runMigrations(db);
    initializeTrekForgeDb(db);

    expect(db.prepare('SELECT version FROM schema_version').get()).toEqual({ version: 175 });
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='plugin_entity_metadata'").get(),
    ).toBeTruthy();
    expect(
      db.prepare("SELECT name FROM pragma_table_info('budget_settlements') WHERE name='currency'").get(),
    ).toBeTruthy();
    expect(db.prepare("SELECT name FROM pragma_table_info('users') WHERE name='display_name'").get()).toBeTruthy();
    expect(db.prepare("SELECT name FROM pragma_table_info('plugins') WHERE name='dependencies'").get()).toBeTruthy();
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='plugin_user_config'").get(),
    ).toBeTruthy();

    expect(db.prepare('SELECT * FROM trekforge.trip_settings WHERE trip_id = 1').get()).toMatchObject({
      schedule_margin_minutes: 25,
      routing_provider: 'google_maps_mobile',
      routing_optimism: 0.7,
      routing_avoid_tolls: 1,
      routing_avoid_highways: 0,
      routing_avoid_ferries: 1,
    });
    expect(db.prepare('SELECT * FROM trekforge.day_settings WHERE day_id = 1').get()).toEqual({
      day_id: 1,
      wake_up_time: '09:15',
    });
    expect(db.prepare('SELECT * FROM trekforge.assignment_settings WHERE assignment_id = 1').get()).toEqual({
      assignment_id: 1,
      duration_minutes: 105,
      margin_before_minutes: 10,
      margin_after_minutes: 20,
    });

    db.close();
  });

  it('does not overwrite sidecar writes when legacy columns remain', () => {
    const db = createLegacyForkDb();
    prepareLegacyForkUpgrade(db);
    runMigrations(db);
    initializeTrekForgeDb(db);

    db.prepare('UPDATE trekforge.trip_settings SET schedule_margin_minutes = 40 WHERE trip_id = 1').run();
    initializeTrekForgeDb(db);

    expect(db.prepare('SELECT schedule_margin_minutes FROM trekforge.trip_settings WHERE trip_id = 1').get()).toEqual({
      schedule_margin_minutes: 40,
    });
    db.close();
  });

  it('does not rewind a valid v3.4 database that still has a legacy fork column', () => {
    const db = new Database(':memory:');
    createTables(db);
    runMigrations(db);
    db.exec('ALTER TABLE trips ADD COLUMN schedule_margin_minutes INTEGER DEFAULT 0');

    prepareLegacyForkUpgrade(db);

    expect(db.prepare('SELECT version FROM schema_version').get()).toEqual({ version: 175 });
    db.close();
  });

  it('keeps fork columns out of a fresh core database', () => {
    const db = new Database(':memory:');
    createTables(db);
    runMigrations(db);
    initializeTrekForgeDb(db);

    expect(
      db.prepare("SELECT name FROM pragma_table_info('trips') WHERE name='routing_provider'").get(),
    ).toBeUndefined();
    expect(db.prepare("SELECT name FROM pragma_table_info('days') WHERE name='wake_up_time'").get()).toBeUndefined();
    expect(
      db.prepare("SELECT name FROM pragma_table_info('day_assignments') WHERE name='duration_minutes'").get(),
    ).toBeUndefined();
    expect(
      db.prepare("SELECT name FROM trekforge.sqlite_master WHERE type='table' AND name='trip_settings'").get(),
    ).toBeTruthy();
    db.close();
  });
});
