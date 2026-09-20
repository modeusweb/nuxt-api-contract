import { CreateUserContract } from '../../../contracts/users'
import { createApiError, defineContractHandler } from 'nuxt-api-contract/server'

export default defineContractHandler(
  CreateUserContract,
  async ({ body }) => {
    if (db.list().some(user => user.email === body.email)) {
      throw createApiError('EMAIL_TAKEN', 'Email already in use', 409)
    }
    return db.create(body)
  },
)
