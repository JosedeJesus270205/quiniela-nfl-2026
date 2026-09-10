/**
 * El marcador en vivo.
 *
 * ESPN publica, en el MISMO endpoint del que ya sacamos los resultados, el
 * estado de cada partido:
 *
 *   pre    todavia no arranca      -> no se enseña nada
 *   in     esta corriendo          -> "EN VIVO" con el marcador y el reloj
 *   post   ya termino              -> "FINAL" con el marcador definitivo
 *
 * Dos reglas que no se rompen:
 *
 *   1. A ESPN se le pregunta SOLO cuando hay un partido corriendo. El resto
 *      del tiempo —que son casi todos los dias— no se consulta nada. No tiene
 *      caso despertar a nadie un martes a las 3 de la tarde.
 *
 *   2. Un marcador en vivo NUNCA cuenta puntos. Los puntos salen de
 *      resultados.json, y ahi solo se escribe cuando ESPN marca el partido
 *      como terminado. Un 21-14 al medio tiempo no le da puntos a nadie.
 *
 * En modo ensayo no se le pregunta nada a ESPN: la hora es de mentiras y la
 * respuesta de verdad no cuadraria. Ahi el estado se inventa a partir del
 * reloj falso, para poder probar la pantalla antes de que llegue el domingo.
 */

'use strict';

var reloj = require('./reloj');

var CADA = 30 * 1000;                  // cada cuanto se le pregunta a ESPN
var ESPERA = 4000;                     // si tarda mas que esto, ni modo
var DURA = 4 * 60 * 60 * 1000;         // lo que dura un partido, con margen
var MINUTO = 60 * 1000;

// Lo ultimo que contesto ESPN, por semana. Vive en memoria: si el servidor se
// reinicia se vuelve a pedir y ya.
var cache = {};          // { semana: { sello, partidos: { id: {...} } } }
var enVuelo = {};        // promesas en curso, para no pedir dos veces lo mismo

// ---------------------------------------------------------------------------
// Cuando vale la pena preguntar
// ---------------------------------------------------------------------------

/**
 * Hay algun partido de esta semana que pueda estar corriendo ahora mismo?
 * Es decir: ya arranco, y no ha pasado tanto como para que forzosamente haya
 * acabado. Si no hay ninguno, no se consulta nada.
 */
function algunoCorriendo(partidos, resultados, ahora) {
  return partidos.some(function (p) {
    var arranco = Date.parse(p.inicio);
    if (ahora < arranco) return false;              // no ha empezado
    if (ahora > arranco + DURA) {
      // Ya paso su ventana. Solo seguimos preguntando si todavia no tenemos
      // su marcador final guardado; puede haberse retrasado.
      var r = resultados.partidos[p.id];
      return !(r && r.final);
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// El ensayo: sin red, todo sale del reloj falso
// ---------------------------------------------------------------------------

/**
 * Un numero estable a partir del id del partido. Sirve para inventar un
 * marcador que no brinque cada vez que se refresca la pantalla.
 */
function semilla(id) {
  var n = 0;
  for (var i = 0; i < id.length; i++) n = (n * 31 + id.charCodeAt(i)) % 100000;
  return n;
}

/** Anotaciones plausibles: multiplos de 3 y 7, que es como anota la NFL. */
function anotacion(sem, cuartos) {
  var puntos = 0;
  for (var c = 0; c < cuartos; c++) {
    var d = (sem >> (c * 3)) % 8;
    if (d === 0) puntos += 0;
    else if (d < 4) puntos += 3;
    else if (d < 7) puntos += 7;
    else puntos += 10;
  }
  return puntos;
}

function inventarEnsayo(partidos, resultados, ahora) {
  var mapa = {};
  partidos.forEach(function (p) {
    var arranco = Date.parse(p.inicio);
    if (ahora < arranco) return;                    // no ha empezado: nada

    var r = resultados.partidos[p.id];
    if (r && r.final) {
      mapa[p.id] = {
        estado: 'post',
        local: r.marcadorLocal,
        visitante: r.marcadorVisitante,
        detalle: 'Final'
      };
      return;
    }

    var corrido = ahora - arranco;
    if (corrido > DURA) return;                     // acabo y no tenemos marcador

    // Cuantos cuartos llevan jugados, de 1 a 4.
    var cuarto = Math.min(4, Math.floor(corrido / (45 * MINUTO)) + 1);
    var s = semilla(p.id);
    var falta = 15 - Math.floor((corrido % (45 * MINUTO)) / (3 * MINUTO));
    if (falta < 0) falta = 0;

    mapa[p.id] = {
      estado: 'in',
      local: anotacion(s, cuarto),
      visitante: anotacion(s + 7919, cuarto),
      detalle: cuarto + 'o · ' + falta + ':00'
    };
  });
  return mapa;
}

// ---------------------------------------------------------------------------
// Lo de verdad: ESPN
// ---------------------------------------------------------------------------

function traducir(datos) {
  var mapa = {};
  (datos.events || []).forEach(function (ev) {
    var comp = ev.competitions && ev.competitions[0];
    if (!comp) return;
    var est = comp.status && comp.status.type;
    if (!est) return;

    var casa = comp.competitors.find(function (c) { return c.homeAway === 'home'; });
    var fuera = comp.competitors.find(function (c) { return c.homeAway === 'away'; });
    if (!casa || !fuera) return;

    mapa[String(ev.id)] = {
      estado: est.state,                     // 'pre' | 'in' | 'post'
      completado: !!est.completed,
      local: Number(casa.score),
      visitante: Number(fuera.score),
      detalle: est.shortDetail || '',
      periodo: comp.status.period,
      reloj: comp.status.displayClock
    };
  });
  return mapa;
}

async function pedirAEspn(temporada, semana) {
  var url = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard' +
            '?dates=' + temporada + '&seasontype=2&week=' + semana;

  var corta = new AbortController();
  var reja = setTimeout(function () { corta.abort(); }, ESPERA);
  try {
    var r = await fetch(url, { signal: corta.signal });
    if (!r.ok) return null;
    return traducir(await r.json());
  } catch (e) {
    // ESPN caido, sin red, o tardo demasiado. No es motivo para tumbar la
    // pagina: se enseña lo que haya en cache y ya se reintentara.
    return null;
  } finally {
    clearTimeout(reja);
  }
}

// ---------------------------------------------------------------------------
// Lo que usa el resto del sistema
// ---------------------------------------------------------------------------

/**
 * El estado en vivo de los partidos de una semana.
 *
 * Devuelve { partidoId: { estado, local, visitante, detalle } } y, aparte, la
 * lista de partidos que ESPN ya dio por terminados y todavia no estan
 * guardados como finales. Quien llame decide que hacer con esos.
 */
async function deLaSemana(temporada, semana, partidos, resultados) {
  var ahora = reloj.milis();

  if (!algunoCorriendo(partidos, resultados, ahora)) {
    return { partidos: {}, porCerrar: [] };
  }

  if (reloj.esEnsayo()) {
    return { partidos: inventarEnsayo(partidos, resultados, ahora), porCerrar: [] };
  }

  var guardado = cache[semana];
  var fresco = guardado && (Date.now() - guardado.sello) < CADA;

  if (!fresco) {
    // Si ya hay una peticion en curso para esta semana, se espera esa misma en
    // vez de lanzar otra. Con 20 jugadores refrescando a la vez, esto es la
    // diferencia entre una llamada a ESPN y veinte.
    if (!enVuelo[semana]) {
      enVuelo[semana] = pedirAEspn(temporada, semana).then(function (mapa) {
        if (mapa) cache[semana] = { sello: Date.now(), partidos: mapa };
        delete enVuelo[semana];
        return mapa;
      }).catch(function () {
        delete enVuelo[semana];
        return null;
      });
    }
    await enVuelo[semana];
    guardado = cache[semana];
  }

  if (!guardado) return { partidos: {}, porCerrar: [] };

  // Los que ESPN ya dio por terminados y aun no tienen marcador guardado.
  var porCerrar = [];
  partidos.forEach(function (p) {
    var v = guardado.partidos[p.id];
    if (!v || !v.completado) return;
    var r = resultados.partidos[p.id];
    if (r && r.final) return;
    porCerrar.push({
      id: p.id,
      marcadorLocal: v.local,
      marcadorVisitante: v.visitante,
      detalle: v.detalle || 'Final'
    });
  });

  return { partidos: guardado.partidos, porCerrar: porCerrar };
}

/**
 * Las semanas que podrian tener un partido corriendo ahorita. Sirve para que
 * el vigilante del servidor sepa a cuales asomarse sin recorrer las 18.
 */
function semanasEnJuego(calendario, resultados) {
  var ahora = reloj.milis();
  var vistas = {};
  calendario.partidos.forEach(function (p) {
    var arranco = Date.parse(p.inicio);
    if (ahora < arranco) return;
    if (ahora > arranco + DURA) {
      var r = resultados.partidos[p.id];
      if (r && r.final) return;      // ya paso y ya esta contado
    }
    vistas[p.semana] = true;
  });
  return Object.keys(vistas).map(Number);
}

/** Para las pruebas: dejar el cache limpio. */
function olvidar() {
  cache = {};
  enVuelo = {};
}

module.exports = {
  deLaSemana: deLaSemana,
  semanasEnJuego: semanasEnJuego,
  olvidar: olvidar,
  CADA: CADA
};
