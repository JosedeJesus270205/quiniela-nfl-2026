/**
 * El panel del administrador: quien pago, cuanto vale cada partido y como van
 * los resultados. Es la unica parte que puede desbloquear semanas.
 */

'use strict';

var crypto = require('crypto');
var almacen = require('./almacen');
var reglas = require('./reglas');
var configuracion = require('./configuracion');
var api = require('./api');
var reloj = require('./reloj');

function entrar(ctx) {
  var config = configuracion.cargar();
  var intento = Buffer.from(String(ctx.cuerpo.contrasena || ''), 'utf8');
  var buena = Buffer.from(config.adminContrasena, 'utf8');
  var ok = intento.length === buena.length && crypto.timingSafeEqual(intento, buena);
  if (!ok) throw api.error(401, 'Contrasena incorrecta.');
  return { token: almacen.abrirSesion(':admin') };
}

/**
 * Los jugadores con su estado de cuenta: cuanto lleva, cuantas semanas trae
 * cubiertas y hasta donde puede jugar. Esta es la pantalla desde la que se
 * liberan los partidos.
 */
function jugadores(ctx) {
  api.exigirAdmin(ctx);
  var config = configuracion.cargar();
  var calendario = almacen.calendario();
  var todas = reglas.semanas(calendario);
  var db = almacen.cargar();
  var ahora = reloj.ahora();

  var lista = db.usuarios.map(function (u) {
    var pagos = almacen.pagosDe(u.id).sort(function (a, b) { return b.fecha.localeCompare(a.fecha); });
    var picks = almacen.picksDe(u.id);
    var total = reglas.totalPagado(pagos);

    var confirmados = 0;
    Object.keys(picks).forEach(function (id) { if (picks[id].confirmado) confirmados++; });

    return {
      id: u.id,
      nombre: u.nombre,
      correo: u.correo,
      telefono: u.telefono,
      creado: u.creado,
      total: total,
      semanasCubiertas: reglas.semanasCubiertas(pagos, config),
      falta: Math.max(0, config.totalTemporada - total),
      alCorriente: total >= config.totalTemporada,
      picksConfirmados: confirmados,
      claveTemporal: !!u.claveTemporal,
      pagos: pagos,
      abiertas: todas.filter(function (n) { return reglas.semanaPagada(n, pagos, config); })
    };
  });

  lista.sort(function (a, b) { return a.nombre.localeCompare(b.nombre); });

  return {
    ahora: ahora.toISOString(),
    ensayo: reloj.esEnsayo(),
    config: configuracion.publica(),
    jugadores: lista,
    // Cuanto dinero lleva junto el bote, por si sirve para el premio.
    bote: lista.reduce(function (s, j) { return s + j.total; }, 0)
  };
}

function registrarPago(ctx) {
  api.exigirAdmin(ctx);
  var monto = Number(ctx.cuerpo.monto);
  if (!Number.isFinite(monto) || monto === 0) throw api.error(400, 'El monto no es valido.');
  if (!almacen.buscarPorId(ctx.cuerpo.usuarioId)) throw api.error(404, 'Ese jugador no existe.');

  var fecha = String(ctx.cuerpo.fecha || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) fecha = reloj.sello().slice(0, 10);

  almacen.registrarPago(ctx.cuerpo.usuarioId, monto, ctx.cuerpo.nota, fecha);
  return jugadores(ctx);
}

function borrarPago(ctx) {
  api.exigirAdmin(ctx);
  if (!almacen.borrarPago(ctx.cuerpo.pagoId)) throw api.error(404, 'Ese movimiento ya no existe.');
  return jugadores(ctx);
}

/**
 * El tablero de "quien ya pago": marcar o desmarcar la casilla de una semana.
 *
 * Marcar la semana N deja al jugador cubierto hasta ahi, cobrando de un golpe
 * lo que le falte. Es lo mismo que ir marcando una por una, porque cada $100
 * vale por una semana sin importar el orden.
 *
 * Desmarcar recorta lo depositado hasta dejarlo en la semana anterior.
 */
function marcarSemana(ctx) {
  api.exigirAdmin(ctx);
  var config = configuracion.cargar();
  var usuario = almacen.buscarPorId(ctx.cuerpo.usuarioId);
  if (!usuario) throw api.error(404, 'Ese jugador no existe.');

  var n = Number(ctx.cuerpo.semana);
  if (!Number.isInteger(n) || n < 1 || n > config.semanasDePago) {
    throw api.error(400, 'Solo se cobran las semanas 1 a la ' + config.semanasDePago + '.');
  }

  var pagos = almacen.pagosDe(usuario.id);
  var total = reglas.totalPagado(pagos);

  if (ctx.cuerpo.pagada === false) {
    var objetivo = (n - 1) * config.cuotaSemanal;
    if (total <= objetivo) throw api.error(400, 'Esa semana ya estaba sin pagar.');
    almacen.recortarPagos(usuario.id, objetivo);
  } else {
    var falta = n * config.cuotaSemanal - total;
    if (falta <= 0) throw api.error(400, 'Esa semana ya estaba pagada.');
    var nota = falta === config.cuotaSemanal
      ? 'Semana ' + n
      : 'Semanas hasta la ' + n;
    almacen.registrarPago(usuario.id, falta, nota, ctx.cuerpo.fecha);
  }

  return jugadores(ctx);
}

/**
 * Contrasena nueva para el jugador que perdio la suya. No hay correo de
 * recuperacion: el administrador se la cambia y se la pasa por WhatsApp.
 * Al hacerlo se le cierran todas las sesiones que tuviera abiertas.
 */
function cambiarClave(ctx) {
  api.exigirAdmin(ctx);
  var usuario = almacen.buscarPorId(ctx.cuerpo.usuarioId);
  if (!usuario) throw api.error(404, 'Ese jugador no existe.');

  var nueva = String(ctx.cuerpo.contrasena || '');
  if (nueva.length < 8) throw api.error(400, 'La contrasena necesita al menos 8 caracteres.');

  // Temporal: el jugador tiene que ponerse la suya al entrar.
  almacen.cambiarContrasena(usuario.id, nueva, true);
  return jugadores(ctx);
}

/**
 * Elimina a un jugador con todo lo suyo. Se pide el nombre exacto como
 * confirmacion para que no se borre a alguien de un clic distraido.
 */
function borrarJugador(ctx) {
  api.exigirAdmin(ctx);
  var usuario = almacen.buscarPorId(ctx.cuerpo.usuarioId);
  if (!usuario) throw api.error(404, 'Ese jugador ya no existe.');

  var escrito = String(ctx.cuerpo.confirmacion || '').trim().toLowerCase();
  if (escrito !== usuario.nombre.trim().toLowerCase()) {
    throw api.error(400, 'Para borrar a ' + usuario.nombre + ' hay que escribir su nombre completo igual.');
  }

  almacen.borrarUsuario(usuario.id);
  return jugadores(ctx);
}

/**
 * Los partidos de una semana con lo que vale cada uno, para capturarlo a mano.
 * Trae la hora local para reconocer de un vistazo cuales son los nocturnos.
 */
function semana(ctx) {
  api.exigirAdmin(ctx);
  var n = Number(ctx.consulta.n);
  var config = configuracion.cargar();
  var calendario = almacen.calendario();
  var puntos = reglas.tablaDePuntos(calendario, almacen.puntos(), config);
  var res = almacen.resultados();
  var db = almacen.cargar();
  var ahora = reloj.ahora();

  var juegos = reglas.partidosDeSemana(calendario, n);
  if (!juegos.length) throw api.error(404, 'No hay partidos en la semana ' + n + '.');

  var cierre = reglas.cierreDeSemana(calendario, n, config);

  return {
    semana: n,
    ahora: ahora.toISOString(),
    cierre: cierre ? cierre.toISOString() : null,
    cerrada: cierre ? ahora.getTime() >= cierre.getTime() : true,
    config: configuracion.publica(),
    partidos: juegos.map(function (p) {
      var fila = puntos[p.id] || {};
      var valor = fila.valor;
      var r = res.partidos[p.id] || null;
      var conteo = 0;
      db.usuarios.forEach(function (u) {
        var pk = almacen.picksDe(u.id)[p.id];
        if (pk && pk.confirmado) conteo++;
      });
      return {
        id: p.id,
        inicio: p.inicio,
        horaConfirmada: p.horaConfirmada !== false,
        neutral: !!p.neutral,
        local: p.local,
        visitante: p.visitante,
        sede: p.sede,
        ciudad: p.ciudad,
        puntos: valor,
        puntosEmpate: valor * config.multiplicadorEmpate,
        posicion: fila.posicion,
        automatico: fila.automatico,
        personalizado: !!fila.personalizado,
        estado: reglas.estadoDePartido(calendario, p, ahora, config),
        confirmaciones: conteo,
        resultado: r && r.final ? {
          local: r.marcadorLocal, visitante: r.marcadorVisitante,
          ganador: reglas.ganadorDeResultado(r)
        } : null
      };
    })
  };
}

/**
 * Fija los puntos de uno o varios partidos. Se puede cambiar el valor de un
 * partido aunque ya haya empezado: eso no mueve elecciones, solo cuanto pagan,
 * y sirve para corregir una captura equivocada.
 */
function fijarPuntos(ctx) {
  api.exigirAdmin(ctx);
  var mapa = ctx.cuerpo.puntos;
  if (!mapa || typeof mapa !== 'object') throw api.error(400, 'No mandaste puntos.');

  var calendario = almacen.calendario();
  var validos = {};
  Object.keys(mapa).forEach(function (id) {
    var existe = calendario.partidos.some(function (p) { return p.id === id; });
    if (!existe) return;
    var v = Number(mapa[id]);
    if (mapa[id] === null || mapa[id] === '' || !Number.isFinite(v) || v <= 0) {
      validos[id] = null;              // volver al valor por omision
    } else if (v > 1000) {
      throw api.error(400, 'Mil puntos por partido ya es demasiado.');
    } else {
      validos[id] = v;
    }
  });

  almacen.fijarPuntos(validos);
  return semana({ token: ctx.token, consulta: { n: ctx.cuerpo.semana } });
}

/** Quien eligio que, semana por semana. Util para revisar y para presumir. */
function picksDeSemana(ctx) {
  api.exigirAdmin(ctx);
  var n = Number(ctx.consulta.n);
  var calendario = almacen.calendario();
  var juegos = reglas.partidosDeSemana(calendario, n);
  var db = almacen.cargar();

  return {
    semana: n,
    partidos: juegos.map(function (p) {
      return { id: p.id, etiqueta: p.visitante.abbr + ' @ ' + p.local.abbr, inicio: p.inicio };
    }),
    jugadores: db.usuarios.map(function (u) {
      var picks = almacen.picksDe(u.id);
      var mios = {};
      juegos.forEach(function (p) {
        if (picks[p.id]) mios[p.id] = { eleccion: picks[p.id].eleccion, confirmado: !!picks[p.id].confirmado };
      });
      return { id: u.id, nombre: u.nombre, picks: mios };
    }).sort(function (a, b) { return a.nombre.localeCompare(b.nombre); })
  };
}

/**
 * Trae los marcadores finales desde ESPN y los guarda. Solo cuenta un partido
 * cuando ESPN lo marca como terminado; un marcador en vivo no se guarda como
 * final para que la tabla no se mueva a media tarde.
 */
async function actualizarResultados(ctx) {
  api.exigirAdmin(ctx);
  var calendario = almacen.calendario();
  var res = almacen.resultados();
  var semanas = reglas.semanas(calendario);
  var nuevos = 0;

  for (var i = 0; i < semanas.length; i++) {
    var n = semanas[i];
    // Ni caso a semanas que todavia no empiezan.
    var primero = reglas.partidosDeSemana(calendario, n)[0];
    if (Date.parse(primero.inicio) > reloj.milis()) break;

    var url = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard' +
              '?dates=' + calendario.temporada + '&seasontype=2&week=' + n;
    var r = await fetch(url);
    if (!r.ok) continue;
    var datos = await r.json();

    (datos.events || []).forEach(function (ev) {
      var comp = ev.competitions[0];
      var estado = comp.status && comp.status.type;
      if (!estado || !estado.completed) return;
      var casa = comp.competitors.find(function (c) { return c.homeAway === 'home'; });
      var fuera = comp.competitors.find(function (c) { return c.homeAway === 'away'; });
      var id = String(ev.id);
      if (!res.partidos[id]) nuevos++;
      res.partidos[id] = {
        final: true,
        marcadorLocal: Number(casa.score),
        marcadorVisitante: Number(fuera.score),
        detalle: estado.shortDetail || 'Final'
      };
    });
  }

  res.actualizado = reloj.sello();
  almacen.guardarResultados(res);
  return { actualizado: res.actualizado, nuevos: nuevos, total: Object.keys(res.partidos).length };
}

module.exports = {
  entrar: entrar,
  jugadores: jugadores,
  registrarPago: registrarPago,
  borrarPago: borrarPago,
  cambiarClave: cambiarClave,
  borrarJugador: borrarJugador,
  marcarSemana: marcarSemana,
  semana: semana,
  fijarPuntos: fijarPuntos,
  picksDeSemana: picksDeSemana,
  actualizarResultados: actualizarResultados
};
