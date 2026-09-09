/**
 * Panel de administracion: registrar depositos, poner cuanto vale cada partido
 * y revisar quien eligio que.
 *
 * Registrar un deposito es lo unico que abre semanas. Mientras un jugador no
 * aparezca aqui con su dinero, no puede poner partidos.
 */

'use strict';

(function () {

  var LLAVE = 'quiniela.admin';
  var token = localStorage.getItem(LLAVE) || '';
  var datos = null;         // /api/admin/jugadores
  var semanaPuntos = 1;
  var semanaPicks = 1;
  var puntosSemana = null;  // /api/admin/semana
  var cambios = {};         // partidoId -> valor sin guardar
  var jugadorEnDialogo = null;

  var $ = function (id) { return document.getElementById(id); };

  function api(ruta, cuerpo) {
    var cabeceras = { 'Content-Type': 'application/json' };
    if (token) cabeceras.Authorization = 'Bearer ' + token;
    return fetch(ruta, {
      method: cuerpo ? 'POST' : 'GET',
      headers: cabeceras,
      body: cuerpo ? JSON.stringify(cuerpo) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) { var e = new Error(d.error || 'Error'); e.estado = r.status; throw e; }
        return d;
      });
    });
  }

  function brindis(mensaje, tipo) {
    var caja = document.createElement('div');
    caja.className = 'brindis ' + (tipo || '');
    caja.textContent = mensaje;
    $('brindis').appendChild(caja);
    setTimeout(function () { caja.remove(); }, tipo === 'mal' ? 5200 : 3200);
  }

  // Iconos dibujados a mano, los mismos que usa la pantalla del jugador.
  var TRAZOS = {
    candado: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    billete: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 12h.01M18 12h.01"/>',
    palomita: '<path d="M20 6 9 17l-5-5"/>',
    luna: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/>',
    gente: '<path d="M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 20v-2a4 4 0 0 0-3-3.9"/>',
    foco: '<path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V18h8v-3.3A7 7 0 0 0 12 2Z"/>',
    diana: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4"/>',
    estrella: '<path d="m12 2.6 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5L2.6 9.4l6.5-.9Z"/>'
  };

  function ico(nombre) {
    return '<svg class="ico" viewBox="0 0 24 24">' + TRAZOS[nombre] + '</svg>';
  }

  var ZONA = 'America/Mexico_City';
  var fmt = new Intl.DateTimeFormat('es-MX', {
    timeZone: ZONA, weekday: 'short', day: 'numeric', month: 'short',
    hour: 'numeric', minute: '2-digit', hour12: true
  });
  function cuando(iso) { return fmt.format(new Date(iso)).replace(/\./g, ''); }
  function pesos(n) { return '$' + Number(n).toLocaleString('es-MX'); }


  /**
   * Cuando el servidor corre con QUINIELA_ENSAYO, se pinta una cinta que no
   * deja lugar a dudas: esto no es la quiniela de verdad.
   */
  function pintarCintaEnsayo(d) {
    var cinta = document.getElementById('cinta-ensayo');
    if (!cinta || !d.ensayo) return;
    var f = new Intl.DateTimeFormat('es-MX', {
      timeZone: 'America/Mexico_City', weekday: 'long', day: 'numeric',
      month: 'long', hour: 'numeric', minute: '2-digit'
    }).format(new Date(d.ahora));
    cinta.innerHTML = 'Modo ensayo · el sistema cree que hoy es <b>' + f + '</b> · datos de mentiras';
    cinta.hidden = false;
    // La pestaña también lo dice: con la quiniela real y un ensayo abiertos al
    // mismo tiempo, en pantalla las dos se ven iguales.
    var corto = new Intl.DateTimeFormat('es-MX', {
      timeZone: 'America/Mexico_City', day: 'numeric', month: 'short'
    }).format(new Date(d.ahora));
    document.title = 'ENSAYO ' + corto + ' · Administración';
  }


  // Lo primero de todo, antes de cualquier sesion: saber si esto es un ensayo.
  // Es justo en la pantalla de acceso donde uno se confunde de servidor.
  fetch('/api/ambiente')
    .then(function (r) { return r.json(); })
    .then(pintarCintaEnsayo)
    .catch(function () {});

  // ================================================================ ACCESO ==

  $('form-entrar').addEventListener('submit', function (ev) {
    ev.preventDefault();
    $('error-acceso').hidden = true;
    api('/api/admin/entrar', { contrasena: $('clave').value })
      .then(function (r) {
        token = r.token;
        localStorage.setItem(LLAVE, token);
        arrancar();
      })
      .catch(function (e) {
        $('error-acceso').textContent = e.message;
        $('error-acceso').hidden = false;
      });
  });

  $('salir').addEventListener('click', function () {
    localStorage.removeItem(LLAVE);
    location.reload();
  });

  document.querySelectorAll('[data-vista]').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('[data-vista]').forEach(function (o) {
        if (o === b) o.setAttribute('aria-current', 'page');
        else o.removeAttribute('aria-current');
      });
      ['pagos', 'puntos', 'picks'].forEach(function (v) {
        $('vista-' + v).hidden = v !== b.dataset.vista;
      });
      if (b.dataset.vista === 'puntos') cargarPuntos(semanaPuntos);
      if (b.dataset.vista === 'picks') cargarPicks(semanaPicks);
    });
  });

  function arrancar() {
    api('/api/admin/jugadores').then(function (d) {
      datos = d;
      $('acceso').hidden = true;
      $('barra').hidden = false;
      $('app').hidden = false;

      $('cuota-texto').textContent = pesos(d.config.cuotaSemanal);
      $('corte-texto').textContent = d.config.semanasDePago + 1;
      $('total-texto').textContent = pesos(d.config.totalTemporada);

      pintarCintaEnsayo(d);
      $('ico-pagos').innerHTML = ico('foco');
      $('ico-puntos').innerHTML = ico('diana');
      $('premio-texto').textContent = d.config.puntosPrimero;
      $('arranque-texto').textContent = d.config.puntosArranque;
      pintarTablero();
      pintarJugadores();
      pintarSelectorSemanas('semanas-puntos', function (n) { cargarPuntos(n); }, function () { return semanaPuntos; });
      pintarSelectorSemanas('semanas-picks', function (n) { cargarPicks(n); }, function () { return semanaPicks; });
    }).catch(function (e) {
      if (e.estado === 401) { localStorage.removeItem(LLAVE); token = ''; }
      else brindis(e.message, 'mal');
    });
  }

  // ======================================================= QUIEN YA PAGO ===

  /**
   * El tablero: cada jugador es un renglon y cada semana de cobro una casilla.
   * Picar una casilla registra el deposito y le abre los partidos de esa semana
   * al momento. Es la pantalla que se usa cuando llega el dinero.
   */
  function pintarTablero() {
    var c = datos.config;
    var semanas = [];
    for (var n = 1; n <= c.semanasDePago; n++) semanas.push(n);

    var alCorriente = datos.jugadores.filter(function (j) { return j.alCorriente; }).length;
    $('resumen-tablero').textContent = datos.jugadores.length
      ? alCorriente + ' de ' + datos.jugadores.length + ' con la temporada completa'
      : '';

    if (!datos.jugadores.length) {
      $('tablero').className = 'cargando';
      $('tablero').textContent = 'Todavía no hay jugadores registrados.';
      return;
    }

    $('tablero').className = '';
    $('tablero').innerHTML =
      '<div style="overflow-x:auto"><table class="tablero"><thead><tr>' +
        '<th class="jugador">Jugador</th>' +
        semanas.map(function (n) { return '<th>' + n + '</th>'; }).join('') +
        '<th class="resumen">Lleva</th>' +
      '</tr></thead><tbody>' +
      datos.jugadores.map(function (j) {
        return '<tr>' +
          '<td class="jugador"><b>' + j.nombre + '</b><span>' + j.telefono + '</span></td>' +
          semanas.map(function (n) {
            var pagada = j.semanasCubiertas >= n;
            // Solo se puede desmarcar la ultima pagada: si no, se abriria un
            // hueco a la mitad y el conteo dejaria de cuadrar.
            var ultima = pagada && j.semanasCubiertas === n;
            var titulo = pagada
              ? (ultima ? 'Pagada. Picar para deshacer.' : 'Pagada')
              : 'Sin pagar. Picar para registrar el depósito hasta la semana ' + n + '.';
            return '<td><button class="casilla' + (pagada ? ' pagada' : '') + '"' +
              ' data-jugador="' + j.id + '" data-semana="' + n + '"' +
              ' data-pagada="' + pagada + '" data-ultima="' + ultima + '"' +
              ' title="' + titulo + '" aria-label="Semana ' + n + ' de ' + j.nombre + '">' +
              (pagada ? ico('palomita') : n) + '</button></td>';
          }).join('') +
          '<td class="resumen">' +
            '<b style="font-family:var(--dato);font-size:17px">' + pesos(j.total) + '</b><br>' +
            (j.alCorriente
              ? '<span class="pastilla ok">Completa</span>'
              : '<span class="pastilla debe">Faltan ' + pesos(j.falta) + '</span>') +
          '</td>' +
        '</tr>';
      }).join('') +
      '</tbody></table></div>';

    $('tablero').querySelectorAll('.casilla').forEach(function (b) {
      b.addEventListener('click', function () { picarCasilla(b); });
    });
  }

  function picarCasilla(b) {
    var j = datos.jugadores.find(function (x) { return x.id === b.dataset.jugador; });
    var n = Number(b.dataset.semana);
    var pagada = b.dataset.pagada === 'true';
    var c = datos.config;

    if (pagada && b.dataset.ultima !== 'true') {
      brindis('Para quitar semanas, empieza por la última pagada (la ' + j.semanasCubiertas + ').', 'mal');
      return;
    }

    var falta = n * c.cuotaSemanal - j.total;
    var pregunta = pagada
      ? {
          titulo: 'Semana ' + n + ' sin pagar',
          texto: 'Se le descuentan <b>' + pesos(c.cuotaSemanal) + '</b> a ' + j.nombre +
                 ' y se le cierran los partidos de esa semana.',
          ok: 'Sí, quitarla', peligro: true
        }
      : {
          titulo: 'Registrar ' + pesos(falta),
          texto: 'Depósito de <b>' + j.nombre + '</b>.\n\n' +
                 (falta > c.cuotaSemanal
                   ? 'Con eso queda cubierto de la semana 1 a la ' + n + '.'
                   : 'Con eso queda cubierta la semana ' + n + '.'),
          ok: 'Sí, registrar', verde: true
        };

    Dialogo.preguntar(pregunta).then(function (si) {
      if (!si) return;
      api('/api/admin/marcar-semana', { usuarioId: j.id, semana: n, pagada: !pagada })
        .then(function (d) {
          datos = d;
          pintarTablero();
          pintarJugadores();
          brindis(pagada
            ? 'Semana ' + n + ' de ' + j.nombre + ' quedó sin pagar.'
            : j.nombre + ' ya puede poner sus partidos hasta la semana ' + n + '.', 'bien');
        })
        .catch(function (e) { brindis(e.message, 'mal'); });
    });
  }

  // ================================================================= PAGOS ==

  function pintarJugadores() {
    $('resumen-bote').textContent = datos.jugadores.length + ' jugadores · bote ' + pesos(datos.bote);

    if (!datos.jugadores.length) {
      $('lista-jugadores').innerHTML =
        '<div class="aviso ambar"><span class="icono">' + ico('gente') + '</span><div><b class="titulo">Todavía no hay nadie registrado</b>' +
        'Cuando alguien cree su cuenta desde la página principal, aparece aquí para registrarle su depósito.</div></div>';
      return;
    }

    $('lista-jugadores').className = '';
    $('lista-jugadores').innerHTML = datos.jugadores.map(function (j) {
      var temporal = j.claveTemporal
        ? ' <span class="pastilla debe" title="Todavía no se pone la suya">Contraseña temporal</span>'
        : '';
      var pastilla = j.alCorriente
        ? '<span class="pastilla ok">Al corriente</span>'
        : j.total > 0
          ? '<span class="pastilla debe">Faltan ' + pesos(j.falta) + '</span>'
          : '<span class="pastilla no">Sin depósitos</span>';

      var abiertas = j.abiertas.length
        ? 'Semanas abiertas: <b>' + resumirRango(j.abiertas) + '</b>'
        : '<span style="color:var(--rojo)">Sin semanas abiertas · no puede poner partidos</span>';

      var movimientos = j.pagos.length
        ? '<table class="tabla" style="margin-top:10px"><thead><tr><th>Fecha</th><th>Nota</th>' +
          '<th class="num">Monto</th><th></th></tr></thead><tbody>' +
          j.pagos.map(function (p) {
            return '<tr><td>' + p.fecha + '</td><td style="color:var(--suave)">' + (p.nota || '—') + '</td>' +
              '<td class="num">' + pesos(p.monto) + '</td>' +
              '<td style="text-align:right"><button class="boton peligro angosto" data-borrar="' + p.id +
              '" style="padding:5px 10px;font-size:11.5px">Quitar</button></td></tr>';
          }).join('') + '</tbody></table>'
        : '<p style="color:var(--tenue);font-size:13px;margin:10px 0 0">Sin movimientos.</p>';

      return '<div class="caja">' +
        '<div style="display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap">' +
          '<div style="min-width:220px">' +
            '<h3 style="font-size:17px">' + j.nombre + '</h3>' +
            '<div style="font-size:12.5px;color:var(--suave);margin-top:3px">' +
              j.correo + ' · ' + j.telefono + '</div>' + temporal +
          '</div>' +
          '<div style="min-width:150px">' +
            '<div class="etiqueta">Depositado</div>' +
            '<div style="font-size:22px;font-weight:800">' + pesos(j.total) + '</div>' +
            pastilla +
          '</div>' +
          '<div style="min-width:200px;font-size:13px;color:var(--suave);padding-top:4px">' +
            abiertas +
            '<div style="margin-top:4px">' + j.picksConfirmados + ' partidos confirmados</div>' +
          '</div>' +
          '<div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap">' +
            '<button class="boton angosto" data-pago="' + j.id + '" data-monto="100">+ ' +
              pesos(datos.config.cuotaSemanal) + '</button>' +
            '<button class="boton gris angosto" data-pago="' + j.id + '" data-monto="">Otro monto</button>' +
            '<button class="boton gris angosto" data-clave="' + j.id + '">Contraseña nueva</button>' +
            '<button class="boton peligro angosto" data-eliminar="' + j.id + '">Eliminar</button>' +
          '</div>' +
        '</div>' + movimientos +
      '</div>';
    }).join('');

    $('lista-jugadores').querySelectorAll('[data-pago]').forEach(function (b) {
      b.addEventListener('click', function () { abrirDialogo(b.dataset.pago, b.dataset.monto); });
    });
    $('lista-jugadores').querySelectorAll('[data-clave]').forEach(function (b) {
      b.addEventListener('click', function () {
        var j = datos.jugadores.find(function (x) { return x.id === b.dataset.clave; });
        Dialogo.pedirTexto({
          titulo: 'Contraseña nueva para ' + j.nombre,
          texto: 'Es lo único que hay para el que perdió la suya: se la cambias aquí y ' +
                 'se la pasas.\n\nSe le cierran todas las sesiones que tenga abiertas.',
          etiqueta: 'Contraseña nueva (mínimo 8 caracteres)',
          marcador: 'quiniela2026',
          ok: 'Cambiarla'
        }).then(function (nueva) {
          if (nueva === null) return;
          api('/api/admin/clave-nueva', { usuarioId: j.id, contrasena: nueva })
            .then(function (d) {
              datos = d;
              pintarJugadores();
              brindis('Lista. Pásale a ' + j.nombre.split(' ')[0] + ' su contraseña nueva.', 'bien');
            })
            .catch(function (e) { brindis(e.message, 'mal'); });
        });
      });
    });

    $('lista-jugadores').querySelectorAll('[data-eliminar]').forEach(function (b) {
      b.addEventListener('click', function () {
        var j = datos.jugadores.find(function (x) { return x.id === b.dataset.eliminar; });
        // Escribir el nombre es a proposito: borrar a alguien se lleva sus
        // pagos y sus picks, y eso no se deshace.
        Dialogo.pedirTexto({
          titulo: 'Eliminar a ' + j.nombre,
          texto: 'Se van sus <b>' + pesos(j.total) + '</b> en depósitos y sus <b>' +
                 j.picksConfirmados + '</b> partidos confirmados.\n\nEsto no se puede deshacer.',
          etiqueta: 'Escribe su nombre completo para confirmar',
          marcador: j.nombre,
          ok: 'Eliminar', peligro: true
        }).then(function (escrito) {
          if (escrito === null) return;
          api('/api/admin/jugador-borrar', { usuarioId: j.id, confirmacion: escrito })
            .then(function (d) { datos = d; pintarTablero(); pintarJugadores(); brindis('Jugador eliminado.', 'bien'); })
            .catch(function (e) { brindis(e.message, 'mal'); });
        });
      });
    });

    $('lista-jugadores').querySelectorAll('[data-borrar]').forEach(function (b) {
      b.addEventListener('click', function () {
        Dialogo.preguntar({
          titulo: 'Quitar este movimiento',
          texto: 'Si con eso el jugador baja de semanas, los partidos que ya confirmó se quedan ' +
                 'como están, pero no podrá poner los de las semanas que se le cierren.',
          ok: 'Sí, quitarlo', peligro: true
        }).then(function (si) {
          if (!si) return;
          api('/api/admin/pago-borrar', { pagoId: b.dataset.borrar }).then(function (d) {
            datos = d; pintarTablero(); pintarJugadores(); brindis('Movimiento eliminado.', 'bien');
          }).catch(function (e) { brindis(e.message, 'mal'); });
        });
      });
    });
  }

  /** [1,2,3,4,7] -> "1 a la 4, 7" */
  function resumirRango(lista) {
    var trozos = [];
    var i = 0;
    while (i < lista.length) {
      var inicio = lista[i];
      while (i + 1 < lista.length && lista[i + 1] === lista[i] + 1) i++;
      trozos.push(inicio === lista[i] ? String(inicio) : inicio + ' a la ' + lista[i]);
      i++;
    }
    return trozos.join(', ');
  }

  // -------------------------------------------------------------- dialogo ---

  function abrirDialogo(usuarioId, monto) {
    jugadorEnDialogo = datos.jugadores.find(function (j) { return j.id === usuarioId; });
    $('pago-titulo').textContent = 'Depósito de ' + jugadorEnDialogo.nombre;
    $('pago-estado').textContent = 'Lleva ' + pesos(jugadorEnDialogo.total) + ' de ' +
      pesos(datos.config.totalTemporada) + '.';
    $('p-monto').value = monto || datos.config.cuotaSemanal;
    $('p-fecha').value = new Date().toISOString().slice(0, 10);
    $('p-nota').value = '';
    $('error-pago').hidden = true;
    $('capa-pago').hidden = false;
    calcularEquivalencia();
    $('p-monto').focus();
  }

  function calcularEquivalencia() {
    if (!jugadorEnDialogo) return;
    var monto = Number($('p-monto').value) || 0;
    var total = jugadorEnDialogo.total + monto;
    var c = datos.config;
    var semanas = Math.min(Math.floor(total / c.cuotaSemanal), c.semanasDePago);
    $('p-equivale').innerHTML = 'Quedaría en <b>' + pesos(total) + '</b> · ' +
      (total >= c.totalTemporada
        ? 'temporada completa, incluidas las semanas ' + (c.semanasDePago + 1) + ' en adelante'
        : 'semanas 1 a la ' + semanas + ' abiertas');
  }

  $('p-monto').addEventListener('input', calcularEquivalencia);
  $('cancelar-pago').addEventListener('click', function () { $('capa-pago').hidden = true; });
  $('capa-pago').addEventListener('click', function (ev) {
    if (ev.target === $('capa-pago')) $('capa-pago').hidden = true;
  });

  $('form-pago').addEventListener('submit', function (ev) {
    ev.preventDefault();
    api('/api/admin/pago', {
      usuarioId: jugadorEnDialogo.id,
      monto: Number($('p-monto').value),
      fecha: $('p-fecha').value,
      nota: $('p-nota').value
    }).then(function (d) {
      datos = d;
      $('capa-pago').hidden = true;
      pintarTablero();
      pintarJugadores();
      brindis('Depósito registrado. Ya se le abrieron las semanas.', 'bien');
    }).catch(function (e) {
      $('error-pago').textContent = e.message;
      $('error-pago').hidden = false;
    });
  });

  // ================================================================ PUNTOS ==

  function pintarSelectorSemanas(id, alElegir, cual) {
    var caja = $(id);
    var html = '';
    for (var n = 1; n <= 18; n++) {
      html += '<button data-n="' + n + '" aria-pressed="' + (n === cual()) + '"><b>' + n + '</b><i>sem</i></button>';
    }
    caja.innerHTML = html;
    caja.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () { alElegir(Number(b.dataset.n)); });
    });
  }

  function marcarSemana(id, n) {
    $(id).querySelectorAll('button').forEach(function (b) {
      b.setAttribute('aria-pressed', String(Number(b.dataset.n) === n));
    });
  }

  function cargarPuntos(n) {
    // Cambiar de semana con puntos sin guardar los tira: mejor preguntar.
    if (Object.keys(cambios).length && n !== semanaPuntos) {
      var pendientes = Object.keys(cambios).length;
      Dialogo.preguntar({
        titulo: 'Puntos sin guardar',
        texto: 'Tienes <b>' + pendientes + '</b> ' + (pendientes === 1 ? 'partido' : 'partidos') +
               ' capturados en la semana ' + semanaPuntos + ' que no has guardado.',
        ok: 'Descartar y cambiar', peligro: true
      }).then(function (si) {
        if (!si) return;
        cambios = {};
        cargarPuntos(n);
      });
      return;
    }

    semanaPuntos = n;
    cambios = {};
    marcarSemana('semanas-puntos', n);
    $('filas-puntos').innerHTML = '<div class="cargando">Cargando…</div>';

    api('/api/admin/semana?n=' + n).then(function (d) {
      puntosSemana = d;
      $('titulo-puntos').textContent = 'Semana ' + n;
      $('estado-semana-puntos').textContent = d.cerrada
        ? 'Cerrada'
        : 'Cierra ' + cuando(d.cierre);
      pintarFilasPuntos();
    }).catch(function (e) { brindis(e.message, 'mal'); });
  }

  function pintarFilasPuntos() {
    $('filas-puntos').innerHTML =
      '<div class="fila-puntos" style="border-bottom:1px solid var(--linea2)">' +
        '<span class="etiqueta">Día y hora</span>' +
        '<span class="etiqueta">Partido</span>' +
        '<span class="etiqueta" style="text-align:center">Puntos</span>' +
        '<span class="etiqueta" style="text-align:center">Empate</span>' +
        '<span class="etiqueta" style="text-align:center">Estado</span>' +
      '</div>' +
      puntosSemana.partidos.map(function (p, i) {
        var valor = cambios[p.id] !== undefined ? cambios[p.id] : p.puntos;
        var sello = p.estado === 'iniciado'
          ? '<span class="pastilla no">Ya jugó</span>'
          : p.estado === 'cerrado'
            ? '<span class="pastilla debe">Cerrado</span>'
            : '<span class="pastilla ok">Abierto</span>';

        // El primero de la jornada es el que paga el premio gordo.
        var lugar = i === 0
          ? '<span class="pastilla info" style="margin-right:6px">' + ico('estrella') + ' 1º</span>'
          : '<span class="lugar-partido">' + (i + 1) + '</span>';

        var hora = p.horaConfirmada
          ? cuando(p.inicio)
          : '<span style="color:var(--ambar)">Horario por definir</span>';

        return '<div class="fila-puntos">' +
          '<span class="hora">' + hora + '</span>' +
          '<span class="enfrentamiento">' + lugar + ' ' +
            p.visitante.corto + ' <span style="color:var(--tenue)">@</span> ' + p.local.corto +
            (p.confirmaciones ? ' <span class="etiqueta">· ' + p.confirmaciones + ' picks</span>' : '') +
          '</span>' +
          '<input type="number" min="1" max="1000" step="1" value="' + valor + '" data-punto="' + p.id + '"' +
            (cambios[p.id] !== undefined || p.personalizado ? ' class="tocado"' : '') +
            ' title="Automático: ' + p.automatico + ' puntos">' +
          '<span class="empate-calc" data-empate="' + p.id + '">' +
            (valor * datos.config.multiplicadorEmpate) + '</span>' +
          '<span style="text-align:center">' + sello + '</span>' +
        '</div>';
      }).join('') +
      '<p style="color:var(--tenue);font-size:13px;margin-top:12px">' +
        'Automático: el 1º paga ' + datos.config.puntosPrimero + ', y del 2º en adelante ' +
        datos.config.puntosArranque + ', ' + (datos.config.puntosArranque + 1) + ', ' +
        (datos.config.puntosArranque + 2) + '… hasta el último. ' +
        'Los que veas en ámbar están ajustados a mano.</p>';

    $('filas-puntos').querySelectorAll('[data-punto]').forEach(function (input) {
      input.addEventListener('input', function () {
        var id = input.dataset.punto;
        var v = Number(input.value);
        cambios[id] = v;
        input.classList.add('tocado');
        var empate = $('filas-puntos').querySelector('[data-empate="' + id + '"]');
        if (empate) empate.textContent = v > 0 ? v * datos.config.multiplicadorEmpate : '—';
        $('guardar-puntos').disabled = false;
      });
    });
  }

  // Volver al automatico: se manda null para borrar el ajuste a mano y que el
  // servidor recalcule por posicion.
  $('reiniciar-puntos').addEventListener('click', function () {
    puntosSemana.partidos.forEach(function (p) { cambios[p.id] = null; });
    $('guardar-puntos').disabled = false;
    api('/api/admin/puntos', { semana: semanaPuntos, puntos: cambios }).then(function (d) {
      puntosSemana = d;
      cambios = {};
      $('guardar-puntos').disabled = true;
      pintarFilasPuntos();
      brindis('Semana ' + semanaPuntos + ' de vuelta al puntaje automático.', 'bien');
    }).catch(function (e) { brindis(e.message, 'mal'); });
  });

  $('guardar-puntos').addEventListener('click', function () {
    if (!Object.keys(cambios).length) return;
    api('/api/admin/puntos', { semana: semanaPuntos, puntos: cambios }).then(function (d) {
      puntosSemana = d;
      cambios = {};
      $('guardar-puntos').disabled = true;
      pintarFilasPuntos();
      brindis('Puntos guardados. Los jugadores ya los ven.', 'bien');
    }).catch(function (e) { brindis(e.message, 'mal'); });
  });

  // ================================================================= PICKS ==

  function cargarPicks(n) {
    semanaPicks = n;
    marcarSemana('semanas-picks', n);
    $('rejilla-picks').innerHTML = '<div class="cargando">Cargando…</div>';

    api('/api/admin/picks?n=' + n).then(function (d) {
      if (!d.jugadores.length) {
        $('rejilla-picks').innerHTML = '<div class="cargando">Todavía no hay jugadores.</div>';
        return;
      }

      var color = { local: 'var(--lima)', visitante: 'var(--verde)', empate: 'var(--ambar)' };

      // Que equipo eligio, por sus siglas. "Local" y "visitante" no le dicen
      // nada a nadie de un vistazo; "SEA" si.
      function siglas(p, eleccion) {
        if (eleccion === 'empate') return 'EMP';
        return p[eleccion];
      }

      $('rejilla-picks').innerHTML =
        '<table class="tabla"><thead><tr><th>Jugador</th>' +
        d.partidos.map(function (p) {
          return '<th style="text-align:center;font-size:9px">' +
                 p.etiqueta.replace(' @ ', '<br>@ ') + '</th>';
        }).join('') + '</tr></thead><tbody>' +
        d.jugadores.map(function (j) {
          return '<tr><td style="white-space:nowrap">' + j.nombre + '</td>' +
            d.partidos.map(function (p) {
              var pk = j.picks[p.id];
              if (!pk) return '<td style="text-align:center;color:var(--tenue)">·</td>';
              return '<td style="text-align:center;font-family:var(--dato);font-weight:700;font-size:12px;letter-spacing:.04em;color:' +
                color[pk.eleccion] + ';opacity:' + (pk.confirmado ? 1 : 0.4) + '"' +
                ' title="' + siglas(p, pk.eleccion) + ' (' + pk.eleccion + ')' +
                (pk.confirmado ? ' · confirmado' : ' · SIN CONFIRMAR') + '">' +
                siglas(p, pk.eleccion) + '</td>';
            }).join('') + '</tr>';
        }).join('') + '</tbody></table>' +
        '<p style="color:var(--tenue);font-size:12.5px;margin-top:14px">' +
          'Cada celda dice a qué equipo le entró: ' +
          '<b style="color:var(--verde)">siglas en verde</b> si es el visitante, ' +
          '<b style="color:var(--lima)">en lima</b> si es el de casa, ' +
          '<b style="color:var(--ambar)">EMP</b> si le fue al empate. ' +
          'Los que se ven tenues están elegidos pero <b>sin confirmar</b>: esos no cuentan puntos.</p>';
    }).catch(function (e) { brindis(e.message, 'mal'); });
  }

  $('actualizar-resultados').addEventListener('click', function () {
    var boton = $('actualizar-resultados');
    boton.disabled = true;
    boton.textContent = 'Consultando ESPN…';
    api('/api/admin/resultados', {}).then(function (r) {
      brindis(r.nuevos + ' partidos nuevos con marcador final. Total: ' + r.total + '.', 'bien');
    }).catch(function (e) {
      brindis(e.message, 'mal');
    }).finally(function () {
      boton.disabled = false;
      boton.textContent = 'Actualizar resultados desde ESPN';
    });
  });

  // ============================================================== ENCENDER ==

  if (token) arrancar();

})();
