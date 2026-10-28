import { describe, it, expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'

describe('P0.5: SQLite triggers on ON DELETE CASCADE and sync_changes', () => {
  it('tests whether AFTER DELETE triggers fire on ON DELETE CASCADE with default vs recursive_triggers', () => {
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON;')

    // Check default pragma
    const defaultRecursive = db.prepare('PRAGMA recursive_triggers;').get() as { recursive_triggers: number }

    db.exec(`
      CREATE TABLE sync_changes (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        tbl TEXT NOT NULL,
        row_id TEXT NOT NULL,
        op TEXT NOT NULL
      );

      CREATE TABLE parents (
        id TEXT PRIMARY KEY
      );

      CREATE TABLE children (
        id TEXT PRIMARY KEY,
        parent_id TEXT REFERENCES parents(id) ON DELETE CASCADE
      );

      CREATE TRIGGER trg_children_delete
      AFTER DELETE ON children
      BEGIN
        INSERT INTO sync_changes (tbl, row_id, op) VALUES ('children', OLD.id, 'delete');
      END;

      CREATE TRIGGER trg_parents_delete
      AFTER DELETE ON parents
      BEGIN
        INSERT INTO sync_changes (tbl, row_id, op) VALUES ('parents', OLD.id, 'delete');
      END;
    `)

    // Insert 1 parent, 2 children
    db.exec("INSERT INTO parents (id) VALUES ('p1');")
    db.exec("INSERT INTO children (id, parent_id) VALUES ('c1', 'p1'), ('c2', 'p1');")

    // Delete parent
    db.exec("DELETE FROM parents WHERE id = 'p1';")

    // Check sync_changes
    const changesDefault = db.prepare('SELECT tbl, row_id, op FROM sync_changes ORDER BY seq;').all() as Array<{ tbl: string; row_id: string; op: string }>

    // Now test with PRAGMA recursive_triggers = ON
    const dbRecursive = new DatabaseSync(':memory:')
    dbRecursive.exec('PRAGMA foreign_keys = ON;')
    dbRecursive.exec('PRAGMA recursive_triggers = ON;')

    dbRecursive.exec(`
      CREATE TABLE sync_changes (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        tbl TEXT NOT NULL,
        row_id TEXT NOT NULL,
        op TEXT NOT NULL
      );

      CREATE TABLE parents (
        id TEXT PRIMARY KEY
      );

      CREATE TABLE children (
        id TEXT PRIMARY KEY,
        parent_id TEXT REFERENCES parents(id) ON DELETE CASCADE
      );

      CREATE TRIGGER trg_children_delete
      AFTER DELETE ON children
      BEGIN
        INSERT INTO sync_changes (tbl, row_id, op) VALUES ('children', OLD.id, 'delete');
      END;

      CREATE TRIGGER trg_parents_delete
      AFTER DELETE ON parents
      BEGIN
        INSERT INTO sync_changes (tbl, row_id, op) VALUES ('parents', OLD.id, 'delete');
      END;
    `)

    dbRecursive.exec("INSERT INTO parents (id) VALUES ('p1');")
    dbRecursive.exec("INSERT INTO children (id, parent_id) VALUES ('c1', 'p1'), ('c2', 'p1');")
    dbRecursive.exec("DELETE FROM parents WHERE id = 'p1';")

    const changesRecursive = dbRecursive.prepare('SELECT tbl, row_id, op FROM sync_changes ORDER BY seq;').all() as Array<{ tbl: string; row_id: string; op: string }>

    // Record the finding
    console.log('Default recursive_triggers:', defaultRecursive)
    console.log('Changes under default:', changesDefault)
    console.log('Changes under recursive_triggers = ON:', changesRecursive)

    // In SQLite with foreign_keys = ON, child DELETE triggers DO fire on foreign key CASCADE!
    expect(changesDefault.map(c => c.tbl)).toEqual(['children', 'children', 'parents'])
    expect(changesRecursive.map(c => c.tbl)).toEqual(['children', 'children', 'parents'])
  })

  it('verifies that child DELETE trigger can SELECT parent row during cascade delete', () => {
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON;')

    db.exec(`
      CREATE TABLE sync_changes (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id TEXT,
        tbl TEXT NOT NULL,
        row_id TEXT NOT NULL,
        op TEXT NOT NULL
      );

      CREATE TABLE parents (
        id TEXT PRIMARY KEY,
        owner TEXT NOT NULL
      );

      CREATE TABLE children (
        id TEXT PRIMARY KEY,
        parent_id TEXT REFERENCES parents(id) ON DELETE CASCADE
      );

      CREATE TRIGGER trg_children_del
      AFTER DELETE ON children
      BEGIN
        INSERT INTO sync_changes (owner_id, tbl, row_id, op)
        SELECT p.owner, 'children', OLD.id, 'delete'
        FROM parents p WHERE p.id = OLD.parent_id;
      END;

      CREATE TRIGGER trg_parents_del
      AFTER DELETE ON parents
      BEGIN
        INSERT INTO sync_changes (owner_id, tbl, row_id, op)
        VALUES (OLD.owner, 'parents', OLD.id, 'delete');
      END;
    `)

    db.exec("INSERT INTO parents (id, owner) VALUES ('p1', 'user_123');")
    db.exec("INSERT INTO children (id, parent_id) VALUES ('c1', 'p1');")

    db.exec("DELETE FROM parents WHERE id = 'p1';")

    const rows = db.prepare('SELECT owner_id, tbl, row_id, op FROM sync_changes ORDER BY seq;').all() as Array<{
      owner_id: string
      tbl: string
      row_id: string
      op: string
    }>

    expect(rows).toEqual([{ owner_id: 'user_123', tbl: 'parents', row_id: 'p1', op: 'delete' }])
  })

  it('direct child deletion correctly captures owner_id via parent lookup', () => {
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON;')

    db.exec(`
      CREATE TABLE sync_changes (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id TEXT,
        tbl TEXT NOT NULL,
        row_id TEXT NOT NULL,
        op TEXT NOT NULL
      );

      CREATE TABLE parents (
        id TEXT PRIMARY KEY,
        owner TEXT NOT NULL
      );

      CREATE TABLE children (
        id TEXT PRIMARY KEY,
        parent_id TEXT REFERENCES parents(id) ON DELETE CASCADE
      );

      CREATE TRIGGER trg_children_after_del
      AFTER DELETE ON children
      BEGIN
        INSERT INTO sync_changes (owner_id, tbl, row_id, op)
        VALUES ((SELECT owner FROM parents WHERE id = OLD.parent_id), 'children', OLD.id, 'delete');
      END;
    `)

    db.exec("INSERT INTO parents (id, owner) VALUES ('p1', 'user_123');")
    db.exec("INSERT INTO children (id, parent_id) VALUES ('c1', 'p1');")

    // Directly delete child
    db.exec("DELETE FROM children WHERE id = 'c1';")

    const rows = db.prepare('SELECT owner_id, tbl, row_id, op FROM sync_changes;').all()
    expect(rows).toEqual([
      { owner_id: 'user_123', tbl: 'children', row_id: 'c1', op: 'delete' },
    ])
  })
})
