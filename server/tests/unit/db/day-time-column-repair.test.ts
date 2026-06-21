import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../../src/db/migrations';

function createVersionCollidedDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE schema_version (version INTEGER NOT NULL);
    INSERT INTO schema_version (version) VALUES (9999);

    CREATE TABLE days (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trip_id INTEGER NOT NULL,
      day_number INTEGER NOT NULL,
      date TEXT,
      notes TEXT,
      title TEXT
    );

    CREATE TABLE places (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      duration_minutes INTEGER DEFAULT 60
    );

    CREATE TABLE day_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day_id INTEGER NOT NULL,
      place_id INTEGER NOT NULL,
      order_index INTEGER DEFAULT 0,
      notes TEXT
    );

    INSERT INTO days (id, trip_id, day_number, date) VALUES (1, 1, 1, '2026-10-01');
    INSERT INTO places (id, duration_minutes) VALUES (1, 135);
    INSERT INTO day_assignments (id, day_id, place_id) VALUES (1, 1, 1);
  `);
  return db;
}

describe('day time column migration repair', () => {
  it('repairs missing day time columns even when schema_version already skipped migrations', () => {
    const db = createVersionCollidedDb();

    runMigrations(db);

    expect(db.prepare("SELECT name FROM pragma_table_info('days') WHERE name = 'wake_up_time'").get()).toBeTruthy();
    expect(
      db.prepare("SELECT name FROM pragma_table_info('day_assignments') WHERE name = 'duration_minutes'").get(),
    ).toBeTruthy();

    expect(db.prepare('SELECT wake_up_time FROM days WHERE id = 1').get()).toEqual({ wake_up_time: '08:00' });
    expect(db.prepare('SELECT duration_minutes FROM day_assignments WHERE id = 1').get()).toEqual({
      duration_minutes: 135,
    });

    db.close();
  });
});
