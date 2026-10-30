import { createRouter, createWebHashHistory } from 'vue-router'
import FeedPage from './pages/FeedPage.vue'
import PostPage from './pages/PostPage.vue'
import ComposePage from './pages/ComposePage.vue'
import ProfilePage from './pages/ProfilePage.vue'
import PublicGroupsPage from './pages/PublicGroupsPage.vue'
import AppearancePage from './pages/AppearancePage.vue'
import UserDashboardPage from './pages/UserDashboardPage.vue'
import MyInvitationsPage from './pages/MyInvitationsPage.vue'
import TrashPage from './pages/TrashPage.vue'
import OverviewPage from './pages/admin/OverviewPage.vue'
import UsersPage from './pages/admin/UsersPage.vue'
import GroupsPage from './pages/admin/GroupsPage.vue'
import LevelsPage from './pages/admin/LevelsPage.vue'
import CategoriesPage from './pages/admin/CategoriesPage.vue'
import PostsPage from './pages/admin/PostsPage.vue'
import MediaPage from './pages/admin/MediaPage.vue'
import SettingsPage from './pages/admin/SettingsPage.vue'
import AuditPage from './pages/admin/AuditPage.vue'
import InvitationsPage from './pages/admin/InvitationsPage.vue'
import MyImagesPage from './pages/MyImagesPage.vue'
import NotificationsPage from './pages/NotificationsPage.vue'
import AdminNotificationsPage from './pages/admin/NotificationsPage.vue'
import ReviewsPage from './pages/admin/ReviewsPage.vue'
import ReviewSettingsPage from './pages/admin/ReviewSettingsPage.vue'
import DeletedPostsPage from './pages/admin/DeletedPostsPage.vue'
import AboutPage from './pages/AboutPage.vue'
import RegistrationPage from './pages/admin/RegistrationPage.vue'
import MailSettingsPage from './pages/admin/MailSettingsPage.vue'
import ResetPasswordPage from './pages/ResetPasswordPage.vue'
import ContentSettingsPage from './pages/admin/ContentSettingsPage.vue'
import FavoritesPage from './pages/FavoritesPage.vue'
import UserSpacePage from './pages/UserSpacePage.vue'
import FollowingPage from './pages/FollowingPage.vue'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/home' },
    { path: '/home', component: FeedPage },
    { path: '/popular', component: FeedPage },
    { path: '/search', component: FeedPage },
    { path: '/category/:id', component: FeedPage },
    { path: '/post/:id', component: PostPage },
    { path: '/compose', component: ComposePage },
    { path: '/profile', component: ProfilePage },
    { path: '/users/:id', component: UserSpacePage },
    { path: '/favorites/:id', component: FavoritesPage },
    { path: '/groups', component: PublicGroupsPage },
    { path: '/appearance', component: AppearancePage },
    { path: '/about', component: AboutPage },
    { path: '/reset-password', component: ResetPasswordPage },
    { path: '/account', component: UserDashboardPage },
    { path: '/account/favorites', component: FavoritesPage },
    { path: '/account/following', component: FollowingPage },
    { path: '/account/favorites/:id', component: FavoritesPage },
    { path: '/account/invitations', component: MyInvitationsPage },
    { path: '/account/trash', component: TrashPage },
    { path: '/account/trash/:id', component: PostPage },
    { path: '/my-images', component: MyImagesPage },
    { path: '/notifications', component: NotificationsPage },
    ...[
      ['overview', OverviewPage],
      ['users', UsersPage],
      ['invitations', InvitationsPage],
      ['groups', GroupsPage],
      ['levels', LevelsPage],
      ['categories', CategoriesPage],
      ['posts', PostsPage],
      ['deleted-posts', DeletedPostsPage],
      ['reviews', ReviewsPage],
      ['review-settings', ReviewSettingsPage],
      ['content-settings', ContentSettingsPage],
      ['notifications', AdminNotificationsPage],
      ['media', MediaPage],
      ['settings', SettingsPage],
      ['registration', RegistrationPage],
      ['mail', MailSettingsPage],
      ['appearance', AppearancePage],
      ['audit', AuditPage],
    ].map(([section, component]) => ({
      path: `/admin/${section}`,
      component: component as typeof OverviewPage,
    })),
    { path: '/:pathMatch(.*)*', redirect: '/home' },
  ],
})
