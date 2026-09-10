/**
 * MODO ENSAYO — probar una jornada antes de que llegue de verdad.
 *
 * Monta una quiniela completa de mentiras en su propia carpeta, con jugadores,
 * pagos, picks y marcadores ya jugados, y pone el reloj del sistema en el
 * momento que pidas. Abres el navegador y todo se comporta como si de verdad
 * fuera ese dia.
 *
 *   node ensayo.js                          semana 1, con todo abierto
 *   node ensayo.js --semana 8               como si fuera la semana 8
 *   node ensayo.js --semana 8 --momento cerrada
 *   node ensayo.js --revisar                revisa las 18 semanas sin abrir nada
 *
 * MOMENTOS
 *   abierta    (por omision) dos dias antes del primer partido: todo se puede
 *   porcerrar  15 minutos antes del cierre: la cuenta regresiva en rojo
 *   cerrada    5 minutos despues del cierre, antes del primer silbatazo
 *   envivo     con la tanda del domingo corriendo: marcadores moviendose
 *   enmedio    con el primer partido ya jugado y el resto por jugarse
 *   terminada  la jornada completa, con todos los marcadores
 *
 * NADA de esto toca datos/. El ensayo vive en ensayo/ y se borra al empezar.
 */

'use strict';

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var RAIZ = __dirname;
var CARPETA = path.join(RAIZ, 'ensayo');
var MINUTO = 60 * 1000;
var DIA = 24 * 60 * MINUTO;

// ---------------------------------------------------------------------------
// Argumentos
// ---------------------------------------------------------------------------

function arg(nombre, porOmision) {
  var i = process.argv.indexOf('--' + nombre);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : porOmision;
}
function bandera(nombre) { return process.argv.indexOf('--' + nombre) !== -1; }

var semanaPedida = Number(arg('semana', 1));
var momento = arg('momento', 'abierta');
var puerto = Number(arg('puerto', 4500));
var soloRevisar = bandera('revisar');

var MOMENTOS = ['abierta', 'porcerrar', 'cerrada', 'envivo', 'enmedio', 'terminada'];
if (MOMENTOS.indexOf(momento) === -1) {
  console.error('\n  --momento tiene que ser uno de: ' + MOMENTOS.join(', ') + '\n');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Preparar la carpeta del ensayo
// ---------------------------------------------------------------------------

var CALENDARIO = path.join(RAIZ, 'datos', 'calendario.json');
if (!fs.existsSync(CALENDARIO)) {
  console.error('\n  Falta datos/calendario.json. Corre primero:');
  console.error('  node herramientas/actualizar-calendario.js\n');
  process.exit(1);
}

fs.rmSync(CARPETA, { recursive: true, force: true });
fs.mkdirSync(CARPETA, { recursive: true });
fs.copyFileSync(CALENDARIO, path.join(CARPETA, 'calendario.json'));

var calendario = JSON.parse(fs.readFileSync(CALENDARIO, 'utf8'));

// ---------------------------------------------------------------------------
// A que hora nos paramos
// ---------------------------------------------------------------------------

function partidosDe(n) {
  return calendario.partidos
    .filter(function (p) { return p.semana === n; })
    .sort(function (a, b) { return a.inicio.localeCompare(b.inicio) || a.id.localeCompare(b.id); });
}

var semanas = [];
calendario.partidos.forEach(function (p) { if (semanas.indexOf(p.semana) === -1) semanas.push(p.semana); });
semanas.sort(function (a, b) { return a - b; });

if (semanas.indexOf(semanaPedida) === -1) {
  console.error('\n  No existe la semana ' + semanaPedida + '. Van de la ' +
                semanas[0] + ' a la ' + semanas[semanas.length - 1] + '.\n');
  process.exit(1);
}

/** El instante exacto que corresponde al momento pedido de esa semana. */
function momentoDe(n, cual) {
  var juegos = partidosDe(n);
  var primero = Date.parse(juegos[0].inicio);
  var ultimo = Date.parse(juegos[juegos.length - 1].inicio);
  var cierre = primero - 30 * MINUTO;

  if (cual === 'abierta') return cierre - 2 * DIA;
  if (cual === 'porcerrar') return cierre - 15 * MINUTO;
  if (cual === 'cerrada') return cierre + 5 * MINUTO;
  if (cual === 'enmedio') return primero + 4 * 60 * MINUTO;

  // "envivo": hora y media despues del silbatazo de la tanda mas grande de la
  // jornada, que es la del domingo por la tarde. Ahi hay varios partidos
  // corriendo a la vez, que es justo lo que hay que poder ver antes de que
  // pase de verdad.
  if (cual === 'envivo') {
    var tandas = {};
    juegos.forEach(function (p) {
      tandas[p.inicio] = (tandas[p.inicio] || 0) + 1;
    });
    var mayor = Object.keys(tandas).sort(function (a, b) {
      return tandas[b] - tandas[a] || a.localeCompare(b);
    })[0];
    return Date.parse(mayor) + 90 * MINUTO;
  }

  return ultimo + 4 * 60 * MINUTO;   // terminada
}

// ---------------------------------------------------------------------------
// Marcadores de mentiras, pero siempre los mismos
// ---------------------------------------------------------------------------

/**
 * Un numero entre 0 y 1 sacado del id del partido. Como no depende del azar,
 * dos ensayos seguidos dan exactamente los mismos marcadores y se puede
 * comparar peras con peras.
 */
function dado(semilla) {
  var h = crypto.createHash('sha256').update(String(semilla)).digest();
  return h.readUInt32BE(0) / 4294967295;
}

/** Un marcador creible, con empate de vez en cuando. */
function marcadorDe(partido) {
  var d = dado(partido.id + ':quien');
  var local = 10 + Math.floor(dado(partido.id + ':l') * 25);
  var visitante = 10 + Math.floor(dado(partido.id + ':v') * 25);

  if (d < 0.06) return [21, 21];                      // empate, ~6% de las veces
  if (d < 0.55) return [Math.max(local, visitante + 3), Math.min(local, visitante)];
  return [Math.min(local, visitante), Math.max(visitante, local + 3)];
}

// ---------------------------------------------------------------------------
// Los jugadores del ensayo
// ---------------------------------------------------------------------------

/**
 * Los jugadores del ensayo salen de la quiniela de verdad: se copian sus
 * nombres y correos (nada mas eso) para poder revisar el ensayo con la lista
 * que uno conoce. Todos entran con la contrasena "ensayo123".
 *
 * Nunca se leen contrasenas ni pagos ni picks de los datos reales, y el ensayo
 * jamas escribe en ellos.
 */
function genteDeLaQuinielaReal() {
  try {
    var real = JSON.parse(fs.readFileSync(path.join(RAIZ, 'datos', 'quiniela.json'), 'utf8'));
    return (real.usuarios || []).map(function (u, i) {
      return {
        nombre: u.nombre,
        correo: u.correo,
        hasta: 15,
        // El primero de la lista le atina a casi todo, para tener puntos altos
        // que revisar desde el arranque.
        estilo: i === 0 ? 'acierta' : ESTILOS[i % ESTILOS.length]
      };
    });
  } catch (e) {
    return [];
  }
}

var ESTILOS = ['favorito', 'empates', 'visitante', 'mezcla'];

/** Relleno, para que el ensayo tenga con quien competir aunque haya poca gente. */
var INVENTADOS = [
  { nombre: 'Ricardo Salinas Mena', hasta: 15, estilo: 'favorito' },
  { nombre: 'Ana Karina Trevino', hasta: 15, estilo: 'empates' },
  { nombre: 'Luis Fernando Ochoa', hasta: 15, estilo: 'visitante' },
  { nombre: 'Paola Guerrero Rios', hasta: 15, estilo: 'mezcla' },
  { nombre: 'Hector Villarreal Sosa', hasta: 6, estilo: 'mezcla' },   // se atraso en pagos
  { nombre: 'Sofia Delgado Nava', hasta: 0, estilo: 'mezcla' }        // nunca deposito
];

var reales = genteDeLaQuinielaReal();
// Siempre al menos seis, para que la tabla tenga sentido.
var GENTE = reales.concat(INVENTADOS.slice(0, Math.max(0, 6 - reales.length)));

/** Quien gano segun el marcador inventado de ese partido. */
function ganadorDe(partido) {
  var m = marcadorDe(partido);
  if (m[0] > m[1]) return 'local';
  if (m[1] > m[0]) return 'visitante';
  return 'empate';
}

/**
 * Como elige cada quien. Tambien sin azar, para poder repetir el ensayo.
 *
 * El estilo "acierta" le pega a 8 de cada 10, incluidos los empates: es el que
 * usa la cuenta propia, para tener puntos altos que revisar desde el principio.
 */
function eligeDe(estilo, partido, i) {
  var d = dado(partido.id + ':' + estilo);
  if (estilo === 'acierta') {
    var bueno = ganadorDe(partido);
    if (d < 0.8) return bueno;
    // El 20% restante falla a proposito, para que no se vea perfecto.
    return bueno === 'local' ? 'visitante' : 'local';
  }
  if (estilo === 'favorito') return 'local';
  if (estilo === 'visitante') return d < 0.7 ? 'visitante' : 'local';
  if (estilo === 'empates') return d < 0.25 ? 'empate' : (d < 0.6 ? 'local' : 'visitante');
  return d < 0.45 ? 'local' : (d < 0.9 ? 'visitante' : 'empate');
}

// ---------------------------------------------------------------------------
// Sembrar
// ---------------------------------------------------------------------------

process.env.QUINIELA_DATOS = CARPETA;
process.env.QUINIELA_ENSAYO = new Date(momentoDe(semanaPedida, momento)).toISOString();
process.env.QUINIELA_PUERTO = String(puerto);

var almacen = require('./lib/almacen');
var reglas = require('./lib/reglas');
var configuracion = require('./lib/configuracion');

var config = configuracion.cargar();
var ahora = Date.parse(process.env.QUINIELA_ENSAYO);

// Jugadores con sus pagos
var jugadores = GENTE.map(function (g) {
  var u = almacen.crearUsuario({
    nombre: g.nombre,
    correo: g.correo || g.nombre.split(' ')[0].toLowerCase() + '@ensayo.mx',
    telefono: '8110000000',
    contrasena: 'ensayo123'
  });
  if (g.hasta > 0) {
    almacen.registrarPago(u.id, g.hasta * config.cuotaSemanal, 'Ensayo · hasta la semana ' + g.hasta);
  }
  return Object.assign({ id: u.id }, g);
});

// Picks y marcadores de todo lo que ya paso
var resultados = { actualizado: new Date(ahora).toISOString(), partidos: {} };
var jugados = 0;

semanas.forEach(function (n) {
  var juegos = partidosDe(n);
  var cierre = Date.parse(juegos[0].inicio) - config.minutosCierre * MINUTO;

  juegos.forEach(function (p, i) {
    var arranco = Date.parse(p.inicio) <= ahora;
    // Un partido cuenta como terminado unas 3.5 horas despues de empezar.
    var termino = Date.parse(p.inicio) + 3.5 * 60 * MINUTO <= ahora;

    if (termino) {
      var m = marcadorDe(p);
      resultados.partidos[p.id] = {
        final: true, marcadorLocal: m[0], marcadorVisitante: m[1], detalle: 'Final'
      };
      jugados++;
    }

    // Solo se pudo elegir lo que estaba abierto antes del cierre de su semana.
    if (cierre > ahora) return;

    jugadores.forEach(function (j) {
      if (!reglas.semanaPagada(n, almacen.pagosDe(j.id), config)) return;
      // Uno de cada veinte se le olvida confirmar: asi se ve ese caso tambien.
      var seLeOlvido = dado(p.id + ':' + j.id + ':flojera') < 0.05;
      almacen.guardarPick(j.id, p.id, eligeDe(j.estilo, p, i));
      if (!seLeOlvido) almacen.confirmarPick(j.id, p.id);
    });
  });
});

fs.writeFileSync(path.join(CARPETA, 'resultados.json'), JSON.stringify(resultados, null, 1));

// ---------------------------------------------------------------------------
// Lo que quedo armado
// ---------------------------------------------------------------------------

var fmt = new Intl.DateTimeFormat('es-MX', {
  timeZone: config.zona, weekday: 'long', day: 'numeric', month: 'long',
  hour: 'numeric', minute: '2-digit'
});

function tablaGeneral() {
  var puntos = reglas.tablaDePuntos(calendario, almacen.puntos(), config);
  var filas = jugadores.map(function (j) {
    var picks = almacen.picksDe(j.id);
    var total = 0, aciertos = 0, contados = 0;
    calendario.partidos.forEach(function (p) {
      var pk = picks[p.id];
      var r = resultados.partidos[p.id];
      if (!pk || !pk.confirmado || !r) return;
      contados++;
      var g = reglas.puntosGanados(pk, p.id, r, puntos, config);
      if (g > 0) { aciertos++; total += g; }
    });
    return { nombre: j.nombre, puntos: total, aciertos: aciertos, jugados: contados };
  });
  filas.sort(function (a, b) { return b.puntos - a.puntos; });
  return filas;
}

console.log('\n============================================================');
console.log('  ENSAYO · Semana ' + semanaPedida + ' · momento "' + momento + '"');
console.log('============================================================\n');
console.log('  El sistema cree que hoy es:');
console.log('     ' + fmt.format(new Date(ahora)) + '  (hora de Mexico)\n');

var juegos = partidosDe(semanaPedida);
var cierre = Date.parse(juegos[0].inicio) - config.minutosCierre * MINUTO;
var abiertos = juegos.filter(function (p) {
  return reglas.estadoDePartido(calendario, p, new Date(ahora), config) === 'abierto';
}).length;
var iniciados = juegos.filter(function (p) {
  return reglas.estadoDePartido(calendario, p, new Date(ahora), config) === 'iniciado';
}).length;

console.log('  Semana ' + semanaPedida + ': ' + juegos.length + ' partidos');
console.log('     cierra   ' + fmt.format(new Date(cierre)));
console.log('     abiertos ' + abiertos + '   cerrados ' + (juegos.length - abiertos - iniciados) +
            '   ya iniciados ' + iniciados);
console.log('\n  ' + jugados + ' partidos con marcador final en toda la temporada\n');

console.log('  Jugadores sembrados:');
jugadores.forEach(function (j) {
  var pagos = almacen.pagosDe(j.id);
  var abiertas = semanas.filter(function (n) { return reglas.semanaPagada(n, pagos, config); });
  console.log('     ' + j.nombre.padEnd(24) + ' $' + String(reglas.totalPagado(pagos)).padStart(4) +
              '   semanas abiertas: ' + (abiertas.length ? '1 a la ' + abiertas[abiertas.length - 1] : 'ninguna'));
});

var tabla = tablaGeneral();
if (tabla[0].jugados) {
  console.log('\n  Tabla general en este momento:');
  tabla.forEach(function (f, i) {
    console.log('     ' + (i + 1) + '. ' + f.nombre.padEnd(24) + String(f.puntos).padStart(4) +
                ' pts   ' + f.aciertos + '/' + f.jugados + ' aciertos');
  });
} else {
  console.log('\n  Todavia no hay partidos jugados: la tabla esta en ceros.');
}

console.log('\n  Contrasena del panel de ensayo: ' + config.adminContrasena);
console.log('  Todos entran con su correo y la clave  ensayo123');
if (reales.length) {
  console.log('     ' + reales.length + ' cuenta(s) copiadas de la quiniela de verdad,');
  console.log('     empezando por ' + reales[0].correo);
}

if (soloRevisar) {
  console.log('\n  (--revisar: no se abre el servidor)\n');
  process.exit(0);
}

/**
 * Si la quiniela de verdad tambien esta corriendo, hay que decirlo fuerte: en
 * pantalla las dos se ven iguales y es facilisimo probar en la que no es.
 */
function quinielaRealPrendida() {
  return new Promise(function (resolver) {
    var req = require('http').get({ host: 'localhost', port: 4400, path: '/', timeout: 700 },
      function (r) { r.destroy(); resolver(true); });
    req.on('error', function () { resolver(false); });
    req.on('timeout', function () { req.destroy(); resolver(false); });
  });
}

quinielaRealPrendida().then(function (prendida) {
  console.log('\n------------------------------------------------------------');
  console.log('  EL ENSAYO ES EL PUERTO ' + puerto);
  console.log('     Jugadores  http://localhost:' + puerto + '/');
  console.log('     Panel      http://localhost:' + puerto + '/admin');

  if (prendida) {
    console.log('');
    console.log('  OJO: la quiniela DE VERDAD tambien esta corriendo, en el 4400.');
    console.log('  Las dos se ven iguales. Para ensayar tienes que abrir el ' + puerto + ',');
    console.log('  no el 4400. El ensayo trae una cinta amarilla arriba y la');
    console.log('  pestana del navegador dice "ENSAYO"; si no ves eso, estas');
    console.log('  en la quiniela de verdad.');
  }

  console.log('');
  console.log('  Ctrl+C para terminar el ensayo.');
  console.log('------------------------------------------------------------\n');

  require('./servidor.js');
});
