const express = require('express');
const router = express.Router();
const reportesController = require('../controllers/reportes.controller');
const { verificarToken } = require('../middleware/auth');

router.use(verificarToken);

router.get('/kpis', reportesController.kpis);
router.get('/ingresos-por-dia', reportesController.ingresosPorDia);
router.get('/ingresos-por-metodo', reportesController.ingresosPorMetodo);
router.get('/ingresos', reportesController.ingresosPorDia); // alias legado
router.get('/movimientos', reportesController.movimientos);
router.get('/movimientos-ajustados', reportesController.movimientosAjustados);
router.get('/top-placas', reportesController.topPlacas);
router.get('/top', reportesController.topPlacas);           // alias legado
router.get('/export/xlsx', reportesController.exportarXlsx);
router.get('/turnos/export/xlsx', reportesController.exportarTurnosXlsx);
router.get('/turnos', reportesController.turnos);
router.get('/cierre-caja', reportesController.obtenerCierreCaja);

module.exports = router;
