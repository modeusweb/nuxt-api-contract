import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const temp = mkdtempSync(join(tmpdir(), 'nuxt-api-contract-consumer-'))
const packDir = join(temp, 'pack')
const appDir = join(temp, 'app')
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const version = packageJson.version

function run(command, args, cwd = root, env = {}) {
  console.log(`[consumer] ${command} ${args.join(' ')}`)
  execFileSync(command, args, {
    cwd,
    env: { ...process.env, NUXT_TELEMETRY_DISABLED: '1', CI: '1', ...env },
    stdio: 'inherit',
    shell: process.platform === 'win32',
    timeout: 300_000,
  })
}

try {
  mkdirSync(packDir, { recursive: true })
  run('npm', ['run', 'build'])
  run('npm', ['pack', '--pack-destination', packDir])
  const tarball = join(packDir, `nuxt-api-contract-${version}.tgz`)
  mkdirSync(join(appDir, 'contracts'), { recursive: true })
  mkdirSync(join(appDir, 'server/api'), { recursive: true })
  writeFileSync(join(appDir, 'package.json'), JSON.stringify({
    name: 'nuxt-api-contract-consumer-smoke',
    private: true,
    type: 'module',
  }, null, 2))
  writeFileSync(join(appDir, 'nuxt.config.ts'), `export default defineNuxtConfig({\n  modules: ['nuxt-api-contract'],\n  apiContract: { openapi: { enabled: true, entry: 'contracts/index.ts' } },\n})\n`)
  writeFileSync(join(appDir, 'contracts/index.ts'), `import { z } from 'zod'\nimport { defineApiContract } from 'nuxt-api-contract/client'\n\nexport const Health = defineApiContract({\n  name: 'Health',\n  method: 'GET',\n  path: '/api/health',\n  response: z.object({ ok: z.literal(true) }),\n})\n`)
  writeFileSync(join(appDir, 'server/api/health.get.ts'), `import { Health } from '../../contracts/index'\nexport default defineContractHandler(Health, () => ({ ok: true }))\n`)
  mkdirSync(join(appDir, 'app'), { recursive: true })
  writeFileSync(join(appDir, 'app/app.vue'), '<template><div>consumer smoke</div></template>\n')

  run('npm', ['install', '--no-package-lock', '--ignore-scripts', `nuxt@${packageJson.devDependencies.nuxt}`, `zod@${packageJson.devDependencies.zod}`, tarball], appDir)
  const consumerBin = (name) => join(appDir, 'node_modules', '.bin', process.platform === 'win32' ? `${name}.cmd` : name)
  run(consumerBin('nuxt-api-contract'), ['check', 'contracts/index.ts', '--strict'], appDir)
  run(consumerBin('nuxt'), ['prepare'], appDir)
  run(consumerBin('nuxt'), ['build', '--preset', 'static'], appDir)
  console.log('[consumer] clean Nuxt consumer passed')
} finally {
  rmSync(temp, { recursive: true, force: true })
}
