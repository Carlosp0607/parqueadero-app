'use strict';
require('dotenv').config();
const { execFileSync } = require('child_process');
const pool = require('../src/config/db');

const EMP = Number(process.env.DEMO_EMPRESA_ID);
const NIT_DEMO = process.env.DEMO_NIT;

async function main() {
  if (!EMP || !NIT_DEMO) throw new Error('Faltan DEMO_EMPRESA_ID o DEMO_NIT en .env');

  // Guarda: verifica que el id apunte de verdad a la empresa demo
  const [rows] = await pool.query(
    'SELECT nit FROM empresas WHERE id_empresa = ?', [EMP]);

  if (!rows.length) throw new Error(`No existe la empresa ${EMP}. Abortado.`);
  if (rows[0].nit !== NIT_DEMO) {
    throw new Error(
      `ABORTADO: la empresa ${EMP} tiene NIT ${rows[0].nit}, no coincide con DEMO_NIT. No se borró nada.`
    );
  }

  const cn = await pool.getConnection();
  try {
    await cn.beginTransaction();
    // Orden por dependencias de FK
    await cn.query('DELETE FROM mensualidades_pagos WHERE id_empresa = ?', [EMP]);
    await cn.query('DELETE FROM mensualidades      WHERE id_empresa = ?', [EMP]);
    await cn.query('DELETE FROM pagos              WHERE id_empresa = ?', [EMP]);
    await cn.query('DELETE FROM turnos             WHERE id_empresa = ?', [EMP]);
    await cn.query('DELETE FROM movimientos        WHERE id_empresa = ?', [EMP]);
    await cn.query('DELETE FROM vehiculos          WHERE id_empresa = ?', [EMP]);
    await cn.commit();
  } catch (e) {
    await cn.rollback();
    throw e;
  } finally {
    cn.release();
  }

  console.log(`Empresa ${EMP} limpiada. Repoblando...`);
  execFileSync(process.execPath, [require.resolve('./seed-demo.js')], { stdio: 'inherit' });
}

main().then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1); });
