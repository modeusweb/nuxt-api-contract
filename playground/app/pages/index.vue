<script setup lang="ts">
import { CreateUserContract, ListUsersContract, UploadAvatarContract } from '~~/contracts/users'

const { data, error } = await useApi(ListUsersContract, {
  query: { page: 1, limit: 10 },
})

const name = ref('')
const email = ref('')
const created = ref<{ id: string, name: string, email: string } | null>(null)
const createError = ref<string | null>(null)

async function createUser() {
  createError.value = null
  // `useApiClient()` is synchronous and captures the Nuxt context, so it can
  // also be called outside of setup (actions, stores, plugins).
  const client = useApiClient()
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

/* --- multipart upload (1.0.0) --- */
const avatarInput = ref<HTMLInputElement | null>(null)
const caption = ref('')
const uploaded = ref<{ fileName: string, size: number, crop: boolean, width: number | null } | null>(null)
const uploadError = ref<string | null>(null)

async function uploadAvatar() {
  uploadError.value = null
  const file = avatarInput.value?.files?.[0]
  if (!file) {
    uploadError.value = 'Pick a file first'
    return
  }

  const client = useApiClient()
  const { data: result, error: err } = await client.tryRequest(UploadAvatarContract, {
    params: { id: '1' },
    body: { file, caption: caption.value || undefined, crop: true, width: 512 },
  })

  if (err) {
    uploadError.value = `${err.code}: ${err.message}`
  } else {
    uploaded.value = result
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

    <h2>Upload avatar (multipart)</h2>
    <form @submit.prevent="uploadAvatar">
      <input ref="avatarInput" type="file" accept="image/*">
      <input v-model="caption" placeholder="Caption">
      <button type="submit">Upload</button>
    </form>
    <p v-if="uploaded">
      Uploaded {{ uploaded.fileName }} ({{ uploaded.size }} bytes, crop: {{ uploaded.crop }}, width: {{ uploaded.width }})
    </p>
    <p v-if="uploadError" style="color: crimson">{{ uploadError }}</p>
  </div>
</template>
