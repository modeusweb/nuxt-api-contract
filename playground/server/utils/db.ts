export interface DbUser {
  id: string
  name: string
  email: string
}

const users: DbUser[] = [
  { id: '1', name: 'John Doe', email: 'john@example.com' },
  { id: '2', name: 'Jane Smith', email: 'jane@example.com' },
  { id: '3', name: 'Bob Brown', email: 'bob@example.com' },
]

export const db = {
  list() {
    return [...users]
  },
  find(id: string) {
    return users.find(user => user.id === id)
  },
  create(data: { name: string, email: string }) {
    const user: DbUser = { id: String(users.length + 1), ...data }
    users.push(user)
    return user
  },
  update(id: string, data: Partial<Pick<DbUser, 'name' | 'email'>>) {
    const user = this.find(id)
    if (!user) return undefined
    Object.assign(user, data)
    return user
  },
  remove(id: string) {
    const index = users.findIndex(user => user.id === id)
    if (index === -1) return false
    users.splice(index, 1)
    return true
  },
}
