/**
 * Prueba de punta a punta contra el servidor corriendo.
 *
 *   node servidor.js                              (en una terminal)
 *   node herramientas/prueba-de-punta-a-punta.js  (en otra)
 *
 * Recorre el camino completo: registro, candado por falta de pago, el
 * administrador registrando el deposito, la eleccion, la confirmacion
 * irreversible y —lo mas importante— que un partido ya iniciado se rechace
 * aunque la peticion venga a mano, sin pasar por la pantalla.
 */

'use strict';

var BASE = process.env.BASE || 'http://localhost:4400';
var fallas = 0;

function ok(condicion, texto, detalle) {
  console.log((condicion ? '  OK   ' : '  FALLA') + '  ' + texto + (detalle ? '  -> ' + detalle : ''));
  if (!condicion) fallas++;
}

async function pedir(ruta, opciones) {
  opciones = opciones || {};
  var r = await fetch(BASE + ruta, {
    method: opciones.cuerpo ? 'POST' : 'GET',
    headers: Object.assign(
      { 'Content-Type': 'application/json' },
      opciones.token ? { Authorization: 'Bearer ' + opciones.token } : {}
    ),
    body: opciones.cuerpo ? JSON.stringify(opciones.cuerpo) : undefined
  });
  var datos = await r.json().catch(function () { return {}; });
  return { estado: r.status, datos: datos };
}

async function main() {
  var config = require('../lib/configuracion').cargar();
  var sufijo = Date.now();
  var correo = 'prueba' + sufijo + '@ejemplo.mx';

  console.log('\nREGISTRO Y CANDADO POR PAGO');

  var reg = await pedir('/api/registro', {
    cuerpo: { nombre: 'Jugador De Prueba', correo: correo, telefono: '8110000001', contrasena: 'contrasena123' }
  });
  ok(reg.estado === 200 && reg.datos.token, 'se registra con nombre, correo y telefono');
  var jugador = reg.datos.token;
  var jugadorId = reg.datos.usuario.id;

  var malos = [
    [{ nombre: 'Solo', correo: 'malo1@ejemplo.mx', telefono: '8110000002', contrasena: 'contrasena123' }, 'nombre sin apellido'],
    [{ nombre: 'Nombre Apellido', correo: 'nada', telefono: '8110000002', contrasena: 'contrasena123' }, 'correo invalido'],
    [{ nombre: 'Nombre Apellido', correo: 'malo2@ejemplo.mx', telefono: '123', contrasena: 'contrasena123' }, 'telefono corto'],
    [{ nombre: 'Nombre Apellido', correo: 'malo3@ejemplo.mx', telefono: '8110000002', contrasena: '123' }, 'contrasena corta']
  ];
  for (var i = 0; i < malos.length; i++) {
    var r = await pedir('/api/registro', { cuerpo: malos[i][0] });
    ok(r.estado === 400, 'rechaza ' + malos[i][1]);
  }

  var repetido = await pedir('/api/registro', {
    cuerpo: { nombre: 'Otro Nombre', correo: correo, telefono: '8110000003', contrasena: 'contrasena123' }
  });
  ok(repetido.estado === 409, 'no deja registrar el mismo correo dos veces');

  var malaClave = await pedir('/api/entrar', { cuerpo: { correo: correo, contrasena: 'equivocada' } });
  ok(malaClave.estado === 401, 'rechaza contrasena equivocada');

  var estado = await pedir('/api/estado', { token: jugador });
  ok(estado.datos.pagos.total === 0, 'arranca en cero');
  ok(estado.datos.semanas.every(function (s) { return !s.pagada; }), 'ninguna semana abierta sin depositar');

  // Buscar una semana que siga abierta para poder probar de verdad.
  var viva = estado.datos.semanas.find(function (s) { return !s.cerrada; });
  ok(!!viva, 'hay al menos una semana viva', viva ? 'semana ' + viva.semana : 'ninguna');
  if (!viva) return terminar();

  var sem = await pedir('/api/semana?n=' + viva.semana, { token: jugador });
  var candidato = sem.datos.partidos.find(function (p) { return p.estado === 'abierto'; });
  ok(!!candidato, 'la semana viva tiene partidos abiertos');

  // Cada partido trae su propia hora limite, 30 min antes del suyo.
  ok(sem.datos.partidos.every(function (p) {
    return Date.parse(p.inicio) - Date.parse(p.cierre) === 30 * 60 * 1000;
  }), 'cada partido cierra 30 min antes del suyo, no del primero');

  var horas = new Set(sem.datos.partidos.map(function (p) { return p.cierre; }));
  ok(horas.size > 1, 'la jornada tiene varias horas de cierre, no una sola',
     horas.size + ' horas distintas');

  var sinPago = await pedir('/api/pick', {
    token: jugador, cuerpo: { partidoId: candidato.id, eleccion: 'local' }
  });
  ok(sinPago.estado === 403 && sinPago.datos.motivo === 'sin_pago',
     'CANDADO: sin deposito no se puede elegir', sinPago.datos.error);

  console.log('\nEL ADMINISTRADOR LIBERA');

  var adm = await pedir('/api/admin/entrar', { cuerpo: { contrasena: config.adminContrasena } });
  ok(adm.estado === 200, 'entra el administrador');
  var admin = adm.datos.token;

  ok((await pedir('/api/admin/entrar', { cuerpo: { contrasena: 'mala' } })).estado === 401,
     'rechaza contrasena de administrador equivocada');
  ok((await pedir('/api/admin/jugadores', { token: jugador })).estado === 401,
     'un jugador no puede entrar al panel de administracion');

  // Depositar justo lo necesario para la semana que estamos probando.
  var necesario = viva.semana <= config.semanasDePago
    ? viva.semana * config.cuotaSemanal
    : config.totalTemporada;

  var pago = await pedir('/api/admin/pago', {
    token: admin, cuerpo: { usuarioId: jugadorId, monto: necesario, nota: 'prueba automatica' }
  });
  ok(pago.estado === 200, 'registra el deposito de $' + necesario);

  var yo = pago.datos.jugadores.find(function (j) { return j.id === jugadorId; });
  ok(yo && yo.total === necesario, 'el total del jugador quedo en $' + necesario);
  ok(yo && yo.abiertas.indexOf(viva.semana) !== -1, 'la semana ' + viva.semana + ' quedo abierta');

  console.log('\nTABLERO DE QUIEN YA PAGO');

  // Se usa a otro jugador para no mover al de arriba a media prueba.
  var otro = await pedir('/api/registro', {
    cuerpo: { nombre: 'Tablero De Prueba', correo: 'tablero' + sufijo + '@ejemplo.mx',
              telefono: '8110000004', contrasena: 'contrasena123' }
  });
  var otroId = otro.datos.usuario.id;

  var m1 = await pedir('/api/admin/marcar-semana', {
    token: admin, cuerpo: { usuarioId: otroId, semana: 1 }
  });
  var t1 = m1.datos.jugadores.find(function (j) { return j.id === otroId; });
  ok(m1.estado === 200 && t1.total === config.cuotaSemanal,
     'marcar la semana 1 registra $' + config.cuotaSemanal);
  ok(t1.semanasCubiertas === 1, 'queda con una semana cubierta');

  // Picar la semana 5 de golpe cobra lo que falte para llegar ahi.
  var m5 = await pedir('/api/admin/marcar-semana', {
    token: admin, cuerpo: { usuarioId: otroId, semana: 5 }
  });
  var t5 = m5.datos.jugadores.find(function (j) { return j.id === otroId; });
  ok(t5.total === 5 * config.cuotaSemanal, 'marcar la semana 5 lo deja en $' + 5 * config.cuotaSemanal);
  ok(t5.semanasCubiertas === 5, 'y con cinco semanas cubiertas');
  ok(t5.abiertas.indexOf(5) !== -1 && t5.abiertas.indexOf(6) === -1,
     'sus semanas abiertas llegan a la 5 y no mas');

  var quitada = await pedir('/api/admin/marcar-semana', {
    token: admin, cuerpo: { usuarioId: otroId, semana: 5, pagada: false }
  });
  var t4 = quitada.datos.jugadores.find(function (j) { return j.id === otroId; });
  ok(t4.total === 4 * config.cuotaSemanal, 'desmarcar la 5 lo baja a $' + 4 * config.cuotaSemanal);

  ok((await pedir('/api/admin/marcar-semana', {
    token: admin, cuerpo: { usuarioId: otroId, semana: 4 }
  })).estado === 400, 'no vuelve a cobrar una semana ya pagada');

  ok((await pedir('/api/admin/marcar-semana', {
    token: admin, cuerpo: { usuarioId: otroId, semana: config.semanasDePago + 1 }
  })).estado === 400, 'no deja cobrar semanas que no se cobran');

  ok((await pedir('/api/admin/marcar-semana', {
    token: jugador, cuerpo: { usuarioId: otroId, semana: 6 }
  })).estado === 401, 'un jugador no puede marcarse pagos a si mismo');

  await pedir('/api/admin/jugador-borrar', {
    token: admin, cuerpo: { usuarioId: otroId, confirmacion: 'Tablero De Prueba' }
  });

  console.log('\nELEGIR Y CONFIRMAR');

  var pick = await pedir('/api/pick', {
    token: jugador, cuerpo: { partidoId: candidato.id, eleccion: 'local' }
  });
  ok(pick.estado === 200 && pick.datos.partido.pick.eleccion === 'local', 'ya puede elegir local');

  var cambio = await pedir('/api/pick', {
    token: jugador, cuerpo: { partidoId: candidato.id, eleccion: 'empate' }
  });
  ok(cambio.datos.partido.pick.eleccion === 'empate', 'puede cambiar a empate antes de confirmar');
  ok(cambio.datos.partido.puntosEmpate === cambio.datos.partido.puntos * config.multiplicadorEmpate,
     'el empate vale el doble de ese partido');

  ok((await pedir('/api/pick', {
    token: jugador, cuerpo: { partidoId: candidato.id, eleccion: 'ninguno' }
  })).estado === 400, 'solo acepta local, visitante o empate');

  var firma = await pedir('/api/confirmar', { token: jugador, cuerpo: { partidoId: candidato.id } });
  ok(firma.estado === 200 && firma.datos.partido.pick.confirmado === true, 'confirma el partido');
  ok(firma.datos.partido.editable === false, 'confirmado deja de ser editable');

  var despues = await pedir('/api/pick', {
    token: jugador, cuerpo: { partidoId: candidato.id, eleccion: 'visitante' }
  });
  ok(despues.estado === 403 && despues.datos.motivo === 'confirmado',
     'CANDADO: lo confirmado ya no se cambia', despues.datos.error);

  console.log('\nREGLA DE ORO');

  // Un partido que ya paso, en una semana que ya cerro.
  var calendario = require('../datos/calendario.json');
  var ahora = Date.now();
  var pasado = calendario.partidos.filter(function (p) { return Date.parse(p.inicio) < ahora; }).pop();

  if (pasado) {
    var intento = await pedir('/api/pick', {
      token: jugador, cuerpo: { partidoId: pasado.id, eleccion: 'local' }
    });
    ok(intento.estado === 403, 'REGLA DE ORO: rechaza un partido que ya inicio', intento.datos.error);
  } else {
    console.log('  ----   todavia no hay ningun partido iniciado en el calendario');
    console.log('         (la regla de oro se prueba a fondo en pruebas.js con relojes simulados)');
  }

  // Una semana futura que todavia no esta pagada.
  var futuraSinPago = estado.datos.semanas.find(function (s) {
    return !s.cerrada && s.semana > viva.semana;
  });
  if (futuraSinPago) {
    var f = await pedir('/api/semana?n=' + futuraSinPago.semana, { token: jugador });
    var pf = f.datos.partidos[0];
    var i2 = await pedir('/api/pick', { token: jugador, cuerpo: { partidoId: pf.id, eleccion: 'local' } });
    ok(i2.estado === 403 && i2.datos.motivo === 'sin_pago',
       'CANDADO: la semana ' + futuraSinPago.semana + ' sigue cerrada por pago');
  }

  console.log('\nPUNTOS Y TABLA');

  var admSem = await pedir('/api/admin/semana?n=' + viva.semana, { token: admin });
  var enOrden = admSem.datos.partidos;

  // La escalera del Excel: el 1o paga 25 y del 2o en adelante 10, 11, 12...
  var esperado = enOrden.map(function (p, i) {
    return i === 0 ? config.puntosPrimero : config.puntosArranque + (i - 1);
  });
  ok(JSON.stringify(enOrden.map(function (p) { return p.puntos; })) === JSON.stringify(esperado),
     'la semana ' + viva.semana + ' paga ' + esperado.join(', '));
  ok(enOrden[0].posicion === 1 && enOrden[enOrden.length - 1].posicion === enOrden.length,
     'cada partido sabe que lugar ocupa en la jornada');
  ok(enOrden[0].puntosEmpate === config.puntosPrimero * config.multiplicadorEmpate,
     'el empate del primero paga ' + config.puntosPrimero * config.multiplicadorEmpate);

  var objetivo = enOrden[0];
  var puestos = {};
  puestos[objetivo.id] = 40;
  var fijados = await pedir('/api/admin/puntos', {
    token: admin, cuerpo: { semana: viva.semana, puntos: puestos }
  });
  var yaConValor = fijados.datos.partidos.find(function (p) { return p.id === objetivo.id; });
  ok(yaConValor.puntos === 40, 'el administrador puede pisar el automatico');
  ok(yaConValor.automatico === config.puntosPrimero, 'y el automatico se sigue sabiendo');
  ok(yaConValor.personalizado === true, 'queda marcado como ajustado a mano');

  var devuelto = {};
  devuelto[objetivo.id] = null;
  var vuelta = await pedir('/api/admin/puntos', {
    token: admin, cuerpo: { semana: viva.semana, puntos: devuelto }
  });
  var yaAutomatico = vuelta.datos.partidos.find(function (p) { return p.id === objetivo.id; });
  ok(yaAutomatico.puntos === config.puntosPrimero && !yaAutomatico.personalizado,
     'y se puede regresar al automatico');

  ok((await pedir('/api/admin/puntos', {
    token: admin, cuerpo: { semana: viva.semana, puntos: { 'inventado': 9 } }
  })).estado === 200, 'ignora ids de partidos que no existen');

  var tabla = await pedir('/api/tabla', { token: jugador });
  ok(tabla.estado === 200 && Array.isArray(tabla.datos.tabla), 'la tabla responde');
  ok(tabla.datos.tabla.some(function (f) { return f.id === jugadorId; }), 'el jugador aparece en la tabla');

  console.log('\nSESIONES');
  ok((await pedir('/api/estado')).estado === 401, 'sin token no se ve nada');
  ok((await pedir('/api/estado', { token: 'inventado' })).estado === 401, 'un token falso no sirve');
  await pedir('/api/salir', { token: jugador, cuerpo: {} });
  ok((await pedir('/api/estado', { token: jugador })).estado === 401, 'al salir se cierra la sesion');

  console.log('\nCONTRASENA NUEVA (para el que la olvido)');

  var quienOlvido = await pedir('/api/registro', {
    cuerpo: { nombre: 'Olvidadizo De Prueba', correo: 'olvido' + sufijo + '@ejemplo.mx',
              telefono: '8110000005', contrasena: 'laqueolvide1' }
  });
  var olvidoId = quienOlvido.datos.usuario.id;
  var sesionVieja = quienOlvido.datos.token;
  ok((await pedir('/api/estado', { token: sesionVieja })).estado === 200,
     'entra con su contrasena original');

  ok((await pedir('/api/admin/clave-nueva', {
    token: admin, cuerpo: { usuarioId: olvidoId, contrasena: 'corta' }
  })).estado === 400, 'no acepta una contrasena de menos de 8 caracteres');

  ok((await pedir('/api/admin/clave-nueva', {
    token: sesionVieja, cuerpo: { usuarioId: olvidoId, contrasena: 'lanuevaclave1' }
  })).estado === 401, 'un jugador no se puede cambiar la contrasena solo');

  ok((await pedir('/api/admin/clave-nueva', {
    token: admin, cuerpo: { usuarioId: olvidoId, contrasena: 'lanuevaclave1' }
  })).estado === 200, 'el administrador si se la cambia');

  ok((await pedir('/api/entrar', {
    cuerpo: { correo: 'olvido' + sufijo + '@ejemplo.mx', contrasena: 'laqueolvide1' }
  })).estado === 401, 'la contrasena vieja ya no sirve');

  ok((await pedir('/api/entrar', {
    cuerpo: { correo: 'olvido' + sufijo + '@ejemplo.mx', contrasena: 'lanuevaclave1' }
  })).estado === 200, 'con la nueva si entra');

  ok((await pedir('/api/estado', { token: sesionVieja })).estado === 401,
     'la sesion que tenia abierta se cerro sola');

  // La que puso el administrador viene marcada como temporal: el jugador esta
  // obligado a cambiarla, y hasta entonces el administrador la sabe.
  var conTemporal = await pedir('/api/entrar', {
    cuerpo: { correo: 'olvido' + sufijo + '@ejemplo.mx', contrasena: 'lanuevaclave1' }
  });
  ok(conTemporal.datos.usuario.claveTemporal === true,
     'la que puso el administrador queda marcada como TEMPORAL');
  var tokenTemporal = conTemporal.datos.token;

  console.log('\nEL JUGADOR SE PONE LA SUYA');

  ok((await pedir('/api/mi-clave', {
    cuerpo: { actual: 'lanuevaclave1', nueva: 'lamiapropia1' }
  })).estado === 401, 'sin sesion no se puede cambiar nada');

  ok((await pedir('/api/mi-clave', {
    token: tokenTemporal, cuerpo: { actual: 'laequivocada', nueva: 'lamiapropia1' }
  })).estado === 401, 'hay que saber la de ahorita para cambiarla');

  ok((await pedir('/api/mi-clave', {
    token: tokenTemporal, cuerpo: { actual: 'lanuevaclave1', nueva: 'corta' }
  })).estado === 400, 'la nueva tampoco puede ser de menos de 8');

  ok((await pedir('/api/mi-clave', {
    token: tokenTemporal, cuerpo: { actual: 'lanuevaclave1', nueva: 'lanuevaclave1' }
  })).estado === 400, 'no deja poner la misma que ya tenia');

  var cambiada = await pedir('/api/mi-clave', {
    token: tokenTemporal, cuerpo: { actual: 'lanuevaclave1', nueva: 'lamiapropia1' }
  });
  ok(cambiada.estado === 200, 'el jugador se pone la suya');
  ok(cambiada.datos.usuario.claveTemporal === false, 'ya no esta marcada como temporal');
  ok(!!cambiada.datos.token && cambiada.datos.token !== tokenTemporal,
     'y recibe una sesion nueva');

  ok((await pedir('/api/entrar', {
    cuerpo: { correo: 'olvido' + sufijo + '@ejemplo.mx', contrasena: 'lanuevaclave1' }
  })).estado === 401, 'LA QUE SABIA EL ADMINISTRADOR YA NO SIRVE');

  ok((await pedir('/api/entrar', {
    cuerpo: { correo: 'olvido' + sufijo + '@ejemplo.mx', contrasena: 'lamiapropia1' }
  })).estado === 200, 'solo entra con la que se puso el jugador');

  ok((await pedir('/api/estado', { token: tokenTemporal })).estado === 401,
     'la sesion con la temporal tambien murio');

  var yaSinTemporal = (await pedir('/api/admin/jugadores', { token: admin }))
    .datos.jugadores.find(function (j) { return j.id === olvidoId; });
  ok(yaSinTemporal.claveTemporal === false,
     'el panel ya no lo marca con contrasena temporal');

  await pedir('/api/admin/jugador-borrar', {
    token: admin, cuerpo: { usuarioId: olvidoId, confirmacion: 'Olvidadizo De Prueba' }
  });

  console.log('\nLIMPIEZA');
  ok((await pedir('/api/admin/jugador-borrar', {
    token: admin, cuerpo: { usuarioId: jugadorId, confirmacion: 'nombre equivocado' }
  })).estado === 400, 'no borra a nadie sin escribir bien el nombre');

  var limpio = await pedir('/api/admin/jugador-borrar', {
    token: admin, cuerpo: { usuarioId: jugadorId, confirmacion: 'Jugador De Prueba' }
  });
  ok(limpio.estado === 200 &&
     !limpio.datos.jugadores.some(function (j) { return j.id === jugadorId; }),
     'la prueba borra su propia cuenta y no deja basura');

  terminar();
}

function terminar() {
  console.log('\n' + (fallas ? fallas + ' FALLAS' : 'Todo pasa.') + '\n');
  process.exit(fallas ? 1 : 0);
}

main().catch(function (e) {
  console.error('\nLa prueba se cayo:', e.message);
  console.error('Verifica que el servidor este corriendo en ' + BASE);
  process.exit(1);
});
