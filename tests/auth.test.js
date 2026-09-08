// Pruebas del middleware de autenticacion.
//
// Verifican las tres garantias sobre las que se apoya el aislamiento
// multi-tenant del sistema:
//   1. Ninguna peticion avanza sin token valido.
//   2. Ninguna peticion avanza sin id_empresa: es lo que impide que una
//      consulta se ejecute sin saber a que empresa pertenece.
//   3. El rol invitado del modo demostracion no puede escribir.
//
// Ejecutar:  npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'clave-solo-para-pruebas';

const verificarToken = require('../src/middleware/auth');
const { esAdmin } = require('../src/middleware/auth');

// ─────────────────────────────────────────────
//  Utilidades: simulan req, res y next de Express
// ─────────────────────────────────────────────

function crearRes() {
  return {
    statusCode: null,
    cuerpo: null,
    status(codigo) {
      this.statusCode = codigo;
      return this;
    },
    json(datos) {
      this.cuerpo = datos;
      return this;
    }
  };
}

function crearReq({ token, metodo = 'GET' } = {}) {
  return {
    method: metodo,
    headers: token ? { authorization: `Bearer ${token}` } : {}
  };
}

function firmar(carga) {
  return jwt.sign(carga, process.env.JWT_SECRET);
}

// Ejecuta el middleware y reporta si dejo pasar la peticion
function ejecutar(middleware, req) {
  const res = crearRes();
  let paso = false;
  middleware(req, res, () => { paso = true; });
  return { res, paso };
}

const USUARIO_VALIDO = {
  id_usuario: 7,
  id_empresa: 3,
  rol: 'admin',
  nombre: 'Operador Prueba'
};

// ─────────────────────────────────────────────
//  1. Autenticacion
// ─────────────────────────────────────────────

test('sin token la peticion se rechaza con 401', () => {
  const { res, paso } = ejecutar(verificarToken, crearReq());

  assert.equal(paso, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.cuerpo.success, false);
});

test('un token firmado con otra clave se rechaza', () => {
  const tokenAjeno = jwt.sign(USUARIO_VALIDO, 'clave-de-un-atacante');
  const { res, paso } = ejecutar(verificarToken, crearReq({ token: tokenAjeno }));

  assert.equal(paso, false);
  assert.equal(res.statusCode, 401);
});

test('un token valido deja pasar la peticion', () => {
  const { paso } = ejecutar(verificarToken, crearReq({ token: firmar(USUARIO_VALIDO) }));

  assert.equal(paso, true);
});

// ─────────────────────────────────────────────
//  2. Aislamiento por empresa (multi-tenant)
// ─────────────────────────────────────────────

test('un token sin id_empresa no puede avanzar', () => {
  // Garantia central del sistema: si la identidad no dice a que empresa
  // pertenece, ninguna consulta debe llegar a ejecutarse.
  const sinEmpresa = { id_usuario: 7, rol: 'admin', nombre: 'Sin empresa' };
  const { res, paso } = ejecutar(verificarToken, crearReq({ token: firmar(sinEmpresa) }));

  assert.equal(paso, false, 'dejo pasar una peticion sin empresa');
  assert.equal(res.statusCode, 401);
  assert.match(res.cuerpo.message, /Token incompleto/);
});

test('el id_empresa del token queda disponible para las consultas', () => {
  const req = crearReq({ token: firmar(USUARIO_VALIDO) });
  ejecutar(verificarToken, req);

  assert.equal(req.usuario.id_empresa, 3);
  assert.equal(req.user.id_empresa, 3, 'el alias req.user debe coincidir');
});

test('un token sin usuario tampoco avanza', () => {
  const sinUsuario = { id_empresa: 3, rol: 'admin' };
  const { res, paso } = ejecutar(verificarToken, crearReq({ token: firmar(sinUsuario) }));

  assert.equal(paso, false);
  assert.equal(res.statusCode, 401);
});

// ─────────────────────────────────────────────
//  3. Modo demostracion: el invitado solo lee
// ─────────────────────────────────────────────

const INVITADO = { id_usuario: 99, id_empresa: 1, rol: 'invitado', nombre: 'Invitado' };

test('el invitado puede consultar', () => {
  const { paso } = ejecutar(
    verificarToken,
    crearReq({ token: firmar(INVITADO), metodo: 'GET' })
  );

  assert.equal(paso, true);
});

test('el invitado no puede escribir por ningun metodo', () => {
  for (const metodo of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const { res, paso } = ejecutar(
      verificarToken,
      crearReq({ token: firmar(INVITADO), metodo })
    );

    assert.equal(paso, false, `${metodo} no fue bloqueado`);
    assert.equal(res.statusCode, 403, `${metodo} no devolvio 403`);
  }
});

test('un usuario normal si puede escribir', () => {
  const { paso } = ejecutar(
    verificarToken,
    crearReq({ token: firmar(USUARIO_VALIDO), metodo: 'POST' })
  );

  assert.equal(paso, true);
});

// ─────────────────────────────────────────────
//  4. Rol de administrador
// ─────────────────────────────────────────────

test('esAdmin bloquea a quien no es administrador', () => {
  const req = { usuario: { rol: 'operador' } };
  const { res, paso } = ejecutar(esAdmin, req);

  assert.equal(paso, false);
  assert.equal(res.statusCode, 403);
});

test('esAdmin deja pasar al administrador', () => {
  const req = { usuario: { rol: 'admin' } };
  const { paso } = ejecutar(esAdmin, req);

  assert.equal(paso, true);
});