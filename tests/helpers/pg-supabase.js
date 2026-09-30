/**
 * Postgres real en memoria (PGlite, WASM) con el mínimo de Supabase que
 * necesitan las migraciones: esquema auth (users + auth.uid()) y los roles
 * anon/authenticated. Ejecuta las migraciones REALES de supabase/ en orden,
 * para probar las RPC tal como quedarían en producción.
 *
 * auth.uid() lee el setting 'test.uid': la prueba "inicia sesión" con
 * comoUsuario(uid). Las RPC son SECURITY DEFINER y se prueban llamándolas
 * directamente (PostgREST no participa).
 */
const fs = require('fs')
const path = require('path')

const DIR_MIGRACIONES = path.join(__dirname, '..', '..', 'supabase')

// Migraciones que NO se ejecutan en la base de prueba: 30/31 son scripts
// manuales de diagnóstico/limpieza de datos, no cambios de esquema.
const EXCLUIDAS = new Set(['30_preview_antes_de_limpiar.sql', '31_limpieza_total_datos_prueba.sql'])

const STUB_SUPABASE = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth;
CREATE TABLE auth.users (
  id UUID PRIMARY KEY,
  email TEXT,
  raw_user_meta_data JSONB DEFAULT '{}'::jsonb
);
CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('test.uid', true), '')::uuid
$$;
-- Igual que Supabase: anon/authenticated reciben por defecto privilegios
-- sobre todo lo que se crea en public (RLS y los REVOKE de las
-- migraciones son los que realmente restringen).
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
`

function listarMigraciones(hasta) {
  return fs.readdirSync(DIR_MIGRACIONES)
    .filter((f) => /^\d+_.*\.sql$/.test(f) && !EXCLUIDAS.has(f))
    .filter((f) => parseInt(f, 10) <= hasta)
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
}

async function crearBase({ hasta = 999 } = {}) {
  const { PGlite } = await import('@electric-sql/pglite')
  const { uuid_ossp } = await import('@electric-sql/pglite/contrib/uuid_ossp')
  const db = new PGlite({ extensions: { uuid_ossp } })
  await db.exec(STUB_SUPABASE)

  for (const archivo of listarMigraciones(hasta)) {
    const sql = fs.readFileSync(path.join(DIR_MIGRACIONES, archivo), 'utf8')
    try {
      await db.exec(sql)
    } catch (err) {
      err.message = `[${archivo}] ${err.message}`
      throw err
    }
  }
  return db
}

async function comoUsuario(db, uid) {
  await db.query(`SELECT set_config('test.uid', $1, false)`, [uid || ''])
}

// Ejecuta una consulta como lo haría PostgREST: rol 'authenticated' (o
// 'anon' si uid es null) con auth.uid() = uid. Así aplican RLS y GRANTs.
async function consultarComo(db, uid, sql, params = []) {
  await db.exec(`SET ROLE ${uid ? 'authenticated' : 'anon'}`)
  try {
    await comoUsuario(db, uid)
    return await db.query(sql, params)
  } finally {
    await db.exec('RESET ROLE')
    await comoUsuario(db, null)
  }
}

module.exports = { crearBase, comoUsuario, consultarComo, listarMigraciones }
