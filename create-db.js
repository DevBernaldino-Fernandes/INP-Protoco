const { Client } = require('pg');

async function run() {
  const client = new Client({
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: '',
    database: 'postgres',
  });

  try {
    await client.connect();
    
    // Check if database inp exists
    const res = await client.query("SELECT 1 FROM pg_database WHERE datname='inp'");
    if (res.rows.length === 0) {
      console.log("Database 'inp' does not exist. Creating...");
      await client.query("CREATE DATABASE inp");
      console.log("Database 'inp' created successfully.");
    } else {
      console.log("Database 'inp' already exists.");
    }

    // Check if user inp exists, if not create it
    const userRes = await client.query("SELECT 1 FROM pg_roles WHERE rolname='inp'");
    if (userRes.rows.length === 0) {
      console.log("User 'inp' does not exist. Creating...");
      await client.query("CREATE USER inp WITH PASSWORD 'inp123'");
      await client.query("ALTER USER inp WITH SUPERUSER"); // Make it superuser or give ownership
      console.log("User 'inp' created with password 'inp123'.");
    } else {
      console.log("User 'inp' already exists. Updating password to 'inp123'...");
      await client.query("ALTER USER inp WITH PASSWORD 'inp123'");
      await client.query("ALTER USER inp WITH SUPERUSER");
      console.log("User 'inp' updated.");
    }

    await client.end();
  } catch (err) {
    console.error("Error creating database/user:", err);
    process.exit(1);
  }
}

run();
