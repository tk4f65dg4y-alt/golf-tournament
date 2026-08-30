const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Attach a Postgres database and provide its connection string.');
}

const ssl = process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl
});

async function initSchema() {
  const schemaPath = path.join(__dirname, '..', 'migrations', 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  await pool.query(sql);
}

module.exports = { pool, initSchema };
