const { Pool } = require('pg');

async function main() {
  const pool = new Pool({
    connectionString: 'postgresql://tobira:tobira@localhost:5432/tobira'
  });

  try {
    // Enable AI features
    await pool.query("UPDATE ai_config SET value = 'true' WHERE key = 'features_enabled'");
    console.log('✅ AI features enabled');

    // Get a real event ID
    const result = await pool.query('SELECT id, title FROM all_events LIMIT 1');
    if (result.rows.length > 0) {
      const event = result.rows[0];
      console.log(`✅ Found event: ID=${event.id}, Title="${event.title}"`);
      console.log(`\nUse this event ID in your tests: ${event.id}`);
    } else {
      console.log('⚠️  No events found in database');
    }

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

main();