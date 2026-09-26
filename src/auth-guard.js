// Guard de sesión compartido — Fase 2.
//
// Antes, cada una de las ~14 páginas tenía su propia copia (ligeramente
// distinta) de "validarSesion/validarAcceso", y algunas (pos.js,
// cajero-pos.js) tapaban el problema de "el token expiró sin red para
// refrescarlo" con un booleano `adnova_session_offline` en localStorage
// que CUALQUIERA podía setear a mano desde la consola del navegador sin
// contraseña. Esto lo reemplaza por una sesión local respaldada por un
// hash de contraseña verificado (ver auth-local.js), con expiración.
const DURACION_SESION_LOCAL_MS = 16 * 60 * 60 * 1000; // 16h: cubre un turno largo + margen
const CLAVE_SESION_LOCAL = 'campo_alto_session';

function guardarSesionLocal(datos) {
  const sesion = { ...datos, expira_en: Date.now() + DURACION_SESION_LOCAL_MS };
  localStorage.setItem(CLAVE_SESION_LOCAL, JSON.stringify(sesion));
}

function leerSesionLocal() {
  try {
    const raw = localStorage.getItem(CLAVE_SESION_LOCAL);
    if (!raw) return null;
    const sesion = JSON.parse(raw);
    if (!sesion.expira_en || Date.now() > sesion.expira_en) {
      localStorage.removeItem(CLAVE_SESION_LOCAL);
      return null;
    }
    return sesion;
  } catch (e) {
    return null;
  }
}

function borrarSesionLocal() {
  localStorage.removeItem(CLAVE_SESION_LOCAL);
  localStorage.removeItem('adnova_session_offline'); // limpia el flag inseguro de versiones anteriores
}

// Devuelve { user_id, email, rol, nombre_completo } o null si no hay
// ninguna sesión (ni de Supabase ni local) vigente.
async function obtenerSesionActiva(supabase) {
  let session = null;
  try {
    const { data } = await supabase.auth.getSession();
    session = data?.session || null;
  } catch (e) {
    session = null;
  }

  if (session) {
    let perfil = null;

    if (navigator.onLine) {
      try {
        const { data, error } = await supabase
          .from('perfiles')
          .select('rol, nombre_completo')
          .eq('id', session.user.id)
          .single();
        if (!error) perfil = data;
      } catch (e) {
        // navigator.onLine dijo que sí pero la conexión falló de todos modos
      }
    }

    if (perfil) {
      await window.AuthLocal.actualizarPerfilLocal(session.user.id, {
        email: session.user.email,
        nombre_completo: perfil.nombre_completo,
        rol: perfil.rol,
      });
    } else {
      perfil = await window.AuthLocal.obtenerPerfilLocal(session.user.id);
    }

    const datos = {
      user_id: session.user.id,
      email: session.user.email,
      rol: perfil?.rol || null,
      nombre_completo: perfil?.nombre_completo || session.user.email,
    };
    guardarSesionLocal(datos);
    return datos;
  }

  // No hay sesión viva de Supabase (típicamente: sin red para refrescar el
  // token). Aceptar una sesión local vigente, creada por un login previo
  // (online u offline) que sí verificó la contraseña.
  return leerSesionLocal();
}

// options.rolPermitido: exige exactamente ese rol (deniega todo lo demás,
//   incluido perfil desconocido) — para páginas exclusivas de admin.
// options.rolExcluido: deniega exactamente ese rol, permite cualquier
//   otro — para páginas exclusivas de cajero/vendedor.
// options.redirectRolInvalido: página destino si el rol no corresponde.
// options.alertaRolInvalido: mensaje de alert() antes de redirigir
//   (algunas páginas de admin ya mostraban un aviso).
async function requireSession(supabase, options = {}) {
  const datos = await obtenerSesionActiva(supabase);

  if (!datos) {
    window.location.href = 'index.html';
    return null;
  }

  const rolInvalido =
    (options.rolPermitido && datos.rol !== options.rolPermitido) ||
    (options.rolExcluido && datos.rol === options.rolExcluido);

  if (rolInvalido) {
    if (options.alertaRolInvalido) alert(options.alertaRolInvalido);
    window.location.href = options.redirectRolInvalido || 'pos.html';
    return null;
  }

  return datos;
}

function cerrarSesion(supabase) {
  borrarSesionLocal();
  return supabase.auth.signOut().catch(() => {});
}

window.AuthGuard = {
  requireSession,
  obtenerSesionActiva,
  guardarSesionLocal,
  leerSesionLocal,
  borrarSesionLocal,
  cerrarSesion,
};
