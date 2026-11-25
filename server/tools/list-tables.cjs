const mysql = require('mysql2/promise');
async function main() {
  const conn = await mysql.createConnection({
    host: 'localhost', port: 3306, user: 'root',
    password: 'Jmx20040813+', database: 'music_box',
  });
  const [rows] = await conn.execute('SHOW TABLES');
  for (const row of rows) {
    const name = Object.values(row)[0];
    const [count] = await conn.execute('SELECT COUNT(*) as c FROM `' + name + '`');
    console.log(name + ': ' + count[0].c + ' rows');
  }
  await conn.end();
}
main().catch(e => console.error(e.message));
