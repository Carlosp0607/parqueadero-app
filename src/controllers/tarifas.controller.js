// Controlador de tarifas
// FIX: el archivo src/routes/tarifas.js era en realidad un CONTROLADOR montado como router
// (app.use('/api/tarifas', objeto) -> crash) y además consultaba columnas inexistentes
// (nombre_vehiculo, valor_fraccion, minutos_gracia, estado) y sin filtro por empresa.
// Reescrito contra el esquema real de schema.sql y aislado por id_empresa.
const pool = require('../config/db');

const SELECT_BASE = `
    SELECT t.id_tarifa, t.id_tipo, t.valor_hora, t.valor_minuto, t.valor_dia_completo,
           t.modo_cobro, t.paso_minutos_a_horas, t.paso_horas_a_dias,
           t.redondeo_horas, t.redondeo_dias, t.activa,
           t.fecha_vigencia_desde, t.fecha_vigencia_hasta,
           tv.nombre AS tipo_nombre, tv.codigo AS tipo_codigo
    FROM tarifas t
    JOIN tipos_vehiculos tv ON tv.id_tipo = t.id_tipo
`;

exports.obtenerTarifas = async (req, res) => {
    try {
        const [tarifas] = await pool.query(
            `${SELECT_BASE} WHERE t.id_empresa = ? ORDER BY tv.nombre ASC`,
            [req.usuario.id_empresa]
        );
        return res.json({ success: true, data: tarifas, tarifas });
    } catch (error) {
        console.error('Error al obtener tarifas:', error);
        return res.status(500).json({ success: false, message: 'Error interno al consultar tarifas' });
    }
};

exports.obtenerTarifasVigentes = async (req, res) => {
    try {
        const [tarifas] = await pool.query(
            `${SELECT_BASE}
             WHERE t.id_empresa = ? AND t.activa = TRUE
               AND t.fecha_vigencia_desde <= NOW()
               AND (t.fecha_vigencia_hasta IS NULL OR t.fecha_vigencia_hasta >= NOW())
             ORDER BY tv.nombre ASC`,
            [req.usuario.id_empresa]
        );
        return res.json({ success: true, data: tarifas });
    } catch (error) {
        console.error('Error al obtener tarifas vigentes:', error);
        return res.status(500).json({ success: false, message: 'Error interno al consultar tarifas' });
    }
};

// Crea o actualiza la tarifa vigente de un tipo de vehículo (upsert por id_tipo)
exports.guardarTarifa = async (req, res) => {
    const { id_empresa } = req.usuario;
    const id_tipo = Number(req.body.id_tipo);
    const {
        modo_cobro = 'mixto',
        valor_hora = 0,
        valor_minuto = 0,
        valor_dia_completo = 0,
        paso_minutos_a_horas = 0,
        paso_horas_a_dias = 0,
        redondeo_horas = 'arriba',
        redondeo_dias = 'arriba'
    } = req.body;

    if (!id_tipo) {
        return res.status(400).json({ success: false, message: 'Debe seleccionar un tipo de vehículo' });
    }
    if ([valor_hora, valor_minuto, valor_dia_completo].some(v => Number(v) < 0)) {
        return res.status(400).json({ success: false, message: 'Los valores no pueden ser negativos' });
    }
    if (!['minuto', 'hora', 'dia', 'mixto'].includes(modo_cobro)) {
        return res.status(400).json({ success: false, message: 'Modo de cobro inválido' });
    }

    try {
        const [tipos] = await pool.query(
            'SELECT id_tipo FROM tipos_vehiculos WHERE id_tipo = ? AND id_empresa = ?',
            [id_tipo, id_empresa]
        );
        if (tipos.length === 0) {
            return res.status(400).json({ success: false, message: 'Tipo de vehículo no válido para esta empresa' });
        }

        const [existente] = await pool.query(
            'SELECT id_tarifa FROM tarifas WHERE id_empresa = ? AND id_tipo = ? AND activa = TRUE LIMIT 1',
            [id_empresa, id_tipo]
        );

        const valores = [
            Number(valor_hora), Number(valor_minuto), Number(valor_dia_completo),
            modo_cobro, parseInt(paso_minutos_a_horas, 10) || 0, parseInt(paso_horas_a_dias, 10) || 0,
            redondeo_horas, redondeo_dias
        ];

        if (existente.length > 0) {
            await pool.query(
                `UPDATE tarifas SET valor_hora = ?, valor_minuto = ?, valor_dia_completo = ?,
                        modo_cobro = ?, paso_minutos_a_horas = ?, paso_horas_a_dias = ?,
                        redondeo_horas = ?, redondeo_dias = ?
                 WHERE id_tarifa = ? AND id_empresa = ?`,
                [...valores, existente[0].id_tarifa, id_empresa]
            );
            return res.json({ success: true, message: 'Tarifa actualizada correctamente', id_tarifa: existente[0].id_tarifa });
        }

        const [ins] = await pool.query(
            `INSERT INTO tarifas (id_empresa, id_tipo, valor_hora, valor_minuto, valor_dia_completo,
                                  modo_cobro, paso_minutos_a_horas, paso_horas_a_dias,
                                  redondeo_horas, redondeo_dias, activa)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE)`,
            [id_empresa, id_tipo, ...valores]
        );
        return res.status(201).json({ success: true, message: 'Tarifa creada exitosamente', id_tarifa: ins.insertId });
    } catch (error) {
        console.error('Error al guardar tarifa:', error);
        return res.status(500).json({ success: false, message: 'Error al procesar la tarifa' });
    }
};

exports.cambiarEstadoTarifa = async (req, res) => {
    const { id_empresa } = req.usuario;
    const activa = req.body.activa !== undefined
        ? Boolean(req.body.activa)
        : String(req.body.estado || '').toUpperCase() === 'ACTIVO';

    try {
        const [r] = await pool.query(
            'UPDATE tarifas SET activa = ? WHERE id_tarifa = ? AND id_empresa = ?',
            [activa, req.params.id, id_empresa]
        );
        if (r.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Tarifa no encontrada' });
        }
        return res.json({ success: true, message: 'Estado de la tarifa modificado' });
    } catch (error) {
        console.error('Error al cambiar estado de tarifa:', error);
        return res.status(500).json({ success: false, message: 'Error al cambiar estado' });
    }
};
