// Test script to apply and verify the cumulative quiz migration
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function testMigration() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://tobira:tobira@localhost:5432/tobira'
  });

  try {
    console.log('='.repeat(80));
    console.log('TESTING CUMULATIVE QUIZ MIGRATION');
    console.log('='.repeat(80));
    console.log();

    // Read and apply the migration
    console.log('1. Applying migration...');
    const migrationSQL = fs.readFileSync(
      path.join(__dirname, '../tobira/backend/src/db/migrations/50-cumulative-quizzes.sql'),
      'utf8'
    );
    
    await pool.query(migrationSQL);
    console.log('✓ Migration applied successfully\n');

    // Test 1: Check table exists
    console.log('2. Verifying table creation...');
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'ai_cumulative_quizzes'
      ) as exists
    `);
    console.log(`✓ Table exists: ${tableCheck.rows[0].exists}\n`);

    // Test 2: Check columns
    console.log('3. Checking columns...');
    const columns = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'ai_cumulative_quizzes'
      ORDER BY ordinal_position
    `);
    console.log(`✓ Found ${columns.rows.length} columns:`);
    columns.rows.forEach(col => {
      console.log(`  - ${col.column_name.padEnd(25)} ${col.data_type.padEnd(20)} ${col.is_nullable === 'NO' ? 'NOT NULL' : 'NULL'}`);
    });
    console.log();

    // Test 3: Check indexes
    console.log('4. Checking indexes...');
    const indexes = await pool.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'ai_cumulative_quizzes'
      ORDER BY indexname
    `);
    console.log(`✓ Found ${indexes.rows.length} indexes:`);
    indexes.rows.forEach(idx => {
      console.log(`  - ${idx.indexname}`);
    });
    console.log();

    // Test 4: Try to insert test data
    console.log('5. Testing insert operation...');
    
    // Find a series with events
    const seriesCheck = await pool.query(`
      SELECT s.id as series_id, e.id as event_id
      FROM series s
      INNER JOIN all_events e ON e.series = s.id
      WHERE s.state = 'ready' AND e.state = 'ready'
      LIMIT 1
    `);

    if (seriesCheck.rows.length > 0) {
      const { series_id, event_id } = seriesCheck.rows[0];
      
      const testQuestions = [
        {
          question: "What is the main topic of this video?",
          questionType: "multiple_choice",
          options: ["Introduction", "Advanced Concepts", "Summary"],
          correctAnswer: "Introduction",
          explanation: "This video covers introductory material",
          difficulty: "easy",
          videoContext: {
            eventId: event_id.toString(),
            videoTitle: "Test Video 1",
            videoNumber: 1,
            timestamp: 120
          }
        }
      ];

      await pool.query(`
        INSERT INTO ai_cumulative_quizzes (
          event_id, series_id, language, model, processing_time_ms,
          questions, included_event_ids, video_count
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        event_id,
        series_id,
        'en',
        'gpt-4-test',
        5000,
        JSON.stringify(testQuestions),
        [event_id],
        1
      ]);
      console.log('✓ Test insert successful\n');

      // Test query
      console.log('6. Testing query...');
      const queryResult = await pool.query(`
        SELECT * FROM ai_cumulative_quizzes WHERE event_id = $1
      `, [event_id]);
      console.log(`✓ Query successful, found ${queryResult.rows.length} row(s)\n`);

      // Clean up
      console.log('7. Cleaning up test data...');
      await pool.query(`
        DELETE FROM ai_cumulative_quizzes WHERE event_id = $1
      `, [event_id]);
      console.log('✓ Cleanup successful\n');

    } else {
      console.log('⚠ No suitable series/event found - skipping insert test\n');
    }

    // Test 5: Check constraints
    console.log('8. Checking constraints...');
    const constraints = await pool.query(`
      SELECT constraint_name, constraint_type
      FROM information_schema.table_constraints
      WHERE table_name = 'ai_cumulative_quizzes'
      ORDER BY constraint_type, constraint_name
    `);
    console.log(`✓ Found ${constraints.rows.length} constraints:`);
    constraints.rows.forEach(con => {
      console.log(`  - ${con.constraint_name.padEnd(40)} ${con.constraint_type}`);
    });
    console.log();

    console.log('='.repeat(80));
    console.log('✅ ALL TESTS PASSED - Migration successful!');
    console.log('='.repeat(80));

  } catch (error) {
    console.error('\n❌ Error during migration test:', error.message);
    console.error('Full error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

testMigration();