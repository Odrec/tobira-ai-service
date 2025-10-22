const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function investigateSchema() {
  try {
    console.log('='.repeat(80));
    console.log('TOBIRA DATABASE SCHEMA INVESTIGATION');
    console.log('='.repeat(80));
    console.log('\n');

    // 1. List all tables in the database
    console.log('1. ALL TABLES IN DATABASE');
    console.log('-'.repeat(80));
    const tablesResult = await pool.query(`
      SELECT 
        schemaname,
        tablename,
        CASE 
          WHEN tablename LIKE '%series%' THEN '*** SERIES RELATED ***'
          WHEN tablename LIKE '%playlist%' THEN '*** PLAYLIST RELATED ***'
          WHEN tablename LIKE '%block%' THEN '*** BLOCK RELATED ***'
          WHEN tablename LIKE '%realm%' THEN '*** REALM RELATED ***'
          WHEN tablename LIKE '%event%' THEN '*** EVENT RELATED ***'
          WHEN tablename LIKE '%course%' THEN '*** COURSE RELATED ***'
          ELSE ''
        END as relevance
      FROM pg_catalog.pg_tables
      WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
      ORDER BY 
        CASE 
          WHEN tablename LIKE '%series%' OR tablename LIKE '%playlist%' 
            OR tablename LIKE '%block%' OR tablename LIKE '%realm%' 
            OR tablename LIKE '%event%' OR tablename LIKE '%course%' THEN 0
          ELSE 1
        END,
        tablename;
    `);
    
    tablesResult.rows.forEach(row => {
      console.log(`  ${row.schemaname}.${row.tablename} ${row.relevance}`);
    });
    console.log('\n');

    // 2. Show schema of events table
    console.log('2. EVENTS TABLE SCHEMA');
    console.log('-'.repeat(80));
    const eventsSchemaResult = await pool.query(`
      SELECT 
        column_name,
        data_type,
        character_maximum_length,
        is_nullable,
        column_default
      FROM information_schema.columns
      WHERE table_name = 'events'
      ORDER BY ordinal_position;
    `);
    
    eventsSchemaResult.rows.forEach(col => {
      const type = col.character_maximum_length 
        ? `${col.data_type}(${col.character_maximum_length})`
        : col.data_type;
      console.log(`  ${col.column_name.padEnd(30)} ${type.padEnd(20)} ${col.is_nullable === 'NO' ? 'NOT NULL' : 'NULL'.padEnd(8)} ${col.column_default || ''}`);
    });
    console.log('\n');

    // 3. Show foreign keys and relationships for events table
    console.log('3. EVENTS TABLE FOREIGN KEYS & RELATIONSHIPS');
    console.log('-'.repeat(80));
    const eventsFkResult = await pool.query(`
      SELECT
        tc.constraint_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY' 
        AND tc.table_name = 'events';
    `);
    
    if (eventsFkResult.rows.length > 0) {
      eventsFkResult.rows.forEach(fk => {
        console.log(`  ${fk.column_name} -> ${fk.foreign_table_name}.${fk.foreign_column_name}`);
      });
    } else {
      console.log('  No foreign keys found');
    }
    console.log('\n');

    // 4. Look for series/playlist/block tables
    console.log('4. SERIES/PLAYLIST/BLOCK RELATED TABLES DETAILS');
    console.log('-'.repeat(80));
    
    const relevantTables = ['series', 'playlists', 'blocks', 'realms', 'series_events', 
                           'playlist_events', 'block_events', 'realm_events'];
    
    for (const tableName of relevantTables) {
      const tableExists = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = $1
        );
      `, [tableName]);
      
      if (tableExists.rows[0].exists) {
        console.log(`\n  Table: ${tableName.toUpperCase()}`);
        console.log('  ' + '-'.repeat(76));
        
        const schemaResult = await pool.query(`
          SELECT 
            column_name,
            data_type,
            is_nullable
          FROM information_schema.columns
          WHERE table_name = $1
          ORDER BY ordinal_position;
        `, [tableName]);
        
        schemaResult.rows.forEach(col => {
          console.log(`    ${col.column_name.padEnd(30)} ${col.data_type.padEnd(20)} ${col.is_nullable === 'NO' ? 'NOT NULL' : ''}`);
        });
        
        // Get row count
        const countResult = await pool.query(`SELECT COUNT(*) as count FROM ${tableName}`);
        console.log(`    Total rows: ${countResult.rows[0].count}`);
      }
    }
    console.log('\n');

    // 5. Check for parent/child or ordering fields in events
    console.log('5. EVENTS TABLE - ORDERING & HIERARCHY FIELDS');
    console.log('-'.repeat(80));
    const orderingFields = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'events'
        AND (
          column_name LIKE '%order%' 
          OR column_name LIKE '%parent%'
          OR column_name LIKE '%series%'
          OR column_name LIKE '%index%'
          OR column_name LIKE '%position%'
          OR column_name LIKE '%sequence%'
        )
      ORDER BY column_name;
    `);
    
    if (orderingFields.rows.length > 0) {
      orderingFields.rows.forEach(field => {
        console.log(`  ${field.column_name.padEnd(30)} ${field.data_type}`);
      });
    } else {
      console.log('  No obvious ordering/hierarchy fields found');
    }
    console.log('\n');

    // 6. Sample events data
    console.log('6. SAMPLE EVENTS DATA (First 5 rows)');
    console.log('-'.repeat(80));
    const sampleEvents = await pool.query(`
      SELECT * FROM events LIMIT 5;
    `);
    
    if (sampleEvents.rows.length > 0) {
      console.log(JSON.stringify(sampleEvents.rows, null, 2));
    } else {
      console.log('  No events found in database');
    }
    console.log('\n');

    // 7. Check for blocks table and its relationship
    console.log('7. BLOCKS TABLE INVESTIGATION');
    console.log('-'.repeat(80));
    const blocksExists = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'blocks'
      );
    `);
    
    if (blocksExists.rows[0].exists) {
      console.log('  Blocks table schema:');
      const blocksSchema = await pool.query(`
        SELECT 
          column_name,
          data_type,
          is_nullable
        FROM information_schema.columns
        WHERE table_name = 'blocks'
        ORDER BY ordinal_position;
      `);
      
      blocksSchema.rows.forEach(col => {
        console.log(`    ${col.column_name.padEnd(30)} ${col.data_type.padEnd(20)} ${col.is_nullable === 'NO' ? 'NOT NULL' : ''}`);
      });
      
      console.log('\n  Sample blocks data:');
      const sampleBlocks = await pool.query(`SELECT * FROM blocks LIMIT 3;`);
      console.log(JSON.stringify(sampleBlocks.rows, null, 2));
      
      // Check for series blocks
      console.log('\n  Series-type blocks:');
      const seriesBlocks = await pool.query(`
        SELECT * FROM blocks
        WHERE type::text = 'series'
        LIMIT 3;
      `);
      console.log(JSON.stringify(seriesBlocks.rows, null, 2));
    } else {
      console.log('  Blocks table does not exist');
    }
    console.log('\n');

    // 8. Check for realm structure
    console.log('8. REALMS TABLE INVESTIGATION');
    console.log('-'.repeat(80));
    const realmsExists = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'realms'
      );
    `);
    
    if (realmsExists.rows[0].exists) {
      console.log('  Realms table schema:');
      const realmsSchema = await pool.query(`
        SELECT 
          column_name,
          data_type,
          is_nullable
        FROM information_schema.columns
        WHERE table_name = 'realms'
        ORDER BY ordinal_position;
      `);
      
      realmsSchema.rows.forEach(col => {
        console.log(`    ${col.column_name.padEnd(30)} ${col.data_type.padEnd(20)} ${col.is_nullable === 'NO' ? 'NOT NULL' : ''}`);
      });
      
      console.log('\n  Sample realms data:');
      const sampleRealms = await pool.query(`SELECT * FROM realms LIMIT 3;`);
      console.log(JSON.stringify(sampleRealms.rows, null, 2));
    } else {
      console.log('  Realms table does not exist');
    }
    console.log('\n');

    // 9. Look for junction/mapping tables
    console.log('9. POTENTIAL JUNCTION/MAPPING TABLES');
    console.log('-'.repeat(80));
    const junctionTables = await pool.query(`
      SELECT tablename
      FROM pg_catalog.pg_tables
      WHERE schemaname = 'public'
        AND (
          tablename LIKE '%_events' 
          OR tablename LIKE 'event_%'
          OR tablename LIKE '%_blocks%'
          OR tablename LIKE '%_series%'
        )
      ORDER BY tablename;
    `);
    
    if (junctionTables.rows.length > 0) {
      for (const table of junctionTables.rows) {
        console.log(`\n  Table: ${table.tablename}`);
        const schema = await pool.query(`
          SELECT column_name, data_type
          FROM information_schema.columns
          WHERE table_name = $1
          ORDER BY ordinal_position;
        `, [table.tablename]);
        
        schema.rows.forEach(col => {
          console.log(`    ${col.column_name.padEnd(30)} ${col.data_type}`);
        });
        
        const count = await pool.query(`SELECT COUNT(*) as count FROM ${table.tablename}`);
        console.log(`    Total rows: ${count.rows[0].count}`);
      }
    } else {
      console.log('  No junction tables found');
    }
    console.log('\n');

    // 10. Investigate Series-Event Relationship
    console.log('10. SERIES-EVENT RELATIONSHIP ANALYSIS');
    console.log('-'.repeat(80));
    
    console.log('\n  Sample series with their events:');
    const seriesWithEvents = await pool.query(`
      SELECT
        s.id as series_id,
        s.title as series_title,
        s.opencast_id as series_opencast_id,
        COUNT(e.id) as event_count
      FROM series s
      LEFT JOIN all_events e ON e.series = s.id
      WHERE s.state::text = 'ready'
      GROUP BY s.id, s.title, s.opencast_id
      HAVING COUNT(e.id) > 0
      ORDER BY event_count DESC
      LIMIT 5;
    `);
    console.log(JSON.stringify(seriesWithEvents.rows, null, 2));

    console.log('\n  Events from a sample series (with ordering info):');
    if (seriesWithEvents.rows.length > 0) {
      const sampleSeriesId = seriesWithEvents.rows[0].series_id;
      const seriesEvents = await pool.query(`
        SELECT
          id,
          opencast_id,
          title,
          created,
          metadata->'http://ethz.ch/video/metadata'->>'order' as order_in_series,
          metadata
        FROM all_events
        WHERE series = $1
        ORDER BY
          CASE
            WHEN metadata->'http://ethz.ch/video/metadata'->>'order' IS NOT NULL
            THEN (metadata->'http://ethz.ch/video/metadata'->>'order')::int
            ELSE 999999
          END,
          created
        LIMIT 10;
      `, [sampleSeriesId]);
      console.log(`  Series ID: ${sampleSeriesId}`);
      console.log(`  Series Title: ${seriesWithEvents.rows[0].series_title}`);
      console.log(JSON.stringify(seriesEvents.rows, null, 2));
    }

    // 11. Check all_events and all_series views
    console.log('\n');
    console.log('11. VIEWS INVESTIGATION (all_events, all_series)');
    console.log('-'.repeat(80));
    
    const viewsInfo = await pool.query(`
      SELECT
        table_name,
        CASE
          WHEN table_type = 'VIEW' THEN 'View'
          WHEN table_type = 'BASE TABLE' THEN 'Table'
          ELSE table_type
        END as type
      FROM information_schema.tables
      WHERE table_name IN ('all_events', 'all_series', 'events', 'series')
        AND table_schema = 'public';
    `);
    
    viewsInfo.rows.forEach(v => {
      console.log(`  ${v.table_name.padEnd(30)} ${v.type}`);
    });

    // Check if all_events is a view and what its definition is
    console.log('\n  Checking if all_events and all_series are views or tables...');
    const viewDef = await pool.query(`
      SELECT
        schemaname,
        viewname,
        definition
      FROM pg_views
      WHERE viewname IN ('all_events', 'all_series');
    `);
    
    if (viewDef.rows.length > 0) {
      console.log('\n  View definitions found:');
      viewDef.rows.forEach(v => {
        console.log(`\n  ${v.viewname}:`);
        console.log(`  ${v.definition.substring(0, 200)}...`);
      });
    }

    console.log('\n');
    console.log('='.repeat(80));
    console.log('INVESTIGATION COMPLETE');
    console.log('='.repeat(80));
    console.log('\n');
    console.log('KEY FINDINGS:');
    console.log('-'.repeat(80));
    console.log('1. Videos (events) are organized into SERIES via the "series" field');
    console.log('2. Series contain multiple events and can be displayed on pages via BLOCKS');
    console.log('3. Events may have an "order" field in metadata for ordering within series');
    console.log('4. The "all_events" and "all_series" appear to be views for querying');
    console.log('5. Blocks can display series content with configurable ordering');
    console.log('\n');
    console.log('RECOMMENDATION FOR CUMULATIVE QUIZZES:');
    console.log('-'.repeat(80));
    console.log('- Query all events in a series using: SELECT * FROM all_events WHERE series = <series_id>');
    console.log('- Order events by metadata order field or creation date');
    console.log('- Generate cumulative quiz by combining transcripts from ordered events');
    console.log('- Store series_id reference in ai_quizzes table for series-level quizzes');

  } catch (error) {
    console.error('Error investigating schema:', error);
  } finally {
    await pool.end();
  }
}

investigateSchema();