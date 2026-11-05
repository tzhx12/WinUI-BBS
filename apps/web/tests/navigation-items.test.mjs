import assert from 'node:assert/strict'
import { test } from 'node:test'
import { effectScope, ref } from 'vue'
import { useNavigationItems } from '../src/composables/useNavigationItems.ts'

test('permission refreshes retain expanded groups while permission removals update their children', () => {
  const scope = effectScope()
  const permissions = ref(['users', 'groups', 'settings'])
  const source = () => [
    {
      Tag: 'management',
      Content: '管理',
      MenuItems: permissions.value.map((id) => ({ Tag: `/admin/${id}`, Content: id })),
    },
  ]
  const items = scope.run(() => useNavigationItems(source))
  try {
    const group = items.value[0]
    const userItem = group.MenuItems[0]
    group.IsExpanded = true
    userItem.IsSelected = true
    permissions.value = [...permissions.value]
    assert.equal(items.value[0], group)
    assert.equal(group.IsExpanded, true)
    assert.equal(group.MenuItems[0], userItem)
    assert.equal(userItem.IsSelected, true)
    permissions.value = ['users', 'settings']
    assert.deepEqual(
      group.MenuItems.map((item) => item.Tag),
      ['/admin/users', '/admin/settings'],
    )
    assert.equal(group.MenuItems[0], userItem)
    assert.equal(group.IsExpanded, true)
  } finally {
    scope.stop()
  }
})

test('category and unread updates retain nested items and apply current labels, order and badges', () => {
  const scope = effectScope()
  const data = ref({ name: '原板块', unread: 1, children: ['a', 'b'] })
  const items = scope.run(() =>
    useNavigationItems(() => [
      {
        Tag: '/category/parent',
        Content: data.value.name,
        MenuItems: data.value.children.map((id) => ({ Tag: `/category/${id}`, Content: id })),
      },
      {
        Tag: '/notifications',
        InfoBadge: data.value.unread ? { Value: data.value.unread } : null,
      },
    ]),
  )
  try {
    const parent = items.value[0]
    const firstChild = parent.MenuItems[0]
    const notifications = items.value[1]
    parent.IsExpanded = true
    data.value = { name: '新板块', unread: 2, children: ['b', 'a'] }
    assert.equal(items.value[0], parent)
    assert.equal(parent.IsExpanded, true)
    assert.equal(parent.Content, '新板块')
    assert.equal(parent.MenuItems[1], firstChild)
    assert.equal(items.value[1], notifications)
    assert.equal(notifications.InfoBadge.Value, 2)
    data.value = { name: '新板块', unread: 0, children: [] }
    assert.deepEqual(parent.MenuItems, [])
    assert.equal(notifications.InfoBadge, null)
  } finally {
    scope.stop()
  }
})
