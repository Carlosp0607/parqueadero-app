function normalizeVehicleTypeCounts(rows = []) {
  const map = { carro: 0, moto: 0, bici: 0 };

  rows.forEach((row) => {
    if (!row || typeof row !== 'object') return;

    const tipo = String(row.tipo || row.tipo_codigo || '').trim().toLowerCase();
    const count = Number(row.count || 0);

    if (!Number.isFinite(count)) return;

    if (tipo === 'carro' || tipo === 'auto' || tipo === 'vehiculo' || tipo === 'coche') {
      map.carro += count;
      return;
    }

    if (tipo === 'moto' || tipo === 'motocicleta') {
      map.moto += count;
      return;
    }

    if (tipo === 'bici' || tipo === 'bicicleta' || tipo === 'bike' || tipo === 'bicicleta') {
      map.bici += count;
    }
  });

  return map;
}

module.exports = {
  normalizeVehicleTypeCounts
};
