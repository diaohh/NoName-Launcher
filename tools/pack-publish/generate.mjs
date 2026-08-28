#!/usr/bin/env node
/**
 * Genera el manifest de un modpack a partir de su carpeta files/.
 *
 *   node tools/pack-publish/generate.mjs <packDir> [--version 1.2.0] [--out <ruta>]
 *
 * No usa red ni credenciales: solo lee del disco y escribe manifest.json.
 * El esquema esta documentado en docs/manifest.md.
 */

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

const FORMAT_VERSION = 1
const VALID_POLICIES = ['strict', 'seed', 'additive', 'ignore']
const HASH_CONCURRENCY = 8

// ---------------------------------------------------------------- utilidades

function fail(msg) {
  console.error(`\n  error: ${msg}\n`)
  process.exit(1)
}

/** Convierte un glob (`**`, `*`, `?`) en RegExp anclado. Solo lo que necesita `ignore`. */
function globToRegExp(pattern) {
  let re = ''
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        if (pattern[i + 2] === '/') {
          re += '(?:.*/)?'
          i += 2
        } else {
          re += '.*'
          i += 1
        }
      } else {
        re += '[^/]*'
      }
    } else if (c === '?') {
      re += '[^/]'
    } else if ('\\^$.|+()[]{}'.includes(c)) {
      re += '\\' + c
    } else {
      re += c
    }
  }
  return new RegExp(`^${re}$`)
}

/** Gana la regla cuyo `path` sea el prefijo mas largo que coincida. */
function resolvePolicy(relPath, rules) {
  let best = null
  for (const rule of rules) {
    const rulePath = rule.path.replace(/\/+$/, '')
    if (relPath === rulePath || relPath.startsWith(`${rulePath}/`)) {
      if (!best || rulePath.length > best.path.length) {
        best = { path: rulePath, policy: rule.policy }
      }
    }
  }
  return best
}

/** Rutas relativas en formato POSIX, ordenables y validas como sufijo de URL. */
function walk(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, base, out)
    else if (entry.isFile()) out.push(path.relative(base, full).split(path.sep).join('/'))
  }
  return out
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

async function mapPool(items, limit, fn) {
  const results = new Array(items.length)
  let next = 0
  const worker = async () => {
    for (let i = next++; i < items.length; i = next++) results[i] = await fn(items[i])
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

const toMB = (bytes) => (bytes / 1024 / 1024).toFixed(1)

// ------------------------------------------------------------------- entrada

const argv = process.argv.slice(2)
const flags = {}
const positionals = []
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) {
    flags[argv[i].slice(2)] = argv[i + 1]
    i++
  } else {
    positionals.push(argv[i])
  }
}

const packDir = positionals[0]
if (!packDir) {
  fail('falta la ruta del modpack.\n'
     + '  uso: node tools/pack-publish/generate.mjs <packDir> [--version 1.2.0] [--out <ruta>]')
}

const configPath = path.join(packDir, 'pack.config.json')
const filesDir = path.join(packDir, 'files')

if (!fs.existsSync(configPath)) fail(`no existe ${configPath}`)
if (!fs.existsSync(filesDir)) fail(`no existe ${filesDir}`)

let config
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
} catch (err) {
  fail(`${configPath} no es JSON valido: ${err.message}`)
}

// ---------------------------------------------------------------- validacion

if (!config.packId) fail('pack.config.json: falta "packId"')
if (!config.minecraft?.version) fail('pack.config.json: falta "minecraft.version"')
if (!config.loader?.type || !config.loader?.version) {
  fail('pack.config.json: falta "loader.type" o "loader.version"')
}

// El launcher solo soporta 1.17+ (assertSupportedVersion). Mejor fallar al publicar
// que en la maquina del jugador.
const [mcMajor, mcMinor] = config.minecraft.version.split('.').map(Number)
if (mcMajor === 1 && mcMinor < 17) {
  fail(`minecraft.version ${config.minecraft.version} no esta soportada; el launcher requiere 1.17+`)
}

if (config.loader.type !== 'fabric') {
  fail(`loader.type "${config.loader.type}" todavia no esta soportado por el generador.\n`
     + '  Forge necesita ademas publicar el jar del instalador; ver "Pendiente" en docs/manifest.md.')
}

const version = flags.version || config.version
if (!version) {
  fail('falta la version del pack: añade "version" a pack.config.json o pasa --version 1.0.0')
}

const rules = config.policies || []
for (const rule of rules) {
  if (!rule.path || !rule.policy) fail(`regla de politica invalida: ${JSON.stringify(rule)}`)
  if (!VALID_POLICIES.includes(rule.policy)) {
    fail(`politica desconocida "${rule.policy}" en "${rule.path}". Validas: ${VALID_POLICIES.join(', ')}`)
  }
}

// ------------------------------------------------------------------- escaneo

const ignorePatterns = config.ignore || []
const ignoreRegexes = ignorePatterns.map(globToRegExp)

const allPaths = walk(filesDir).sort()
const ignored = []
const skippedByPolicy = []
const unmatched = []
const selected = []

for (const relPath of allPaths) {
  if (ignoreRegexes.some((re) => re.test(relPath))) {
    ignored.push(relPath)
    continue
  }

  const match = resolvePolicy(relPath, rules)
  if (!match) {
    unmatched.push(relPath)
    selected.push({ relPath, policy: 'strict' })
    continue
  }

  // Declarar un archivo bajo `ignore` no tendria efecto: el launcher no lo toca.
  if (match.policy === 'ignore') {
    skippedByPolicy.push(relPath)
    continue
  }

  selected.push({ relPath, policy: match.policy })
}

if (selected.length === 0) fail(`no hay archivos que publicar en ${filesDir}`)

process.stdout.write(`  hasheando ${selected.length} archivos...`)

const files = await mapPool(selected, HASH_CONCURRENCY, async ({ relPath, policy }) => {
  const full = path.join(filesDir, relPath)
  return {
    path: relPath,
    hash: await hashFile(full),
    size: fs.statSync(full).size,
    policy
  }
})

process.stdout.write('\r' + ' '.repeat(40) + '\r')

// -------------------------------------------------------------------- salida

const totalSize = files.reduce((sum, f) => sum + f.size, 0)

// Sin timestamp y con `files` ordenado: regenerar sin cambios produce un archivo identico,
// asi el hash del manifest solo cambia cuando cambia el contenido real.
const manifest = {
  formatVersion: FORMAT_VERSION,
  packId: config.packId,
  version,
  minecraft: { version: config.minecraft.version },
  loader: { type: config.loader.type, version: config.loader.version },
  policies: rules,
  ignore: ignorePatterns,
  fileCount: files.length,
  totalSize,
  files
}

const outPath = flags.out || path.join(packDir, 'manifest.json')
const serialized = `${JSON.stringify(manifest, null, 2)}\n`
fs.writeFileSync(outPath, serialized)

const manifestHash = crypto.createHash('sha256').update(serialized).digest('hex')

// ------------------------------------------------------------------- informe

const byPolicy = {}
for (const f of files) byPolicy[f.policy] = (byPolicy[f.policy] || 0) + 1

console.log(`\n  ${config.packId} ${version}  —  ${config.loader.type} ${config.loader.version} / MC ${config.minecraft.version}`)
console.log(`  ${files.length} archivos, ${toMB(totalSize)} MB`)
console.log(`  ${Object.entries(byPolicy).map(([p, n]) => `${p}: ${n}`).join('   ')}`)

if (ignored.length) console.log(`  ignorados por glob: ${ignored.length}`)
if (skippedByPolicy.length) console.log(`  omitidos por politica ignore: ${skippedByPolicy.length}`)

if (unmatched.length) {
  console.log(`\n  aviso: ${unmatched.length} archivo(s) sin regla de politica, asumido "strict".`)
  console.log('  Añade una regla explicita en pack.config.json para cada uno:')
  for (const p of unmatched.slice(0, 10)) console.log(`    ${p}`)
  if (unmatched.length > 10) console.log(`    ... y ${unmatched.length - 10} mas`)
}

console.log(`\n  escrito ${outPath}`)
console.log(`  sha256 del manifest (va en Firestore):\n    ${manifestHash}`)
console.log('\n  siguiente paso:')
console.log(`    rclone sync "${filesDir}" r2:<bucket>/${config.packId}/files --header-upload "Cache-Control: no-cache" --progress`)
console.log(`    rclone copyto "${outPath}" r2:<bucket>/${config.packId}/manifest.json --header-upload "Cache-Control: no-cache"`)
console.log('')
