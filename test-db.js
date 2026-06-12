const { Client } = require('pg');

const users = ['postgres', 'inp'];
const passwords = ['', 'postgres', 'admin', 'inp123', 'root', '123456', '1234'];

async function test() {
  for (const user of users) {
    for (const password of passwords) {
      console.log(`Trying user: ${user}, password: "${password}"...`);
      const client = new Client({
        host: 'localhost',
        port: 5432,
        user: user,
        password: password,
        database: 'postgres',
      });
      try {
        await client.connect();
        console.log(`SUCCESS! Connected with user: ${user}, password: "${password}"`);
        await client.end();
        return;
      } catch (err) {
        console.log(`Failed: ${err.message}`);
      }
    }
  }
  console.log('All attempts failed.');
}

test();
