const pool = require('./config/db');

async function run() {
  try {
    const res = await pool.query("SELECT DISTINCT user_type FROM users");
    console.log("DISTINCT USER TYPES:", res.rows);
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

run();
