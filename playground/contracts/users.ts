import { z } from 'zod'
import { defineApiContract } from 'nuxt-api-contract/client'

export const UserSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  email: z.string().email(),
})

export const GetUserContract = defineApiContract({
  name: 'GetUser',
  method: 'GET',
  path: '/api/users/:id',
  summary: 'Get a single user',
  tags: ['Users'],
  params: z.object({ id: z.string().min(1) }),
  response: UserSchema,
  errors: {
    USER_NOT_FOUND: z.object({ error: z.object({ code: z.literal('USER_NOT_FOUND'), message: z.string() }) }),
  },
})

export const ListUsersContract = defineApiContract({
  name: 'ListUsers',
  method: 'GET',
  path: '/api/users',
  summary: 'List users with pagination and search',
  tags: ['Users'],
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().max(100).default(20),
    search: z.string().optional(),
  }),
  response: z.object({
    users: z.array(UserSchema),
    total: z.number().int(),
    page: z.number().int(),
  }),
})

export const CreateUserContract = defineApiContract({
  name: 'CreateUser',
  method: 'POST',
  path: '/api/users',
  summary: 'Create a user',
  tags: ['Users'],
  body: z.object({
    name: z.string().min(1),
    email: z.string().email(),
  }),
  response: UserSchema,
  errors: {
    EMAIL_TAKEN: z.object({ error: z.object({ code: z.literal('EMAIL_TAKEN'), message: z.string() }) }),
  },
})

export const UpdateUserContract = defineApiContract({
  name: 'UpdateUser',
  method: 'PATCH',
  path: '/api/users/:id',
  summary: 'Partially update a user',
  tags: ['Users'],
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    name: z.string().min(1).optional(),
    email: z.string().email().optional(),
  }),
  response: UserSchema,
  errors: {
    USER_NOT_FOUND: z.object({ error: z.object({ code: z.literal('USER_NOT_FOUND'), message: z.string() }) }),
  },
})

export const DeleteUserContract = defineApiContract({
  name: 'DeleteUser',
  method: 'DELETE',
  path: '/api/users/:id',
  summary: 'Delete a user',
  tags: ['Users'],
  params: z.object({ id: z.string().min(1) }),
  response: z.object({ ok: z.boolean() }),
  errors: {
    USER_NOT_FOUND: z.object({ error: z.object({ code: z.literal('USER_NOT_FOUND'), message: z.string() }) }),
  },
})
