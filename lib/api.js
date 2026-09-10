/**
 * Los endpoints. Cada uno vuelve a verificar las reglas contra el reloj del
 * servidor antes de escribir: lo que diga el navegador es una peticion, no un
 * permiso. Si alguien manda un pick a mano con curl para un partido que ya
 * empezo, aqui se rechaza igual.
 */

'use strict';

var fs = require('fs');
var path = require('path');
var almacen = require('./almacen');
var reglas = require('./reglas');
var configuracion = require('./configuracion');
var vivo = require('./vivo');
var reloj = require('./reloj');

// Que fotos de estadio si tenemos en disco. Los estadios internacionales
// (Melbourne, Sao Paulo, Madrid) no siempre traen foto en ESPN; para esos la
// pantalla arma un fondo con los colores de los dos equipos en lugar de dejar
// un hueco negro.
var FOTOS = null;

function hayFoto(sedeId) {
  if (!FOTOS) {
    try {
      FOTOS = new Set(fs.readdirSync(path.join(__dirname, '..', 'publico', 'img', 'estadios'))
        .map(function (f) { return f.replace(/\.jpg$/i, ''); }));
    } catch (e) {
      FOTOS = new Set();
    }
  }
  return !!sedeId && FOTOS.has(String(sedeId));
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function error(codigo, mensaje, extra) {
  var e = new Error(mensaje);
  e.codigo = codigo;
  e.extra = extra || null;
  return e;
}

function exigirSesion(ctx) {
  var u = almacen.sesion(ctx.token);
  if (!u || u.admin) throw error(401, 'Necesitas entrar a tu cuenta.');
  return u;
}

function exigirAdmin(ctx) {
  var u = almacen.sesion(ctx.token);
  if (!u || !u.admin) throw error(401, 'Necesitas entrar como administrador.');
  return u;
}

var CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function validarRegistro(cuerpo) {
  var nombre = String(cuerpo.nombre || '').trim().replace(/\s+/g, ' ');
  var correo = almacen.normalizarCorreo(cuerpo.correo);
  var telefono = String(cuerpo.telefono || '').replace(/[^\d]/g, '');
  var contrasena = String(cuerpo.contrasena || '');

  if (nombre.split(' ').length < 2 || nombre.length < 5) {
    throw error(400, 'Escribe tu nombre completo, con apellido.');
  }
  if (!CORREO.test(correo)) throw error(400, 'Ese correo no se ve bien.');
  if (telefono.length !== 10) throw error(400, 'El telefono va a 10 digitos, sin espacios.');
  if (contrasena.length < 8) throw error(400, 'La contrasena necesita al menos 8 caracteres.');

  return { nombre: nombre, correo: correo, telefono: telefono, contrasena: contrasena };
}

// ---------------------------------------------------------------------------
// Armado de la vista de una semana
// ---------------------------------------------------------------------------

/**
 * Arma un partido tal como lo va a ver el jugador: con su estado real, el
 * motivo del candado si lo hay, lo que vale y, si ya se jugo, el marcador.
 */
function verPartido(partido, contexto) {
  var ahora = contexto.ahora;
  var pick = contexto.picks[partido.id] || null;
  var fila = contexto.puntos[partido.id] || {};
  var valor = reglas.puntosDePartido(partido.id, contexto.puntos, contexto.config);
  var resultado = contexto.resultados.partidos[partido.id] || null;
  var estado = reglas.estadoDePartido(contexto.calendario, partido, ahora, contexto.config);

  var permiso = reglas.puedeElegir({
    calendario: contexto.calendario,
    partido: partido,
    ahora: ahora,
    pagos: contexto.pagos,
    pick: pick,
    config: contexto.config
  });

  // El marcador en vivo, si es que este partido esta corriendo. Un partido que
  // ya termino no va aqui: ese se enseña con su resultado final.
  var v = contexto.vivo && contexto.vivo[partido.id];
  var enVivo = v && v.estado === 'in'
    ? { local: v.local, visitante: v.visitante, detalle: v.detalle || '' }
    : null;

  return {
    id: partido.id,
    semana: partido.semana,
    inicio: partido.inicio,
    // ESPN pone medianoche de relleno cuando la NFL no ha definido el horario.
    // La pantalla lo dice en lugar de inventar una hora.
    horaConfirmada: partido.horaConfirmada !== false,
    neutral: !!partido.neutral,
    techo: !!partido.techo,
    sede: partido.sede,
    sedeId: hayFoto(partido.sedeId) ? partido.sedeId : null,
    ciudad: partido.ciudad,
    local: partido.local,
    visitante: partido.visitante,
    puntos: valor,
    puntosEmpate: valor * contexto.config.multiplicadorEmpate,
    posicion: fila.posicion || null,
    puntosAMano: !!fila.personalizado,
    cierre: reglas.cierreDePartido(partido, contexto.config).toISOString(),
    estado: estado,
    editable: permiso.puede,
    bloqueo: permiso.motivo,
    falta: permiso.falta || 0,
    pick: pick ? { eleccion: pick.eleccion, confirmado: !!pick.confirmado } : null,
    resultado: resultado && resultado.final ? {
      local: resultado.marcadorLocal,
      visitante: resultado.marcadorVisitante,
      ganador: reglas.ganadorDeResultado(resultado)
    } : null,
    // Como va el partido AHORITA. Solo sale cuando esta corriendo; antes del
    // silbatazo no se enseña nada. Esto no da ni quita puntos: los puntos
    // salen del resultado final, que es otro campo.
    vivo: enVivo,
    ganados: reglas.puntosGanados(pick, partido.id, resultado, contexto.puntos, contexto.config)
  };
}

function contextoDe(usuario, ahora, enVivo) {
  var config = configuracion.cargar();
  var calendario = almacen.calendario();
  return {
    config: config,
    ahora: ahora || reloj.ahora(),
    calendario: calendario,
    resultados: almacen.resultados(),
    vivo: enVivo || null,
    // Lo que vale cada partido, ya resuelto: la escalera por posicion mas los
    // ajustes que el administrador haya puesto a mano.
    puntos: reglas.tablaDePuntos(calendario, almacen.puntos(), config),
    pagos: usuario ? almacen.pagosDe(usuario.id) : [],
    picks: usuario ? almacen.picksDe(usuario.id) : {}
  };
}

/** El resumen de cada semana: si esta pagada, cuando cierra y como va. */
function resumenSemanas(ctx) {
  return reglas.semanas(ctx.calendario).map(function (n) {
    var siguiente = reglas.proximoCierre(ctx.calendario, n, ctx.ahora, ctx.config);
    var juegos = reglas.partidosDeSemana(ctx.calendario, n);
    var elegidos = 0;
    var confirmados = 0;
    var abiertos = 0;
    juegos.forEach(function (p) {
      var pick = ctx.picks[p.id];
      if (pick) elegidos++;
      if (pick && pick.confirmado) confirmados++;
      if (reglas.estadoDePartido(ctx.calendario, p, ctx.ahora, ctx.config) === 'abierto') abiertos++;
    });
    return {
      semana: n,
      partidos: juegos.length,
      // El proximo partido de la jornada que cierra, no la jornada entera.
      cierre: siguiente ? siguiente.cierre.toISOString() : null,
      cerrada: !siguiente,
      pagada: reglas.semanaPagada(n, ctx.pagos, ctx.config),
      falta: reglas.faltaParaSemana(n, ctx.pagos, ctx.config),
      requierePago: n <= ctx.config.semanasDePago,
      elegidos: elegidos,
      confirmados: confirmados,
      abiertos: abiertos
    };
  });
}

/** La semana que conviene mostrar al abrir: la primera que sigue viva. */
function semanaSugerida(resumen) {
  var viva = resumen.find(function (s) { return !s.cerrada; });
  return viva ? viva.semana : (resumen.length ? resumen[resumen.length - 1].semana : 1);
}

// ---------------------------------------------------------------------------
// Cuenta
// ---------------------------------------------------------------------------

/**
 * Lo unico que se puede preguntar sin haber entrado: en que estamos parados.
 * Sirve para que la cinta de "modo ensayo" salga desde la pantalla de acceso,
 * que es justo donde mas falta hace no confundirse de servidor.
 */
function ambiente() {
  return {
    ensayo: reloj.esEnsayo(),
    ahora: reloj.ahora().toISOString(),
    temporada: almacen.calendario().temporada
  };
}

function registro(ctx) {
  var datos = validarRegistro(ctx.cuerpo);
  if (almacen.buscarPorCorreo(datos.correo)) {
    throw error(409, 'Ese correo ya esta registrado. Entra con tu contrasena.');
  }
  var usuario = almacen.crearUsuario(datos);
  return { token: almacen.abrirSesion(usuario.id), usuario: almacen.publico(usuario) };
}

function entrar(ctx) {
  var usuario = almacen.buscarPorCorreo(ctx.cuerpo.correo);
  // Mismo mensaje para correo inexistente y contrasena mala: no confirmamos
  // quien esta registrado y quien no.
  if (!usuario || !almacen.contrasenaCorrecta(ctx.cuerpo.contrasena, usuario)) {
    // En el ensayo si conviene ayudar: el mismo correo suele existir en la
    // quiniela de verdad con otra contrasena, y es facilisimo confundirse.
    if (reloj.esEnsayo()) {
      throw error(401, 'Correo o contrasena incorrectos. Ojo: estas en el ENSAYO, ' +
                       'y aqui la contrasena de todos es "ensayo123".');
    }
    throw error(401, 'Correo o contrasena incorrectos.');
  }
  return { token: almacen.abrirSesion(usuario.id), usuario: almacen.publico(usuario) };
}

function salir(ctx) {
  almacen.cerrarSesion(ctx.token);
  return { ok: true };
}

/**
 * El jugador se cambia su propia contrasena. Pide la que trae puesta, asi que
 * nadie que se siente frente a una sesion abierta puede secuestrar la cuenta.
 *
 * Cuando termina se cierran TODAS las sesiones —incluida esta— y se entrega un
 * token nuevo. Es lo que hace que la contrasena de emergencia que puso el
 * administrador deje de servirle a nadie, ni a el.
 */
function cambiarMiClave(ctx) {
  var usuario = exigirSesion(ctx);
  var completo = almacen.buscarPorId(usuario.id);

  if (!almacen.contrasenaCorrecta(ctx.cuerpo.actual, completo)) {
    throw error(401, 'Esa no es tu contrasena de ahorita.');
  }

  var nueva = String(ctx.cuerpo.nueva || '');
  if (nueva.length < 8) throw error(400, 'La contrasena necesita al menos 8 caracteres.');
  if (nueva === String(ctx.cuerpo.actual)) {
    throw error(400, 'Esa es la misma de antes. Ponte una distinta.');
  }

  almacen.cambiarContrasena(usuario.id, nueva, false);

  return {
    token: almacen.abrirSesion(usuario.id),
    usuario: almacen.publico(almacen.buscarPorId(usuario.id))
  };
}

/** Todo lo que necesita la pantalla principal en una sola llamada. */
function estado(ctx) {
  var usuario = exigirSesion(ctx);
  var c = contextoDe(usuario);
  var resumen = resumenSemanas(c);
  var total = reglas.totalPagado(c.pagos);

  return {
    usuario: almacen.publico(usuario),
    config: configuracion.publica(),
    temporada: c.calendario.temporada,
    ensayo: reloj.esEnsayo(),
    ahora: c.ahora.toISOString(),
    pagos: {
      total: total,
      semanasCubiertas: reglas.semanasCubiertas(c.pagos, c.config),
      falta: Math.max(0, c.config.totalTemporada - total),
      movimientos: c.pagos.slice().sort(function (a, b) { return b.fecha.localeCompare(a.fecha); })
    },
    semanas: resumen,
    semanaSugerida: semanaSugerida(resumen)
  };
}

// ---------------------------------------------------------------------------
// Partidos y picks
// ---------------------------------------------------------------------------

/**
 * Se asoma al marcador en vivo de una semana y, de paso, guarda como finales
 * los partidos que ESPN ya dio por terminados.
 *
 * Que los resultados entren solos es a proposito: si el sistema ya sabe que el
 * partido acabo 24-17, no tiene caso que la tabla se quede congelada hasta que
 * el administrador se acuerde de picar un boton. El boton del panel sigue ahi
 * para forzar una recarga cuando haga falta.
 *
 * Solo se guarda lo que ESPN marca como TERMINADO. Un marcador a media tarde
 * no se escribe nunca.
 */
async function alDia(calendario, semana) {
  var estado = await vivo.deLaSemana(
    calendario.temporada, semana,
    reglas.partidosDeSemana(calendario, semana),
    almacen.resultados()
  );

  if (estado.porCerrar.length) {
    var res = almacen.resultados();
    estado.porCerrar.forEach(function (p) {
      res.partidos[p.id] = {
        final: true,
        marcadorLocal: p.marcadorLocal,
        marcadorVisitante: p.marcadorVisitante,
        detalle: p.detalle
      };
    });
    res.actualizado = reloj.sello();
    almacen.guardarResultados(res);
  }

  return estado.partidos;
}

async function semana(ctx) {
  var usuario = exigirSesion(ctx);
  var n = Number(ctx.consulta.n);
  var calendario = almacen.calendario();
  var juegos = reglas.partidosDeSemana(calendario, n);
  if (!juegos.length) throw error(404, 'No hay partidos en la semana ' + n + '.');

  // Primero el vivo: puede cerrar partidos, y el contexto tiene que armarse
  // ya con esos marcadores guardados para que los puntos salgan al momento.
  var mapaVivo = await alDia(calendario, n);
  var c = contextoDe(usuario, null, mapaVivo);

  var siguiente = reglas.proximoCierre(c.calendario, n, c.ahora, c.config);

  return {
    semana: n,
    ahora: c.ahora.toISOString(),
    // Cada partido trae su propio cierre; esto es el del proximo en cerrar.
    cierre: siguiente ? siguiente.cierre.toISOString() : null,
    cierraPartido: siguiente
      ? siguiente.partido.visitante.abbr + ' @ ' + siguiente.partido.local.abbr
      : null,
    cerrada: !siguiente,
    pagada: reglas.semanaPagada(n, c.pagos, c.config),
    falta: reglas.faltaParaSemana(n, c.pagos, c.config),
    requierePago: n <= c.config.semanasDePago,
    // Si hay algo corriendo, la pantalla se vuelve a pedir sola cada tanto.
    refrescar: juegos.some(function (p) { return !!(mapaVivo && mapaVivo[p.id] && mapaVivo[p.id].estado === 'in'); })
      ? vivo.CADA : 0,
    partidos: juegos.map(function (p) { return verPartido(p, c); })
  };
}

/** Encuentra el partido y verifica, otra vez, que se pueda tocar. */
function partidoEditable(usuario, partidoId) {
  var c = contextoDe(usuario);
  var partido = c.calendario.partidos.find(function (p) { return p.id === String(partidoId); });
  if (!partido) throw error(404, 'Ese partido no existe.');

  var permiso = reglas.puedeElegir({
    calendario: c.calendario,
    partido: partido,
    ahora: c.ahora,
    pagos: c.pagos,
    pick: c.picks[partido.id],
    config: c.config
  });

  if (!permiso.puede) {
    var mensajes = {
      iniciado: 'Ese partido ya empezo. Ya no se puede tocar.',
      cerrado: 'La semana ' + partido.semana + ' ya cerro.',
      confirmado: 'Ya confirmaste ese partido. No se puede cambiar.',
      sin_pago: 'Todavia no tienes cubierta la semana ' + partido.semana +
                '. Faltan $' + permiso.falta + '.'
    };
    throw error(403, mensajes[permiso.motivo] || 'Ese partido esta bloqueado.', { motivo: permiso.motivo });
  }

  return { partido: partido, contexto: c };
}

function guardarPick(ctx) {
  var usuario = exigirSesion(ctx);
  var eleccion = String(ctx.cuerpo.eleccion || '');
  if (reglas.ELECCIONES.indexOf(eleccion) === -1) {
    throw error(400, 'Solo puedes elegir local, visitante o empate.');
  }
  var r = partidoEditable(usuario, ctx.cuerpo.partidoId);
  almacen.guardarPick(usuario.id, r.partido.id, eleccion);
  return { partido: verPartido(r.partido, contextoDe(usuario, r.contexto.ahora)) };
}

function quitarPick(ctx) {
  var usuario = exigirSesion(ctx);
  var r = partidoEditable(usuario, ctx.cuerpo.partidoId);
  almacen.borrarPick(usuario.id, r.partido.id);
  return { partido: verPartido(r.partido, contextoDe(usuario, r.contexto.ahora)) };
}

/**
 * Confirmar es irreversible a proposito: es la firma del jugador sobre ese
 * partido. Se puede confirmar uno solo, o de golpe todos los que ya tengan
 * eleccion en una semana.
 */
function confirmar(ctx) {
  var usuario = exigirSesion(ctx);

  if (ctx.cuerpo.partidoId) {
    var r = partidoEditable(usuario, ctx.cuerpo.partidoId);
    var picks = almacen.picksDe(usuario.id);
    if (!picks[r.partido.id]) throw error(400, 'Primero elige quien gana.');
    almacen.confirmarPick(usuario.id, r.partido.id);
    return { partido: verPartido(r.partido, contextoDe(usuario, r.contexto.ahora)) };
  }

  var n = Number(ctx.cuerpo.semana);
  var c = contextoDe(usuario);
  var juegos = reglas.partidosDeSemana(c.calendario, n);
  var hechos = [];
  var saltados = 0;

  juegos.forEach(function (p) {
    var pick = c.picks[p.id];
    if (!pick || pick.confirmado) return;
    var permiso = reglas.puedeElegir({
      calendario: c.calendario, partido: p, ahora: c.ahora,
      pagos: c.pagos, pick: pick, config: c.config
    });
    if (!permiso.puede) { saltados++; return; }
    almacen.confirmarPick(usuario.id, p.id);
    hechos.push(p.id);
  });

  if (!hechos.length && !saltados) throw error(400, 'No tienes partidos pendientes de confirmar.');

  var despues = contextoDe(usuario, c.ahora);
  return {
    confirmados: hechos.length,
    saltados: saltados,
    partidos: juegos.map(function (p) { return verPartido(p, despues); })
  };
}

// ---------------------------------------------------------------------------
// Tabla de posiciones
// ---------------------------------------------------------------------------

/**
 * La tabla general y, semana por semana, quien gano esa jornada.
 *
 * La jornada corre de jueves a martes. Un partido en miercoles pertenece a la
 * jornada que arranca al dia siguiente — que es exactamente como la NFL numera
 * sus semanas, asi que el numero de semana del calendario ya sirve tal cual.
 * (Los dos unicos partidos de miercoles de 2026, el inaugural y la vispera de
 * Thanksgiving, caen donde deben con esta regla.)
 *
 * Solo compite en una semana quien tenga picks confirmados en ella: al que no
 * pago o no alcanzo a firmar no se le cuenta como que perdio, simplemente no
 * estuvo.
 */
function tabla(ctx) {
  exigirSesion(ctx);
  var config = configuracion.cargar();
  var calendario = almacen.calendario();
  var res = almacen.resultados();
  var puntos = reglas.tablaDePuntos(calendario, almacen.puntos(), config);
  var db = almacen.cargar();

  var gente = db.usuarios.map(function (u) {
    return { u: u, picks: almacen.picksDe(u.id), pagos: almacen.pagosDe(u.id) };
  });

  /** Lo que hizo cada quien en un puñado de partidos ya terminados. */
  function cuenta(terminados) {
    return gente.map(function (j) {
      var total = 0, aciertos = 0, jugados = 0, empates = 0;
      terminados.forEach(function (p) {
        var pick = j.picks[p.id];
        if (!pick || !pick.confirmado) return;
        jugados++;
        var g = reglas.puntosGanados(pick, p.id, res.partidos[p.id], puntos, config);
        if (g > 0) {
          aciertos++;
          total += g;
          if (pick.eleccion === 'empate') empates++;
        }
      });
      return {
        id: j.u.id, nombre: j.u.nombre,
        puntos: total, aciertos: aciertos, jugados: jugados, empates: empates
      };
    });
  }

  function ordenar(filas) {
    filas.sort(function (a, b) {
      return b.puntos - a.puntos || b.aciertos - a.aciertos || a.nombre.localeCompare(b.nombre);
    });
    filas.forEach(function (f, i) { f.lugar = i + 1; });
    return filas;
  }

  // --- Jornada por jornada ---
  var semanas = [];

  reglas.semanas(calendario).forEach(function (n) {
    var juegos = reglas.partidosDeSemana(calendario, n);
    var terminados = juegos.filter(function (p) {
      var r = res.partidos[p.id];
      return r && r.final;
    });
    if (!terminados.length) return;   // esa jornada todavia no arranca

    var filas = ordenar(cuenta(terminados).filter(function (f) { return f.jugados > 0; }));
    var mejor = filas.length ? filas[0].puntos : 0;
    var ganadores = mejor > 0
      ? filas.filter(function (f) { return f.puntos === mejor; })
      : [];

    semanas.push({
      semana: n,
      partidos: juegos.length,
      terminados: terminados.length,
      completa: terminados.length === juegos.length,
      // Puede haber empate arriba: se reparten la semana.
      ganadores: ganadores.map(function (g) {
        return { id: g.id, nombre: g.nombre, puntos: g.puntos, aciertos: g.aciertos };
      }),
      tabla: filas
    });
  });

  // --- La general, sobre toda la temporada ---
  var jugados = calendario.partidos.filter(function (p) {
    var r = res.partidos[p.id];
    return r && r.final;
  });

  // La tabla general la ve toda la quiniela, asi que trae lo justo: nombre,
  // puntos y aciertos. Fuera de aqui quedan dos cosas a proposito:
  //
  //   - Cuanto lleva depositado cada quien. Es asunto suyo y del
  //     administrador. Cada jugador ve el suyo en Mi cuenta.
  //   - Cuantas jornadas lleva ganadas. Mientras la semana no termina el
  //     numero es provisional y se presta a confusion; quien va ganando cada
  //     jornada se ve abajo, en su propia seccion, con el "x de y partidos".
  //
  // Ninguno de los dos se manda al navegador. Esconderlos en pantalla no
  // bastaria: el dato seguiria viajando y se leeria con dos clics.
  var general = ordenar(cuenta(jugados));

  return {
    actualizado: res.actualizado,
    tabla: general,
    // De la mas reciente hacia atras: es la que interesa ver primero.
    semanas: semanas.reverse()
  };
}

module.exports = {
  alDia: alDia,
  error: error,
  exigirSesion: exigirSesion,
  exigirAdmin: exigirAdmin,
  contextoDe: contextoDe,
  verPartido: verPartido,
  resumenSemanas: resumenSemanas,
  ambiente: ambiente,
  registro: registro,
  entrar: entrar,
  salir: salir,
  cambiarMiClave: cambiarMiClave,
  estado: estado,
  semana: semana,
  guardarPick: guardarPick,
  quitarPick: quitarPick,
  confirmar: confirmar,
  tabla: tabla
};
