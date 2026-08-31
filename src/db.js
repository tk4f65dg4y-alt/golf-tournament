const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { RULES } = require('./data');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Attach a Postgres database and provide its connection string.');
}

const ssl = process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl
});

// The `rules` table starts life as a straight copy of the RULES constant
// (src/data.js) so there's sensible content from the very first boot, but
// only if it's actually empty -- once a captain's edited anything in there,
// the database is the source of truth and this is a permanent no-op.
async function seedRulesIfEmpty() {
  const { rows } = await pool.query('SELECT COUNT(*) AS n FROM rules');
  if (Number(rows[0].n) > 0) return;
  let order = 0;
  for (const r of RULES) {
    await pool.query('INSERT INTO rules (title, text, sort_order) VALUES ($1, $2, $3)', [r.title, r.text, order++]);
  }
}

async function initSchema() {
  const schemaPath = path.join(__dirname, '..', 'migrations', 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  await pool.query(sql);
  await seedRulesIfEmpty();
}

module.exports = { pool, initSchema };
