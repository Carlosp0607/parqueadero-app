const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeVehicleTypeCounts } = require('../src/utils/dashboard');

test('normaliza conteos por tipo de vehículo con nombres y códigos distintos', () => {
  const summary = normalizeVehicleTypeCounts([
    { tipo: 'Carro', count: 3 },
    { tipo: 'Moto', count: 2 },
    { tipo: 'Bicicleta', count: 5 },
    { tipo: 'carro', count: 1 },
    { tipo: 'bici', count: 4 }
  ]);

  assert.equal(summary.carro, 4);
  assert.equal(summary.moto, 2);
  assert.equal(summary.bici, 9);
});

test('devuelve ceros si no hay registros', () => {
  const summary = normalizeVehicleTypeCounts([]);

  assert.deepEqual(summary, { carro: 0, moto: 0, bici: 0 });
});
