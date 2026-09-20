import { GetUserContract } from '../../../contracts/users'
import { createApiError, defineContractHandler } from 'nuxt-api-contract/server'

export default defineContractHandler(
  GetUserContract,
  async ({ params }) => {
    const user = db.find(params.id)
    if (!user) {
      throw createApiError('USER_NOT_FOUND', 'User not found', 404)
    }
    return user
  },
)
