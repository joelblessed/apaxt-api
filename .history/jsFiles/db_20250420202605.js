const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'your_database',
  password: process.env.DB_PASS || 'your_password',
  port: process.env.DB_PORT || 5432,
});

const 



module.exports = {
  query: (text, params) => pool.query(text, params),
};