import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const output = resolve(root, 'playground/openapi.json')

function run(command, args) {
  console.log(`[governance] ${command} ${args.join(' ')}`)
  execFileSync(command, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
}

try {
  run('node', ['dist/cli.mjs', 'check', 'playground/contracts/index.ts', '--strict'])
  run('node', ['dist/cli.mjs', 'openapi', 'playground/contracts/index.ts', '--output', 'playground/openapi.json'])
  run('node', ['dist/cli.mjs', 'openapi', 'playground/contracts/index.ts', '--output', 'playground/openapi.json', '--check'])
  const document = JSON.parse(readFileSync(output, 'utf8'))
  if (!document || typeof document !== 'object' || document.openapi !== '3.0.3' || !document.paths || typeof document.paths !== 'object' || Object.keys(document.paths).length === 0) {
    throw new Error('Generated OpenAPI document is empty or has an unexpected version.')
  }
  console.log(`[governance] OpenAPI validated: ${Object.keys(document.paths).length} path(s).`)
} finally {
  rmSync(output, { force: true })
}
