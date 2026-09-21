import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { $fetch, fetch, setup } from '@nuxt/test-utils/e2e'

describe('playground integration', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('../../playground', import.meta.url)),
    server: true,
    build: true,
  })

  it('serves a validated contract response', async () => {
    const user = await $fetch('/api/users/1')
    expect(user).toMatchObject({ id: '1', name: 'John Doe', email: 'john@example.com' })
  })

  it('rejects invalid requests with the unified error payload', async () => {
    // `name` has min(1): an empty value fails validation.
    const response = await fetch('/api/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '', email: 'not-an-email' }),
    })
    expect(response.status).toBe(400)
    const payload = (await response.json()) as { error?: { code?: string } }
    expect(payload.error?.code).toBe('VALIDATION_ERROR')
  })

  it('propagates typed ApiErrors from handlers', async () => {
    const response = await fetch('/api/users/unknown-id')
    expect(response.status).toBe(404)
    const payload = (await response.json()) as { error?: { code?: string } }
    expect(payload.error?.code).toBe('USER_NOT_FOUND')
  })

  it('coerces and validates query parameters', async () => {
    const list = await $fetch('/api/users', { query: { page: '1', limit: '2' } })
    expect((list as { users: unknown[] }).users).toHaveLength(2)
    expect((list as { total: number }).total).toBeGreaterThan(0)
  })

  it('rejects invalid query parameters', async () => {
    const response = await fetch('/api/users?limit=abc')
    expect(response.status).toBe(400)
    const payload = (await response.json()) as { error?: { code?: string } }
    expect(payload.error?.code).toBe('VALIDATION_ERROR')
  })

  it('creates users through the POST contract', async () => {
    const created = await $fetch('/api/users', {
      method: 'POST',
      body: { name: 'Test User', email: 'test@example.com' },
    })
    expect(created).toMatchObject({ name: 'Test User' })

    const duplicate = await fetch('/api/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Test User', email: 'test@example.com' }),
    })
    expect(duplicate.status).toBe(409)
    const payload = (await duplicate.json()) as { error?: { code?: string } }
    expect(payload.error?.code).toBe('EMAIL_TAKEN')
  })

  it('updates and deletes users', async () => {
    const updated = await $fetch('/api/users/2', { method: 'PATCH', body: { name: 'Jane Updated' } })
    expect(updated).toMatchObject({ id: '2', name: 'Jane Updated' })

    const deleted = await $fetch('/api/users/2', { method: 'DELETE' })
    expect(deleted).toMatchObject({ ok: true })

    const missing = await fetch('/api/users/2', { method: 'DELETE' })
    expect(missing.status).toBe(404)
  })

  it('serves the generated OpenAPI document', async () => {
    const doc = await $fetch('/_api-contracts/openapi.json')
    expect((doc as { openapi: string }).openapi).toBe('3.0.3')
    const paths = (doc as { paths: Record<string, unknown> }).paths
    expect(Object.keys(paths)).toContain('/api/users/{id}')
  })

  it('uploads files through the multipart contract (1.0.0)', async () => {
    const form = new FormData()
    form.append('file', new File(['avatar-bytes'], 'avatar.png', { type: 'image/png' }))
    form.append('caption', 'profile photo')
    form.append('crop', 'true')
    form.append('width', '512')

    const uploaded = await $fetch('/api/users/1/avatar', { method: 'POST', body: form })
    expect(uploaded).toMatchObject({
      id: '1',
      fileName: 'avatar.png',
      size: 12,
      contentType: 'image/png',
      caption: 'profile photo',
      crop: true,
      width: 512,
    })
  })

  it('validates multipart requests (missing file, bad coercion)', async () => {
    const missing = new FormData()
    missing.append('caption', 'no file here')
    const missingResponse = await fetch('/api/users/1/avatar', { method: 'POST', body: missing })
    expect(missingResponse.status).toBe(400)
    const missingPayload = (await missingResponse.json()) as { error?: { code?: string } }
    expect(missingPayload.error?.code).toBe('VALIDATION_ERROR')

    const badWidth = new FormData()
    badWidth.append('file', new File(['x'], 'a.png', { type: 'image/png' }))
    badWidth.append('width', 'not-a-number')
    const badResponse = await fetch('/api/users/1/avatar', { method: 'POST', body: badWidth })
    expect(badResponse.status).toBe(400)
    const badPayload = (await badResponse.json()) as { error?: { code?: string, message?: string } }
    expect(badPayload.error?.code).toBe('VALIDATION_ERROR')
    expect(badPayload.error?.message).toContain('body.width')
  })

  it('propagates handler errors from multipart endpoints', async () => {
    const form = new FormData()
    form.append('file', new File(['x'], 'a.png', { type: 'image/png' }))
    const response = await fetch('/api/users/missing/avatar', { method: 'POST', body: form })
    expect(response.status).toBe(404)
    const payload = (await response.json()) as { error?: { code?: string } }
    expect(payload.error?.code).toBe('USER_NOT_FOUND')
  })

  it('documents multipart bodies in OpenAPI', async () => {
    const doc = await $fetch('/_api-contracts/openapi.json')
    const paths = (doc as { paths: Record<string, Record<string, { requestBody?: { content?: Record<string, unknown> } }>> }).paths
    const upload = paths['/api/users/{id}/avatar']!.post!
    expect(Object.keys(upload.requestBody?.content ?? {})).toContain('multipart/form-data')
  })

  it('renders SSR pages without errors', async () => {
    const html = await $fetch('/users/1')
    expect(String(html)).toContain('John Doe')
  })
})
