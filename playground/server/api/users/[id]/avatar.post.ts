import { UploadAvatarContract } from '../../../../contracts/users'
import { createApiError, defineContractHandler } from 'nuxt-api-contract/server'

/**
 * Multipart handler: `body.file` is a real `File` instance and the text fields
 * are already coerced (`crop` -> boolean, `width` -> number) before validation.
 */
export default defineContractHandler(
  UploadAvatarContract,
  async ({ params, body }) => {
    const user = db.find(params.id)
    if (!user) {
      throw createApiError('USER_NOT_FOUND', 'User not found', 404)
    }
    if (body.file.size === 0) {
      throw createApiError('EMPTY_FILE', 'The uploaded file is empty', 400)
    }

    return {
      id: user.id,
      fileName: body.file.name,
      size: body.file.size,
      contentType: body.file.type,
      caption: body.caption ?? null,
      crop: body.crop ?? false,
      width: body.width ?? null,
    }
  },
)
