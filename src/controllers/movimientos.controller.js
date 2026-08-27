// Controlador de movimientos (ingreso / salida de vehículos)
// FIX: este archivo NO existía en el backend. src/routes/movimientos.js lo requería
// y el servidor moría con MODULE_NOT_FOUND. El único movimientos.controller.js del
// repo estaba en public/js/ (código de navegador, no utilizable en Node).
const pool = require('../config/db');
const { calcularTotal } = require('../utils/tarifa');

async function obtenerTarifaVigente(conn, id_empresa, id_tipo) {
    const [rows] = await conn.query(
        `SELECT * FROM tarifas
         WHERE id_empresa = ? AND id_tipo = ? AND activa = TRUE
           AND fecha_vigencia_desde <= NOW()
           AND (fecha_vigencia_hasta IS NULL OR fecha_vigencia_hasta >= NOW())
         ORDER BY fecha_vigencia_desde DESC LIMIT 1`,
        [id_empresa, id_tipo]
    );
    return rows[0] || null;
}

async function armarFactura(conn, id_empresa, id_movimiento) {
    const [rows] = await conn.query(
        `SELECT m.id_movimiento, m.fecha_entrada, m.fecha_salida, m.total_a_pagar, m.estado,
                v.placa, tv.nombre AS tipo, tv.codigo AS tipo_codigo
         FROM movimientos m
         JOIN vehiculos v ON v.id_vehiculo = m.id_vehiculo
         JOIN tipos_vehiculos tv ON tv.id_tipo = v.id_tipo
         WHERE m.id_movimiento = ? AND m.id_empresa = ?`,
        [id_movimiento, id_empresa]
    );
    if (rows.length === 0) return null;
    const m = rows[0];

    const [pagos] = await conn.query(
        `SELECT metodo_pago, monto FROM pagos WHERE id_movimiento = ? AND id_empresa = ?`,
        [id_movimiento, id_empresa]
    );

    const minutos = m.fecha_salida
        ? Math.max(1, Math.floor((new Date(m.fecha_salida) - new Date(m.fecha_entrada)) / 60000))
        : Math.max(1, Math.floor((Date.now() - new Date(m.fecha_entrada)) / 60000));

    return {
        movimientoId: m.id_movimiento,
        placa: m.placa,
        tipo: m.tipo,
        tipoCodigo: m.tipo_codigo,
        fechaEntrada: m.fecha_entrada,
        fechaSalida: m.fecha_salida,
        minutos,
        estado: m.estado,
        total: Number(m.total_a_pagar || 0),
        pagosList: pagos.map(p => ({ metodo_pago: p.metodo_pago, monto: Number(p.monto) }))
    };
}

// POST /api/movimientos/ingreso  (alias: /entrada)
exports.registrarEntrada = async (req, res) => {
    const { id_empresa, id: id_usuario } = req.usuario;
    const placa = String(req.body.placa || '').trim().toUpperCase();
    const id_tipo = Number(req.body.id_tipo);

    if (!placa || !id_tipo) {
        return res.status(400).json({ success: false, message: 'Placa y tipo de vehículo son obligatorios' });
    }

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        const [tipos] = await conn.query(
            'SELECT id_tipo, nombre, codigo FROM tipos_vehiculos WHERE id_tipo = ? AND id_empresa = ? AND activo = TRUE',
            [id_tipo, id_empresa]
        );
        if (tipos.length === 0) {
            await conn.rollback();
            return res.status(400).json({ success: false, message: 'Tipo de vehículo no válido para esta empresa' });
        }

        // Vehículo: buscar o crear dentro de la empresa
        let [veh] = await conn.query(
            'SELECT id_vehiculo, id_tipo FROM vehiculos WHERE placa = ? AND id_empresa = ?',
            [placa, id_empresa]
        );
        let id_vehiculo;
        if (veh.length === 0) {
            const [ins] = await conn.query(
                'INSERT INTO vehiculos (id_empresa, placa, id_tipo, color) VALUES (?, ?, ?, ?)',
                [id_empresa, placa, id_tipo, 'N/D']
            );
            id_vehiculo = ins.insertId;
        } else {
            id_vehiculo = veh[0].id_vehiculo;
            if (veh[0].id_tipo !== id_tipo) {
                await conn.query('UPDATE vehiculos SET id_tipo = ? WHERE id_vehiculo = ?', [id_tipo, id_vehiculo]);
            }
        }

        // Evitar doble ingreso activo
        const [activos] = await conn.query(
            `SELECT id_movimiento FROM movimientos
             WHERE id_vehiculo = ? AND id_empresa = ? AND estado = 'activo'`,
            [id_vehiculo, id_empresa]
        );
        if (activos.length > 0) {
            await conn.rollback();
            return res.status(409).json({ success: false, message: `La placa ${placa} ya tiene un ingreso activo` });
        }

        const tarifa = await obtenerTarifaVigente(conn, id_empresa, id_tipo);
        if (!tarifa) {
            await conn.rollback();
            return res.status(400).json({ success: false, message: 'No hay tarifa vigente para este tipo de vehículo' });
        }

        const [mov] = await conn.query(
            `INSERT INTO movimientos (id_empresa, id_vehiculo, id_tarifa, id_usuario_entrada, estado)
             VALUES (?, ?, ?, ?, 'activo')`,
            [id_empresa, id_vehiculo, tarifa.id_tarifa, id_usuario]
        );

        const [creado] = await conn.query(
            'SELECT fecha_entrada FROM movimientos WHERE id_movimiento = ?', [mov.insertId]
        );

        await conn.commit();

        return res.status(201).json({
            success: true,
            message: 'Ingreso registrado',
            data: {
                movimientoId: mov.insertId,
                placa,
                tipo: tipos[0].nombre,
                tipoCodigo: tipos[0].codigo,
                fechaEntrada: creado[0].fecha_entrada
            }
        });
    } catch (error) {
        await conn.rollback();
        console.error('Error al registrar ingreso:', error);
        return res.status(500).json({ success: false, message: 'Error al registrar el ingreso' });
    } finally {
        conn.release();
    }
};

// POST /api/movimientos/calcular-salida  -> calcula SIN finalizar
exports.calcularSalida = async (req, res) => {
    const { id_empresa } = req.usuario;
    const placa = String(req.body.placa || '').trim().toUpperCase();
    if (!placa) return res.status(400).json({ success: false, message: 'La placa es obligatoria' });

    try {
        const [rows] = await pool.query(
            `SELECT m.id_movimiento, m.fecha_entrada, m.id_tarifa,
                    v.placa, tv.nombre AS tipo, tv.codigo AS tipo_codigo
             FROM movimientos m
             JOIN vehiculos v ON v.id_vehiculo = m.id_vehiculo
             JOIN tipos_vehiculos tv ON tv.id_tipo = v.id_tipo
             WHERE v.placa = ? AND m.id_empresa = ? AND m.estado = 'activo'
             ORDER BY m.fecha_entrada DESC LIMIT 1`,
            [placa, id_empresa]
        );
        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: `No hay ingreso activo para la placa ${placa}` });
        }
        const m = rows[0];

        const [tarifas] = await pool.query('SELECT * FROM tarifas WHERE id_tarifa = ?', [m.id_tarifa]);
        if (tarifas.length === 0) {
            return res.status(400).json({ success: false, message: 'La tarifa del movimiento ya no existe' });
        }

        const ahora = new Date();
        const { minutos, total } = calcularTotal(tarifas[0], m.fecha_entrada, ahora);

        return res.json({
            success: true,
            data: {
                movimientoId: m.id_movimiento,
                placa: m.placa,
                tipo: m.tipo,
                tipoCodigo: m.tipo_codigo,
                fechaEntrada: m.fecha_entrada,
                fechaSalida: ahora,
                minutos,
                total,
                pagosList: []
            }
        });
    } catch (error) {
        console.error('Error al calcular salida:', error);
        return res.status(500).json({ success: false, message: 'Error al calcular la salida' });
    }
};

// POST /api/movimientos/confirmar-salida -> finaliza + registra pagos (transaccional)
exports.confirmarSalida = async (req, res) => {
    const { id_empresa, id: id_usuario } = req.usuario;
    const id_movimiento = Number(req.body.id_movimiento);
    const pagos = Array.isArray(req.body.pagos) ? req.body.pagos : [];

    if (!id_movimiento) return res.status(400).json({ success: false, message: 'id_movimiento es obligatorio' });

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        const [rows] = await conn.query(
            `SELECT m.id_movimiento, m.fecha_entrada, m.id_tarifa, m.estado
             FROM movimientos m
             WHERE m.id_movimiento = ? AND m.id_empresa = ? FOR UPDATE`,
            [id_movimiento, id_empresa]
        );
        if (rows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ success: false, message: 'Movimiento no encontrado' });
        }
        if (rows[0].estado === 'finalizado') {
            await conn.rollback();
            return res.status(409).json({ success: false, message: 'El movimiento ya fue finalizado' });
        }

        const [tarifas] = await conn.query('SELECT * FROM tarifas WHERE id_tarifa = ?', [rows[0].id_tarifa]);
        const ahora = new Date();
        const { total } = calcularTotal(tarifas[0], rows[0].fecha_entrada, ahora);

        const validos = pagos
            .filter(p => p && p.metodo_pago && Number(p.monto) > 0)
            .map(p => [id_empresa, id_movimiento, p.metodo_pago, Number(p.monto), id_usuario]);

        const pagado = validos.reduce((a, p) => a + p[3], 0);
        if (pagado + 0.01 < total) {
            await conn.rollback();
            return res.status(400).json({ success: false, message: 'El pago registrado es menor al total a pagar' });
        }

        await conn.query(
            `UPDATE movimientos
             SET fecha_salida = ?, total_a_pagar = ?, id_usuario_salida = ?, estado = 'finalizado'
             WHERE id_movimiento = ? AND id_empresa = ?`,
            [ahora, total, id_usuario, id_movimiento, id_empresa]
        );

        if (validos.length > 0) {
            await conn.query(
                `INSERT INTO pagos (id_empresa, id_movimiento, metodo_pago, monto, id_usuario) VALUES ?`,
                [validos]
            );
        }

        const factura = await armarFactura(conn, id_empresa, id_movimiento);
        await conn.commit();

        return res.json({ success: true, message: 'Salida confirmada', data: factura });
    } catch (error) {
        await conn.rollback();
        console.error('Error al confirmar salida:', error);
        return res.status(500).json({ success: false, message: 'Error al confirmar la salida' });
    } finally {
        conn.release();
    }
};

// POST /api/movimientos/salida -> salida directa por placa con un solo método de pago
exports.registrarSalida = async (req, res) => {
    const { id_empresa } = req.usuario;
    const placa = String(req.body.placa || '').trim().toUpperCase();
    const metodoPago = req.body.metodoPago || req.body.metodo_pago || 'efectivo';
    if (!placa) return res.status(400).json({ success: false, message: 'La placa es obligatoria' });

    try {
        const [rows] = await pool.query(
            `SELECT m.id_movimiento, m.fecha_entrada, m.id_tarifa
             FROM movimientos m
             JOIN vehiculos v ON v.id_vehiculo = m.id_vehiculo
             WHERE v.placa = ? AND m.id_empresa = ? AND m.estado = 'activo'
             ORDER BY m.fecha_entrada DESC LIMIT 1`,
            [placa, id_empresa]
        );
        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: `No hay ingreso activo para la placa ${placa}` });
        }

        const [tarifas] = await pool.query('SELECT * FROM tarifas WHERE id_tarifa = ?', [rows[0].id_tarifa]);
        const { total } = calcularTotal(tarifas[0], rows[0].fecha_entrada, new Date());

        req.body = { id_movimiento: rows[0].id_movimiento, pagos: [{ metodo_pago: metodoPago, monto: total }] };
        return exports.confirmarSalida(req, res);
    } catch (error) {
        console.error('Error al registrar salida:', error);
        return res.status(500).json({ success: false, message: 'Error al registrar la salida' });
    }
};

// GET /api/movimientos/detalle/:id
exports.obtenerDetalle = async (req, res) => {
    const { id_empresa } = req.usuario;
    try {
        const [rows] = await pool.query(
            `SELECT m.id_movimiento, m.fecha_entrada, m.fecha_salida, m.total_a_pagar, m.estado,
                    v.placa, tv.nombre AS tipo, tv.codigo AS tipo_codigo,
                    ue.nombre AS usuario_entrada, us.nombre AS usuario_salida
             FROM movimientos m
             JOIN vehiculos v ON v.id_vehiculo = m.id_vehiculo
             JOIN tipos_vehiculos tv ON tv.id_tipo = v.id_tipo
             LEFT JOIN usuarios ue ON ue.id_usuario = m.id_usuario_entrada
             LEFT JOIN usuarios us ON us.id_usuario = m.id_usuario_salida
             WHERE m.id_movimiento = ? AND m.id_empresa = ?`,
            [req.params.id, id_empresa]
        );
        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Movimiento no encontrado' });
        }
        return res.json({ success: true, data: rows[0] });
    } catch (error) {
        console.error('Error al obtener detalle:', error);
        return res.status(500).json({ success: false, message: 'Error al obtener el detalle' });
    }
};

// GET /api/movimientos/factura/:id  (para reimpresión)
exports.obtenerFactura = async (req, res) => {
    const { id_empresa } = req.usuario;
    try {
        const factura = await armarFactura(pool, id_empresa, req.params.id);
        if (!factura) return res.status(404).json({ success: false, message: 'Movimiento no encontrado' });
        return res.json({ success: true, data: factura });
    } catch (error) {
        console.error('Error al obtener factura:', error);
        return res.status(500).json({ success: false, message: 'Error al obtener la factura' });
    }
};

// GET /api/movimientos/activos
exports.listarActivos = async (req, res) => {
    const { id_empresa } = req.usuario;
    try {
        const [rows] = await pool.query(
            `SELECT * FROM v_movimientos_activos WHERE id_empresa = ? ORDER BY fecha_entrada DESC`,
            [id_empresa]
        );
        return res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Error al listar activos:', error);
        return res.status(500).json({ success: false, message: 'Error al listar movimientos activos' });
    }
};
