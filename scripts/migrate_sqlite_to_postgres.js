
'use strict';

const Database = require('better-sqlite3');
const { Pool } = require('pg');
const path = require('path');
require('dotenv').config();

const db = new Database(
  path.join(__dirname, '..', 'streakforce-pre-migration.sqlite'),
  { readonly: true, fileMustExist: true }
);
const pool = new Pool({
  connectionString: process.env.PRODUCTION_DATABASE_URL,
  
  ssl: { rejectUnauthorized: false },
  max: 1,
  connectionTimeoutMillis: 30000,
  idleTimeoutMillis: 30000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000
});

const schema = 'streakforce_test';

const tables = [
  'profiles',
  'platform_connections',
  'activities',
  'manual_activities',
  'settings',
  'sessions',
  'catalog_items',
  'custom_activities',
  'custom_activity_logs',
  'projects',
  'project_tasks',
  'project_task_events',
  'goals',
  'goal_progress_logs',
  'password_recovery_tokens'
];

const quote = name => '"' + name.replace(/"/g, '""') + '"';

async function migrate() {
  const client = await pool.connect();
  let transactionStarted = false;

  try {
        const configuredHost = new URL(process.env.DATABASE_URL).hostname;

    if (configuredHost !== 'ep-mute-cloud-beedvce2-pooler.c-9.us-east-2.aws.neon.tech') {
      throw new Error('Not connected to the approved test branch. Migration stopped.');
    }
    const connection = await client.query(
      'SELECT current_database() AS database, current_user AS username'
    );

    console.log('Connected database:', connection.rows[0].database);
    console.log('Connected user:', connection.rows[0].username);

    if (connection.rows[0].database !== 'neondb') {
      throw new Error('Unexpected database. Migration stopped.');
    }

    await client.query('BEGIN');
    transactionStarted = true;

    await client.query('SET LOCAL search_path TO ' + quote(schema));

    const schemaCheck = await client.query(
  'SELECT schema_name FROM information_schema.schemata ORDER BY schema_name'
);

console.log(
  'Schemas visible to migration:',
  schemaCheck.rows.map(row => row.schema_name).join(', ')
);

if (!schemaCheck.rows.some(row => row.schema_name === schema)) {
  throw new Error('Target schema not found: ' + schema);
}

    if (!schemaCheck.rowCount) {
      throw new Error('Test schema not found.');
    }

    const pgTables = await client.query(
      'SELECT table_name FROM information_schema.tables WHERE table_schema = $1',
      [schema]
    );

    if (pgTables.rowCount !== tables.length) {
      throw new Error('Unexpected number of PostgreSQL tables.');
    }

    // Check every destination table is empty.
    for (const table of tables) {
      const result = await client.query(
        `SELECT COUNT(*) AS count FROM ${quote(schema)}.${quote(table)}`
      );

      if (Number(result.rows[0].count) !== 0) {
        throw new Error(`Destination table ${table} is not empty.`);
      }
    }

    console.log('Destination check: all tables empty.');

    // Compare SQLite and PostgreSQL columns.
    for (const table of tables) {
      const sqliteColumns = db
        .pragma(`table_info(${quote(table)})`)
        .map(column => column.name);

      const pgResult = await client.query(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2
         ORDER BY ordinal_position`,
        [schema, table]
      );

      const pgColumns = pgResult.rows.map(row => row.column_name);

      if (
        sqliteColumns.length !== pgColumns.length ||
        sqliteColumns.some(column => !pgColumns.includes(column))
      ) {
        throw new Error(`Column mismatch in ${table}.`);
      }
    }

    console.log('Column compatibility: verified.');

    // Copy rows in foreign-key dependency order.
    const imported = {};

    for (const table of tables) {
      const rows = db.prepare(
        `SELECT * FROM ${quote(table)}`
      ).all();

      const columns = db
        .pragma(`table_info(${quote(table)})`)
        .map(column => column.name);

      for (const row of rows) {
        const values = columns.map(column => row[column]);
        const placeholders = values.map((_, index) => `$${index + 1}`);

        await client.query(
          `INSERT INTO ${quote(schema)}.${quote(table)}
           (${columns.map(quote).join(', ')})
           VALUES (${placeholders.join(', ')})`,
          values
        );
      }

      imported[table] = rows.length;
      console.log(`${table}: ${rows.length} imported`);
    }

    // Reset identity sequences so future inserts work correctly.
    for (const table of tables) {
      const hasId = db
        .pragma(`table_info(${quote(table)})`)
        .some(column => column.name === 'id');

      if (hasId) {
        await client.query(
          `SELECT setval(
            pg_get_serial_sequence($1, 'id'),
            COALESCE(MAX(id), 1),
            COUNT(*) > 0
          )
          FROM ${quote(schema)}.${quote(table)}`,
          [`${schema}.${table}`]
        );
      }
    }

    // Verify imported record counts before committing.
    for (const table of tables) {
      const result = await client.query(
        `SELECT COUNT(*) AS count
         FROM ${quote(schema)}.${quote(table)}`
      );

      if (Number(result.rows[0].count) !== imported[table]) {
        throw new Error(`Record count mismatch in ${table}.`);
      }
    }

    await client.query('COMMIT');
    transactionStarted = false;

    console.log('\nMIGRATION SUCCESSFUL');
    console.log('All 15 tables verified.');
    console.log(
      'Total records imported:',
      Object.values(imported).reduce((sum, count) => sum + count, 0)
    );
  } catch (error) {
    if (transactionStarted) {
      await client.query('ROLLBACK');
    }

    console.error('\nMIGRATION FAILED:', error.message);
    console.log('Transaction rolled back. No partial import committed.');
  } finally {
    client.release();
    db.close();
    await pool.end();
  }
}

migrate().catch(error => {
  console.error('FATAL ERROR:', error.message);
  process.exitCode = 1;
});
