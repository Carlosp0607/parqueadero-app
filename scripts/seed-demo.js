'use strict';
require('dotenv').config();
const pool = require('../src/config/db');

const EMP = Number(process.env.DEMO_EMPRESA_ID);

const LETRAS = 'ABCDEFGHJKLMNPRSTUVWXYZ';
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];

function placaCarro() {
  return `${pick(LETRAS)}${pick(LETRAS)}${pick(LETRAS)}${rnd(10)}${rnd(10)}${rnd(10)}`;
}
function placaMoto() {
  return `${pick(LETRAS)}${pick(LETRAS)}${pick(LETRAS)}${rnd(10)}${rnd(10)}${pick(LETRAS)}`;
}

async function main() {
  if (!EMP) throw new Error('Falta DEMO_EMPRESA_ID en .env');

  const cn = await pool.getConnection();
  try {
    await cn.beginTransaction();

    const [tipos] = await cn.query(
      'SELECT id_tipo, codigo FROM tipos_vehiculos WHERE id_empresa = ?', [EMP]);
    const [tarifas] = await cn.query(
      'SELECT id_tarifa, id_tipo FROM tarifas WHERE id_empresa = ? AND activa = TRUE', [EMP]);
    const [usuarios] = await cn.query(
      'SELECT id_usuario FROM usuarios WHERE id_empresa = ? LIMIT 1', [EMP]);

    if (!tipos.length || !tarifas.length || !usuarios.length) {
      throw new Error('La empresa demo no tiene tipos, tarifas o usuarios. Corre 02-empresa-demo.sql primero.');
    }

    // Placas ya existentes en la BD, para no chocar en corridas repetidas
    const [previas] = await cn.query(
      'SELECT placa FROM vehiculos WHERE id_empresa = ?', [EMP]);
    const placasUsadas = new Set(previas.map(p => p.placa));

    const uid = usuarios[0].id_usuario;
    const tarifaDe = (idTipo) => tarifas.find(t => t.id_tipo === idTipo).id_tarifa;
    const colores = ['Blanco','Negro','Gris','Rojo','Azul','Plata','Verde'];

    // 30 vehículos
    const vehiculos = [];
    for (let i = 0; i < 30; i++) {
      const tipo = pick(tipos);

      let placa;
      do {
        placa = tipo.codigo === 'moto' ? placaMoto()
              : tipo.codigo === 'bici' ? `BIC${rnd(900) + 100}`
              : placaCarro();
      } while (placasUsadas.has(placa));
      placasUsadas.add(placa);

      const [r] = await cn.query(
        `INSERT INTO vehiculos (id_empresa, placa, id_tipo, color, modelo)
         VALUES (?,?,?,?,?)`,
        [EMP, placa, tipo.id_tipo, pick(colores), String(2015 + rnd(11))]
      );
      vehiculos.push({ id: r.insertId, id_tipo: tipo.id_tipo });
    }

    // Movimientos de los últimos 30 días, fechas relativas a hoy
    const metodos = ['efectivo','tarjeta','QR'];
    for (let d = 29; d >= 0; d--) {
      const porDia = 4 + rnd(6);
      for (let k = 0; k < porDia; k++) {
        const v = pick(vehiculos);
        const entrada = new Date();
        entrada.setDate(entrada.getDate() - d);
        entrada.setHours(7 + rnd(12), rnd(60), 0, 0);

        const salida = new Date(entrada);
        salida.setMinutes(salida.getMinutes() + 30 + rnd(300));

        const abierto = d === 0 && k === 0;
        const total = 2000 + rnd(28000);

        const [m] = await cn.query(
          `INSERT INTO movimientos
             (id_empresa, id_vehiculo, fecha_entrada, fecha_salida, id_tarifa,
              total_a_pagar, id_usuario_entrada, id_usuario_salida, estado)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          [EMP, v.id, entrada, abierto ? null : salida, tarifaDe(v.id_tipo),
           abierto ? null : total, uid, abierto ? null : uid,
           abierto ? 'activo' : 'finalizado']
        );

        if (!abierto) {
          await cn.query(
            `INSERT INTO pagos
               (id_empresa, id_movimiento, metodo_pago, monto, fecha_pago, id_usuario)
             VALUES (?,?,?,?,?,?)`,
            [EMP, m.insertId, pick(metodos), total, salida, uid]
          );
        }
      }
    }

    // 2 turnos cerrados
    for (let i = 2; i >= 1; i--) {
      const ap = new Date(); ap.setDate(ap.getDate() - i); ap.setHours(7,0,0,0);
      const ci = new Date(ap); ci.setHours(19,0,0,0);
      const ef = 150000 + rnd(200000);
      const ta = 80000 + rnd(150000);
      const qr = 40000 + rnd(90000);
      await cn.query(
        `INSERT INTO turnos
           (id_empresa, id_usuario, fecha_apertura, base_inicial, observacion_apertura,
            fecha_cierre, total_efectivo, total_tarjeta, total_qr, total_general,
            diferencia, observacion_cierre, estado)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'cerrado')`,
        [EMP, uid, ap, 100000, 'Apertura de demostración',
         ci, ef, ta, qr, ef + ta + qr, 0, 'Cierre de demostración']
      );
    }

    await cn.commit();
    console.log(`Seed demo listo. Empresa ${EMP}: 30 vehículos, ~150 movimientos, 2 turnos.`);
  } catch (e) {
    await cn.rollback();
    throw e;
  } finally {
    cn.release();
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });