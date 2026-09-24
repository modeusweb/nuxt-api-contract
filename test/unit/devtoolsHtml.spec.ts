import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineApiContract } from '../../src/client'
import { buildDevtoolsHtml, escapeHtml } from '../../src/module/devtoolsHtml'

const GetUser = defineApiContract({
  name: 'DevtoolsGetUser',
  method: 'GET',
  path: '/api/devtools-users/:id',
  tags: ['Users'],
  params: z.object({ id: z.string() }),
  response: z.object({ id: z.string() }),
  errors: { USER_NOT_FOUND: z.object({ code: z.literal('USER_NOT_FOUND') }) },
})

describe('escapeHtml', () => {
  it('escapes markup-significant characters', () => {
    expect(escapeHtml('<script>"x" & \'y\'</script>'))
      .toBe('&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;')
  })
})

describe('buildDevtoolsHtml', () => {
  it('renders a full HTML document (served as text/html)', () => {
    const html = buildDevtoolsHtml([GetUser])
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('<table>')
    expect(html).toContain('/api/devtools-users/:id')
    expect(html).toContain('DevtoolsGetUser')
    expect(html).toContain('USER_NOT_FOUND')
    expect(html).toContain('Try request')
    expect(html).toContain('1 operation(s)')
  })

  it('escapes contract names so they cannot inject markup', () => {
    const Evil = defineApiContract({
      name: 'Evil<img src=x onerror=alert(1)>',
      method: 'POST',
      path: '/api/evil',
      response: z.object({ ok: z.boolean() }),
    })
    const html = buildDevtoolsHtml([Evil])
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('Evil&lt;img src=x onerror=alert(1)&gt;')
    // The embedded JSON data set must not be able to close the script tag.
    expect(html).not.toMatch(/const CONTRACTS = \[[^\]]*<\/script>/)
  })

  it('reports response timing and invalid JSON in the DevTools panel', () => {
    const html = buildDevtoolsHtml([GetUser])
    expect(html).toContain('performance.now()')
    expect(html).toContain('invalid JSON')
    expect(html).toContain('status-ok')
  })

  it('redacts metadata paths in DevTools output', () => {
    const Secure = defineApiContract({
      name: 'Secure',
      method: 'GET',
      path: '/api/secure',
      metadata: { redact: ['password', 'token'] },
      response: z.object({ email: z.string() }),
    })
    const html = buildDevtoolsHtml([Secure])
    expect(html).toContain('redactedPaths')
    expect(html).toContain('[REDACTED]')
  })

  it('renders an empty state page without contracts', () => {
    const html = buildDevtoolsHtml([])
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('0 operation(s)')
  })
})