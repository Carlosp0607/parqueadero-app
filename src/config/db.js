const mysql = require('mysql2/promise');
require('dotenv').config();

const config = {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'parqueadero',
    multipleStatements: false,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: 15000,
    timezone: 'Z'
};

if (String(process.env.DB_SSL).toLowerCase() === 'true') {
    config.ssl = { rejectUnauthorized: false };
}

const pool = mysql.createPool(config);

pool.getConnection()
    .then(conn => {
        console.log(`[db] Conectado a ${config.host}:${config.port}/${config.database}`);
        conn.release();
    })
    .catch(err => {
        console.error(`[db] NO CONECTA a ${config.host}:${config.port} — ${err.code}`);
    });

module.exports = pool;
