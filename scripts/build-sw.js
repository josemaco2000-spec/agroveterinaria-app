// Recalcula CACHE_VERSION en src/sw.js a partir de un hash del contenido
// real de los archivos del app shell (más la lógica del propio sw.js).
//
// Por qué: sin esto, cada despliegue que cambie un HTML/JS/CSS requiere
// subir "v1" -> "v2" a mano en sw.js, o los usuarios quedan viendo la
// versión vieja cacheada hasta que alguien borra el caché del navegador.
// Con esto, el hash cambia solo cuando cambia contenido real, así que
// basta con correr `npm run build` antes de cada despliegue.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SRC_DIR = path.join(__dirname, '..', 'src');
const SW_PATH = path.join(SRC_DIR, 'sw.js');
const VERSION_LINE = /const CACHE_VERSION = '.*?';/;

function extractShellAssets(swSource) {
  const match = swSource.match(/const SHELL_ASSETS = \[([\s\S]*?)\];/);
  if (!match) {
    throw new Error('No se encontró el arreglo SHELL_ASSETS en sw.js');
  }
  const assets = [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  if (assets.length === 0) {
    throw new Error('SHELL_ASSETS está vacío o no se pudo parsear');
  }
  return assets;
}

function computeHash(swSource, assetPaths) {
  const hash = crypto.createHash('sha256');
  // Contenido del propio sw.js sin la línea de versión, para no crear un
  // ciclo (cambiar el hash cambiaría el archivo que a su vez cambia el hash).
  hash.update(swSource.replace(VERSION_LINE, ''));

  for (const relPath of [...assetPaths].sort()) {
    const abs = path.join(SRC_DIR, relPath);
    if (!fs.existsSync(abs)) {
      throw new Error(`SHELL_ASSETS lista un archivo que no existe: ${relPath}`);
    }
    hash.update(relPath);
    hash.update(fs.readFileSync(abs));
  }

  return hash.digest('hex').slice(0, 10);
}

function main() {
  const original = fs.readFileSync(SW_PATH, 'utf8');
  if (!VERSION_LINE.test(original)) {
    throw new Error('No se encontró la línea "const CACHE_VERSION = ...;" en sw.js');
  }

  const assetPaths = extractShellAssets(original);
  const newVersion = computeHash(original, assetPaths);
  const updated = original.replace(VERSION_LINE, `const CACHE_VERSION = '${newVersion}';`);

  if (updated === original) {
    console.log(`sw.js ya está al día (CACHE_VERSION = '${newVersion}').`);
    return;
  }

  fs.writeFileSync(SW_PATH, updated);
  console.log(`sw.js actualizado: CACHE_VERSION = '${newVersion}' (${assetPaths.length} archivos del shell hasheados).`);
}

main();
