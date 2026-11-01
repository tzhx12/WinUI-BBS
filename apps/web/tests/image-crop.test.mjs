import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  imageCropOutputSize,
  imageCropPresets,
  imageCropRectangle,
  moveImageCrop,
  resizeImageCrop,
  backgroundCropPreset,
} from '../src/imageCrop.ts'

const handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`)

test('fixed background crop ratios follow their visible viewport range without changing home', () => {
  assert.deepEqual(backgroundCropPreset(50).aspectRatio, [8, 3])
  assert.deepEqual(backgroundCropPreset(75).aspectRatio, [16, 9])
  assert.deepEqual(imageCropPresets.homeBackground.aspectRatio, [3, 1])
})

test('square crops start at the center of landscape and portrait images', () => {
  assert.deepEqual(imageCropRectangle(1200, 800, 1), { x: 200, y: 0, width: 800, height: 800 })
  assert.deepEqual(imageCropRectangle(800, 1200, 1), { x: 0, y: 200, width: 800, height: 800 })
})

test('moving the selection follows the pointer and stops at all image boundaries', () => {
  const crop = { x: 200, y: 100, width: 400, height: 400 }
  assert.deepEqual(moveImageCrop(crop, 1200, 800, 60, 30), { ...crop, x: 260, y: 130 })
  assert.deepEqual(moveImageCrop(crop, 1200, 800, -5000, -5000), { ...crop, x: 0, y: 0 })
  assert.deepEqual(moveImageCrop(crop, 1200, 800, 5000, 5000), { ...crop, x: 800, y: 400 })
})

test('corner resizing keeps the opposite corner anchored and follows both pointer axes', () => {
  const crop = { x: 200, y: 100, width: 400, height: 400 }
  assert.deepEqual(resizeImageCrop(crop, 1200, 800, 'se', -100, -100, 50), {
    ...crop,
    width: 300,
    height: 300,
  })
  assert.deepEqual(resizeImageCrop(crop, 1200, 800, 'nw', 100, 100, 50), {
    x: 300,
    y: 200,
    width: 300,
    height: 300,
  })
  assert.deepEqual(resizeImageCrop(crop, 1200, 800, 'ne', -100, 100, 50), {
    x: 200,
    y: 200,
    width: 300,
    height: 300,
  })
  assert.deepEqual(resizeImageCrop(crop, 1200, 800, 'sw', 100, -100, 50), {
    x: 300,
    y: 100,
    width: 300,
    height: 300,
  })
})

test('edge resizing keeps the opposite edge and its midpoint anchored', () => {
  const crop = { x: 200, y: 100, width: 400, height: 400 }
  assert.deepEqual(resizeImageCrop(crop, 1200, 800, 'e', -100, 0, 50), {
    x: 200,
    y: 150,
    width: 300,
    height: 300,
  })
  assert.deepEqual(resizeImageCrop(crop, 1200, 800, 'w', 100, 0, 50), {
    x: 300,
    y: 150,
    width: 300,
    height: 300,
  })
  assert.deepEqual(resizeImageCrop(crop, 1200, 800, 's', 0, -100, 50), {
    x: 250,
    y: 100,
    width: 300,
    height: 300,
  })
  assert.deepEqual(resizeImageCrop(crop, 1200, 800, 'n', 0, 100, 50), {
    x: 250,
    y: 200,
    width: 300,
    height: 300,
  })
})

test('all eight handles retain each preset ratio, image bounds and the resize anchor', () => {
  for (const preset of Object.values(imageCropPresets)) {
    const ratio = preset.aspectRatio[0] / preset.aspectRatio[1]
    for (const [width, height] of [
      [1200, 800],
      [600, 1800],
      [2400, 400],
    ]) {
      const initial = imageCropRectangle(width, height, ratio)
      for (const crop of [
        initial,
        {
          x: initial.x + initial.width / 4,
          y: initial.y + initial.height / 4,
          width: initial.width / 2,
          height: initial.height / 2,
        },
      ]) {
        for (const handle of handles) {
          for (const dx of [-10000, -50, 0, 50, 10000])
            for (const dy of [-10000, -50, 0, 50, 10000]) {
              const next = resizeImageCrop(crop, width, height, handle, dx, dy, 48)
              assert.ok(next.x >= -1e-7 && next.y >= -1e-7)
              assert.ok(next.x + next.width <= width + 1e-7 && next.y + next.height <= height + 1e-7)
              assert.ok(next.width >= Math.min(48, crop.width) - 1e-7)
              near(next.width / next.height, ratio)
              near(
                next.x + next.width * (handle.includes('w') ? 1 : handle.includes('e') ? 0 : 0.5),
                crop.x + crop.width * (handle.includes('w') ? 1 : handle.includes('e') ? 0 : 0.5),
              )
              near(
                next.y + next.height * (handle.includes('n') ? 1 : handle.includes('s') ? 0 : 0.5),
                crop.y + crop.height * (handle.includes('n') ? 1 : handle.includes('s') ? 0 : 0.5),
              )
            }
        }
      }
    }
  }
})

test('exports retain exact preset proportions and cap resolution without upscaling', () => {
  for (const preset of Object.values(imageCropPresets)) {
    for (const sourceWidth of [127.7, 512, 2037.5, 8000]) {
      const size = imageCropOutputSize(sourceWidth, preset.aspectRatio, preset.maxWidth)
      assert.equal(size.width * preset.aspectRatio[1], size.height * preset.aspectRatio[0])
      assert.ok(size.width <= sourceWidth && size.width <= preset.maxWidth)
      assert.ok(Number.isInteger(size.width) && Number.isInteger(size.height))
    }
  }
})
