// Controlador de reportes
// FIX: src/routes/reportes.js era un CONTROLADOR montado como router (crash al arrancar)
// y solo tenía obtenerCierreCaja, consultando columnas inexistentes
// (total_pagar, usuario_salida_id, estado='FINALIZADO'). Reescrito contra el esquema real
// e implementados los endpoints que el frontend ya consumía.
const pool = require('../config/db');
const ExcelJS = require('exceljs');

function rango(req) {
    const hoy = new Date().toISOString().slice(0, 10);
    const q = req.query || {};
    const desde = typeof q.desde === 'string' && q.desde.length >= 8 ? q.desde : hoy;
    const hasta = typeof q.hasta === 'string' && q.hasta.length >= 8 ? q.hasta : hoy;
    return { desde: `${desde} 00:00:00`, hasta: `${hasta} 23:59:59` };
}

// GET /api/reportes/kpis
exports.kpis = async (req, res) => {
    const { id_empresa } = req.usuario;
    const { desde, hasta } = rango(req);
    try {
        const [[mov]] = await pool.query(
            `SELECT COALESCE(SUM(monto),0) AS total FROM pagos
             WHERE id_empresa = ? AND fecha_pago BETWEEN ? AND ?`,
            [id_empresa, desde, hasta]
        );
        const [[mens]] = await pool.query(
            `SELECT COALESCE(SUM(monto),0) AS total FROM mensualidades_pagos
             WHERE id_empresa = ? AND fecha_pago BETWEEN ? AND ?`,
            [id_empresa, desde, hasta]
        );
        const [[tk]] = await pool.query(
            `SELECT COUNT(*) AS tickets FROM movimientos
             WHERE id_empresa = ? AND estado = 'finalizado' AND fecha_salida BETWEEN ? AND ?`,
            [id_empresa, desde, hasta]
        );
        const [[ocupados]] = await pool.query(
            `SELECT COUNT(*) AS n FROM movimientos WHERE id_empresa = ? AND estado = 'activo'`,
            [id_empresa]
        );
        const [[cap]] = await pool.query(
            `SELECT COALESCE(SUM(capacidad_total),0) AS total FROM capacidades_tipo WHERE id_empresa = ?`,
            [id_empresa]
        );

        const ingresosMov = Number(mov.total);
        const ingresosMens = Number(mens.total);
        const tickets = Number(tk.tickets);
        const capacidad = Number(cap.total);

        return res.json({
            success: true,
            data: {
                ingresos: ingresosMov + ingresosMens,
                ingresosMov,
                ingresosMens,
                tickets,
                promedioTicket: tickets > 0 ? Math.round(ingresosMov / tickets) : 0,
                ocupacion: capacidad > 0 ? Math.round((Number(ocupados.n) / capacidad) * 100) : 0
            }
        });
    } catch (error) {
        console.error('Error KPIs:', error);
        return res.status(500).json({ success: false, message: 'Error al calcular KPIs' });
    }
};

// GET /api/reportes/ingresos-por-dia
exports.ingresosPorDia = async (req, res) => {
    const { id_empresa } = req.usuario;
    const { desde, hasta } = rango(req);
    const metodo = ['efectivo', 'tarjeta', 'QR'].includes(req.query.metodo) ? req.query.metodo : null;
    try {
        const params = [id_empresa, desde, hasta];
        let filtro = '';
        if (metodo) { filtro = ' AND metodo_pago = ?'; params.push(metodo); }

        const [rows] = await pool.query(
            `SELECT DATE(fecha_pago) AS fecha, COALESCE(SUM(monto),0) AS total
             FROM pagos
             WHERE id_empresa = ? AND fecha_pago BETWEEN ? AND ?${filtro}
             GROUP BY DATE(fecha_pago) ORDER BY fecha ASC`,
            params
        );
        return res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Error ingresos por día:', error);
        return res.status(500).json({ success: false, message: 'Error al consultar ingresos por día' });
    }
};

// GET /api/reportes/ingresos-por-metodo
exports.ingresosPorMetodo = async (req, res) => {
    const { id_empresa } = req.usuario;
    const { desde, hasta } = rango(req);
    try {
        const [rows] = await pool.query(
            `SELECT metodo_pago, COALESCE(SUM(monto),0) AS total
             FROM pagos
             WHERE id_empresa = ? AND fecha_pago BETWEEN ? AND ?
             GROUP BY metodo_pago ORDER BY total DESC`,
            [id_empresa, desde, hasta]
        );
        return res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Error ingresos por método:', error);
        return res.status(500).json({ success: false, message: 'Error al consultar ingresos por método' });
    }
};

function construirFiltroMovimientos(req) {
    const { id_empresa } = req.usuario;
    const { desde, hasta } = rango(req);
    const params = [id_empresa, desde, hasta];
    let where = `m.id_empresa = ? AND m.fecha_entrada BETWEEN ? AND ?`;

    if (req.query.estado === 'activo' || req.query.estado === 'finalizado') {
        where += ' AND m.estado = ?';
        params.push(req.query.estado);
    }
    if (req.query.tipo) {
        where += ' AND tv.codigo = ?';
        params.push(String(req.query.tipo).toLowerCase());
    }
    if (req.query.placa) {
        where += ' AND v.placa LIKE ?';
        params.push(`%${String(req.query.placa).toUpperCase().replace(/[%_]/g, c => '\\' + c)}%`);
    }
    return { where, params };
}

// GET /api/reportes/movimientos
exports.movimientos = async (req, res) => {
    const { toSafeInt } = require('../utils/sanitize');
    const page = toSafeInt(req.query.page, { min: 0, max: 100000, fallback: 0 });
    const pageSize = toSafeInt(req.query.pageSize, { min: 1, max: 100, fallback: 20 });
    const { where, params } = construirFiltroMovimientos(req);

    try {
        const [rows] = await pool.query(
            `SELECT m.id_movimiento, v.placa, tv.nombre AS tipo, tv.codigo AS tipo_codigo,
                    m.fecha_entrada, m.fecha_salida, m.estado, m.total_a_pagar
             FROM movimientos m
             JOIN vehiculos v ON v.id_vehiculo = m.id_vehiculo
             JOIN tipos_vehiculos tv ON tv.id_tipo = v.id_tipo
             WHERE ${where}
             ORDER BY m.fecha_entrada DESC
             LIMIT ? OFFSET ?`,
            [...params, pageSize, page * pageSize]
        );
        const [[c]] = await pool.query(
            `SELECT COUNT(*) AS total FROM movimientos m
             JOIN vehiculos v ON v.id_vehiculo = m.id_vehiculo
             JOIN tipos_vehiculos tv ON tv.id_tipo = v.id_tipo
             WHERE ${where}`,
            params
        );
        return res.json({
            success: true,
            data: rows,
            paging: { page, pageSize, total: Number(c.total), hasNext: (page + 1) * pageSize < Number(c.total) }
        });
    } catch (error) {
        console.error('Error reporte movimientos:', error);
        return res.status(500).json({ success: false, message: 'Error al consultar movimientos' });
    }
};

// GET /api/reportes/movimientos-ajustados (sin paginar, para exportar a PDF en cliente)
exports.movimientosAjustados = async (req, res) => {
    const { toSafeInt } = require('../utils/sanitize');
    const limit = toSafeInt(req.query.limit, { min: 1, max: 5000, fallback: 1000 });
    const { where, params } = construirFiltroMovimientos(req);
    try {
        const [rows] = await pool.query(
            `SELECT m.id_movimiento, v.placa, tv.nombre AS tipo, tv.codigo AS tipo_codigo,
                    m.fecha_entrada, m.fecha_salida, m.estado, m.total_a_pagar
             FROM movimientos m
             JOIN vehiculos v ON v.id_vehiculo = m.id_vehiculo
             JOIN tipos_vehiculos tv ON tv.id_tipo = v.id_tipo
             WHERE ${where}
             ORDER BY m.fecha_entrada DESC LIMIT ?`,
            [...params, limit]
        );
        return res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Error movimientos ajustados:', error);
        return res.status(500).json({ success: false, message: 'Error al consultar movimientos' });
    }
};

// GET /api/reportes/top-placas
exports.topPlacas = async (req, res) => {
    const { toSafeInt } = require('../utils/sanitize');
    const { id_empresa } = req.usuario;
    const { desde, hasta } = rango(req);
    const limit = toSafeInt(req.query.limit, { min: 1, max: 100, fallback: 10 });
    try {
        const [rows] = await pool.query(
            `SELECT v.placa, tv.nombre AS tipo, COUNT(*) AS visitas,
                    COALESCE(SUM(m.total_a_pagar),0) AS total
             FROM movimientos m
             JOIN vehiculos v ON v.id_vehiculo = m.id_vehiculo
             JOIN tipos_vehiculos tv ON tv.id_tipo = v.id_tipo
             WHERE m.id_empresa = ? AND m.fecha_entrada BETWEEN ? AND ?
             GROUP BY v.placa, tv.nombre
             ORDER BY visitas DESC, total DESC
             LIMIT ?`,
            [id_empresa, desde, hasta, limit]
        );
        return res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Error top placas:', error);
        return res.status(500).json({ success: false, message: 'Error al consultar top de placas' });
    }
};

// GET /api/reportes/export/xlsx
exports.exportarXlsx = async (req, res) => {
    const { where, params } = construirFiltroMovimientos(req);
    try {
        const [rows] = await pool.query(
            `SELECT m.id_movimiento, v.placa, tv.nombre AS tipo,
                    m.fecha_entrada, m.fecha_salida, m.estado, m.total_a_pagar
             FROM movimientos m
             JOIN vehiculos v ON v.id_vehiculo = m.id_vehiculo
             JOIN tipos_vehiculos tv ON tv.id_tipo = v.id_tipo
             WHERE ${where}
             ORDER BY m.fecha_entrada DESC LIMIT 5000`,
            params
        );

        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet('Movimientos');
        ws.columns = [
            { header: 'ID', key: 'id_movimiento', width: 10 },
            { header: 'Placa', key: 'placa', width: 14 },
            { header: 'Tipo', key: 'tipo', width: 16 },
            { header: 'Entrada', key: 'fecha_entrada', width: 22 },
            { header: 'Salida', key: 'fecha_salida', width: 22 },
            { header: 'Estado', key: 'estado', width: 14 },
            { header: 'Total', key: 'total_a_pagar', width: 14 }
        ];
        ws.getRow(1).font = { bold: true };
        rows.forEach(r => ws.addRow(r));

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="reporte-movimientos.xlsx"');
        await wb.xlsx.write(res);
        return res.end();
    } catch (error) {
        console.error('Error exportando XLSX:', error);
        return res.status(500).json({ success: false, message: 'Error al exportar el reporte' });
    }
};

// GET /api/reportes/turnos
exports.turnos = async (req, res) => {
    const { id_empresa } = req.usuario;
    const { desde, hasta } = rango(req);
    try {
        const [rows] = await pool.query(
            `SELECT t.id_turno, u.nombre AS usuario, t.fecha_apertura, t.fecha_cierre,
                    t.base_inicial, t.total_efectivo, t.total_tarjeta, t.total_qr,
                    t.total_general, t.diferencia, t.estado
             FROM turnos t
             JOIN usuarios u ON u.id_usuario = t.id_usuario
             WHERE t.id_empresa = ? AND t.fecha_apertura BETWEEN ? AND ?
             ORDER BY t.fecha_apertura DESC`,
            [id_empresa, desde, hasta]
        );
        return res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Error reporte turnos:', error);
        return res.status(500).json({ success: false, message: 'Error al consultar turnos' });
    }
};

// GET /api/reportes/turnos/export/xlsx
exports.exportarTurnosXlsx = async (req, res) => {
    const { id_empresa } = req.usuario;
    const { desde, hasta } = rango(req);
    try {
        const [rows] = await pool.query(
            `SELECT t.id_turno, u.nombre AS usuario, t.fecha_apertura, t.fecha_cierre,
                    t.base_inicial, t.total_efectivo, t.total_tarjeta, t.total_qr,
                    t.total_general, t.diferencia, t.estado
             FROM turnos t
             JOIN usuarios u ON u.id_usuario = t.id_usuario
             WHERE t.id_empresa = ? AND t.fecha_apertura BETWEEN ? AND ?
             ORDER BY t.fecha_apertura DESC LIMIT 5000`,
            [id_empresa, desde, hasta]
        );

        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet('Turnos');
        ws.columns = [
            { header: 'Turno', key: 'id_turno', width: 10 },
            { header: 'Usuario', key: 'usuario', width: 22 },
            { header: 'Apertura', key: 'fecha_apertura', width: 22 },
            { header: 'Cierre', key: 'fecha_cierre', width: 22 },
            { header: 'Base', key: 'base_inicial', width: 14 },
            { header: 'Efectivo', key: 'total_efectivo', width: 14 },
            { header: 'Tarjeta', key: 'total_tarjeta', width: 14 },
            { header: 'QR', key: 'total_qr', width: 14 },
            { header: 'Total', key: 'total_general', width: 14 },
            { header: 'Diferencia', key: 'diferencia', width: 14 },
            { header: 'Estado', key: 'estado', width: 12 }
        ];
        ws.getRow(1).font = { bold: true };
        rows.forEach(r => ws.addRow(r));

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="reporte-turnos.xlsx"');
        await wb.xlsx.write(res);
        return res.end();
    } catch (error) {
        console.error('Error exportando turnos XLSX:', error);
        return res.status(500).json({ success: false, message: 'Error al exportar turnos' });
    }
};

// GET /api/reportes/cierre-caja
exports.obtenerCierreCaja = async (req, res) => {
    const { id_empresa, id: id_usuario } = req.usuario;
    try {
        const [rows] = await pool.query(
            `SELECT COUNT(m.id_movimiento) AS total_vehiculos,
                    COALESCE(SUM(m.total_a_pagar),0) AS total_recaudado,
                    MIN(m.fecha_entrada) AS primer_ingreso,
                    MAX(m.fecha_salida) AS ultima_salida
             FROM movimientos m
             WHERE m.id_empresa = ? AND m.id_usuario_salida = ?
               AND m.estado = 'finalizado' AND DATE(m.fecha_salida) = CURDATE()`,
            [id_empresa, id_usuario]
        );
        return res.json({ success: true, cierre: rows[0], data: rows[0] });
    } catch (error) {
        console.error('Error al generar cierre de caja:', error);
        return res.status(500).json({ success: false, message: 'Error al consultar reporte de caja' });
    }
};
