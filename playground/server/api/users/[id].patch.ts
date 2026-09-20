import { UpdateUserContract } from '../../../contracts/users'
import { createApiError, defineContractHandler } from 'nuxt-api-contract/server'

export default defineContractHandler(
  UpdateUserContract,
  async ({ params, body }) => {
    const user = db.update(params.id, body)
    if (!user) {
      throw createApiError('USER_NOT_FOUND', 'User not found', 404)
    }
    return user
  },
)
