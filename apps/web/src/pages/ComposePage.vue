<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { InfoBar, NumberBox, TextBox } from 'winuionweb'
import { api } from '../api'
import { useSite } from '../site'
import type { PageParameter } from '../types'
import EditorComposer from '../components/EditorComposer.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import WinButton from '../components/ui/WinButton.vue'
import WinSelect from '../components/ui/WinSelect.vue'
defineOptions({ inheritAttrs: false })
const props = defineProps<{ Parameter: PageParameter }>()
const site = useSite(),
  router = useRouter()
const title = ref(''),
  error = ref(''),
  busy = ref(false),
  readerLevel = ref(0)
const editor = ref<InstanceType<typeof EditorComposer> | null>(null)
const allowedCategories = computed(() =>
  site.categories.value.filter((c) => c.minimum_author_level <= (site.user.value?.level || 0)),
)
const requestedCategory = allowedCategories.value.find((c) => c.id === props.Parameter.query.category)?.id
const category = ref(requestedCategory || allowedCategories.value[0]?.id || '')
const canPost = computed(() => site.user.value?.permissions?.includes('posts.create'))
const canSetReaderLevel = computed(() => site.user.value?.permissions?.includes('posts.set_reader_level'))
const metadata = computed(() => ({
  title: title.value,
  category: category.value,
  readerLevel: readerLevel.value,
}))
function restoreDraft(value: Record<string, unknown>) {
  title.value = String(value.title || '')
  if (!requestedCategory && allowedCategories.value.some((c) => c.id === value.category))
    category.value = String(value.category)
  readerLevel.value = Number(value.readerLevel || 0)
}
const requiresReview = computed(() => {
  const permissions = site.user.value?.permissions || []
  return (
    permissions.includes('posts.require_review') ||
    (!permissions.includes('posts.bypass_review') &&
      (site.settings.postsRequireReview ||
        site.categories.value.find((c) => c.id === category.value)?.requires_review))
  )
})
async function publish() {
  busy.value = true
  error.value = ''
  try {
    const body = await editor.value!.save()
    if (title.value.trim().length < 4) throw new Error('标题至少需要 4 个字')
    if (!body.blocks.length) throw new Error('请输入帖子正文')
    const result = await api<{ post: { id: string; status: string } }>('/api/posts', {
      method: 'POST',
      token: site.token.value,
      body: await editor.value!.submission({
        categoryId: category.value,
        title: title.value,
        ...(canSetReaderLevel.value ? { minimumReaderLevel: readerLevel.value } : {}),
      }),
    })
    await editor.value!.clearDraft()
    await Promise.all([site.refreshUser(), site.loadCategories()])
    site.notify(result.post.status === 'pending' ? '帖子已提交，等待审核' : '帖子已发布')
    void router.replace(`/post/${result.post.id}`)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '发布失败'
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <div class="page-scroll">
    <div class="page-content compose-page">
      <PageHeader title="发布帖子"
        ><WinButton label="返回社区" icon="back" @click="router.push('/home')"
      /></PageHeader>
      <EmptyState v-if="!site.user.value" title="登录后发布帖子" icon="person"
        ><WinButton label="登录" accent @click="site.authOpen.value = true"
      /></EmptyState>
      <InfoBar
        :IsOpen="true"
        v-else-if="!canPost"
        Message="当前用户组没有发帖权限"
        Severity="Warning"
        :IsClosable="false"
      />
      <InfoBar
        :IsOpen="true"
        v-else-if="!allowedCategories.length"
        Message="当前等级还不能在任何板块发帖"
        Severity="Warning"
        :IsClosable="false"
      />
      <form v-else class="compose-form" @submit.prevent="publish">
        <TextBox
          v-model:Text="title"
          Header="标题"
          PlaceholderText="给这场讨论起个标题"
          aria-label="帖子标题"
          :MaxLength="180"
        />
        <div class="form-columns">
          <WinSelect
            v-model="category"
            label="发布到板块"
            :options="allowedCategories.map((c) => ({ value: c.id, label: c.name }))"
          /><NumberBox
            v-if="canSetReaderLevel"
            v-model:Value="readerLevel"
            Header="最低阅读等级"
            :Minimum="0"
            SpinButtonPlacementMode="Inline"
            AutomationProperties.Name="最低阅读等级"
          />
        </div>
        <section class="editor-surface">
          <EditorComposer
            :key="site.user.value!.uid"
            ref="editor"
            :token="site.token.value!"
            :draft-key="`post:${site.user.value!.uid}`"
            :metadata="metadata"
            @restored="restoreDraft"
          />
        </section>
        <p v-if="requiresReview" class="field-hint">此帖需审核，通过后会向社区公开。</p>
        <InfoBar :IsOpen="true" v-if="error" :Message="error" Severity="Error" :IsClosable="false" />
        <div class="form-actions">
          <WinButton
            :label="busy ? '正在发布…' : '发布帖子'"
            icon="add"
            accent
            :disabled="busy"
            @click="publish"
          />
        </div>
      </form>
    </div>
  </div>
</template>
