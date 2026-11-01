declare module '@editorjs/marker' {
  import type { InlineToolConstructable } from '@editorjs/editorjs'
  const Marker: InlineToolConstructable
  export default Marker
}
declare module 'hevue-img-preview/v3' {
  export function previewImages(options: {
    imgList: string[]
    nowImgIndex?: number
    thumbnail?: boolean
    arrowBtn?: boolean
    disableTransition?: boolean
    closeFn?: () => void
  }): { close: () => void }
}
