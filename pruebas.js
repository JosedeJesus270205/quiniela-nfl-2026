/**
 * Pruebas de las reglas. Corre con:  node --test pruebas.js
 *
 * No tocan la base de datos ni la red: le dan de comer un calendario inventado
 * a las funciones de lib/reglas.js y verifican que los candados cierren.
 */

'use strict';

var test = require('node:test');
var assert = require('node:assert');
var reglas = require('./lib/reglas');

var C = reglas.CONFIG;
var MIN = 60 * 1000;

// Una semana de mentiras: jueves 20:20, domingo 12:00 y lunes 20:15.
var JUEVES = Date.parse('2026-09-10T00:20:00Z');
var DOMINGO = Date.parse('2026-09-13T17:00:00Z');
var LUNES = Date.parse('2026-09-15T00:15:00Z');

function partido(id, inicio, semana) {
  return {
    id: id, semana: semana || 1, inicio: new Date(inicio).toISOString(),
    local: { abbr: 'SEA' }, visitante: { abbr: 'NE' }, sede: '', ciudad: ''
  };
}

var CAL = {
  temporada: 2026,
  partidos: [
    partido('tnf', JUEVES),
    partido('dom', DOMINGO),
    partido('mnf', LUNES),
    partido('s2', Date.parse('2026-09-17T00:15:00Z'), 2)
  ]
};

var pagos = function (total) { return total ? [{ monto: total }] : []; };

// ---------------------------------------------------------------------------

test('cada partido cierra 30 minutos antes del suyo, no del primero', function () {
  assert.strictEqual(reglas.cierreDePartido(CAL.partidos[0]).getTime(), JUEVES - 30 * MIN);
  assert.strictEqual(reglas.cierreDePartido(CAL.partidos[1]).getTime(), DOMINGO - 30 * MIN);
  assert.strictEqual(reglas.cierreDePartido(CAL.partidos[2]).getTime(), LUNES - 30 * MIN);
});

test('antes de todo, todo esta abierto', function () {
  var ahora = new Date(JUEVES - 60 * MIN);
  CAL.partidos.filter(function (p) { return p.semana === 1; }).forEach(function (p) {
    assert.strictEqual(reglas.estadoDePartido(CAL, p, ahora), 'abierto');
  });
});

test('cuando cierra el jueves, el domingo y el lunes SIGUEN abiertos', function () {
  // Este es el cambio: antes cerraba la jornada completa de un golpe.
  var ahora = new Date(JUEVES - 30 * MIN);
  assert.strictEqual(reglas.estadoDePartido(CAL, CAL.partidos[0], ahora), 'cerrado');
  assert.strictEqual(reglas.estadoDePartido(CAL, CAL.partidos[1], ahora), 'abierto');
  assert.strictEqual(reglas.estadoDePartido(CAL, CAL.partidos[2], ahora), 'abierto');
});

test('con el jueves ya jugado, el domingo y el lunes se pueden elegir', function () {
  // Alguien que deposito el domingo temprano todavia alcanza lo que falta.
  var domingoTemprano = new Date(DOMINGO - 3 * 60 * MIN);
  assert.strictEqual(reglas.estadoDePartido(CAL, CAL.partidos[0], domingoTemprano), 'iniciado');

  var permiso = reglas.puedeElegir({
    calendario: CAL, partido: CAL.partidos[2], ahora: domingoTemprano,
    pagos: pagos(1500), pick: null
  });
  assert.strictEqual(permiso.puede, true, 'el lunes sigue disponible');
});

test('el proximo cierre es el del siguiente partido por jugarse', function () {
  var antes = new Date(JUEVES - 2 * 60 * MIN);
  var siguiente = reglas.proximoCierre(CAL, 1, antes);
  assert.strictEqual(siguiente.partido.id, 'tnf');

  // Ya cerrado el jueves, el proximo es el del domingo.
  var despues = new Date(JUEVES + 60 * MIN);
  assert.strictEqual(reglas.proximoCierre(CAL, 1, despues).partido.id, 'dom');
});

test('la jornada solo esta cerrada cuando cerro su ULTIMO partido', function () {
  assert.strictEqual(reglas.semanaCerrada(CAL, 1, new Date(JUEVES - 30 * MIN)), false);
  assert.strictEqual(reglas.semanaCerrada(CAL, 1, new Date(DOMINGO)), false);
  assert.strictEqual(reglas.semanaCerrada(CAL, 1, new Date(LUNES - 31 * MIN)), false);
  assert.strictEqual(reglas.semanaCerrada(CAL, 1, new Date(LUNES - 30 * MIN)), true);
});

test('la semana siguiente no se entera de lo que pasa en esta', function () {
  var ahora = new Date(JUEVES - 30 * MIN);
  assert.strictEqual(reglas.estadoDePartido(CAL, CAL.partidos[3], ahora), 'abierto');
});

test('REGLA DE ORO: un partido que ya empezo nunca esta abierto', function () {
  var sinMargen = Object.assign({}, C, { minutosCierre: 0 });
  [JUEVES, JUEVES + 1, DOMINGO, LUNES + 3 * 60 * MIN].forEach(function (t) {
    var p = partido('x', t, 9);
    var cal = { partidos: [p] };
    assert.strictEqual(reglas.estadoDePartido(cal, p, new Date(t), sinMargen), 'iniciado');
    assert.strictEqual(reglas.estadoDePartido(cal, p, new Date(t + 1), sinMargen), 'iniciado');
    assert.strictEqual(reglas.yaInicio(p, new Date(t)), true);
  });
});

test('REGLA DE ORO: ni con la temporada pagada se toca un partido iniciado', function () {
  var r = reglas.puedeElegir({
    calendario: CAL, partido: CAL.partidos[1], ahora: new Date(DOMINGO + 1),
    pagos: pagos(1500), pick: null
  });
  assert.strictEqual(r.puede, false);
  assert.strictEqual(r.motivo, 'iniciado');
});

test('en los 30 minutos previos ya no se puede, aunque no haya empezado', function () {
  var r = reglas.puedeElegir({
    calendario: CAL, partido: CAL.partidos[1], ahora: new Date(DOMINGO - 29 * MIN),
    pagos: pagos(1500), pick: null
  });
  assert.strictEqual(r.puede, false);
  assert.strictEqual(r.motivo, 'cerrado');
});

// ---------------------------------------------------------------------------

test('cada 100 pesos abre una semana, en el orden que sea', function () {
  assert.strictEqual(reglas.semanasCubiertas(pagos(700)), 7);
  assert.strictEqual(reglas.semanaPagada(7, pagos(700)), true);
  assert.strictEqual(reglas.semanaPagada(8, pagos(700)), false);
  // Depositos sueltos que suman lo mismo valen igual.
  assert.strictEqual(reglas.semanasCubiertas([{ monto: 300 }, { monto: 100 }, { monto: 300 }]), 7);
});

test('un deposito incompleto no abre la semana', function () {
  assert.strictEqual(reglas.semanaPagada(1, pagos(50)), false);
  assert.strictEqual(reglas.faltaParaSemana(1, pagos(50)), 50);
  assert.strictEqual(reglas.faltaParaSemana(8, pagos(700)), 100);
});

test('de la semana 16 en adelante solo juega quien completo los 1500', function () {
  [16, 17, 18].forEach(function (n) {
    assert.strictEqual(reglas.semanaPagada(n, pagos(1400)), false, 'con 1400 no entra a la ' + n);
    assert.strictEqual(reglas.semanaPagada(n, pagos(1500)), true, 'con 1500 si entra a la ' + n);
  });
  assert.strictEqual(reglas.faltaParaSemana(17, pagos(1400)), 100);
  assert.strictEqual(reglas.faltaParaSemana(17, pagos(1500)), 0);
});

test('pagar de mas no rompe nada', function () {
  assert.strictEqual(reglas.semanaPagada(18, pagos(2000)), true);
  assert.strictEqual(reglas.faltaParaSemana(18, pagos(2000)), 0);
});

// ---------------------------------------------------------------------------

test('el puntaje va por el lugar del partido en su semana', function () {
  // Tal cual la tabla del Excel: 1 -> 25, y del 2 en adelante 10, 11, 12...
  var esperado = [25, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25];
  esperado.forEach(function (puntos, i) {
    assert.strictEqual(reglas.puntosPorPosicion(i), puntos, 'partido ' + (i + 1));
  });
});

test('la escalera se reinicia en cada semana', function () {
  var tabla = reglas.tablaDePuntos(CAL, {});
  var s1 = reglas.partidosDeSemana(CAL, 1).map(function (p) { return tabla[p.id].valor; });
  var s2 = reglas.partidosDeSemana(CAL, 2).map(function (p) { return tabla[p.id].valor; });
  assert.deepStrictEqual(s1, [25, 10, 11]);
  assert.deepStrictEqual(s2, [25]);
});

test('el administrador puede pisar el puntaje de un partido', function () {
  var tabla = reglas.tablaDePuntos(CAL, { dom: 40 });
  assert.strictEqual(tabla.dom.valor, 40);
  assert.strictEqual(tabla.dom.automatico, 10, 'el automatico se sigue sabiendo');
  assert.strictEqual(tabla.dom.personalizado, true);
  // Los demas no se mueven.
  assert.strictEqual(tabla.tnf.valor, 25);
  assert.strictEqual(tabla.tnf.personalizado, false);
});

test('un ajuste invalido no pisa el automatico', function () {
  [0, -5, null, '', 'hola'].forEach(function (malo) {
    var t = reglas.tablaDePuntos(CAL, { dom: malo });
    assert.strictEqual(t.dom.valor, 10, 'con ' + JSON.stringify(malo));
  });
});

test('la posicion se guarda para poder mostrarla', function () {
  var tabla = reglas.tablaDePuntos(CAL, {});
  assert.strictEqual(tabla.tnf.posicion, 1);
  assert.strictEqual(tabla.dom.posicion, 2);
  assert.strictEqual(tabla.mnf.posicion, 3);
});

test('el empate paga doble sobre el valor de ese partido', function () {
  assert.strictEqual(reglas.puntosSiAcierta('local', 25), 25);
  assert.strictEqual(reglas.puntosSiAcierta('empate', 25), 50);
  assert.strictEqual(reglas.puntosSiAcierta('empate', 10), 20);
  assert.strictEqual(reglas.puntosSiAcierta('empate', 24), 48);
});

test('el marcador se traduce a la misma palabra que elige el jugador', function () {
  var f = reglas.ganadorDeResultado;
  assert.strictEqual(f({ final: true, marcadorLocal: 24, marcadorVisitante: 17 }), 'local');
  assert.strictEqual(f({ final: true, marcadorLocal: 17, marcadorVisitante: 24 }), 'visitante');
  assert.strictEqual(f({ final: true, marcadorLocal: 20, marcadorVisitante: 20 }), 'empate');
  assert.strictEqual(f({ final: false, marcadorLocal: 20, marcadorVisitante: 3 }), null);
});

test('un pick sin confirmar no paga aunque le atine', function () {
  var tabla = reglas.tablaDePuntos(CAL, {});
  var res = { final: true, marcadorLocal: 24, marcadorVisitante: 17 };
  var sinFirmar = { eleccion: 'local', confirmado: false };
  var firmado = { eleccion: 'local', confirmado: true };
  assert.strictEqual(reglas.puntosGanados(sinFirmar, 'tnf', res, tabla), 0);
  assert.strictEqual(reglas.puntosGanados(firmado, 'tnf', res, tabla), 25);
});

test('atinarle al empate en el primer partido paga 50', function () {
  var tabla = reglas.tablaDePuntos(CAL, {});
  var res = { final: true, marcadorLocal: 20, marcadorVisitante: 20 };
  var pick = { eleccion: 'empate', confirmado: true };
  assert.strictEqual(reglas.puntosGanados(pick, 'tnf', res, tabla), 50);
  // Y en el segundo, que paga 10, el empate deja 20.
  assert.strictEqual(reglas.puntosGanados(pick, 'dom', res, tabla), 20);
});

test('fallar no resta', function () {
  var tabla = reglas.tablaDePuntos(CAL, {});
  var res = { final: true, marcadorLocal: 24, marcadorVisitante: 17 };
  assert.strictEqual(reglas.puntosGanados({ eleccion: 'empate', confirmado: true }, 'tnf', res, tabla), 0);
  assert.strictEqual(reglas.puntosGanados({ eleccion: 'visitante', confirmado: true }, 'tnf', res, tabla), 0);
});

// ---------------------------------------------------------------------------

test('sin pago no se abre el partido, y dice cuanto falta', function () {
  var r = reglas.puedeElegir({
    calendario: CAL, partido: CAL.partidos[0], ahora: new Date(JUEVES - 2 * 60 * MIN),
    pagos: pagos(0), pick: null
  });
  assert.strictEqual(r.puede, false);
  assert.strictEqual(r.motivo, 'sin_pago');
  assert.strictEqual(r.falta, 100);
});

test('lo confirmado ya no se mueve', function () {
  var r = reglas.puedeElegir({
    calendario: CAL, partido: CAL.partidos[0], ahora: new Date(JUEVES - 5 * 60 * MIN),
    pagos: pagos(1500), pick: { eleccion: 'local', confirmado: true }
  });
  assert.strictEqual(r.puede, false);
  assert.strictEqual(r.motivo, 'confirmado');
});

test('con la semana pagada y a tiempo, si se puede', function () {
  var r = reglas.puedeElegir({
    calendario: CAL, partido: CAL.partidos[2], ahora: new Date(JUEVES - 5 * 60 * MIN),
    pagos: pagos(100), pick: { eleccion: 'local', confirmado: false }
  });
  assert.strictEqual(r.puede, true);
});

// ---------------------------------------------------------------------------

test('el calendario real tiene 18 semanas y ningun partido sin hora', function () {
  var real = require('./datos/calendario.json');
  assert.deepStrictEqual(reglas.semanas(real), [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18]);
  assert.strictEqual(real.partidos.length, 272);
  real.partidos.forEach(function (p) {
    assert.ok(!Number.isNaN(Date.parse(p.inicio)), 'fecha invalida en ' + p.id);
    assert.ok(p.local.abbr && p.visitante.abbr, 'equipos incompletos en ' + p.id);
  });
});

test('los partidos sin horario definido vienen marcados', function () {
  var real = require('./datos/calendario.json');
  var sinHora = real.partidos.filter(function (p) { return p.horaConfirmada === false; });
  // ESPN les pone medianoche de relleno. Lo que importa es que vengan
  // marcados: la pantalla dice "horario por definir" en vez de inventar una.
  sinHora.forEach(function (p) {
    assert.ok(p.semana >= 16, 'solo el final de temporada trae horarios abiertos: ' + p.id);
  });
  real.partidos.forEach(function (p) {
    assert.strictEqual(typeof p.horaConfirmada, 'boolean', 'falta horaConfirmada en ' + p.id);
  });
});

test('la semana de la NFL corre de jueves a miercoles', function () {
  var real = require('./datos/calendario.json');
  reglas.semanas(real).forEach(function (n) {
    var v = real.semanas[n];
    assert.ok(v, 'falta la ventana de la semana ' + n);
    assert.strictEqual(new Date(v.inicia).getUTCDay(), 4, 'la semana ' + n + ' no arranca en jueves');
    assert.strictEqual(new Date(v.termina).getUTCDay(), 3, 'la semana ' + n + ' no termina en miercoles');
    var largo = Date.parse(v.termina) - Date.parse(v.inicia);
    assert.ok(largo > 6.9 * 86400000 && largo < 7 * 86400000, 'la semana ' + n + ' no dura siete dias');
  });
});

test('ningun partido se sale de la ventana de su semana', function () {
  var real = require('./datos/calendario.json');
  reglas.semanas(real).forEach(function (n) {
    var v = real.semanas[n];
    reglas.partidosDeSemana(real, n).forEach(function (p) {
      assert.ok(p.inicio >= v.inicia && p.inicio <= v.termina,
        'semana ' + n + ': ' + p.visitante.abbr + ' @ ' + p.local.abbr + ' el ' + p.inicio);
    });
  });
});

test('en el calendario real, cada partido cierra antes de empezar', function () {
  var real = require('./datos/calendario.json');
  real.partidos.forEach(function (p) {
    var cierre = reglas.cierreDePartido(p);
    assert.ok(cierre.getTime() < Date.parse(p.inicio),
      p.visitante.abbr + '@' + p.local.abbr + ' cierra despues de empezar');
    assert.strictEqual(Date.parse(p.inicio) - cierre.getTime(), 30 * 60 * 1000);
  });
});

test('en el calendario real, cerrar uno no cierra a los demas', function () {
  var real = require('./datos/calendario.json');
  reglas.semanas(real).forEach(function (n) {
    var juegos = reglas.partidosDeSemana(real, n);
    // Justo cuando cierra el primero, el ultimo tiene que seguir abierto,
    // salvo que los dos empiecen a la misma hora.
    var alCerrarElPrimero = reglas.cierreDePartido(juegos[0]);
    var ultimo = juegos[juegos.length - 1];
    if (Date.parse(ultimo.inicio) > Date.parse(juegos[0].inicio)) {
      assert.strictEqual(reglas.estadoDePartido(real, ultimo, alCerrarElPrimero), 'abierto',
        'semana ' + n + ': el ultimo partido se cerro junto con el primero');
    }
  });
});

// ---------------------------------------------------------------------------
// La cuenta completa: picks + marcadores -> puntos de cada quien.
// Es la parte que decide quien gana el dinero, asi que va probada con numeros
// sacados a mano.
// ---------------------------------------------------------------------------

test('la suma de una semana cuadra con la cuenta a mano', function () {
  var tabla = reglas.tablaDePuntos(CAL, {});

  // Semana 1 del calendario de mentiras: tnf (25), dom (10), mnf (11).
  var resultados = {
    tnf: { final: true, marcadorLocal: 24, marcadorVisitante: 17 },  // gana local
    dom: { final: true, marcadorLocal: 20, marcadorVisitante: 20 },  // EMPATE
    mnf: { final: true, marcadorLocal: 13, marcadorVisitante: 27 }   // gana visitante
  };

  var jugadores = {
    // Le atina a los tres: 25 + (10 x 2 por el empate) + 11 = 56
    Pedro: { tnf: 'local', dom: 'empate', mnf: 'visitante' },
    // Solo el primero: 25
    Sofia: { tnf: 'local', dom: 'local', mnf: 'local' },
    // Solo el empate, que paga doble: 20
    Marco: { tnf: 'visitante', dom: 'empate', mnf: 'local' },
    // Le atina a todo pero sin confirmar: 0
    Distraido: { tnf: 'local', dom: 'empate', mnf: 'visitante' }
  };

  function sumar(nombre, confirmados) {
    return Object.keys(jugadores[nombre]).reduce(function (total, id) {
      var pick = { eleccion: jugadores[nombre][id], confirmado: confirmados };
      return total + reglas.puntosGanados(pick, id, resultados[id], tabla);
    }, 0);
  }

  assert.strictEqual(sumar('Pedro', true), 56, 'Pedro: 25 + 20 + 11');
  assert.strictEqual(sumar('Sofia', true), 25, 'Sofia: solo el primero');
  assert.strictEqual(sumar('Marco', true), 20, 'Marco: solo el empate, x2');
  assert.strictEqual(sumar('Distraido', false), 0, 'sin confirmar no paga nada');
});

test('un partido sin marcador final todavia no paga', function () {
  var tabla = reglas.tablaDePuntos(CAL, {});
  var pick = { eleccion: 'local', confirmado: true };
  // En vivo, ganando, pero sin silbatazo final.
  var enVivo = { final: false, marcadorLocal: 35, marcadorVisitante: 0 };
  assert.strictEqual(reglas.puntosGanados(pick, 'tnf', enVivo, tabla), 0);
  assert.strictEqual(reglas.puntosGanados(pick, 'tnf', null, tabla), 0);
});

test('el orden de la tabla lo decide el puntaje, no los aciertos', function () {
  // Uno con un solo acierto caro le gana a otro con dos baratos.
  var tabla = reglas.tablaDePuntos(CAL, {});
  var res = {
    tnf: { final: true, marcadorLocal: 24, marcadorVisitante: 17 },
    dom: { final: true, marcadorLocal: 24, marcadorVisitante: 17 },
    mnf: { final: true, marcadorLocal: 24, marcadorVisitante: 17 }
  };
  var caro = reglas.puntosGanados({ eleccion: 'local', confirmado: true }, 'tnf', res.tnf, tabla);
  var barato = reglas.puntosGanados({ eleccion: 'local', confirmado: true }, 'dom', res.dom, tabla) +
               reglas.puntosGanados({ eleccion: 'local', confirmado: true }, 'mnf', res.mnf, tabla);
  assert.strictEqual(caro, 25);
  assert.strictEqual(barato, 21);
  assert.ok(caro > barato, 'el partido 1 vale mas que el 2 y el 3 juntos');
});

// ---------------------------------------------------------------------------
// Ganadores por jornada. La jornada corre de jueves a martes: un partido en
// miercoles cuenta para la jornada que arranca al dia siguiente.
// ---------------------------------------------------------------------------

test('la jornada jueves-martes coincide con la semana del calendario', function () {
  var real = require('./datos/calendario.json');
  var DIA = 86400000;

  // El jueves con el que arranca la jornada de un partido, en hora de Mexico.
  function juevesDeLaJornada(iso) {
    var dia = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date(iso));
    var f = new Date(dia + 'T12:00:00Z');
    var dow = f.getUTCDay();                       // 4 = jueves
    if (dow === 3) return new Date(f.getTime() + DIA);   // miercoles -> el jueves que sigue
    return new Date(f.getTime() - ((dow - 4 + 7) % 7) * DIA);
  }

  // Cada jornada calculada asi tiene que caer completa en una sola semana.
  var porJornada = {};
  real.partidos.forEach(function (p) {
    var j = juevesDeLaJornada(p.inicio).toISOString().slice(0, 10);
    (porJornada[j] = porJornada[j] || []).push(p.semana);
  });

  var jornadas = Object.keys(porJornada);
  assert.strictEqual(jornadas.length, reglas.semanas(real).length,
    'salen ' + jornadas.length + ' jornadas y ' + reglas.semanas(real).length + ' semanas');

  jornadas.forEach(function (j) {
    var semanasAhi = new Set(porJornada[j]);
    assert.strictEqual(semanasAhi.size, 1,
      'la jornada del ' + j + ' mezcla las semanas ' + [...semanasAhi].join(', '));
  });
});

test('el ganador de la jornada es quien mas puntos hizo esa semana', function () {
  var tabla = reglas.tablaDePuntos(CAL, {});
  var resultados = {
    tnf: { final: true, marcadorLocal: 24, marcadorVisitante: 17 },  // local, 25 pts
    dom: { final: true, marcadorLocal: 20, marcadorVisitante: 20 },  // empate, 10 x2
    mnf: { final: true, marcadorLocal: 13, marcadorVisitante: 27 }   // visitante, 11 pts
  };

  function puntosDe(picks) {
    return Object.keys(picks).reduce(function (t, id) {
      return t + reglas.puntosGanados({ eleccion: picks[id], confirmado: true },
                                      id, resultados[id], tabla);
    }, 0);
  }

  // Uno le atina solo al de 25; otro a los dos baratos (20 + 11 = 31).
  var soloElGordo = puntosDe({ tnf: 'local', dom: 'local', mnf: 'local' });
  var losDosChicos = puntosDe({ tnf: 'visitante', dom: 'empate', mnf: 'visitante' });

  assert.strictEqual(soloElGordo, 25);
  assert.strictEqual(losDosChicos, 31);
  assert.ok(losDosChicos > soloElGordo,
    'dos aciertos baratos con empate le ganan al partido 1 solo');
});

test('una jornada se puede empatar entre dos', function () {
  var tabla = reglas.tablaDePuntos(CAL, {});
  var res = { tnf: { final: true, marcadorLocal: 24, marcadorVisitante: 17 } };
  var uno = reglas.puntosGanados({ eleccion: 'local', confirmado: true }, 'tnf', res.tnf, tabla);
  var otro = reglas.puntosGanados({ eleccion: 'local', confirmado: true }, 'tnf', res.tnf, tabla);
  assert.strictEqual(uno, otro, 'dos que eligen igual suman igual y se reparten la jornada');
});

// ---------------------------------------------------------------------------
// El marcador en vivo
//
// Lo unico que de verdad importa aqui: que un marcador a medio partido nunca
// se convierta en puntos. Los puntos salen del resultado FINAL guardado, y
// esa puerta es la unica.
// ---------------------------------------------------------------------------

var vivo = require('./lib/vivo');

test('sin partidos corriendo no se le pregunta nada a ESPN', async function () {
  // Dos dias antes del primero: no hay nada que consultar. Si esto se pusiera
  // a pedirle datos a ESPN, estaria despertando a la red todo el martes.
  var antes = new Date(JUEVES - 2 * 24 * 60 * MIN);
  var real = Date.now;
  Date.now = function () { return antes.getTime(); };
  try {
    var r = await vivo.deLaSemana(2026, 1, reglas.partidosDeSemana(CAL, 1), { partidos: {} });
    assert.deepStrictEqual(r.partidos, {}, 'no devuelve estados');
    assert.deepStrictEqual(r.porCerrar, [], 'no hay nada que cerrar');
  } finally {
    Date.now = real;
  }
});

test('un marcador en vivo NO da puntos', function () {
  var tabla = reglas.tablaDePuntos(CAL, {});
  var pick = { eleccion: 'local', confirmado: true };

  // El local va ganando 21-14, pero el partido no ha terminado: sin "final"
  // no hay puntos, por mucho que vaya arriba.
  var enVivo = { final: false, marcadorLocal: 21, marcadorVisitante: 14 };
  assert.strictEqual(reglas.puntosGanados(pick, 'tnf', enVivo, tabla), 0,
    'un partido a medias no puede pagar');

  // Ya terminado, con el mismo marcador, si paga.
  var final = { final: true, marcadorLocal: 21, marcadorVisitante: 14 };
  assert.ok(reglas.puntosGanados(pick, 'tnf', final, tabla) > 0,
    'ya terminado si paga');
});

test('semanasEnJuego solo trae semanas con algo pendiente', function () {
  var real = Date.now;

  // Antes de que arranque nada.
  Date.now = function () { return JUEVES - 60 * MIN; };
  try {
    assert.deepStrictEqual(vivo.semanasEnJuego(CAL, { partidos: {} }), [],
      'antes del primer silbatazo no hay nada que vigilar');

    // Con la jornada ya jugada y TODOS los marcadores guardados, tampoco.
    Date.now = function () { return LUNES + 12 * 60 * MIN; };
    var todos = { partidos: {} };
    CAL.partidos.forEach(function (p) {
      todos.partidos[p.id] = { final: true, marcadorLocal: 20, marcadorVisitante: 17 };
    });
    assert.deepStrictEqual(vivo.semanasEnJuego(CAL, todos), [],
      'ya contados todos, no hay por que seguir preguntando');

    // Pero si falta uno por cerrar, esa semana si se vigila.
    var falta = { partidos: {} };
    CAL.partidos.slice(1).forEach(function (p) {
      falta.partidos[p.id] = { final: true, marcadorLocal: 20, marcadorVisitante: 17 };
    });
    assert.deepStrictEqual(vivo.semanasEnJuego(CAL, falta), [1],
      'con un partido sin marcador, la semana sigue en la lista');
  } finally {
    Date.now = real;
  }
});
