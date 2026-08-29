const mysql = require('mysql2/promise');
require('dotenv').config();

// FIX despliegue: los proveedores de MySQL en la nube (Railway, Aiven, Clever Cloud,
// PlanetScale, Hostinger...) casi nunca usan el puerto 3306 y muchos exigen TLS.
// Antes esos parámetros no existían y la conexión fallaba siempre desde Render.
const config = {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'parqueadero',
    multipleStatements: false,
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_POOL_LIMIT) || 10,
    queueLimit: 0,
    connectTimeout: 15000,
    timezone: process.env.DB_TIMEZONE || 'Z'
};

// DB_SSL=true activa TLS. DB_SSL_REJECT_UNAUTHORIZED=false para certificados autofirmados.
if (String(process.env.DB_SSL).toLowerCase() === 'true') {
    config.ssl = {
        rejectUnauthorized: String(process.env.DB_SSL_REJECT_UNAUTHORIZED).toLowerCase() !== 'false'
    };
}

const pool = mysql.createPool(config);

// Diagnóstico al arrancar: si la BD no responde, se ve en los logs de inmediato
// en lugar de descubrirlo con un 500 opaco en el login.
pool.getConnection()
    .then(conn => {
        console.log(`[db] Conectado a ${config.host}:${config.port}/${config.database}`);
        conn.release();
    })
    .catch(err => {
        console.error('[db] NO SE PUDO CONECTAR A LA BASE DE DATOS');
        console.error(`[db] destino: ${config.host}:${config.port}/${config.database} (usuario: ${config.user})`);
        console.error(`[db] código: ${err.code} — ${err.message}`);
    });

module.exports = pool;
