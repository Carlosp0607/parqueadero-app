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

/**
 * Elimina comentarios (-- y #) que estén FUERA de cadenas de texto.
 * Necesario porque el esquema tiene líneas como:  (1, 3, 30);   -- Bicicletas
 * Sin esto, la sentencia no se corta en el ';' y se pega con la siguiente.
 */
function limpiarComentarios(linea) {
    let dentro = null, salida = '';
    for (let i = 0; i < linea.length; i++) {
        const c = linea[i];
        if (dentro) {
            salida += c;
            if (c === '\\') { if (i + 1 < linea.length) salida += linea[++i]; continue; }
            if (c === dentro) dentro = null;
            continue;
        }
        if (c === "'" || c === '"' || c === '`') { dentro = c; salida += c; continue; }
        if (c === '-' && linea[i + 1] === '-') break;
        if (c === '#') break;
        salida += c;
    }
    return salida;
}

/** Separa el SQL en sentencias respetando los bloques DELIMITER. */
function separarSentencias(sql) {
    const sentencias = [];
    let delimitador = ';', buffer = '';

    for (const cruda of sql.split(/\r?\n/)) {
        const linea = limpiarComentarios(cruda);
        const limpia = linea.trim();
        if (limpia === '') continue;

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

const TABLAS = ['mensualidades_pagos', 'mensualidades', 'turnos', 'pagos', 'movimientos',
                'tarifas', 'vehiculos', 'capacidades_tipo', 'configuracion_empresa',
                'tipos_vehiculos', 'login_attempts', 'usuarios', 'empresas'];

async function borrarTodo(conn) {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    await conn.query('DROP PROCEDURE IF EXISTS calcular_total_pagar');
    for (const v of ['v_movimientos_activos', 'v_ingresos_diarios']) {
        await conn.query(`DROP VIEW IF EXISTS ${v}`);
    }
    for (const t of TABLAS) {
        await conn.query(`DROP TABLE IF EXISTS ${t}`);
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
}

async function aplicarEsquema(conn, archivo) {
    const sentencias = separarSentencias(fs.readFileSync(archivo, 'utf8'));
    console.log(`[migrate] Sentencias a ejecutar: ${sentencias.length}`);

    for (const [i, sentencia] of sentencias.entries()) {
        const etiqueta = sentencia.split(/\s+/).slice(0, 3).join(' ');
        try {
            await conn.query(sentencia);
            console.log(`[migrate]   ${i + 1}/${sentencias.length} ${etiqueta} OK`);
        } catch (err) {
            console.error(`[migrate]   ${i + 1}/${sentencias.length} ${etiqueta} FALLÓ: ${err.code} ${err.sqlMessage || err.message}`);
            return false;
        }
    }
    return true;
}

/**
 * Idempotente y auto-reparable:
 *  - Base vacía              -> aplica el esquema completo.
 *  - Migración incompleta    -> (tablas creadas pero sin usuarios) rehace desde cero.
 *  - Migración completa      -> no hace nada.
 * Nunca borra si ya existen usuarios reales.
 */
async function migrarSiHaceFalta() {
    const archivo = path.join(__dirname, '..', '..', 'schema-cloud.sql');

    let conn;
    try {
        conn = await pool.getConnection();
        console.log(`[db] Conectado a ${config.host}:${config.port}/${config.database}`);
    } catch (err) {
        console.error(`[db] NO CONECTA a ${config.host}:${config.port} — ${err.code}: ${err.message}`);
        if (err.code === 'ETIMEDOUT') console.error('[db] El servicio puede estar APAGADO o el puerto ser incorrecto.');
        if (err.code === 'HANDSHAKE_SSL_ERROR') console.error('[db] Defina DB_SSL_REJECT_UNAUTHORIZED=false');
        return;
    }

    try {
        if (!fs.existsSync(archivo)) {
            console.error(`[migrate] Falta el archivo ${archivo}`);
            return;
        }

        const [tablas] = await conn.query(
            `SELECT TABLE_NAME AS t FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('empresas','usuarios')`
        );
        const nombres = tablas.map(x => x.t);

        if (nombres.length === 0) {
            console.log('[migrate] Base vacía. Aplicando esquema...');
            if (await aplicarEsquema(conn, archivo)) await resumen(conn);
            return;
        }

        let usuarios = 0;
        if (nombres.includes('usuarios')) {
            const [[u]] = await conn.query('SELECT COUNT(*) AS n FROM usuarios');
            usuarios = u.n;
        }

        if (usuarios > 0) {
            console.log(`[migrate] El esquema ya existe y tiene ${usuarios} usuario(s). Nada que hacer.`);
            return;
        }

        console.warn('[migrate] MIGRACIÓN INCOMPLETA: hay tablas pero ningún usuario.');
        console.warn('[migrate] Rehaciendo el esquema desde cero (no hay datos que perder).');
        await borrarTodo(conn);
        if (await aplicarEsquema(conn, archivo)) await resumen(conn);
    } catch (err) {
        console.error(`[migrate] Error inesperado: ${err.code || ''} ${err.message}`);
    } finally {
        conn.release();
    }
}

async function resumen(conn) {
    const [[e]] = await conn.query('SELECT COUNT(*) AS n FROM empresas');
    const [[u]] = await conn.query('SELECT COUNT(*) AS n FROM usuarios');
    const [[t]] = await conn.query('SELECT COUNT(*) AS n FROM tarifas');
    console.log(`[migrate] Esquema aplicado. Empresas: ${e.n}, Usuarios: ${u.n}, Tarifas: ${t.n}`);
    console.log('[migrate] Acceso inicial -> NIT 900123456-7 / admin / admin123');
}

migrarSiHaceFalta();

module.exports = pool;
