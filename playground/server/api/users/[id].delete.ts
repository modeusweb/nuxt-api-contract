// The contract is imported explicitly here (contract auto-discovery through
// `apiContract.contractsDirs` is app-side), while `defineContractHandler` and
// `createApiError` come from the module's Nitro auto-import preset — this route
// is the canary that the preset actually injects (a broken `from` silently
// disables every auto-import instead of failing the build).
import { DeleteUserContract } from '../../../contracts/users'

export default defineContractHandler(
  DeleteUserContract,
  async ({ params }) => {
    if (!db.remove(params.id)) {
      throw createApiError('USER_NOT_FOUND', 'User not found', 404)
    }
    return { ok: true }
  },
)
