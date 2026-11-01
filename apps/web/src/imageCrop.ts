import type { BackgroundHeight } from './types'

export interface CropRectangle {
  x: number
  y: number
  width: number
  height: number
}

export type CropHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export interface ImageCropPreset {
  aspectRatio: readonly [number, number]
  maxWidth: number
  circularPreview?: boolean
}

// Match the wide home hero and the taller, half-viewport category background.
export const imageCropPresets = {
  avatar: { aspectRatio: [1, 1], maxWidth: 512, circularPreview: true },
  categoryIcon: { aspectRatio: [1, 1], maxWidth: 512 },
  homeBackground: { aspectRatio: [3, 1], maxWidth: 1920 },
  categoryBackground: { aspectRatio: [8, 3], maxWidth: 1920 },
  categoryBackgroundTall: { aspectRatio: [16, 9], maxWidth: 1920 },
} as const satisfies Record<string, ImageCropPreset>

export function backgroundCropPreset(height: BackgroundHeight) {
  return height === 75 ? imageCropPresets.categoryBackgroundTall : imageCropPresets.categoryBackground
}

export function imageCropRectangle(width: number, height: number, aspectRatio: number) {
  const cropWidth = Math.min(width, height * aspectRatio)
  const cropHeight = cropWidth / aspectRatio
  const x = (width - cropWidth) / 2
  const y = (height - cropHeight) / 2
  return { x, y, width: cropWidth, height: cropHeight }
}

export function imageCropOutputSize(
  cropWidth: number,
  aspectRatio: readonly [number, number],
  maxWidth: number,
) {
  const unit = Math.max(1, Math.floor(Math.min(cropWidth, maxWidth) / aspectRatio[0]))
  return { width: unit * aspectRatio[0], height: unit * aspectRatio[1] }
}

export function moveImageCrop(crop: CropRectangle, width: number, height: number, dx: number, dy: number) {
  return {
    ...crop,
    x: Math.max(0, Math.min(width - crop.width, crop.x + dx)),
    y: Math.max(0, Math.min(height - crop.height, crop.y + dy)),
  }
}

export function resizeImageCrop(
  crop: CropRectangle,
  width: number,
  height: number,
  handle: CropHandle,
  dx: number,
  dy: number,
  minimumWidth: number,
): CropRectangle {
  const ratio = crop.width / crop.height
  const horizontal = handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0
  const vertical = handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0
  const anchorX = crop.x + (horizontal > 0 ? 0 : horizontal < 0 ? crop.width : crop.width / 2)
  const anchorY = crop.y + (vertical > 0 ? 0 : vertical < 0 ? crop.height : crop.height / 2)
  const availableWidth = horizontal
    ? horizontal > 0
      ? width - anchorX
      : anchorX
    : Math.min(anchorX, width - anchorX) * 2
  const availableHeight = vertical
    ? vertical > 0
      ? height - anchorY
      : anchorY
    : Math.min(anchorY, height - anchorY) * 2
  const maximum = Math.min(availableWidth, availableHeight * ratio)
  // Project diagonal drags onto the fixed-ratio edge; keep the opposite corner anchored.
  const delta =
    horizontal && vertical
      ? (horizontal * dx + (vertical * dy) / ratio) / (1 + 1 / ratio ** 2)
      : horizontal
        ? horizontal * dx
        : vertical * dy * ratio
  const nextWidth = Math.max(Math.min(minimumWidth, maximum), Math.min(maximum, crop.width + delta))
  const nextHeight = nextWidth / ratio
  return {
    x: anchorX - (horizontal > 0 ? 0 : horizontal < 0 ? nextWidth : nextWidth / 2),
    y: anchorY - (vertical > 0 ? 0 : vertical < 0 ? nextHeight : nextHeight / 2),
    width: nextWidth,
    height: nextHeight,
  }
}
