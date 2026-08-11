const pool = require('./db');

async function initDb() {
    try {
        console.log('[DB Init] Checking and applying database schema updates...');

        // 1. Add unsettled_amount and settled_amount to listener_details if not present
        await pool.query(`
            ALTER TABLE listener_details 
            ADD COLUMN IF NOT EXISTS unsettled_amount NUMERIC(10, 2) DEFAULT 0.00;
        `);

        await pool.query(`
            ALTER TABLE listener_details 
            ADD COLUMN IF NOT EXISTS settled_amount NUMERIC(10, 2) DEFAULT 0.00;
        `);

        // 2. Create call_earnings_logs table if not exists
        await pool.query(`
            CREATE TABLE IF NOT EXISTS call_earnings_logs (
                id SERIAL PRIMARY KEY,
                call_id INTEGER NOT NULL,
                listener_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                duration_seconds INTEGER DEFAULT 0,
                total_minutes INTEGER DEFAULT 0,
                rate_per_minute NUMERIC(10, 2) DEFAULT 0.00,
                amount NUMERIC(10, 2) DEFAULT 0.00,
                created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
            );
        `);

        // Create indexes on call_earnings_logs for fast lookups
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_call_earnings_logs_listener_id ON call_earnings_logs (listener_id);
            CREATE INDEX IF NOT EXISTS idx_call_earnings_logs_call_id ON call_earnings_logs (call_id);
            CREATE INDEX IF NOT EXISTS idx_call_earnings_logs_created_at ON call_earnings_logs (created_at DESC);
        `);

        // 3. Create listener_settlements table if not exists
        await pool.query(`
            CREATE TABLE IF NOT EXISTS listener_settlements (
                id SERIAL PRIMARY KEY,
                listener_id INTEGER NOT NULL,
                admin_id INTEGER,
                amount NUMERIC(10, 2) NOT NULL,
                note TEXT,
                payment_method VARCHAR(100) DEFAULT 'manual',
                transaction_ref VARCHAR(255),
                status VARCHAR(50) DEFAULT 'completed',
                created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
            );
        `);

        // Create indexes on listener_settlements
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_listener_settlements_listener_id ON listener_settlements (listener_id);
            CREATE INDEX IF NOT EXISTS idx_listener_settlements_created_at ON listener_settlements (created_at DESC);
        `);

        // 4. Ensure app_settings has listener_rate_per_minute
        const { rows: settingRows } = await pool.query(
            `SELECT id, setting_value FROM app_settings WHERE setting_key = 'listener_rate_per_minute' LIMIT 1`
        );

        if (settingRows.length === 0) {
            await pool.query(
                `INSERT INTO app_settings (setting_key, setting_value, created_at, updated_at)
                 VALUES ('listener_rate_per_minute', '0.20', NOW(), NOW())`
            );
            console.log("[DB Init] Default setting 'listener_rate_per_minute' inserted (0.20).");
        }

        console.log('[DB Init] Schema updates verified successfully.');
    } catch (error) {
        console.error('[DB Init] Error during database initialization:', error);
    }
}

module.exports = initDb;
