<script setup lang="ts">
import { computed } from 'vue'
import { PersonPicture } from 'winuionweb'
import type { PostSummary } from '../types'
import { formatDate } from '../utils'
import { previewText } from '../content'
import IconGlyph from './IconGlyph.vue'
import WinButton from './ui/WinButton.vue'
const props = defineProps<{ item: PostSummary; canDelete?: boolean }>()
defineEmits<{ delete: [post: PostSummary] }>()
const excerpt = computed(() =>
  props.item.body.blocks
    .filter((block) => ['paragraph', 'header', 'quote'].includes(block.type))
    .map((block) => previewText(block.data.text))
    .join(' ')
    .slice(0, 140),
)
</script>
<template>
  <article class="post-list-item">
    <PersonPicture
      :DisplayName="item.display_name"
      :ProfilePicture="item.avatar_url || undefined"
      :Width="40"
      :Height="40"
    />
    <div class="post-list-copy">
      <div class="post-list-labels">
        <span class="category-label"
          ><i :style="{ background: item.category_color }" />{{ item.category_name }}</span
        ><span v-if="item.is_pinned" class="tag"><IconGlyph name="pin" :size="12" />置顶</span
        ><span v-if="item.minimum_reader_level" class="tag"
          ><IconGlyph name="lock" :size="12" />Lv.{{ item.minimum_reader_level }}+</span
        ><span v-if="item.status && item.status !== 'published'" class="tag">{{
          item.status === 'pending' ? '待审核' : item.status === 'rejected' ? '未通过' : '已隐藏'
        }}</span>
      </div>
      <h2>{{ item.title }}</h2>
      <p v-if="excerpt" class="post-excerpt">{{ excerpt }}</p>
      <div class="post-list-meta">
        <span>{{ item.display_name }}</span
        ><span>UID {{ item.author_uid }}</span
        ><time>{{ formatDate(item.created_at) }}</time>
      </div>
    </div>
    <div class="post-list-stats">
      <span><IconGlyph name="chat" :size="15" />{{ item.reply_count }}</span
      ><span><IconGlyph name="eye" :size="15" />{{ item.view_count }}</span>
    </div>
    <div v-if="canDelete" class="post-list-actions" @click.stop>
      <WinButton label="删除帖子" icon="delete" subtle @click="$emit('delete', item)" />
    </div>
  </article>
</template>
