<script setup lang="ts">
import { CreateUserContract, ListUsersContract } from '../contracts/users'

const { data, error } = await useApi(ListUsersContract, {
  query: { page: 1, limit: 10 },
})

const name = ref('')
const email = ref('')
const created = ref<{ id: string, name: string, email: string } | null>(null)
const createError = ref<string | null>(null)

async function createUser() {
  createError.value = null
  const client = await useApiClient()
  const { data: user, error: err } = await client.tryRequest(CreateUserContract, {
    body: { name: name.value, email: email.value },
  })
  if (err) {
    createError.value = `${err.code}: ${err.message}`
  } else {
    created.value = user
    refreshNuxtData()
  }
}
</script>

<template>
  <div style="font-family: sans-serif; padding: 24px">
    <h1>Users</h1>
    <div v-if="error" style="color: crimson">Error: {{ error.code }}</div>
    <ul v-else-if="data">
      <li v-for="user in data.users" :key="user.id">
        <NuxtLink :to="`/users/${user.id}`">{{ user.name }}</NuxtLink>
        (total: {{ data.total }}, page: {{ data.page }})
      </li>
    </ul>

    <h2>Create user</h2>
    <form @submit.prevent="createUser">
      <input v-model="name" placeholder="Name">
      <input v-model="email" placeholder="Email">
      <button type="submit">Create</button>
    </form>
    <p v-if="created">Created #{{ created.id }} {{ created.name }}</p>
    <p v-if="createError" style="color: crimson">{{ createError }}</p>
  </div>
</template>
