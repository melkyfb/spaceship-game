#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '../..')

function parseArgs(argv) {
  const args = { only: null, dryRun: false, report: null, requireBlender: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--only') args.only = argv[++i] ?? null
    else if (a === '--dry-run') args.dryRun = true
    else if (a === '--report') args.report = argv[++i] ?? null
    else if (a === '--require-blender') args.requireBlender = true
    else if (a === '--help' || a === '-h') args.help = true
    else {
      throw new Error(`Unknown arg: ${a}`)
    }
  }
  return args
}

function usage() {
  console.log(`Usage: node scripts/assets/export-glb.mjs [--only p1|<id>] [--dry-run] [--report <path>] [--require-blender]`)
}

function resolveRepoPath(p) {
  if (!p) return p
  return path.isAbsolute(p) ? p : path.resolve(repoRoot, p)
}

function findBlender() {
  const candidates = []
  if (process.env.BLENDER_BIN) candidates.push(process.env.BLENDER_BIN)
  candidates.push('blender')

  if (process.platform === 'win32') {
    const roots = [
      process.env['ProgramFiles'] || 'C:\\Program Files',
      process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
    ]
    for (const root of roots) {
      const base = path.join(root, 'Blender Foundation')
      try {
        const entries = fs.readdirSync(base, { withFileTypes: true })
          .filter((e) => e.isDirectory() && /^Blender/i.test(e.name))
          .map((e) => path.join(base, e.name, 'blender.exe'))
          .sort()
          .reverse()
        candidates.push(...entries)
      } catch {
        // ignore missing install root
      }
    }
  }

  const seen = new Set()
  for (const bin of candidates) {
    const key = String(bin).toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const r = spawnSync(bin, ['--version'], { encoding: 'utf8', shell: false })
    if (r.error) continue
    if (r.status === 0) {
      const version = String(r.stdout || r.stderr || '').split(/\r?\n/).find(Boolean) || 'unknown'
      return { bin, version: version.trim() }
    }
  }
  return null
}

function loadSources(only) {
  const sourcesPath = path.resolve(__dirname, 'sources.p1.json')
  const raw = fs.readFileSync(sourcesPath, 'utf8')
  const sources = JSON.parse(raw)
  if (!Array.isArray(sources)) throw new Error('sources.p1.json must be an array')
  if (!only || only === 'p1' || only === 'all') return { sourcesPath, sources }
  const filtered = sources.filter((s) => s.id === only)
  if (filtered.length === 0) throw new Error(`No source matched --only ${only}`)
  return { sourcesPath, sources: filtered }
}

function canAutoExport(sourcePath) {
  const ext = path.extname(sourcePath).toLowerCase()
  return ['.blend', '.fbx', '.obj', '.glb', '.gltf'].includes(ext)
}

function runBlenderExport(blender, item) {
  const scriptPath = path.resolve(__dirname, 'blender_export.py')
  const sourcePath = resolveRepoPath(item.source)
  const outputPath = resolveRepoPath(item.output)
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })

  const args = [
    '-b',
    '--factory-startup',
    '--python', scriptPath,
    '--',
    '--source', sourcePath,
    '--output', outputPath,
  ]
  if (item.forward) args.push(`--forward=${String(item.forward)}`)
  if (Number.isFinite(item.targetRadius)) args.push('--target-radius', String(item.targetRadius))
  if (item.nodeFilter) args.push('--node-filter', String(item.nodeFilter))
  if (Array.isArray(item.rotationDeg) && item.rotationDeg.length === 3) {
    args.push('--rotation-deg', item.rotationDeg.map((n) => String(n)).join(','))
  }
  if (item.id) args.push('--id', String(item.id))

  const r = spawnSync(blender.bin, args, { encoding: 'utf8', cwd: repoRoot, shell: false })
  const stdout = String(r.stdout || '').trim()
  const stderr = String(r.stderr || '').trim()
  let result = null
  const lines = stdout.split(/\r?\n/).filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(lines[i])
      if (parsed && typeof parsed === 'object' && ('status' in parsed || 'output' in parsed)) {
        result = parsed
        break
      }
    } catch {
      // not JSON line
    }
  }

  if (r.error) {
    return { status: 'failed', reason: `Blender invocation error: ${r.error.message}`, stdout, stderr }
  }
  if (r.status !== 0) {
    const reason = result?.reason || stderr || stdout || `Blender exited with code ${r.status}`
    return { status: result?.status === 'manual' ? 'manual' : 'failed', reason, stdout, stderr }
  }
  if (result?.status) return { ...result, stdout, stderr }
  return { status: 'exported', output: outputPath, stdout, stderr }
}

function writeReport(reportPath, report) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    usage()
    return
  }

  const { sourcesPath, sources } = loadSources(args.only)
  const blender = findBlender()

  if (!blender) {
    const msg = [
      'Blender not found. Automated export unavailable.',
      'Install Blender 4.x+ and add it to PATH, or set BLENDER_BIN.',
      'Windows example: $env:BLENDER_BIN="C:\\Program Files\\Blender Foundation\\Blender 5.3\\blender.exe"',
    ].join('\n')
    console.error(msg)
    if (args.requireBlender) {
      const reportPath = resolveRepoPath(args.report || 'scripts/assets/out/export-report.json')
      writeReport(reportPath, {
        generatedAt: new Date().toISOString(),
        sources: path.relative(repoRoot, sourcesPath).replace(/\\/g, '/'),
        blender: null,
        dryRun: args.dryRun,
        items: sources.map((item) => ({
          id: item.id,
          source: item.source,
          output: item.output,
          status: 'manual',
          reason: 'Blender not found; --require-blender set',
        })),
      })
      process.exit(2)
    }
  } else {
    console.log(`Blender: ${blender.bin} (${blender.version})`)
  }

  const items = []
  for (const item of sources) {
    const sourcePath = resolveRepoPath(item.source)
    const outputPath = resolveRepoPath(item.output)
    const base = {
      id: item.id,
      source: item.source,
      output: item.output,
      targetRadius: item.targetRadius,
      forward: item.forward ?? '-Z',
      nodeFilter: item.nodeFilter ?? null,
    }

    const hasRotationConfig = Array.isArray(item.rotationDeg) && item.rotationDeg.length === 3
    const hasTargetRadius = Number.isFinite(item.targetRadius) && item.targetRadius > 0
    const forward = item.forward ? String(item.forward).toUpperCase() : null

    if (args.dryRun) {
      if (!fs.existsSync(sourcePath)) {
        items.push({ ...base, status: 'manual', reason: `Source missing: ${item.source}` })
      } else if (!canAutoExport(sourcePath)) {
        items.push({ ...base, status: 'manual', reason: `Unsupported/ambiguous source format for automation: ${path.extname(sourcePath)}` })
      } else if (!hasTargetRadius) {
        items.push({ ...base, status: 'manual', reason: 'targetRadius is required for normalization/export' })
      } else if (forward === '-Z' && !hasRotationConfig) {
        items.push({ ...base, status: 'manual', reason: 'Forward orientation required (-Z) but no explicit rotation configured; set rotationDeg [pitch,yaw,roll] in sources' })
      } else if (!blender) {
        items.push({ ...base, status: 'manual', reason: 'Blender not found' })
      } else {
        items.push({ ...base, status: 'planned', reason: 'Dry run; Blender available' })
      }
      continue
    }

    if (!fs.existsSync(sourcePath)) {
      items.push({ ...base, status: 'manual', reason: `Source missing: ${item.source}` })
      continue
    }
    if (!canAutoExport(sourcePath)) {
      items.push({ ...base, status: 'manual', reason: `Unsupported/ambiguous source format for automation: ${path.extname(sourcePath)}` })
      continue
    }
    if (!hasTargetRadius) {
      items.push({ ...base, status: 'manual', reason: 'targetRadius is required for normalization/export' })
      continue
    }
    if (forward === '-Z' && !hasRotationConfig) {
      items.push({ ...base, status: 'manual', reason: 'Forward orientation required (-Z) but no explicit rotation configured; set rotationDeg [pitch,yaw,roll] in sources' })
      continue
    }
    if (!blender) {
      items.push({ ...base, status: 'manual', reason: 'Blender not found. Install Blender 4.x+ or set BLENDER_BIN.' })
      continue
    }

    console.log(`Exporting ${item.id}: ${item.source} -> ${item.output}`)
    const result = runBlenderExport(blender, item)
    items.push({ ...base, ...result, output: item.output })
  }

  const report = {
    generatedAt: new Date().toISOString(),
    sources: path.relative(repoRoot, sourcesPath).replace(/\\/g, '/'),
    blender: blender ? { bin: blender.bin, version: blender.version } : null,
    dryRun: args.dryRun,
    items,
  }

  const reportPath = resolveRepoPath(args.report || 'scripts/assets/out/export-report.json')
  writeReport(reportPath, report)
  console.log(`Report written: ${path.relative(repoRoot, reportPath).replace(/\\/g, '/')}`)

  const hardFailures = items.filter((i) => i.status === 'failed')
  if (hardFailures.length > 0) {
    console.error(`Export completed with ${hardFailures.length} hard failure(s).`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err?.stack || String(err))
  process.exit(1)
})
