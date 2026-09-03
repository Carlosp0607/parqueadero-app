/* ============================================================
   public/js/menu.js
   Menu lateral unico de ParkSystem.
   Reescribe el sidebar de la pagina donde se cargue.
   Para cambiar el menu del sistema entero, se edita SOLO este archivo.

   Tambien maneja el cierre de sesion y la expiracion del token.

   Uso: agregar antes de </body> en cada pagina del panel:
     <script src="../js/menu.js"></script>
   ============================================================ */
(function () {
  'use strict';

  var ITEMS = [
    { href: 'dashboard.html',     icono: 'fa-house',           texto: 'Inicio' },
    { href: 'vehiculos.html',     icono: 'fa-car',             texto: 'Vehículos' },
    { href: 'mensualidades.html', icono: 'fa-calendar-check',  texto: 'Planes' },
    { href: 'tarifas.html',       icono: 'fa-money-bill-wave', texto: 'Tarifas',       admin: true },
    { href: 'reportes.html',      icono: 'fa-chart-bar',       texto: 'Reportes',      admin: true },
    { href: 'usuarios.html',      icono: 'fa-users',           texto: 'Usuarios',      admin: true },
    { href: 'configuracion.html', icono: 'fa-gear',            texto: 'Configuración', admin: true }
  ];

  // Paginas retiradas del menu que redirigen a su reemplazo.
  var REDIRECCIONES = {
    'operacion.html': 'vehiculos.html',
    'ingreso-salida.html': 'vehiculos.html',
    'tipos-vehiculos.html': 'tarifas.html'
  };

  var RUTA_LOGOUT = '/api/auth/logout';

  // Claves de sesion. Las preferencias del equipo (ps_ultimo_nit,
  // savedUsername, savedEmpresa) NO se borran: se conservan para que el
  // operador no tenga que volver a escribir el NIT cada vez.
  var CLAVES_SESION = [
    'token', 'ps_token', 'usuario', 'user', 'userRole', 'userName',
    'empresaId', 'empresaNit', 'gfLoginDay', 'gfDismissedDay'
  ];

  function limpiarSesion() {
    CLAVES_SESION.forEach(function (k) {
      try { localStorage.removeItem(k); } catch (e) {}
    });
  }

  // ---------------------------------------------------------------------
  // Sesion vencida
  //
  // Si el token muere mientras el operador esta trabajando, cualquier llamada
  // a la API responde 401. Antes cada pagina mandaba al login SIN limpiar el
  // localStorage, y el login veia el token guardado y devolvia al panel: la
  // pantalla se recargaba sola para siempre y el operador quedaba trabado.
  //
  // Aqui se limpia primero y se redirige despues, una sola vez. El login ya
  // no encuentra token, asi que muestra el formulario y el ciclo se corta.
  // ---------------------------------------------------------------------
  var yaRedirigiendo = false;

  function sesionVencida() {
    if (yaRedirigiendo) return;
    yaRedirigiendo = true;
    limpiarSesion();
    window.location.replace('/?expirada=1');
  }

  // Envuelve fetch para detectar el 401 en TODA la aplicacion sin tener que
  // tocar cada pagina. Solo actua sobre llamadas a /api/: si el propio login
  // responde 401 (usuario o clave mala) no se toca, porque ahi el mensaje de
  // error lo maneja el formulario.
  function interceptarFetch() {
    if (window.__fetchInterceptado) return;
    window.__fetchInterceptado = true;

    var fetchOriginal = window.fetch;
    window.fetch = function () {
      var args = arguments;
      var url = '';
      try {
        url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
      } catch (e) {}

      return fetchOriginal.apply(this, args).then(function (res) {
        var esApi = url.indexOf('/api/') !== -1;
        var esLogin = url.indexOf('/api/auth/login') !== -1;
        if (esApi && !esLogin && (res.status === 401 || res.status === 403)) {
          sesionVencida();
        }
        return res;
      });
    };
  }

  function paginaActual() {
    return (window.location.pathname.split('/').pop() || 'dashboard.html').toLowerCase();
  }

  function htmlSidebar() {
    var actual = paginaActual();
    var destino = REDIRECCIONES[actual] || actual;

    var li = ITEMS.map(function (it) {
      var activa = (it.href.toLowerCase() === destino) ? ' active' : '';
      var clase  = it.admin ? 'nav-item admin-only' : 'nav-item';
      return '<li class="' + clase + '">' +
               '<a href="' + it.href + '" class="nav-link' + activa + '">' +
                 '<i class="fas ' + it.icono + '"></i><span>' + it.texto + '</span>' +
               '</a>' +
             '</li>';
    }).join('');

    return '' +
      '<div class="sidebar-header">' +
        '<div class="logo-container">' +
          '<div class="logo-circle"><span class="logo-text">PS</span></div>' +
        '</div>' +
        '<h5 class="mt-3 text-white">ParkSystem</h5>' +
      '</div>' +
      '<nav class="sidebar-nav"><ul class="nav flex-column">' + li + '</ul></nav>' +
      '<div class="sidebar-footer">' +
        '<a href="#" class="nav-link" id="btnLogout">' +
          '<i class="fas fa-sign-out-alt"></i><span>Cerrar Sesión</span>' +
        '</a>' +
      '</div>';
  }

  function salir() {
    // Se marca antes de llamar al servidor: el logout devuelve la cookie
    // borrada y no queremos que el interceptor lo lea como sesion vencida.
    yaRedirigiendo = true;

    var headers = { 'Content-Type': 'application/json' };
    var tok = localStorage.getItem('token') || localStorage.getItem('ps_token');
    if (tok) headers['Authorization'] = 'Bearer ' + tok;

    fetch(RUTA_LOGOUT, {
      method: 'POST',
      headers: headers,
      credentials: 'include',
      body: '{}'
    })
    .catch(function () { /* la cookie igual se descarta al salir */ })
    .then(function () {
      limpiarSesion();
      window.location.href = '/';
    });
  }

  function montar() {
    interceptarFetch();

    // Si la pagina fue retirada del menu, se manda a su reemplazo.
    var destino = REDIRECCIONES[paginaActual()];
    if (destino) { window.location.replace(destino); return; }

    var side = document.querySelector('.sidebar');
    if (!side) {
      side = document.createElement('div');
      side.className = 'sidebar';
      document.body.insertBefore(side, document.body.firstChild);
    }
    side.innerHTML = htmlSidebar();

    var toggle = document.querySelector('.sidebar-toggle');
    if (toggle && !toggle.dataset.menuJs) {
      toggle.dataset.menuJs = '1';
      toggle.addEventListener('click', function () {
        side.classList.toggle('active');
        var main = document.querySelector('.main-content');
        if (main) main.classList.toggle('active');
      });
    }

    var btn = document.getElementById('btnLogout');
    if (btn) btn.addEventListener('click', function (e) { e.preventDefault(); salir(); });

    // Enlace heredado que algunas paginas todavia traen oculto.
    var viejo = document.getElementById('logoutDropdown');
    if (viejo) viejo.addEventListener('click', function (e) { e.preventDefault(); salir(); });

    var span = document.getElementById('userName');
    if (span) {
      try {
        var u = JSON.parse(localStorage.getItem('usuario') || localStorage.getItem('user') || 'null');
        var n = u && (u.nombre || u.usuario || u.username || u.nombre_usuario);
        if (n) span.textContent = n;
        else {
          var simple = localStorage.getItem('userName');
          if (simple) span.textContent = simple;
        }
      } catch (e) {}
    }

    // Oculta las opciones de admin si el rol es operador.
    try {
      var rol = String(localStorage.getItem('userRole') || '').toLowerCase();
      if (!rol) {
        var raw = localStorage.getItem('usuario') || localStorage.getItem('user');
        var user = raw ? JSON.parse(raw) : null;
        rol = user ? String(user.rol || user.role || '').toLowerCase() : '';
      }
      if (rol === 'operador') {
        side.querySelectorAll('.admin-only').forEach(function (el) {
          el.style.display = 'none';
        });
      }
    } catch (e) {}
  }

  // El interceptor se instala de una, sin esperar al DOM: si una pagina hace
  // su primera llamada a la API antes de que el menu se monte, igual queda
  // protegida.
  interceptarFetch();

  // Disponible por si alguna pagina necesita cerrar sesion por su cuenta.
  window.psLimpiarSesion = limpiarSesion;
  window.psSesionVencida = sesionVencida;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', montar);
  } else {
    montar();
  }
})();
