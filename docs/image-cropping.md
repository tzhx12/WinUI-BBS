# 图片裁剪

头像、首页背景、板块背景、热门讨论背景和板块图标在选择文件后打开共用的 `ImageCropDialog`。在原图上拖动裁剪框移动选区，拖动四角或边缘手柄调整大小，比例保持固定。预览完整显示原图，并按图片宽高比适应可用空间，图片外没有额外画布。点击保存后才上传；取消会丢弃本次裁剪，上传失败时保留裁剪范围以便重试。

裁剪框获得焦点后，方向键移动选区；手柄获得焦点后，方向键调整对应边角。按住 Shift 可加快调整。

## 新的裁剪入口复用 ImageCropDialog

后续图片裁剪均复用 `apps/web/src/components/ui/ImageCropDialog.vue`，不要在上传页面单独实现 Canvas 裁剪逻辑。文件选择、格式校验、解码、移动、缩放和导出由组件负责；调用方继续负责原有上传 API、权限和保存后的状态刷新。

```vue
<script setup lang="ts">
import { ref } from "vue";
import ImageCropDialog from "./components/ui/ImageCropDialog.vue";
import WinButton from "./components/ui/WinButton.vue";
import { imageCropPresets } from "./imageCrop";
import { api, uploadForm } from "./api";
import { useSite } from "./site";

const cropper = ref<InstanceType<typeof ImageCropDialog> | null>(null);
const site = useSite();
const busy = ref(false),
  error = ref("");
async function save(file: File) {
  busy.value = true;
  error.value = "";
  try {
    await api("/api/me/avatar", {
      method: "POST",
      token: site.token.value,
      body: uploadForm(file),
    });
    await site.refreshUser();
    cropper.value?.close();
  } catch (cause) {
    error.value = (cause as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <WinButton label="上传头像" @click="cropper?.choose()" />
  <ImageCropDialog
    ref="cropper"
    title="裁剪头像"
    v-bind="imageCropPresets.avatar"
    :busy="busy"
    :error="error"
    @selected="error = ''"
    @confirm="save"
  />
</template>
```

`choose()` 打开文件选择器；`confirm` 提供裁剪后的 `File`；`close()` 在保存成功后关闭对话框。`busy` 在上传期间禁用编辑和关闭。`maxBytes` 同时检查原文件与导出文件，未设置时沿用上传 API 的大小限制。

## 固定比例

预设集中在 `apps/web/src/imageCrop.ts`。头像和板块图标为 1:1，最大宽度 512px；首页背景保持 3:1；板块与热门讨论背景通过 `backgroundCropPreset(height)` 按显示范围选择比例：半屏（50）为 8:3、3/4 屏（75）为 16:9，最大宽度 1920px。两种范围使用同一套共用裁剪交互。原有响应式 `object-fit: cover` 展示保留，视口变化时仍会裁去边缘。管理页预览使用相同的上传比例。

导出按原图像素裁剪并限制最大分辨率；输出宽高为比例的整数倍。JPEG、PNG、WebP 保持对应格式，PNG 和 WebP 保留透明通道；动图固定为解码后的首帧，GIF 输出 PNG。头像裁剪仍输出方形图片，圆形参考线对应实际头像显示。

`npm run check:crop -w apps/web` 检查移动、八个手柄的比例与边界、固定锚点和导出尺寸，已纳入 `npm run check`。
