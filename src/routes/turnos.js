const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const auth = require('../middleware/auth');
const { sanitizeIdParam } = require('../utils/sanitize');

// Middleware de autenticación
router.use(auth);

// ---------------------------------------------------------------------------
// Manejo de errores
//
// Antes cada catch respondía con un texto fijo y descartaba el error real.
// Por eso "Error abriendo turno" no decía nada: el error de MySQL nunca llegaba
// ni a los logs de Render ni a la pantalla. Ahora todo error queda registrado
// en el servidor con su código, y el cliente recibe una causa entendible.
// ---------------------------------------------------------------------------
function responderError(res, contexto, error, mensajeUsuario) {
    console.error(`[turnos] ${contexto} FALLÓ:`, {
        code: error.code,
        errno: error.errno,
        sqlState: error.sqlState,
        sqlMessage: error.sqlMessage,
        message: error.message
    });

    // Causas conocidas traducidas a algo que el operador pueda entender.
    const causas = {
        ER_NO_SUCH_TABLE: 'La base de datos no tiene las tablas creadas. Ejecute la migración.',
        ER_NO_REFERENCED_ROW_2: 'El usuario o la empresa del turno no existen en la base de datos.',
        ER_BAD_FIELD_ERROR: 'La estructura de la tabla de turnos no coincide con la esperada.',
        ER_DUP_ENTRY: 'Ya existe un registro con esos datos.',
        ECONNREFUSED: 'No hay conexión con la base de datos.',
        PROTOCOL_CONNECTION_LOST: 'Se perdió la conexión con la base de datos.',
        ETIMEDOUT: 'La base de datos no respondió a tiempo.'
    };

    const detalle = causas[error.code];

    res.status(500).json({
        success: false,
        message: detalle ? `${mensajeUsuario}: ${detalle}` : mensajeUsuario,
        codigo: error.code || null
    });
}

// ---------------------------------------------------------------------------
// Base inicial en pesos colombianos
//
// Acepta 50000, "50000", "50.000", "$ 50.000". Rechaza decimales, porque la
// caja se cuadra en pesos enteros. Esto cubre el punto 1 de la revisión: la
// base se digitó "2,71" y el valor llegaba mal al servidor.
// ---------------------------------------------------------------------------
function parsearPesos(valor) {
    if (valor === null || valor === undefined || valor === '') return 0;

    if (typeof valor === 'number') {
        if (!Number.isFinite(valor) || valor < 0) return null;
        if (!Number.isInteger(valor)) return null;
        return valor;
    }

    let texto = String(valor).trim().replace(/[$\s]/g, '');
    if (texto === '') return 0;

    // Un punto o coma seguido de uno o dos dígitos al final es un decimal.
    if (/[.,]\d{1,2}$/.test(texto)) return null;

    texto = texto.replace(/[.,]/g, '');
    if (!/^\d+$/.test(texto)) return null;

    return parseInt(texto, 10);
}

async function getTurnoAbierto(id_empresa) {
    const [rows] = await pool.query(
        'SELECT * FROM turnos WHERE id_empresa=? AND estado="abierto" ORDER BY fecha_apertura DESC LIMIT 1',
        [id_empresa]
    );
    return rows[0] || null;
}

async function getTotalesSistema(id_empresa, fecha_desde, fecha_hasta) {
    const [rows] = await pool.query(
        `SELECT 
            SUM(CASE WHEN metodo_pago='efectivo' THEN monto ELSE 0 END) AS efectivo,
            SUM(CASE WHEN metodo_pago='tarjeta' THEN monto ELSE 0 END) AS tarjeta,
            SUM(CASE WHEN metodo_pago='QR' THEN monto ELSE 0 END) AS qr,
            SUM(monto) AS total
         FROM pagos
         WHERE id_empresa=? AND fecha_pago BETWEEN ? AND COALESCE(?, NOW())`,
        [id_empresa, fecha_desde, fecha_hasta || null]
    );
    const r = rows[0] || {};
    return {
        efectivo: Number(r.efectivo || 0),
        tarjeta: Number(r.tarjeta || 0),
        qr: Number(r.qr || 0),
        total: Number(r.total || 0)
    };
}

// Conteo de tickets por tipo de vehículo, para el resumen de cierre.
async function getConteoTickets(id_empresa, fecha_desde, fecha_hasta) {
    const [rows] = await pool.query(
        `SELECT tv.codigo as tipo, COUNT(*) as cnt
         FROM movimientos m
         JOIN vehiculos v ON v.id_vehiculo = m.id_vehiculo
         JOIN tipos_vehiculos tv ON v.id_tipo = tv.id_tipo
         WHERE m.id_empresa=? AND m.estado='finalizado'
           AND m.fecha_salida BETWEEN ? AND COALESCE(?, NOW())
         GROUP BY tv.codigo`,
        [id_empresa, fecha_desde, fecha_hasta || null]
    );

    const map = {};
    let total = 0;
    rows.forEach(r => {
        map[r.tipo] = Number(r.cnt || 0);
        total += Number(r.cnt || 0);
    });
    return { total, porTipo: map };
}

// Turno activo de la empresa
router.get('/actual', async (req, res) => {
    try {
        const { id_empresa } = req.user;
        const t = await getTurnoAbierto(id_empresa);
        res.json({ success: true, data: t });
    } catch (err) {
        responderError(res, 'GET /actual', err, 'Error obteniendo el turno');
    }
});

// Totales del sistema desde la apertura del turno activo
router.get('/resumen', async (req, res) => {
    try {
        const { id_empresa } = req.user;
        const t = await getTurnoAbierto(id_empresa);
        if (!t) {
            return res.status(400).json({ success: false, message: 'No hay turno abierto' });
        }
        const tot = await getTotalesSistema(id_empresa, t.fecha_apertura, t.fecha_cierre);
        const stats = await getConteoTickets(id_empresa, t.fecha_apertura, t.fecha_cierre);
        res.json({ success: true, data: { turno: t, totales: tot, stats } });
    } catch (err) {
        responderError(res, 'GET /resumen', err, 'Error calculando los totales del turno');
    }
});

// Abrir turno
router.post('/abrir', async (req, res) => {
    try {
        const { id_empresa, id: id_usuario } = req.user;

        if (!id_usuario || !id_empresa) {
            console.error('[turnos] POST /abrir con token incompleto:', req.user);
            return res.status(401).json({
                success: false,
                message: 'La sesión no identifica al usuario. Vuelva a iniciar sesión.'
            });
        }

        const base = parsearPesos(req.body.base_inicial);
        if (base === null) {
            return res.status(400).json({
                success: false,
                message: 'La base inicial debe ser un valor en pesos enteros, sin decimales. Ejemplo: 50000'
            });
        }

        const observacion = (req.body.observacion_apertura || '').toString().trim().slice(0, 255) || null;

        const [abiertos] = await pool.query(
            'SELECT id_turno FROM turnos WHERE id_empresa=? AND estado="abierto"',
            [id_empresa]
        );
        if (abiertos.length) {
            return res.status(400).json({
                success: false,
                message: 'Ya existe un turno abierto. Ciérrelo antes de abrir uno nuevo.'
            });
        }

        const [result] = await pool.query(
            'INSERT INTO turnos (id_empresa,id_usuario,base_inicial,observacion_apertura) VALUES (?,?,?,?)',
            [id_empresa, id_usuario, base, observacion]
        );

        console.log(`[turnos] Turno ${result.insertId} abierto por usuario ${id_usuario} (empresa ${id_empresa}) con base ${base}`);

        res.json({
            success: true,
            data: { id_turno: result.insertId, base_inicial: base }
        });
    } catch (err) {
        responderError(res, 'POST /abrir', err, 'No se pudo abrir el turno');
    }
});

// Cerrar turno
router.post('/cerrar', async (req, res) => {
    try {
        const { id_empresa } = req.user;
        const { observacion_cierre } = req.body;

        const t = await getTurnoAbierto(id_empresa);
        if (!t) {
            return res.status(400).json({ success: false, message: 'No hay turno abierto' });
        }

        const efectivo = parsearPesos(req.body.total_efectivo);
        const tarjeta = parsearPesos(req.body.total_tarjeta);
        const qr = parsearPesos(req.body.total_qr);

        if (efectivo === null || tarjeta === null || qr === null) {
            return res.status(400).json({
                success: false,
                message: 'Los totales del conteo deben ser valores en pesos enteros, sin decimales.'
            });
        }

        const totalConteo = efectivo + tarjeta + qr;
        const id_turno = t.id_turno;

        const expected = await getTotalesSistema(id_empresa, t.fecha_apertura, t.fecha_cierre);
        const userTotals = { efectivo, tarjeta, qr, total: totalConteo };
        const diff = Number((totalConteo - expected.total).toFixed(2));

        await pool.query(
            `UPDATE turnos
             SET fecha_cierre=CURRENT_TIMESTAMP, total_efectivo=?, total_tarjeta=?, total_qr=?,
                 total_general=?, diferencia=?, observacion_cierre=?, estado="cerrado"
             WHERE id_turno=?`,
            [efectivo, tarjeta, qr, totalConteo, diff,
             (observacion_cierre || '').toString().trim().slice(0, 255) || null, id_turno]
        );

        const [fresh] = await pool.query('SELECT * FROM turnos WHERE id_turno=?', [id_turno]);
        const cierre = fresh[0];
        const stats = await getConteoTickets(id_empresa, t.fecha_apertura, cierre.fecha_cierre);

        console.log(`[turnos] Turno ${id_turno} cerrado. Diferencia: ${diff}`);

        res.json({
            success: true,
            data: {
                id_turno,
                base: t.base_inicial,
                expected,
                userTotals,
                diferencia: diff,
                stats,
                turno: { id_turno, usuario: req.user.nombre }
            }
        });
    } catch (err) {
        responderError(res, 'POST /cerrar', err, 'No se pudo cerrar el turno');
    }
});

// Detalle de turno para reimpresión
router.get('/detalle/:id', sanitizeIdParam('id'), async (req, res) => {
    try {
        const { id_empresa } = req.user;
        const id_turno = req.params.id;

        const [rows] = await pool.query(
            `SELECT t.*, u.nombre AS usuario, u.usuario_login
             FROM turnos t
             JOIN usuarios u ON u.id_usuario = t.id_usuario
             WHERE t.id_empresa=? AND t.id_turno=?`,
            [id_empresa, id_turno]
        );

        if (!rows.length) {
            return res.status(404).json({ success: false, message: 'Turno no encontrado' });
        }

        const t = rows[0];
        const expected = await getTotalesSistema(id_empresa, t.fecha_apertura, t.fecha_cierre);
        const stats = await getConteoTickets(id_empresa, t.fecha_apertura, t.fecha_cierre);

        res.json({ success: true, data: { turno: t, expected, stats } });
    } catch (err) {
        responderError(res, 'GET /detalle', err, 'Error obteniendo el detalle del turno');
    }
});

module.exports = router;
