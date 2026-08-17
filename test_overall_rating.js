const pool = require('./config/db');

async function testOverallRating() {
  try {
    console.log("=== STARTING OVERALL RATING TEST ===");

    // 1. Find a listener and a caller
    const listenerRes = await pool.query("SELECT id, email, user_type FROM users WHERE user_type = 'listener' LIMIT 1");
    if (listenerRes.rows.length === 0) {
        throw new Error("No listener found in database to run tests!");
    }
    const listener = listenerRes.rows[0];
    console.log(`Found Listener: ID=${listener.id}, Email=${listener.email}`);

    const callerRes = await pool.query("SELECT id, email, user_type FROM users WHERE user_type = 'user' LIMIT 1");
    if (callerRes.rows.length === 0) {
        throw new Error("No caller found in database to run tests!");
    }
    const caller = callerRes.rows[0];

    // Generate token for Caller
    const jwt = require('jsonwebtoken');
    const token = jwt.sign({ userId: caller.id, user_type: 'user' }, process.env.JWT_SECRET || 'mysecretkey');
    console.log("Generated JWT manually for caller.");

    // 2. Fetch listener details
    console.log(`\nCalling GET /api/listener-details/${listener.id}...`);
    const detailsRes = await fetch(`http://127.0.0.1:3000/api/listener-details/${listener.id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });

    const detailsResult = await detailsRes.json();
    console.log("API Response Status:", detailsResult.status);
    console.log("API Response Message:", detailsResult.message);
    
    if (!detailsResult.status) {
        throw new Error("API call returned failure status!");
    }

    const data = detailsResult.data;
    console.log("Returned rating:", data.rating);
    console.log("Returned overall_rating:", data.overall_rating);

    if (data.overall_rating === undefined) {
        throw new Error("overall_rating field is missing from response!");
    }

    console.log("\n=== ALL TESTS PASSED SUCCESSFULLY! ===");

  } catch (err) {
    console.error("\nTEST FAILED:", err);
  } finally {
    await pool.end();
  }
}

testOverallRating();
