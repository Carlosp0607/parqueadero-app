const express = require('express');
const router = express.Router();
const tarifasController = require('../controllers/tarifas.controller');
const { verificarToken, esAdmin } = require('../middleware/auth');
const { sanitizeIdParam } = require('../utils/sanitize');

// Lectura abierta a cualquier usuario autenticado (los cajeros necesitan ver tarifas)
router.get('/', verificarToken, tarifasController.obtenerTarifas);
router.get('/current', verificarToken, tarifasController.obtenerTarifasVigentes);

// Escritura solo administradores
router.post('/', verificarToken, esAdmin, tarifasController.guardarTarifa);
router.put('/', verificarToken, esAdmin, tarifasController.guardarTarifa);
router.put('/:id/estado', verificarToken, esAdmin, sanitizeIdParam('id'), tarifasController.cambiarEstadoTarifa);

module.exports = router;
