const express = require('express');
const router = express.Router();
const movimientosController = require('../controllers/movimientos.controller');
// FIX: la ruta del middleware estaba mal escrita (carpeta plural inexistente)
const { verificarToken } = require('../middleware/auth');
const { sanitizeIdParam } = require('../utils/sanitize');

router.use(verificarToken);

// Ingreso
router.post('/ingreso', movimientosController.registrarEntrada);
router.post('/entrada', movimientosController.registrarEntrada); // alias legado

// Salida en dos pasos (calcular -> confirmar con pagos)
router.post('/calcular-salida', movimientosController.calcularSalida);
router.post('/calcular', movimientosController.calcularSalida);   // alias legado
router.post('/confirmar-salida', movimientosController.confirmarSalida);
router.post('/confirmar', movimientosController.confirmarSalida); // alias legado

// Salida directa
router.post('/salida', movimientosController.registrarSalida);

// Consultas
router.get('/activos', movimientosController.listarActivos);
router.get('/detalle/:id', sanitizeIdParam('id'), movimientosController.obtenerDetalle);
router.get('/factura/:id', sanitizeIdParam('id'), movimientosController.obtenerFactura);

module.exports = router;
