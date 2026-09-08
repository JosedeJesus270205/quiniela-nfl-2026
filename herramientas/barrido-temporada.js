/**
 * Barrido de la temporada completa.
 *
 *   node herramientas/barrido-temporada.js
 *
 * Recorre las 18 semanas en cinco momentos distintos de cada una —cuando esta
 * abierta, justo antes de cerrar, recien cerrada, a media jornada y ya
 * terminada— y en cada uno verifica que las reglas se cumplan. Son 90
 * escenarios sobre el calendario real.
 *
 * Lo que se revisa en cada escenario:
 *
 *   1. REGLA DE ORO: ningun partido que ya empezo aparece como editable.
 *   2. La semana cierra exactamente 30 min antes de su primer partido.
 *   3. Cuando la semana esta cerrada, lo esta COMPLETA (el lunes tambien).
 *   4. Quien no tiene pagada la semana no puede tocar ninguno de sus partidos.
 *   5. Los puntos siguen la escalera 25, 10, 11, 12... sin huecos ni repetidos.
 *   6. Un partido no puede estar abierto y ya iniciado a la vez.
 *
 * No necesita servidor ni red: le pega directo a las reglas, que son la
 * autoridad. Si esto pasa, el servidor no tiene por donde equivocarse.
 */

'use strict';

var path = require('path');
var reglas = require(path.join(__dirname, '..', 'lib', 'reglas'));
var calendario = require(path.join(__dirname, '..', 'datos', 'calendario.json'));

var C = reglas.CONFIG;
var MINUTO = 60 * 1000;
var DIA = 24 * 60 * MINUTO;

var fallas = [];
var escenarios = 0;
var revisiones = 0;

function exigir(condicion, que, donde) {
  revisiones++;
  if (!condicion) fallas.push(donde + ' — ' + que);
}

var MOMENTOS = [
  ['abierta',   function (pri, ult, cie) { return cie - 2 * DIA; }],
  ['porcerrar', function (pri, ult, cie) { return cie - 15 * MINUTO; }],
  ['cerrada',   function (pri, ult, cie) { return cie + 5 * MINUTO; }],
  ['enmedio',   function (pri, ult, cie) { return pri + 4 * 60 * MINUTO; }],
  ['terminada', function (pri, ult, cie) { return ult + 4 * 60 * MINUTO; }]
];

// Tres perfiles de pago para probar el candado del dinero en cada escenario.
var CARTERAS = [
  { nombre: 'sin pagar',     pagos: [] },
  { nombre: 'hasta la 7',    pagos: [{ monto: 700 }] },
  { nombre: 'temporada',     pagos: [{ monto: C.totalTemporada }] }
];

var semanas = reglas.semanas(calendario);
var tabla = reglas.tablaDePuntos(calendario, {}, C);

console.log('\nBarrido de la temporada ' + calendario.temporada +
            ' · ' + semanas.length + ' semanas x ' + MOMENTOS.length + ' momentos\n');

semanas.forEach(function (n) {
  var juegos = reglas.partidosDeSemana(calendario, n);
  var primero = Date.parse(juegos[0].inicio);
  var ultimo = Date.parse(juegos[juegos.length - 1].inicio);
  var cierre = reglas.cierreDeSemana(calendario, n, C);

  // --- 2. El cierre esta donde debe ---
  exigir(cierre.getTime() === primero - C.minutosCierre * MINUTO,
         'el cierre no es 30 min antes del primer partido', 'S' + n);

  // --- 5. La escalera de puntos ---
  var valores = juegos.map(function (p) { return tabla[p.id].valor; });
  exigir(valores[0] === C.puntosPrimero,
         'el primer partido no paga ' + C.puntosPrimero, 'S' + n);
  for (var k = 1; k < valores.length; k++) {
    exigir(valores[k] === C.puntosArranque + (k - 1),
           'el partido ' + (k + 1) + ' paga ' + valores[k] + ' y deberia pagar ' +
           (C.puntosArranque + (k - 1)), 'S' + n);
  }
  var sinRepetir = new Set(valores.slice(1));
  exigir(sinRepetir.size === valores.length - 1,
         'hay puntajes repetidos entre el 2o y el ultimo', 'S' + n);

  MOMENTOS.forEach(function (m) {
    var etiqueta = m[0];
    var ahora = new Date(m[1](primero, ultimo, cierre.getTime()));
    var donde = 'S' + n + ' · ' + etiqueta;
    escenarios++;

    var cerrada = ahora.getTime() >= cierre.getTime();

    juegos.forEach(function (p, i) {
      var estado = reglas.estadoDePartido(calendario, p, ahora, C);
      var arranco = Date.parse(p.inicio) <= ahora.getTime();

      // --- 1 y 6. La regla de oro, por partido ---
      if (arranco) {
        exigir(estado === 'iniciado',
               'el partido ' + (i + 1) + ' ya arranco y no dice "iniciado"', donde);
      }
      exigir(!(estado === 'abierto' && arranco),
             'el partido ' + (i + 1) + ' esta abierto habiendo arrancado', donde);

      // --- 3. Cerrada es cerrada para toda la semana ---
      if (cerrada && !arranco) {
        exigir(estado === 'cerrado',
               'la semana cerro pero el partido ' + (i + 1) + ' sigue en "' + estado + '"', donde);
      }

      // --- Contra las tres carteras ---
      CARTERAS.forEach(function (cartera) {
        var permiso = reglas.puedeElegir({
          calendario: calendario, partido: p, ahora: ahora,
          pagos: cartera.pagos, pick: null, config: C
        });

        // La regla de oro manda sobre todo lo demas.
        if (arranco || cerrada) {
          exigir(permiso.puede === false,
                 'con "' + cartera.nombre + '" se puede tocar el partido ' + (i + 1) +
                 ' estando ' + estado, donde);
        }

        // --- 4. El candado del dinero ---
        var pagada = reglas.semanaPagada(n, cartera.pagos, C);
        if (!pagada && !arranco && !cerrada) {
          exigir(permiso.puede === false && permiso.motivo === 'sin_pago',
                 'con "' + cartera.nombre + '" (semana ' + n + ' sin pagar) se cuela al partido ' +
                 (i + 1), donde);
        }

        // Con todo pagado y a tiempo, tiene que poder.
        if (pagada && !arranco && !cerrada) {
          exigir(permiso.puede === true,
                 'con "' + cartera.nombre + '" no puede elegir el partido ' + (i + 1) +
                 ' estando abierto', donde);
        }
      });
    });
  });

  var abiertos = juegos.filter(function (p) {
    return reglas.estadoDePartido(calendario, p, new Date(cierre.getTime() - DIA), C) === 'abierto';
  }).length;
  console.log('  S' + String(n).padStart(2) + '  ' + String(juegos.length).padStart(2) + ' partidos  ' +
              'paga ' + valores.join(' ') +
              '   (' + abiertos + '/' + juegos.length + ' abiertos un dia antes del cierre)');
});

console.log('\n' + escenarios + ' escenarios · ' + revisiones.toLocaleString('es-MX') + ' verificaciones');

if (fallas.length) {
  console.log('\n' + fallas.length + ' FALLAS:');
  fallas.slice(0, 25).forEach(function (f) { console.log('   ' + f); });
  if (fallas.length > 25) console.log('   ...y ' + (fallas.length - 25) + ' mas');
  console.log('');
  process.exit(1);
}

console.log('\nLa temporada completa se comporta bien en los cinco momentos.\n');
