import { DeleteUserContract } from '../../../contracts/users'
import { createApiError, defineContractHandler } from 'nuxt-api-contract/server'

export default defineContractHandler(
  DeleteUserContract,
  async ({ params }) => {
    if (!db.remove(params.id)) {
      throw createApiError('USER_NOT_FOUND', 'User not found', 404)
    }
    return { ok: true }
  },
)
