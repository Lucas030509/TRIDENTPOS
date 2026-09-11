/**
 * TRIDENTPOS WP-008 Crash Simulation Worker Helper
 * Used by WP008-T13 and WP008-T14 to simulate abrupt power-loss / SIGKILL during active uncommitted writing.
 */

const Database = require('better-sqlite3');

const dbPath = process.argv[2];
if (!dbPath) {
  console.error('ERROR: Database path argument required');
  process.exit(1);
}

try {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  // Ensure table exists
  db.exec('CREATE TABLE IF NOT EXISTS crash_test (id INTEGER PRIMARY KEY, marker TEXT, committed INTEGER);');

  // Insert an uncommitted transaction
  db.exec('BEGIN IMMEDIATE;');
  db.exec("INSERT INTO crash_test (marker, committed) VALUES ('uncommitted_entry', 0);");

  // Signal parent that uncommitted frame is in WAL buffer
  process.stdout.write('READY\n');

  // Sleep indefinitely awaiting abrupt termination (SIGKILL)
  setInterval(() => {}, 5000);
} catch (err) {
  console.error('Child worker error:', err);
  process.exit(1);
}
