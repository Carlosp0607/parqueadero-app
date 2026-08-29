const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const config = {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'parqueadero',
    multipleStatements: false,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: 20000,
    timezone: 'Z'
};

if (String(process.env.DB_SSL).toLowerCase() === 'true') {
    config.ssl = {
        rejectUnauthorized: String(process.env.DB_SSL_REJECT_UNAUTHORIZED).toLowerCase() !== 'false'
    };
}

const pool = mysql.createPool(config);

/** Separa el SQL en sentencias respetando los bloques DELIMITER. */
function separarSentencias(sql) {
    const sentencias = [];
    let delimitador = ';';
    let buffer = '';

    for (const linea of sql.split(/\r?\n/)) {
        const limpia = linea.trim();
        if (limpia.startsWith('--') || limpia === '') continue;

        const cambio = limpia.match(/^DELIMITER\s+(\S+)$/i);
        if (cambio) {
            if (buffer.trim()) { sentencias.push(buffer.trim()); buffer = ''; }
            delimitador = cambio[1];
            continue;
        }

        buffer += linea + '\n';

        if (limpia.endsWith(delimitador)) {
            const s = buffer.trim();
            sentencias.push(s.slice(0, s.length - delimitador.length).trim());
            buffer = '';
        }
    }
    if (buffer.trim()) sentencias.push(buffer.trim());
    return sentencias.filter(s => s.length > 0);
}

/**
 * Crea el esquema si la base está vacía. Es idempotente: si la tabla 'empresas'
 * ya existe, no hace nada. Se ejecuta al arrancar el servidor, no en el build,
 * para que siempre corra con las variables de entorno definitivas.
 */
async function migrarSiHaceFalta() {
    const archivo = path.join(__dirname, '..', '..', 'schema-cloud.sql');

    let conn;
    try {
        conn = await pool.getConnection();
        console.log(`[db] Conectado a ${config.host}:${config.port}/${config.database}`);
    } catch (err) {
        console.error(`[db] NO CONECTA a ${config.host}:${config.port} — ${err.code}: ${err.message}`);
        if (err.code === 'ETIMEDOUT') {
            console.error('[db] ETIMEDOUT: el servicio puede estar APAGADO o el puerto ser incorrecto.');
        }
        if (err.code === 'HANDSHAKE_SSL_ERROR') {
            console.error('[db] Certificado rechazado: defina DB_SSL_REJECT_UNAUTHORIZED=false');
        }
        return;
    }

    try {
        const [existe] = await conn.query(
            `SELECT TABLE_NAME FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'empresas'`
        );

        if (existe.length > 0) {
            console.log('[migrate] El esquema ya existe. Nada que hacer.');
            return;
        }

        if (!fs.existsSync(archivo)) {
            console.error(`[migrate] Base vacía pero falta el archivo ${archivo}`);
            return;
        }

        console.log('[migrate] Base vacía. Aplicando esquema...');
        const sentencias = separarSentencias(fs.readFileSync(archivo, 'utf8'));
        console.log(`[migrate] Sentencias a ejecutar: ${sentencias.length}`);

        for (const [i, sentencia] of sentencias.entries()) {
            const etiqueta = sentencia.split(/\s+/).slice(0, 3).join(' ');
            try {
                await conn.query(sentencia);
                console.log(`[migrate]   ${i + 1}/${sentencias.length} ${etiqueta} OK`);
            } catch (err) {
                console.error(`[migrate]   ${i + 1}/${sentencias.length} ${etiqueta} FALLÓ: ${err.code} ${err.sqlMessage || err.message}`);
                return;
            }
        }

        const [[e]] = await conn.query('SELECT COUNT(*) AS n FROM empresas');
        const [[u]] = await conn.query('SELECT COUNT(*) AS n FROM usuarios');
        console.log(`[migrate] Esquema aplicado. Empresas: ${e.n}, Usuarios: ${u.n}`);
        console.log('[migrate] Acceso inicial -> NIT 900123456-7 / admin / admin123');
    } catch (err) {
        console.error(`[migrate] Error inesperado: ${err.code || ''} ${err.message}`);
    } finally {
        conn.release();
    }
}

migrarSiHaceFalta();

module.exports = pool;
