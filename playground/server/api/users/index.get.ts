import { ListUsersContract } from '../../../contracts/users'
import { defineContractHandler } from 'nuxt-api-contract/server'

export default defineContractHandler(
  ListUsersContract,
  async ({ query }) => {
    const all = db.list()
    const search = query.search?.toLowerCase()
    const filtered = search
      ? all.filter(user => user.name.toLowerCase().includes(search) || user.email.toLowerCase().includes(search))
      : all
    const start = (query.page - 1) * query.limit
    return {
      users: filtered.slice(start, start + query.limit),
      total: filtered.length,
      page: query.page,
    }
  },
)
