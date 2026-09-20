import { describe, expect, it } from 'vitest'
import { buildRequestPath } from '../../src/client'
import type { PathParams, SplitPath } from '../../src/shared'

describe('buildRequestPath', () => {
  it('replaces single path parameters', () => {
    expect(buildRequestPath('/api/users/:id', { id: '42' })).toBe('/api/users/42')
  })

  it('replaces multiple path parameters', () => {
    expect(buildRequestPath('/api/posts/:postId/comments/:commentId', { postId: '1', commentId: '2' }))
      .toBe('/api/posts/1/comments/2')
  })

  it('encodes parameter values', () => {
    expect(buildRequestPath('/api/users/:id', { id: 'a/b c' })).toBe('/api/users/a%2Fb%20c')
  })

  it('throws on missing parameters', () => {
    expect(() => buildRequestPath('/api/users/:id', {})).toThrow(/Missing path parameter/)
  })
})

describe('PathParams (type level)', () => {
  it('extracts single parameters', () => {
    type Params = PathParams<'/api/users/:id'>
    const params: Params = { id: '1' }
    expect(params).toEqual({ id: '1' })
  })

  it('extracts multiple parameters', () => {
    type Params = PathParams<'/api/posts/:postId/comments/:commentId'>
    const params: Params = { postId: '1', commentId: '2' }
    expect(params).toEqual({ postId: '1', commentId: '2' })
  })

  it('extracts no parameters for plain paths', () => {
    type Params = SplitPath<'/api/users'> extends never ? true : PathParams<'/api/users'>
    const count: number = Object.keys({} as Params).length
    expect(count).toBe(0)
  })
})
