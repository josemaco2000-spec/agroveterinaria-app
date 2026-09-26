// Capa de autenticación local (offline) — Fase 2.
//
// Modelo de seguridad: esta laptop nunca tiene internet en el local, así
// que Supabase Auth no puede validar contraseñas cuando no hay red. En
// vez de eso, cada vez que un login ONLINE es exitoso, guardamos acá un
// hash (PBKDF2-SHA256, salteado por usuario) de la contraseña que se
// escribió, para poder validar esa misma contraseña sin red la próxima
// vez. Nunca se guarda ni se transmite la contraseña en texto plano, y
// nunca se cachean credenciales de usuarios que no hayan iniciado sesión
// en este dispositivo — no se replica la tabla de usuarios completa.
const PBKDF2_ITERATIONS = 100000;

function bufferToHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBuffer(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

function generarSaltHex() {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return bufferToHex(salt);
}

async function derivarHash(secreto, saltHex) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(secreto), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: hexToBuffer(saltHex), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return bufferToHex(bits);
}

// Guarda/actualiza en IndexedDB el hash de la contraseña (y del PIN, si se
// pasa) del usuario que acaba de autenticarse con éxito contra Supabase.
async function cachearCredenciales({ user_id, email, nombre_completo, rol, password, pin }) {
  const existente = await window.CampoAltoDB.usuarios_cache.get(user_id);

  const registro = {
    user_id,
    email,
    nombre_completo,
    rol,
    pass_salt: existente?.pass_salt || generarSaltHex(),
    pin_salt: existente?.pin_salt || generarSaltHex(),
    pass_hash: existente?.pass_hash || null,
    pin_hash: existente?.pin_hash || null,
    actualizado_en: new Date().toISOString(),
  };

  if (password) {
    registro.pass_hash = await derivarHash(password, registro.pass_salt);
  }
  if (pin) {
    registro.pin_hash = await derivarHash(pin, registro.pin_salt);
  }

  await window.CampoAltoDB.usuarios_cache.put(registro);
}

// Solo actualiza rol/nombre (p.ej. al refrescar el guard con red), sin
// tocar los hashes de contraseña/PIN ya guardados.
async function actualizarPerfilLocal(user_id, { email, nombre_completo, rol }) {
  const existente = await window.CampoAltoDB.usuarios_cache.get(user_id);
  if (!existente) return; // no cachear perfiles de usuarios que nunca hicieron login local aquí
  await window.CampoAltoDB.usuarios_cache.update(user_id, { email, nombre_completo, rol, actualizado_en: new Date().toISOString() });
}

async function obtenerPerfilLocal(user_id) {
  const registro = await window.CampoAltoDB.usuarios_cache.get(user_id);
  if (!registro) return null;
  return { rol: registro.rol, nombre_completo: registro.nombre_completo, email: registro.email };
}

// Valida email+password contra el hash cacheado. Devuelve el registro
// (sin los hashes) si coincide, o null si no hay match o el usuario nunca
// se cacheó en este dispositivo.
async function validarLoginLocal(email, password) {
  const registro = await window.CampoAltoDB.usuarios_cache.where('email').equals(email).first();
  if (!registro || !registro.pass_hash) return null;

  const hashIntentado = await derivarHash(password, registro.pass_salt);
  if (hashIntentado !== registro.pass_hash) return null;

  return { user_id: registro.user_id, email: registro.email, nombre_completo: registro.nombre_completo, rol: registro.rol };
}

async function validarPinLocal(user_id, pin) {
  const registro = await window.CampoAltoDB.usuarios_cache.get(user_id);
  if (!registro || !registro.pin_hash) return false;
  const hashIntentado = await derivarHash(pin, registro.pin_salt);
  return hashIntentado === registro.pin_hash;
}

window.AuthLocal = {
  cachearCredenciales,
  actualizarPerfilLocal,
  obtenerPerfilLocal,
  validarLoginLocal,
  validarPinLocal,
};
