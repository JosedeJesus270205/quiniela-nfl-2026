/**
 * Los dialogos de confirmar. Reemplazan a confirm() y prompt() del navegador,
 * que se ven distintos en cada sistema, no respetan el diseño y en algunos
 * navegadores ni siquiera aparecen.
 *
 * Se usan asi:
 *
 *   Dialogo.preguntar({ titulo: '...', texto: '...', ok: 'Confirmar' })
 *     .then(function (si) { if (si) ... });
 *
 *   Dialogo.pedirTexto({ titulo: '...', etiqueta: 'Nombre' })
 *     .then(function (escrito) { if (escrito !== null) ... });
 */

'use strict';

var Dialogo = (function () {

  var capa = null;
  var resolver = null;

  function cerrar(valor) {
    if (!capa) return;
    capa.remove();
    capa = null;
    document.removeEventListener('keydown', teclas);
    var r = resolver;
    resolver = null;
    if (r) r(valor);
  }

  function teclas(ev) {
    if (ev.key === 'Escape') cerrar(null);
    if (ev.key === 'Enter' && ev.target.tagName !== 'TEXTAREA') {
      var ok = capa && capa.querySelector('[data-ok]');
      if (ok) ok.click();
    }
  }

  function montar(opciones, cuerpo, alAceptar) {
    cerrar(null);

    capa = document.createElement('div');
    capa.className = 'capa-dialogo';
    capa.innerHTML =
      '<div class="dialogo" role="dialog" aria-modal="true">' +
        '<h3>' + opciones.titulo + '</h3>' +
        (opciones.texto ? '<p>' + opciones.texto + '</p>' : '') +
        cuerpo +
        '<div class="botones">' +
          '<button class="boton gris" data-cancelar>' + (opciones.cancelar || 'Cancelar') + '</button>' +
          '<button class="boton' + (opciones.peligro ? ' peligro' : opciones.verde ? ' verde' : '') +
            '" data-ok>' + (opciones.ok || 'Confirmar') + '</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(capa);

    capa.querySelector('[data-cancelar]').addEventListener('click', function () { cerrar(null); });
    capa.querySelector('[data-ok]').addEventListener('click', alAceptar);
    capa.addEventListener('click', function (ev) { if (ev.target === capa) cerrar(null); });
    document.addEventListener('keydown', teclas);

    var primero = capa.querySelector('input') || capa.querySelector('[data-ok]');
    if (primero) primero.focus();

    return new Promise(function (r) { resolver = r; });
  }

  return {
    /** Si o no. Resuelve true solo cuando el usuario acepta. */
    preguntar: function (opciones) {
      return montar(opciones, '', function () { cerrar(true); }).then(function (v) { return v === true; });
    },

    /**
     * Cambio de contrasena obligado: no se puede cancelar, ni con Escape ni
     * picando afuera. O la cambia, o se sale de la cuenta. Se usa cuando el
     * administrador puso una contrasena de emergencia.
     *
     * `alGuardar(actual, nueva)` tiene que devolver una promesa.
     */
    cambioObligado: function (opciones) {
      cerrar(null);

      capa = document.createElement('div');
      capa.className = 'capa-dialogo';
      capa.innerHTML =
        '<div class="dialogo" role="dialog" aria-modal="true">' +
          '<h3>' + opciones.titulo + '</h3>' +
          '<p>' + opciones.texto + '</p>' +
          '<div class="error-caja" data-error hidden></div>' +
          '<div class="campo">' +
            '<label for="dlg-actual">La contraseña que te dieron</label>' +
            '<input type="password" id="dlg-actual" autocomplete="current-password">' +
          '</div>' +
          '<div class="campo">' +
            '<label for="dlg-nueva">Tu contraseña nueva</label>' +
            '<input type="password" id="dlg-nueva" autocomplete="new-password">' +
            '<div class="ayuda">Mínimo 8 caracteres.</div>' +
          '</div>' +
          '<div class="campo">' +
            '<label for="dlg-repetir">Repítela</label>' +
            '<input type="password" id="dlg-repetir" autocomplete="new-password">' +
          '</div>' +
          '<div class="botones">' +
            '<button class="boton" data-ok>Guardar y entrar</button>' +
          '</div>' +
        '</div>';

      document.body.appendChild(capa);
      capa.querySelector('#dlg-actual').focus();

      var error = capa.querySelector('[data-error]');
      var boton = capa.querySelector('[data-ok]');

      function mostrar(mensaje) {
        error.textContent = mensaje;
        error.hidden = false;
        boton.disabled = false;
        boton.textContent = 'Guardar y entrar';
      }

      boton.addEventListener('click', function () {
        var actual = capa.querySelector('#dlg-actual').value;
        var nueva = capa.querySelector('#dlg-nueva').value;
        var repetir = capa.querySelector('#dlg-repetir').value;

        if (nueva !== repetir) return mostrar('Las dos contraseñas nuevas no son iguales.');
        if (nueva.length < 8) return mostrar('La contraseña necesita al menos 8 caracteres.');

        error.hidden = true;
        boton.disabled = true;
        boton.textContent = 'Guardando…';

        opciones.alGuardar(actual, nueva)
          .then(function () { cerrar(true); })
          .catch(function (e) { mostrar(e.message); });
      });

      // Enter guarda; Escape no cierra nada a proposito.
      capa.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') { ev.preventDefault(); boton.click(); }
      });

      return new Promise(function (r) { resolver = r; });
    },

    /**
     * Pide escribir algo. Resuelve con el texto, o null si se cancela.
     * Se usa para las confirmaciones de lo que no se puede deshacer.
     */
    pedirTexto: function (opciones) {
      var cuerpo =
        '<div class="campo">' +
          (opciones.etiqueta ? '<label for="dlg-texto">' + opciones.etiqueta + '</label>' : '') +
          '<input type="text" id="dlg-texto" autocomplete="off"' +
          (opciones.marcador ? ' placeholder="' + opciones.marcador + '"' : '') + '>' +
        '</div>';
      return montar(opciones, cuerpo, function () {
        cerrar(capa.querySelector('#dlg-texto').value);
      });
    }
  };

})();
