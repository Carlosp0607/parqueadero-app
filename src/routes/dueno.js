// ---------------------------------------------------------------------------
// Panel del dueño del SaaS
//
// Esto NO es parte del sistema que usa un parqueadero. Es la vista del dueño
// de ParkSystem para administrar a sus clientes: quien esta al dia, quien se
// vencio, y cuantos van del tope de 15.
//
// Va aparte a proposito. Los roles de la tabla usuarios son 'admin' y
// 'operador', ambos internos de UNA empresa. Meter un rol por encima obligaria
// a tocar la tabla que valida todos los logins del sistema; si eso se rompe,
// no entra nadie. Este panel se protege con una clave suelta que vive en las
// variables de entorno de Render.
//
// La clave va en ADMIN_MASTER_KEY. Si no esta definida, el panel queda
// apagado por completo: es preferible que no exista a que exista con una
// clave por defecto que cualquiera adivine.
// ---------------------------------------------------------------------------

const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const bcrypt = require('bcryptjs');

// Tope de la fase actual: mas alla de esto el tier gratuito de Aiven y Render
// no aguanta. Sirve para no vender el cliente 16 sin darse cuenta.
const TOPE_EMPRESAS = 15;

function claveMaestra() {
    return process.env.ADMIN_MASTER_KEY || null;
}

// Compara sin cortar en el primer caracter distinto, para no dar pistas de
// cuanto de la clave se acerto.
function clavesIguales(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    if (a.length !== b.length) return false;
    let dif = 0;
    for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return dif === 0;
}

function exigirClave(req, res, next) {
    const esperada = claveMaestra();
    if (!esperada) {
        return res.status(503).json({
            success: false,
            message: 'El panel no está habilitado en este servidor.'
        });
    }

    const recibida = req.headers['x-admin-key'] || req.body.clave || '';
    if (!clavesIguales(String(recibida), esperada)) {
        console.warn('[dueno] Intento de acceso con clave incorrecta desde', req.ip);
        return res.status(401).json({ success: false, message: 'Clave incorrecta.' });
    }
    next();
}

// Crea fecha_vencimiento si no existe todavia.
async function asegurarColumnaVencimiento() {
    try {
        await pool.query('ALTER TABLE empresas ADD COLUMN fecha_vencimiento DATETIME NULL');
    } catch (e) {
        if (e.code !== 'ER_DUP_FIELDNAME') throw e;
    }
}

// Solo valida la clave. El panel la usa para saber si dejar entrar.
router.post('/entrar', exigirClave, (req, res) => {
    res.json({ success: true, message: 'Clave correcta' });
});

// ---------------------------------------------------------------------------
// Lista de parqueaderos con su estado de pago.
//
// El estado se calcula en SQL para que no dependa de la hora del navegador:
//   sin_fecha  no tiene vencimiento puesto
//   al_dia     le faltan mas de 5 dias
//   por_vencer le faltan 5 dias o menos
//   gracia     vencida hace 5 dias o menos (todavia entra)
//   vencida    vencida hace mas de 5 dias (ya no entra)
// ---------------------------------------------------------------------------
router.get('/empresas', exigirClave, async (req, res) => {
    try {
        await asegurarColumnaVencimiento();

        const [rows] = await pool.query(
            `SELECT e.id_empresa, e.nombre, e.nit, e.telefono, e.email,
                    e.plan, e.activa, e.fecha_vencimiento,
                    DATEDIFF(e.fecha_vencimiento, CURDATE()) AS dias_restantes,
                    (SELECT COUNT(*) FROM usuarios u WHERE u.id_empresa = e.id_empresa) AS usuarios,
                    (SELECT COUNT(*) FROM movimientos m
                      WHERE m.id_empresa = e.id_empresa
                        AND m.fecha_entrada >= DATE_SUB(NOW(), INTERVAL 30 DAY)) AS movimientos_30d
             FROM empresas e
             ORDER BY e.activa DESC, e.fecha_vencimiento IS NULL, e.fecha_vencimiento ASC`
        );

        const empresas = rows.map(e => {
            let estado;
            if (e.fecha_vencimiento == null) estado = 'sin_fecha';
            else {
                const d = Number(e.dias_restantes);
                if (d > 5) estado = 'al_dia';
                else if (d >= 0) estado = 'por_vencer';
                else if (d >= -5) estado = 'gracia';
                else estado = 'vencida';
            }
            return { ...e, estado };
        });

        const activas = empresas.filter(e => e.activa).length;

        res.json({
            success: true,
            data: empresas,
            resumen: {
                total: empresas.length,
                activas,
                tope: TOPE_EMPRESAS,
                cupos_libres: Math.max(0, TOPE_EMPRESAS - activas)
            }
        });
    } catch (error) {
        console.error('[dueno] Error listando empresas:', error);
        res.status(500).json({ success: false, message: 'Error al listar los parqueaderos' });
    }
});

// ---------------------------------------------------------------------------
// Cambia la fecha de vencimiento o el estado activo de un parqueadero.
//
// Desactivar corta el acceso de una, sin esperar al vencimiento: el login ya
// filtra por activa = true.
// ---------------------------------------------------------------------------
router.put('/empresas/:id', exigirClave, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
        return res.status(400).json({ success: false, message: 'Identificador inválido' });
    }

    const campos = [];
    const valores = [];

    if (req.body.fecha_vencimiento !== undefined) {
        const f = req.body.fecha_vencimiento;
        if (f === null || f === '') {
            campos.push('fecha_vencimiento = NULL');
        } else if (/^\d{4}-\d{2}-\d{2}$/.test(String(f))) {
            campos.push('fecha_vencimiento = ?');
            valores.push(f + ' 23:59:59');
        } else {
            return res.status(400).json({
                success: false,
                message: 'La fecha debe venir como AAAA-MM-DD'
            });
        }
    }

    if (req.body.activa !== undefined) {
        campos.push('activa = ?');
        valores.push(req.body.activa ? 1 : 0);
    }

    if (req.body.plan !== undefined) {
        campos.push('plan = ?');
        valores.push(String(req.body.plan).slice(0, 50));
    }

    if (!campos.length) {
        return res.status(400).json({ success: false, message: 'Nada para actualizar' });
    }

    try {
        await asegurarColumnaVencimiento();
        valores.push(id);

        const [r] = await pool.query(
            `UPDATE empresas SET ${campos.join(', ')} WHERE id_empresa = ?`,
            valores
        );
        if (r.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Parqueadero no encontrado' });
        }

        console.log(`[dueno] Empresa ${id} actualizada:`, campos.join(', '));
        res.json({ success: true, message: 'Actualizado' });
    } catch (error) {
        console.error('[dueno] Error actualizando empresa:', error);
        res.status(500).json({ success: false, message: 'Error al actualizar' });
    }
});

// ---------------------------------------------------------------------------
// Renueva por N meses desde hoy, o desde el vencimiento actual si todavia no
// ha pasado. Asi renovar antes de tiempo no le regala dias al cliente ni se
// los quita.
// ---------------------------------------------------------------------------
router.post('/empresas/:id/renovar', exigirClave, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const meses = parseInt(req.body.meses, 10);

    if (!Number.isFinite(id)) {
        return res.status(400).json({ success: false, message: 'Identificador inválido' });
    }
    if (!Number.isFinite(meses) || meses < 1 || meses > 24) {
        return res.status(400).json({ success: false, message: 'Los meses deben ir de 1 a 24' });
    }

    try {
        await asegurarColumnaVencimiento();

        await pool.query(
            `UPDATE empresas
             SET fecha_vencimiento = DATE_ADD(
                   GREATEST(COALESCE(fecha_vencimiento, NOW()), NOW()),
                   INTERVAL ? MONTH)
             WHERE id_empresa = ?`,
            [meses, id]
        );

        const [rows] = await pool.query(
            'SELECT fecha_vencimiento FROM empresas WHERE id_empresa = ?', [id]
        );
        if (!rows.length) {
            return res.status(404).json({ success: false, message: 'Parqueadero no encontrado' });
        }

        console.log(`[dueno] Empresa ${id} renovada ${meses} meses. Vence ${rows[0].fecha_vencimiento}`);
        res.json({
            success: true,
            message: 'Renovado por ' + meses + (meses === 1 ? ' mes' : ' meses'),
            fecha_vencimiento: rows[0].fecha_vencimiento
        });
    } catch (error) {
        console.error('[dueno] Error renovando:', error);
        res.status(500).json({ success: false, message: 'Error al renovar' });
    }
});

// ---------------------------------------------------------------------------
// Alta de un parqueadero nuevo
//
// Antes esto eran cinco INSERT a mano en la base: empresa, configuracion,
// usuario admin, tipos de vehiculo y tarifas. Media hora de SQL por cliente, y
// si uno se equivocaba a la mitad el parqueadero quedaba armado por pedazos:
// una empresa sin configuracion, o con tipos pero sin precios, y el operador
// no podia ni registrar una entrada.
//
// Todo va en UNA transaccion. O se crea completo y usable desde el primer
// minuto, o no se crea nada.
//
// OJO con la estructura real de las tablas:
//   - tipos_vehiculos NO tiene columna capacidad. Los cupos viven en
//     configuracion_empresa, en tres columnas fijas que ademas son NOT NULL.
//   - tarifas.fecha_vigencia_desde es NOT NULL. Sin ella la tarifa no cuenta
//     como vigente y el primer ingreso falla con "No hay tarifa vigente".
// ---------------------------------------------------------------------------
const TIPOS_INICIALES = [
    // nombre, codigo, minuto, hora, dia
    ['Carro',     'carro',     120, 6000, 30000],
    ['Moto',      'moto',       60, 3000, 15000],
    ['Bicicleta', 'bicicleta',  30, 1500,  7500]
];

router.post('/empresas', exigirClave, async (req, res) => {
    const nombre   = String(req.body.nombre || '').trim();
    const nit      = String(req.body.nit || '').trim();
    const direccion= String(req.body.direccion || '').trim() || null;
    const telefono = String(req.body.telefono || '').trim() || null;
    const email    = String(req.body.email || '').trim() || null;
    const usuario  = String(req.body.usuario || '').trim();
    const password = String(req.body.password || '');
    const meses    = parseInt(req.body.meses, 10) || 1;

    if (!nombre || !nit) {
        return res.status(400).json({ success:false, message:'El nombre y el NIT son obligatorios.' });
    }
    if (!usuario || !password) {
        return res.status(400).json({ success:false, message:'Hay que crear el usuario administrador.' });
    }
    if (password.length < 6) {
        return res.status(400).json({ success:false, message:'La contraseña debe tener al menos 6 caracteres.' });
    }
    if (meses < 1 || meses > 24) {
        return res.status(400).json({ success:false, message:'Los meses deben ir de 1 a 24.' });
    }

    const conn = await pool.getConnection();
    try {
        // El tope no es un capricho: mas alla de 15 el tier gratuito de Aiven
        // y Render no aguanta, y el sistema se cae para TODOS los clientes.
        const [cuenta] = await conn.query(
            'SELECT COUNT(*) AS n FROM empresas WHERE activa = TRUE'
        );
        if (Number(cuenta[0].n) >= TOPE_EMPRESAS) {
            conn.release();
            return res.status(409).json({
                success: false,
                message: 'Ya hay ' + TOPE_EMPRESAS + ' parqueaderos activos, que es el tope ' +
                         'de este plan. Apaga uno o sube de plan antes de vender otro.'
            });
        }

        const [repetido] = await conn.query(
            'SELECT id_empresa FROM empresas WHERE nit = ?', [nit]
        );
        if (repetido.length) {
            conn.release();
            return res.status(409).json({
                success: false,
                message: 'Ya existe un parqueadero con el NIT ' + nit + '.'
            });
        }

        await conn.beginTransaction();

        // 1. La empresa. El plan arranca en 'basico', primer valor del ENUM.
        const [emp] = await conn.query(
            `INSERT INTO empresas (nombre, nit, direccion, telefono, email, plan, activa, fecha_vencimiento)
             VALUES (?, ?, ?, ?, ?, 'basico', TRUE, DATE_ADD(NOW(), INTERVAL ? MONTH))`,
            [nombre, nit, direccion, telefono, email, meses]
        );
        const id_empresa = emp.insertId;

        // 2. Configuracion. Sin esta fila la pantalla de Configuracion responde
        //    404 y el cliente no puede ni poner su horario. Las tres capacidades
        //    son NOT NULL, asi que van con valores de arranque.
        await conn.query(
            `INSERT INTO configuracion_empresa
                (id_empresa, capacidad_total_carros, capacidad_total_motos,
                 capacidad_total_bicicletas, horario_apertura, horario_cierre,
                 iva_porcentaje, moneda, zona_horaria, operacion_24h)
             VALUES (?, 40, 30, 20, '06:00:00', '22:00:00', 0, 'COP', 'America/Bogota', FALSE)`,
            [id_empresa]
        );

        // 3. Usuario administrador
        const hash = await bcrypt.hash(password, 10);
        await conn.query(
            'INSERT INTO usuarios (id_empresa, nombre, usuario_login, `contraseña`, rol, activo) VALUES (?, ?, ?, ?, ?, TRUE)',
            [id_empresa, 'Administrador', usuario, hash, 'admin']
        );

        // 4. Tipos de vehiculo y su tarifa. Van juntos a proposito: un tipo sin
        //    tarifa no se puede cobrar, el ingreso falla y el parqueadero queda
        //    inservible el primer dia.
        for (const [nom, cod, vMin, vHora, vDia] of TIPOS_INICIALES) {
            const [tipo] = await conn.query(
                'INSERT INTO tipos_vehiculos (id_empresa, nombre, codigo, activo) VALUES (?, ?, ?, TRUE)',
                [id_empresa, nom, cod]
            );

            await conn.query(
                `INSERT INTO tarifas
                    (id_empresa, id_tipo, valor_hora, valor_minuto, valor_dia_completo,
                     fecha_vigencia_desde, modo_cobro, paso_minutos_a_horas,
                     paso_horas_a_dias, redondeo_horas, redondeo_dias, activa)
                 VALUES (?, ?, ?, ?, ?, NOW(), 'mixto', 60, 5, 'arriba', 'arriba', TRUE)`,
                [id_empresa, tipo.insertId, vHora, vMin, vDia]
            );
        }

        await conn.commit();

        const [creada] = await conn.query(
            'SELECT id_empresa, nombre, nit, fecha_vencimiento FROM empresas WHERE id_empresa = ?',
            [id_empresa]
        );

        console.log(`[dueno] Parqueadero creado: ${nombre} (NIT ${nit}, id ${id_empresa})`);

        res.status(201).json({
            success: true,
            message: 'Parqueadero creado. Ya puede entrar con su NIT y usuario.',
            data: creada[0]
        });
    } catch (error) {
        await conn.rollback();
        console.error('[dueno] Error creando parqueadero:', {
            code: error.code, sqlMessage: error.sqlMessage, message: error.message
        });

        const causas = {
            ER_DUP_ENTRY: 'Ya existe un parqueadero o un usuario con esos datos.',
            ER_NO_SUCH_TABLE: 'Falta una tabla en la base de datos.'
        };
        res.status(500).json({
            success: false,
            message: causas[error.code] || ('No se pudo crear el parqueadero: ' + (error.sqlMessage || error.message))
        });
    } finally {
        conn.release();
    }
});

module.exports = router;
