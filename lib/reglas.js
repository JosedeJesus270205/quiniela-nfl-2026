/**
 * Las reglas de la quiniela. Todo lo que decide si algo se puede o no se puede
 * vive aqui, en funciones puras que reciben la hora como argumento. El servidor
 * siempre les pasa SU reloj, nunca el del navegador del jugador.
 *
 * Estas funciones son la autoridad. El navegador pinta candados para que se
 * entienda que pasa, pero el servidor vuelve a verificar cada una antes de
 * escribir un solo dato.
 */

'use strict';

var MINUTO = 60 * 1000;

var CONFIG = {
  cuotaSemanal: 100,        // pesos por semana
  semanasDePago: 15,        // se deposita de la semana 1 a la 15

  // El puntaje va por el LUGAR que ocupa el partido dentro de su semana, no
  // por la hora. El primero de la jornada paga 25; del segundo en adelante
  // arranca en 10 y sube de uno en uno: 10, 11, 12... hasta el ultimo.
  // Asi cada partido vale distinto y dos jugadores casi nunca empatan.
  puntosPrimero: 25,
  puntosArranque: 10,

  multiplicadorEmpate: 2,   // atinarle al empate paga doble
  minutosCierre: 30,        // cada partido cierra 30 min antes de SU inicio

  // Desde que semana el empate se decide al minuto 60 y no con la prorroga.
  // La regla se acordo con la semana 1 ya jugada; esa se queda contada como
  // se conto entonces, con el marcador final.
  empateTiempoNormalDesde: 2,
  zona: 'America/Mexico_City'
};

CONFIG.totalTemporada = CONFIG.cuotaSemanal * CONFIG.semanasDePago; // 1500

/** Las tres opciones posibles. No hay mas. */
var ELECCIONES = ['local', 'visitante', 'empate'];

// ---------------------------------------------------------------------------
// Tiempo y candados
// ---------------------------------------------------------------------------

/** Los partidos de una semana, ordenados por hora de inicio. */
function partidosDeSemana(calendario, semana) {
  return calendario.partidos
    .filter(function (p) { return p.semana === Number(semana); })
    .sort(function (a, b) { return a.inicio.localeCompare(b.inicio) || a.id.localeCompare(b.id); });
}

/** Todas las semanas que existen en el calendario, en orden. */
function semanas(calendario) {
  var vistas = {};
  calendario.partidos.forEach(function (p) { vistas[p.semana] = true; });
  return Object.keys(vistas).map(Number).sort(function (a, b) { return a - b; });
}

/**
 * El momento en que se cierra UN partido: 30 minutos antes de que ese partido
 * arranque. Cada uno tiene su propia hora limite, no la de la jornada.
 *
 * Asi, el que deposita el domingo a media tarde todavia alcanza los partidos
 * que faltan de esa semana; los que ya se jugaron, ni modo.
 */
function cierreDePartido(partido, config) {
  var minutos = (config || CONFIG).minutosCierre;
  return new Date(Date.parse(partido.inicio) - minutos * MINUTO);
}

/**
 * El proximo partido de la semana que esta por cerrar, con su hora. Es lo que
 * se enseña en la cuenta regresiva: "el que sigue cierra en tanto".
 * Devuelve null si ya cerraron todos.
 */
function proximoCierre(calendario, semana, ahora, config) {
  var pendientes = partidosDeSemana(calendario, semana)
    .map(function (p) { return { partido: p, cierre: cierreDePartido(p, config) }; })
    .filter(function (x) { return x.cierre.getTime() > ahora.getTime(); })
    .sort(function (a, b) { return a.cierre - b.cierre; });
  return pendientes.length ? pendientes[0] : null;
}

/** Ya cerraron todos los partidos de esa semana? */
function semanaCerrada(calendario, semana, ahora, config) {
  return proximoCierre(calendario, semana, ahora, config) === null;
}

/**
 * REGLA DE ORO: un partido que ya empezo no se puede elegir jamas.
 * Se evalua partido por partido, ademas de su propio cierre, para que ningun
 * cambio de horario de la NFL abra una rendija.
 */
function yaInicio(partido, ahora) {
  return ahora.getTime() >= Date.parse(partido.inicio);
}

/**
 * Estado de un partido para efectos de captura:
 *   'abierto'  -> se puede elegir y cambiar
 *   'cerrado'  -> faltan menos de 30 min para ESE partido
 *   'iniciado' -> ese partido ya arranco o ya paso
 */
function estadoDePartido(calendario, partido, ahora, config) {
  if (yaInicio(partido, ahora)) return 'iniciado';
  if (ahora.getTime() >= cierreDePartido(partido, config).getTime()) return 'cerrado';
  return 'abierto';
}

// ---------------------------------------------------------------------------
// Pagos
// ---------------------------------------------------------------------------

/** Lo que un jugador lleva depositado, en pesos. */
function totalPagado(pagos) {
  return (pagos || []).reduce(function (suma, p) { return suma + Number(p.monto || 0); }, 0);
}

/**
 * Cuantas semanas trae pagadas. No importa el orden ni en que fecha deposito:
 * cada 100 pesos vale por una semana. Quien mete 700 de golpe trae 7 semanas.
 */
function semanasCubiertas(pagos, config) {
  var c = config || CONFIG;
  return Math.floor(totalPagado(pagos) / c.cuotaSemanal);
}

/**
 * Tiene derecho este jugador a poner los partidos de esta semana?
 *
 *   Semanas 1 a 15  -> necesita tener cubierta esa semana (100 pesos por cada una).
 *   Semana 16 en adelante y eliminatorias -> ya no se deposita, pero solo entra
 *   quien completo los 1500. Al que le falto, se le queda lo que ya tiene.
 */
function semanaPagada(semana, pagos, config) {
  var c = config || CONFIG;
  var total = totalPagado(pagos);
  if (Number(semana) > c.semanasDePago) return total >= c.totalTemporada;
  return Number(semana) <= Math.floor(total / c.cuotaSemanal);
}

/** Lo que le falta depositar para abrir esa semana. 0 si ya la tiene. */
function faltaParaSemana(semana, pagos, config) {
  var c = config || CONFIG;
  var total = totalPagado(pagos);
  var necesario = Number(semana) > c.semanasDePago
    ? c.totalTemporada
    : Number(semana) * c.cuotaSemanal;
  return Math.max(0, necesario - total);
}

// ---------------------------------------------------------------------------
// Puntos
// ---------------------------------------------------------------------------

/**
 * Lo que vale un partido por el lugar que ocupa en su semana. `indice` va
 * desde 0 (el primero de la jornada).
 *
 *   partido 1  -> 25
 *   partido 2  -> 10
 *   partido 3  -> 11
 *   partido 4  -> 12   ... y asi hasta el ultimo de la semana
 *
 * El primero se lleva el premio gordo porque es el que hay que arriesgar con
 * menos informacion: cuando cierra, no se ha jugado nada de la jornada.
 */
function puntosPorPosicion(indice, config) {
  var c = config || CONFIG;
  if (indice <= 0) return c.puntosPrimero;
  return c.puntosArranque + (indice - 1);
}

/**
 * Resuelve lo que vale CADA partido del calendario, ya con los ajustes que el
 * administrador haya capturado a mano encima.
 *
 * Devuelve { partidoId: { valor, automatico, posicion, personalizado } }.
 * Se arma de un golpe para toda la temporada y se pasa a donde haga falta, en
 * vez de recalcular la posicion partido por partido.
 */
function tablaDePuntos(calendario, manuales, config) {
  var c = config || CONFIG;
  var tabla = {};

  semanas(calendario).forEach(function (n) {
    partidosDeSemana(calendario, n).forEach(function (p, i) {
      var automatico = puntosPorPosicion(i, c);
      var mano = manuales && manuales[p.id];
      var personalizado = Number.isFinite(Number(mano)) && Number(mano) > 0;
      tabla[p.id] = {
        valor: personalizado ? Number(mano) : automatico,
        automatico: automatico,
        posicion: i + 1,
        personalizado: personalizado
      };
    });
  });

  return tabla;
}

/** Lo que vale un partido, ya resuelto. Si no aparece, cae al primero. */
function puntosDePartido(partidoId, tabla, config) {
  var fila = tabla && tabla[partidoId];
  return fila ? fila.valor : (config || CONFIG).puntosPrimero;
}

/** Atinarle al empate paga el doble de lo que valga ese partido. */
function puntosSiAcierta(eleccion, valorPartido, config) {
  var c = config || CONFIG;
  return eleccion === 'empate' ? valorPartido * c.multiplicadorEmpate : valorPartido;
}

/**
 * Los dos partidos de la SEMANA 2 que se fueron a tiempo extra y que, por
 * acuerdo, cuentan con el marcador final y no con el del minuto 60.
 *
 * Por que la excepcion: la regla del minuto 60 se acordo apenas, y para la
 * semana 2 todavia no se le habia avisado al grupo. Nadie eligio empate en
 * esos dos partidos —se verifico contra los picks guardados, 0 de 18— asi
 * que contarlos por el minuto 60 dejaba en cero a gente que le habia atinado
 * al ganador sin saber que la regla ya corria.
 *
 * Es solo para estos dos. De la semana 3 en adelante manda el minuto 60.
 */
var CUENTAN_CON_FINAL = {
  '401872945': 'IND @ KC, semana 2 — 27-27 al 60, gano KC 33-30 en tiempo extra',
  '401872936': 'GB @ NYJ, semana 2 — 17-17 al 60, gano GB 20-17 en tiempo extra'
};

/**
 * Con que marcador se cuenta ESTE partido: 'final' o 'normal' (minuto 60).
 * Manda la excepcion; si no, lo que se haya guardado con el resultado.
 */
function cuentaDe(resultado, partidoId) {
  if (partidoId && CUENTAN_CON_FINAL[String(partidoId)]) return 'final';
  return resultado && resultado.cuenta === 'final' ? 'final' : 'normal';
}

/**
 * El marcador que decide la quiniela: el del TIEMPO NORMAL, al minuto 60.
 *
 * La prorroga no cuenta. Si al minuto 60 van empatados, el partido es empate
 * para la quiniela aunque alguien lo gane despues en tiempo extra. Ejemplo
 * real, semana 1 de 2026: NO 24-24 DET al minuto 60, Detroit gano 31-30 en
 * la prorroga. Para la quiniela: empate.
 *
 * Se usa el final cuando el resultado no trae `tiempoNormal` (guardado antes
 * de la regla) o cuando es de una semana anterior a la regla (`cuenta:
 * 'final'`, ver CONFIG.empateTiempoNormalDesde).
 */
function marcadorQueCuenta(resultado, partidoId) {
  if (resultado.tiempoNormal && cuentaDe(resultado, partidoId) !== 'final') {
    return { local: resultado.tiempoNormal.local, visitante: resultado.tiempoNormal.visitante };
  }
  return { local: resultado.marcadorLocal, visitante: resultado.marcadorVisitante };
}

/**
 * Con que marcador se cuenta un partido de esa semana: 'normal' (minuto 60)
 * desde la semana en que se acordo la regla, 'final' antes.
 */
function cuentaDeSemana(semana) {
  return Number(semana) >= CONFIG.empateTiempoNormalDesde ? 'normal' : 'final';
}

/**
 * El record de cada equipo en la temporada: ganados, perdidos y empatados.
 *
 * Es el record OFICIAL de la NFL, asi que sale del marcador final, prorroga
 * incluida. No tiene nada que ver con la regla de la quiniela del minuto 60:
 * NO @ DET 30-31 en prorroga es una victoria de Detroit en su record, aunque
 * para la quiniela haya contado distinto.
 *
 * Solo cuenta partidos con resultado final guardado, asi que es el record al
 * dia de hoy. Devuelve { SEA: { g, p, e }, ... }.
 */
function records(calendario, resultados) {
  var tabla = {};
  function de(abbr) {
    if (!tabla[abbr]) tabla[abbr] = { g: 0, p: 0, e: 0 };
    return tabla[abbr];
  }
  calendario.partidos.forEach(function (partido) {
    var r = resultados && resultados.partidos && resultados.partidos[partido.id];
    var casa = de(partido.local.abbr);
    var fuera = de(partido.visitante.abbr);
    if (!r || !r.final) return;
    if (r.marcadorLocal > r.marcadorVisitante) { casa.g++; fuera.p++; }
    else if (r.marcadorVisitante > r.marcadorLocal) { fuera.g++; casa.p++; }
    else { casa.e++; fuera.e++; }
  });
  return tabla;
}

/** "3-1", o "3-1-1" si tiene algun empate, como lo escribe la NFL. */
function textoRecord(rec) {
  if (!rec) return '0-0';
  return rec.g + '-' + rec.p + (rec.e ? '-' + rec.e : '');
}

/** Quien gano, en el mismo idioma que las elecciones del jugador. */
function ganadorDeResultado(resultado, partidoId) {
  if (!resultado || !resultado.final) return null;
  var m = marcadorQueCuenta(resultado, partidoId);
  if (m.local > m.visitante) return 'local';
  if (m.visitante > m.local) return 'visitante';
  return 'empate';
}

/**
 * Los puntos que se lleva un pick ya jugado. Un pick sin confirmar no cuenta:
 * confirmar es la firma del jugador.
 */
function puntosGanados(pick, partidoId, resultado, tabla, config) {
  if (!pick || !pick.confirmado) return 0;
  var ganador = ganadorDeResultado(resultado, partidoId);
  if (!ganador || ganador !== pick.eleccion) return 0;
  return puntosSiAcierta(pick.eleccion, puntosDePartido(partidoId, tabla, config), config);
}

// ---------------------------------------------------------------------------
// La pregunta que importa
// ---------------------------------------------------------------------------

/**
 * Puede este jugador tocar este partido ahora mismo? Devuelve el motivo exacto
 * cuando no, para poder decirselo con claridad en pantalla.
 */
function puedeElegir(opciones) {
  var calendario = opciones.calendario;
  var partido = opciones.partido;
  var ahora = opciones.ahora;
  var pagos = opciones.pagos;
  var pickActual = opciones.pick;
  var config = opciones.config || CONFIG;

  if (pickActual && pickActual.confirmado) {
    return { puede: false, motivo: 'confirmado' };
  }

  var estado = estadoDePartido(calendario, partido, ahora, config);
  if (estado === 'iniciado') return { puede: false, motivo: 'iniciado' };
  if (estado === 'cerrado') return { puede: false, motivo: 'cerrado' };

  if (!semanaPagada(partido.semana, pagos, config)) {
    return { puede: false, motivo: 'sin_pago', falta: faltaParaSemana(partido.semana, pagos, config) };
  }

  return { puede: true, motivo: null };
}

module.exports = {
  CONFIG: CONFIG,
  ELECCIONES: ELECCIONES,
  partidosDeSemana: partidosDeSemana,
  semanas: semanas,
  cierreDePartido: cierreDePartido,
  proximoCierre: proximoCierre,
  semanaCerrada: semanaCerrada,
  yaInicio: yaInicio,
  estadoDePartido: estadoDePartido,
  totalPagado: totalPagado,
  semanasCubiertas: semanasCubiertas,
  semanaPagada: semanaPagada,
  faltaParaSemana: faltaParaSemana,
  puntosPorPosicion: puntosPorPosicion,
  tablaDePuntos: tablaDePuntos,
  puntosDePartido: puntosDePartido,
  puntosSiAcierta: puntosSiAcierta,
  marcadorQueCuenta: marcadorQueCuenta,
  cuentaDe: cuentaDe,
  CUENTAN_CON_FINAL: CUENTAN_CON_FINAL,
  records: records,
  textoRecord: textoRecord,
  cuentaDeSemana: cuentaDeSemana,
  ganadorDeResultado: ganadorDeResultado,
  puntosGanados: puntosGanados,
  puedeElegir: puedeElegir
};
