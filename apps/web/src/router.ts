import { createRouter, createWebHashHistory } from 'vue-router'
const SetupView = () => import('./components/SetupView.vue')
const FeedPage = () => import('./pages/FeedPage.vue')
const PostPage = () => import('./pages/PostPage.vue')
const ComposePage = () => import('./pages/ComposePage.vue')
const ProfilePage = () => import('./pages/ProfilePage.vue')
const PublicGroupsPage = () => import('./pages/PublicGroupsPage.vue')
const AppearancePage = () => import('./pages/AppearancePage.vue')
const UserDashboardPage = () => import('./pages/UserDashboardPage.vue')
const MyInvitationsPage = () => import('./pages/MyInvitationsPage.vue')
const TrashPage = () => import('./pages/TrashPage.vue')
const OverviewPage = () => import('./pages/admin/OverviewPage.vue')
const UsersPage = () => import('./pages/admin/UsersPage.vue')
const GroupsPage = () => import('./pages/admin/GroupsPage.vue')
const LevelsPage = () => import('./pages/admin/LevelsPage.vue')
const CategoriesPage = () => import('./pages/admin/CategoriesPage.vue')
const PostsPage = () => import('./pages/admin/PostsPage.vue')
const ReportsPage = () => import('./pages/admin/ReportsPage.vue')
const MediaPage = () => import('./pages/admin/MediaPage.vue')
const SettingsPage = () => import('./pages/admin/SettingsPage.vue')
const AuditPage = () => import('./pages/admin/AuditPage.vue')
const InvitationsPage = () => import('./pages/admin/InvitationsPage.vue')
const MyImagesPage = () => import('./pages/MyImagesPage.vue')
const NotificationsPage = () => import('./pages/NotificationsPage.vue')
const AdminNotificationsPage = () => import('./pages/admin/NotificationsPage.vue')
const ReviewsPage = () => import('./pages/admin/ReviewsPage.vue')
const ReviewSettingsPage = () => import('./pages/admin/ReviewSettingsPage.vue')
const DeletedPostsPage = () => import('./pages/admin/DeletedPostsPage.vue')
const AboutPage = () => import('./pages/AboutPage.vue')
const RegistrationPage = () => import('./pages/admin/RegistrationPage.vue')
const MailSettingsPage = () => import('./pages/admin/MailSettingsPage.vue')
const ResetPasswordPage = () => import('./pages/ResetPasswordPage.vue')
const ContentSettingsPage = () => import('./pages/admin/ContentSettingsPage.vue')
const FavoritesPage = () => import('./pages/FavoritesPage.vue')
const UserSpacePage = () => import('./pages/UserSpacePage.vue')
const FollowingPage = () => import('./pages/FollowingPage.vue')
const HomeSettingsPage = () => import('./pages/admin/HomeSettingsPage.vue')
const AccountProfilePage = () => import('./pages/AccountProfilePage.vue')

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/home' },
    { path: '/home', component: FeedPage },
    { path: '/popular', component: FeedPage },
    { path: '/search', component: FeedPage },
    { path: '/category/:categorySlug', component: FeedPage },
    { path: '/category/:categorySlug/post/:id', component: PostPage },
    { path: '/setup/:setupToken', component: SetupView },
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
    { path: '/account/profile', component: AccountProfilePage },
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
      ['home-settings', HomeSettingsPage],
      ['categories', CategoriesPage],
      ['posts', PostsPage],
      ['reports', ReportsPage],
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
