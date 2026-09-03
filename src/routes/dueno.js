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
        await pool.query('ALTER TABLE empresas ADD COLUMN fecha_vencimiento DATE NULL');
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
            valores.push(f);
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
                   GREATEST(COALESCE(fecha_vencimiento, CURDATE()), CURDATE()),
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

module.exports = router;
