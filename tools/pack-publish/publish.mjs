#!/usr/bin/env node
/**
 * Publishes a modpack: generates the manifest, syncs it to the CDN with rclone, and
 * prints the values to put in Firestore.
 *
 *   node tools/pack-publish/publish.mjs <packDir> [--remote r2] [--bucket name]
 *                                       [--base-url https://...] [--version 1.2.0] [--dry-run]
 *
 * `--remote`, `--bucket` and `--base-url` default to the `cdn` block of pack.config.json.
 *
 * This orchestrates `generate.mjs` rather than reimplementing it: the manifest is
 * deterministic, so its sha256 is recomputed from disk instead of scraped from stdout.
 * Use generate.mjs on its own when you want to inspect a manifest without uploading.
 */

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import { execFileSync, spawnSync } from 'child_process'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const GENERATE = path.join(HERE, 'generate.mjs')

const CACHE_HEADER = 'Cache-Control: no-cache'

function fail(msg) {
  console.error(`\n  error: ${msg}\n`)
  process.exit(1)
}

function heading(text) {
  console.log(`\n${text}`)
  console.log('-'.repeat(text.length))
}

// ------------------------------------------------------------------- entrada

const argv = process.argv.slice(2)
const flags = {}
const positionals = []
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--dry-run') {
    flags.dryRun = true
  } else if (argv[i].startsWith('--')) {
    flags[argv[i].slice(2)] = argv[i + 1]
    i++
  } else {
    positionals.push(argv[i])
  }
}

const packDir = positionals[0]
if (!packDir) {
  fail('falta la ruta del modpack.\n'
     + '  uso: node tools/pack-publish/publish.mjs <packDir> [--remote r2] [--bucket name]\n'
     + '                                          [--base-url https://...] [--version 1.2.0] [--dry-run]')
}

const configPath = path.join(packDir, 'pack.config.json')
const filesDir = path.join(packDir, 'files')
const manifestPath = path.join(packDir, 'manifest.json')

if (!fs.existsSync(configPath)) fail(`no existe ${configPath}`)
if (!fs.existsSync(filesDir)) fail(`no existe ${filesDir}`)

let config
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
} catch (err) {
  fail(`${configPath} no es JSON valido: ${err.message}`)
}

const packId = config.packId
if (!packId) fail('pack.config.json: falta "packId"')

const cdn = config.cdn || {}
const remote = flags.remote || cdn.remote
const bucket = flags.bucket || cdn.bucket
const baseUrl = (flags['base-url'] || cdn.baseUrl || '').replace(/\/+$/, '')

if (!remote || !bucket) {
  fail('falta el destino. Pasa --remote y --bucket, o añade a pack.config.json:\n'
     + '    "cdn": { "remote": "r2", "bucket": "mi-bucket", "baseUrl": "https://..." }')
}

// -------------------------------------------------------------- pre-vuelo

heading('Pre-vuelo')

try {
  const version = execFileSync('rclone', ['version'], { encoding: 'utf8' }).split('\n')[0].trim()
  console.log(`  rclone: ${version}`)
} catch {
  fail('rclone no esta instalado o no esta en el PATH.\n'
     + '  Instalalo desde https://rclone.org/downloads/ y configuralo con `rclone config`.')
}

let remotes
try {
  remotes = execFileSync('rclone', ['listremotes'], { encoding: 'utf8' })
    .split('\n').map(r => r.trim().replace(/:$/, '')).filter(Boolean)
} catch (err) {
  fail(`no se pudo listar los remotes de rclone: ${err.message}`)
}

if (!remotes.includes(remote)) {
  fail(`el remote "${remote}" no existe en rclone.\n`
     + `  Remotes configurados: ${remotes.length ? remotes.join(', ') : '(ninguno)'}\n`
     + '  Crea uno con `rclone config` (Storage: s3, Provider: Cloudflare).')
}
console.log(`  remote: ${remote}  ->  ${bucket}/${packId}`)

if (flags.dryRun) console.log('  modo: --dry-run, no se subira nada')

if (!flags.dryRun) {
  console.log('\n  Recuerda poner "maintenance: true" en Firestore ANTES de subir,')
  console.log('  para que nadie lance el modpack a medio actualizar.')
}

// -------------------------------------------------------------- manifest

heading('Manifest')

const generateArgs = [GENERATE, packDir]
if (flags.version) generateArgs.push('--version', flags.version)

const generated = spawnSync(process.execPath, generateArgs, { stdio: 'inherit' })
if (generated.status !== 0) fail('el generador del manifest fallo; no se ha subido nada')
if (!fs.existsSync(manifestPath)) fail(`el generador no dejo ${manifestPath}`)

const serialized = fs.readFileSync(manifestPath)
const manifestHash = crypto.createHash('sha256').update(serialized).digest('hex')
const manifest = JSON.parse(serialized)

// -------------------------------------------------------------- subida

const rcloneCommon = ['--header-upload', CACHE_HEADER]
if (flags.dryRun) rcloneCommon.push('--dry-run')

function rclone(args, what) {
  console.log(`\n  rclone ${args.join(' ')}\n`)
  const result = spawnSync('rclone', args, { stdio: 'inherit' })
  if (result.status !== 0) fail(`rclone fallo al ${what} (codigo ${result.status})`)
}

heading('Sincronizando archivos')

// `sync` (not `copy`) so files removed from the pack are removed from the bucket too.
rclone([
  'sync', filesDir, `${remote}:${bucket}/${packId}/files`,
  ...rcloneCommon, '--progress'
], 'sincronizar los archivos')

heading('Subiendo manifest')

// Separate command: manifest.json lives outside files/, so the sync above never sees it.
rclone([
  'copyto', manifestPath, `${remote}:${bucket}/${packId}/manifest.json`,
  ...rcloneCommon
], 'subir el manifest')

// -------------------------------------------------------------- informe

heading('Listo')

console.log(`  ${manifest.packId} ${manifest.version} — ${manifest.fileCount} archivos, `
  + `${(manifest.totalSize / 1024 / 1024).toFixed(1)} MB`)
console.log(`  loader: ${manifest.loader.type} ${manifest.loader.version} / MC ${manifest.minecraft.version}`)

if (flags.dryRun) {
  console.log('\n  Era un --dry-run: no se subio nada y Firestore no debe tocarse.')
  process.exit(0)
}

const manifestUrl = baseUrl
  ? `${baseUrl}/${packId}/manifest.json`
  : `<cdn-base-url>/${packId}/manifest.json`

console.log('\n  Actualiza el documento modpacks/' + packId + ' en Firestore:')
console.log('\n    manifest.url     = ' + manifestUrl)
console.log('    manifest.hash    = ' + manifestHash)
console.log('    manifest.version = ' + manifest.version)
console.log('    maintenance      = false')

if (!baseUrl) {
  console.log('\n  (añade "cdn.baseUrl" a pack.config.json para que se imprima la URL completa)')
}

console.log('')
