<script setup lang="ts">
import { HyperlinkButton } from 'winuionweb'
import { projectInfo } from '../projectInfo'
import PageHeader from '../components/ui/PageHeader.vue'

defineOptions({ inheritAttrs: false })

const projectGroups = [
  {
    title: '界面与编辑器',
    projects: [
      {
        name: 'WinUIonWeb',
        purpose: 'WinUI 风格组件、布局与主题',
        url: 'https://github.com/Furry-Xiyi/WinUIonWeb',
      },
      { name: 'Vue', purpose: '响应式界面与组件系统', url: 'https://vuejs.org/' },
      { name: 'Vue Router', purpose: '社区与管理后台路由', url: 'https://router.vuejs.org/' },
      { name: 'Editor.js', purpose: '块编辑器与图文工具', url: 'https://github.com/codex-team/editor.js' },
      { name: 'DOMPurify', purpose: '富文本内容净化', url: 'https://github.com/cure53/DOMPurify' },
      { name: 'MathLive', purpose: 'WinUIonWeb 的数学内容支持', url: 'https://cortexjs.io/mathlive/' },
      { name: 'rtf.js', purpose: 'WinUIonWeb 的 RTF 内容支持', url: 'https://github.com/tbluemel/rtf.js' },
    ],
  },
  {
    title: '服务与数据',
    projects: [
      { name: 'Node.js', purpose: '服务端运行环境', url: 'https://nodejs.org/' },
      { name: 'Fastify', purpose: 'API、鉴权、上传与静态资源插件', url: 'https://fastify.dev/' },
      { name: 'PostgreSQL', purpose: '关系数据库与事务', url: 'https://www.postgresql.org/' },
      {
        name: 'node-postgres',
        purpose: 'PostgreSQL 连接与查询',
        url: 'https://github.com/brianc/node-postgres',
      },
      { name: 'Zod', purpose: '请求数据校验', url: 'https://zod.dev/' },
      { name: 'bcrypt.js', purpose: '账号密码哈希', url: 'https://github.com/dcodeIO/bcrypt.js' },
      { name: 'dotenv', purpose: '开发环境配置加载', url: 'https://github.com/motdotla/dotenv' },
    ],
  },
  {
    title: '开发工具',
    projects: [
      { name: 'Vite', purpose: '前端开发与构建', url: 'https://vite.dev/' },
      { name: 'TypeScript', purpose: '类型检查', url: 'https://www.typescriptlang.org/' },
      { name: 'tsx', purpose: 'API 开发与集成测试运行', url: 'https://tsx.hirok.io/' },
      {
        name: 'concurrently',
        purpose: '前后端开发进程管理',
        url: 'https://github.com/open-cli-tools/concurrently',
      },
      { name: 'Prettier', purpose: '代码格式化', url: 'https://prettier.io/' },
    ],
  },
]
</script>

<template>
  <div class="page-scroll">
    <div class="page-content about-page">
      <PageHeader title="关于" />
      <section class="about-identity">
        <img src="/brand-mark.png" alt="" class="about-logo" />
        <div>
          <h2>{{ projectInfo.name }}</h2>
          <div class="tag-list">
            <span class="tag">版本 {{ projectInfo.version }}</span
            ><span class="tag">{{ projectInfo.license }}</span>
          </div>
          <p>让社区讨论拥有熟悉的 WinUI 界面。</p>
        </div>
      </section>
      <section class="about-introduction">
        <p>
          WinUI-BBS 是一款开源论坛系统，采用 Vue、WinUIonWeb、Fastify 和 PostgreSQL
          构建，提供分级板块、用户组权限、发帖审核、站内公告与个人图床。
        </p>
        <p>
          帖子采用 Editor.js
          块编辑器，支持图片、引用、列表和剧透。管理员可以通过可视化后台配置注册邀请、等级经验、内容审核与上传限额。
        </p>
        <HyperlinkButton
          Content="查看 GPL-3.0 许可证"
          NavigateUri="https://www.gnu.org/licenses/gpl-3.0.html"
          TargetName="_blank"
          rel="noopener noreferrer"
        />
      </section>
      <div class="about-acknowledgements">
        <h2>开源致谢</h2>
        <p class="secondary-text">感谢以下项目为界面、内容创作与社区服务提供支持。</p>
      </div>
      <div class="about-project-grid">
        <section v-for="group in projectGroups" :key="group.title" class="surface-card about-project-group">
          <h3>{{ group.title }}</h3>
          <div v-for="project in group.projects" :key="project.name" class="about-project-row">
            <HyperlinkButton
              :Content="project.name"
              :NavigateUri="project.url"
              TargetName="_blank"
              rel="noopener noreferrer"
              :aria-label="`${project.name} 项目主页`"
            />
            <span class="secondary-text">{{ project.purpose }}</span>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.about-page {
  max-width: 1360px;
}
.about-identity {
  display: flex;
  align-items: center;
  gap: 24px;
  margin: 8px 0 28px;
}
.about-logo {
  width: 80px;
  height: 80px;
  object-fit: contain;
  flex-shrink: 0;
}
.about-identity h2 {
  font-size: 32px;
  margin-bottom: 12px;
  letter-spacing: -0.5px;
}
.about-identity p {
  margin: 12px 0 0;
  color: var(--text-secondary);
}
.about-introduction {
  max-width: 850px;
  margin-bottom: 36px;
}
.about-introduction p {
  line-height: 1.8;
}
.about-introduction :deep(.win-hyperlink-button) {
  display: inline-flex;
  margin-left: -12px;
}
.about-acknowledgements h2 {
  margin-bottom: 8px;
}
.about-acknowledgements p {
  margin-bottom: 20px;
}
.about-project-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 20px;
}
.about-project-group {
  margin-bottom: 0;
  padding: 20px;
}
.about-project-group h3 {
  margin-bottom: 16px;
}
.about-project-row {
  display: grid;
  justify-items: start;
  padding: 10px 0;
  border-top: 1px solid var(--card-stroke);
}
.about-project-row :deep(.win-hyperlink-button) {
  margin-left: -12px;
}
.about-project-row > span {
  font-size: 13px;
  line-height: 1.5;
  margin-top: 3px;
}
@media (max-width: 1100px) {
  .about-project-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 700px) {
  .about-project-grid {
    grid-template-columns: 1fr;
  }
  .about-identity {
    gap: 16px;
  }
  .about-logo {
    width: 60px;
    height: 60px;
  }
  .about-identity h2 {
    font-size: 28px;
  }
}
</style>
