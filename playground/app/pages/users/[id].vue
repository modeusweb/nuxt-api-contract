<script setup lang="ts">
import { GetUserContract, ListUsersContract } from '~~/contracts/users'

const route = useRoute()

// SSR + typed data: `data` is fully inferred from the contract response schema.
const { data, error } = await useApi(GetUserContract, {
  params: { id: route.params.id as string },
})

// Client-side demo: list users on mount (no SSR fetch).
const list = ref<Awaited<ReturnType<typeof fetchList>> | null>(null)

async function fetchList() {
  const client = useApiClient()
  return client.request(ListUsersContract, { query: { page: 1, limit: 10 } })
}

onMounted(async () => {
  const result = await fetchList()
  list.value = result
})
</script>

<template>
  <div style="font-family: sans-serif; padding: 24px">
    <h1>Users</h1>
    <div v-if="error" style="color: crimson">
      Error: {{ error.code }} — {{ error.message }}
    </div>
    <div v-else-if="data">
      <p><strong>#{{ data.id }}</strong> {{ data.name }} &lt;{{ data.email }}&gt;</p>
    </div>

    <h2>All users (client-side)</h2>
    <ul v-if="list">
      <li v-for="user in list.users" :key="user.id">
        <NuxtLink :to="`/users/${user.id}`">{{ user.name }}</NuxtLink>
      </li>
    </ul>
  </div>
</template>
