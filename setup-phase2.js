/**
 * Phase 2 Setup Script
 * Enables quiz feature in the database
 */

const { Pool } = require('pg');

async function setup() {
    const connectionString = process.env.DATABASE_URL || 'postgresql://tobira:tobira@localhost:5432/tobira';
    
    console.log('🔧 Setting up Phase 2 features...\n');
    console.log(`Connecting to: ${connectionString.replace(/:[^:@]+@/, ':****@')}`);
    
    const pool = new Pool({ connectionString });
    
    try {
        // Test connection
        await pool.query('SELECT 1');
        console.log('✅ Database connected\n');
        
        // Enable quiz feature
        console.log('Enabling quiz feature...');
        await pool.query(
            "UPDATE ai_config SET value = 'true' WHERE key = 'quiz_enabled'"
        );
        console.log('✅ Quiz feature enabled\n');
        
        // Verify configuration
        const result = await pool.query(
            'SELECT key, value, description FROM ai_config ORDER BY key'
        );
        
        console.log('Current AI Configuration:');
        console.log('========================');
        result.rows.forEach(row => {
            console.log(`  ${row.key}: ${row.value}`);
        });
        
        console.log('\n✅ Phase 2 setup complete!\n');
        console.log('Next steps:');
        console.log('  1. Add your OpenAI API key to .env file');
        console.log('  2. Run: npm run dev');
        console.log('  3. Open: http://localhost:3001/admin/admin.html\n');
        
    } catch (error) {
        console.error('❌ Setup failed:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

setup();