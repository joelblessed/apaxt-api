const { Pool } = require('pg');
require('dotenv').config();

// const pool = new Pool({
//   user: process.env.DB_USER ||"postgres",
//   host: process.env.DB_HOST ||"localhost",
//   database: process.env.DB_NAME  || "mydb",
//   password: process.env.DB_PASS || "5270Postgresql" ,
//   port: process.env.DB_PORT  || 5432,
// });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // Required for Render PostgreSQL
});


module.exports = {
  query: (text, params) => pool.query(text, params),
};