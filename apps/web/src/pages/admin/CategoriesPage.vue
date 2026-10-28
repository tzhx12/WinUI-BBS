<script setup lang="ts">
import { computed, reactive, ref, resolveComponent, watch } from 'vue'
import { Button, FontIcon, NumberBox, TextBox, ToggleSwitch, TreeView } from 'winuionweb'
import { api } from '../../api'
import { useResource } from '../../composables/useResource'
import { useSite } from '../../site'
import type { Category } from '../../types'
import CategoryTreeItem from '../../components/CategoryTreeItem.vue'
import PageHeader from '../../components/ui/PageHeader.vue'
import ResourceState from '../../components/ui/ResourceState.vue'
import EmptyState from '../../components/ui/EmptyState.vue'
import WinButton from '../../components/ui/WinButton.vue'
import WinDialog from '../../components/ui/WinDialog.vue'
import WinSelect from '../../components/ui/WinSelect.vue'
defineOptions({ inheritAttrs: false })
interface CategoryNode extends Category {
  Children: CategoryNode[]
  IsExpanded: boolean
}
const site = useSite()
const {
  data: categories,
  loading,
  error,
  saving,
  reload,
  run,
} = useResource(() => api<Category[]>('/api/admin/categories', { token: site.token.value }), [])
const tree = ref<CategoryNode[]>([]),
  selected = ref<Category | null>(null)
function buildTree(parentId: string | null): CategoryNode[] {
  return categories.value
    .filter((c) => c.parent_id === parentId)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((c) => ({ ...c, IsExpanded: true, Children: buildTree(c.id) }))
}
watch(categories, () => {
  tree.value = buildTree(null)
  if (selected.value) selected.value = categories.value.find((c) => c.id === selected.value!.id) || null
})
const TreeItemTemplate = resolveComponent('TreeView.ItemTemplate')
const DataTemplate = resolveComponent('DataTemplate')
const boundItem = '{x:Bind}' as unknown as Category
const iconOptions = [
  { glyph: '\ue8b7', label: '文件夹' },
  { glyph: '\ue80f', label: '主页' },
  { glyph: '\ue8bd', label: '讨论' },
  { glyph: '\ue897', label: '问答' },
  { glyph: '\ue734', label: '星标' },
  { glyph: '\ue82f', label: '灵感' },
  { glyph: '\ue943', label: '代码' },
  { glyph: '\ue772', label: '设备' },
  { glyph: '\ue8b9', label: '图片' },
  { glyph: '\ue716', label: '成员' },
  { glyph: '\ue787', label: '活动' },
  { glyph: '\ue8f1', label: '书架' },
  { glyph: '\ue774', label: '网络' },
  { glyph: '\ue8d6', label: '音乐' },
  { glyph: '\ue736', label: '阅读' },
  { glyph: '\ue8a5', label: '文档' },
]
const dialog = ref(false),
  editing = ref<Category | null>(null)
const form = reactive({
  name: '',
  slug: '',
  parentId: '' as string | number,
  description: '',
  accentColor: '#0078d4',
  iconGlyph: '\ue8b7',
  showNotification: false,
  requiresReview: false,
  minimumReaderLevel: 0,
  minimumAuthorLevel: 1,
  sortOrder: 0,
})
const parentOptions = computed(() => {
  const excluded = new Set<string>()
  function collect(id: string) {
    excluded.add(id)
    categories.value.filter((c) => c.parent_id === id).forEach((c) => collect(c.id))
  }
  if (editing.value) collect(editing.value.id)
  return [
    { value: '', label: '顶层板块' },
    ...categories.value.filter((c) => !excluded.has(c.id)).map((c) => ({ value: c.id, label: c.name })),
  ]
})
function edit(category?: Category) {
  editing.value = category || null
  Object.assign(
    form,
    category
      ? {
          name: category.name,
          slug: category.slug,
          parentId: category.parent_id || '',
          description: category.description,
          accentColor: category.accent_color,
          iconGlyph: category.icon_glyph,
          showNotification: category.show_notification,
          requiresReview: category.requires_review,
          minimumReaderLevel: category.minimum_reader_level,
          minimumAuthorLevel: category.minimum_author_level,
          sortOrder: category.sort_order,
        }
      : {
          name: '',
          slug: '',
          parentId: '',
          description: '',
          accentColor: '#0078d4',
          iconGlyph: '\ue8b7',
          showNotification: false,
          requiresReview: false,
          minimumReaderLevel: 0,
          minimumAuthorLevel: 1,
          sortOrder: categories.value.length,
        },
  )
  error.value = ''
  dialog.value = true
}
async function refresh() {
  await Promise.all([reload(), site.loadCategories()])
  if (selected.value)
    selected.value = categories.value.find((category) => category.id === selected.value!.id) || null
}
async function save() {
  if (
    await run(
      () =>
        api(`/api/admin/categories${editing.value ? `/${editing.value.id}` : ''}`, {
          method: editing.value ? 'PATCH' : 'POST',
          token: site.token.value,
          body: { ...form, parentId: form.parentId || null },
        }),
      '板块已保存',
    )
  ) {
    dialog.value = false
    await refresh()
  }
}
async function remove(category: Category) {
  if (!(await site.confirm(`删除“${category.name}”？`, '仅可删除没有帖子和子板块的板块。', '删除'))) return
  if (
    await run(
      () => api(`/api/admin/categories/${category.id}`, { method: 'DELETE', token: site.token.value }),
      '板块已删除',
    )
  ) {
    selected.value = null
    await refresh()
  }
}
async function persistTree(_sender: unknown, args: { DropResult: string }) {
  if (args.DropResult !== 'Move') return
  await run(async () => {
    async function walk(nodes: CategoryNode[], parentId: string | null) {
      for (const [sortOrder, node] of nodes.entries()) {
        const original = categories.value.find((c) => c.id === node.id)!
        if (original.parent_id !== parentId || original.sort_order !== sortOrder)
          await api(`/api/admin/categories/${node.id}`, {
            method: 'PATCH',
            token: site.token.value,
            body: { parentId, sortOrder },
          })
        await walk(node.Children, node.id)
      }
    }
    await walk(tree.value, null)
  }, '板块结构已更新')
  await refresh()
}
function select(_sender: unknown, args: { InvokedItem: Category }) {
  selected.value = args.InvokedItem
}
</script>
<template>
  <div class="page-scroll">
    <div class="page-content">
      <PageHeader title="板块结构" description="拖动板块调整层级与顺序，选择板块查看详细设置。"
        ><WinButton label="新建板块" icon="add" accent @click="edit()" /></PageHeader
      ><ResourceState :loading="loading" :error="dialog ? '' : error" />
      <EmptyState v-if="!loading && !categories.length" title="还没有板块" icon="folder"
        ><WinButton label="新建板块" @click="edit()"
      /></EmptyState>
      <div v-else-if="!loading" class="category-editor-layout">
        <section class="surface-card tree-panel">
          <h2>板块拓扑</h2>
          <TreeView
            v-model:ItemsSource="tree"
            SelectionMode="Single"
            :CanDragItems="true"
            :CanReorderItems="true"
            :AllowDrop="true"
            :IsEnabled="!saving"
            @ItemInvoked="select"
            @DragItemsCompleted="persistTree"
            ><TreeItemTemplate
              ><DataTemplate><CategoryTreeItem :item="boundItem" /></DataTemplate></TreeItemTemplate
          ></TreeView>
        </section>
        <section class="surface-card">
          <template v-if="selected"
            ><span class="category-label"><i :style="{ background: selected.accent_color }" />板块设置</span>
            <h2>{{ selected.name }}</h2>
            <p v-if="selected.description" class="secondary-text">{{ selected.description }}</p>
            <dl class="details-list">
              <div>
                <dt>路径标识</dt>
                <dd>{{ selected.slug }}</dd>
              </div>
              <div>
                <dt>阅读等级</dt>
                <dd>{{ selected.minimum_reader_level ? `Lv.${selected.minimum_reader_level}+` : '公开' }}</dd>
              </div>
              <div>
                <dt>发帖等级</dt>
                <dd>Lv.{{ selected.minimum_author_level }}+</dd>
              </div>
              <div>
                <dt>帖子数量</dt>
                <dd>{{ selected.post_count || 0 }}</dd>
              </div>
              <div>
                <dt>发帖审核</dt>
                <dd>{{ selected.requires_review ? '需要审核' : '遵循全站设置' }}</dd>
              </div>
            </dl>
            <div class="row-actions">
              <WinButton label="编辑板块" icon="edit" @click="edit(selected)" /><WinButton
                label="删除"
                icon="delete"
                subtle
                @click="remove(selected)"
              /></div></template
          ><EmptyState
            v-else
            title="选择一个板块"
            description="查看阅读等级、发帖等级和板块设置。"
            icon="folder"
          />
        </section>
      </div>
      <WinDialog
        v-model:open="dialog"
        :title="editing ? '编辑板块' : '新建板块'"
        primary="保存"
        :busy="saving"
        :error="error"
        @primary="save"
        ><div class="form-columns">
          <TextBox v-model:Text="form.name" Header="名称" aria-label="板块名称" :MaxLength="64" /><TextBox
            v-model:Text="form.slug"
            Header="路径标识"
            PlaceholderText="例如 general"
            aria-label="板块路径标识"
            :MaxLength="72"
          />
        </div>
        <fieldset class="category-icon-picker">
          <legend>板块图标</legend>
          <div class="category-icon-grid">
            <Button
              v-for="icon in iconOptions"
              :key="icon.glyph"
              :Style="
                form.iconGlyph === icon.glyph
                  ? '{StaticResource AccentButtonStyle}'
                  : '{StaticResource DefaultButtonStyle}'
              "
              :aria-label="icon.label"
              :aria-pressed="form.iconGlyph === icon.glyph"
              :title="icon.label"
              @Click="form.iconGlyph = icon.glyph"
            >
              <FontIcon :Glyph="icon.glyph" FontFamily="Segoe Fluent Icons" :FontSize="20" />
            </Button>
          </div>
        </fieldset>
        <ToggleSwitch
          v-model:IsOn="form.showNotification"
          Header="板块通知徽标"
          OnContent="开启"
          OffContent="关闭" />
        <WinSelect v-model="form.parentId" label="父板块" :options="parentOptions" /><TextBox
          v-model:Text="form.description"
          Header="说明"
          aria-label="板块说明"
          :MaxLength="500" />
        <ToggleSwitch
          v-model:IsOn="form.requiresReview"
          Header="此板块发帖需要审核"
          OnContent="需要审核"
          OffContent="遵循全站设置" />
        <div class="form-columns">
          <NumberBox
            v-model:Value="form.minimumReaderLevel"
            Header="最低阅读等级"
            :Minimum="0"
            SpinButtonPlacementMode="Inline"
            AutomationProperties.Name="最低阅读等级"
          /><NumberBox
            v-model:Value="form.minimumAuthorLevel"
            Header="最低发帖等级"
            :Minimum="1"
            SpinButtonPlacementMode="Inline"
            AutomationProperties.Name="最低发帖等级"
          />
        </div>
        <div class="form-columns">
          <NumberBox
            v-model:Value="form.sortOrder"
            Header="排序"
            SpinButtonPlacementMode="Inline"
            AutomationProperties.Name="板块排序"
          />
          <div class="color-field">
            <TextBox
              v-model:Text="form.accentColor"
              Header="标记颜色"
              aria-label="板块标记颜色"
              :MaxLength="7"
            /><span :style="{ background: form.accentColor }" />
          </div></div
      ></WinDialog>
    </div>
  </div>
</template>
