import { afterEach, describe, expect, it, vi } from 'vitest'
import { notifyCapabilityChange, subscribeCapabilityChange } from './notify.ts'

const unsubscribers: Array<() => void> = []

function subscribe(listener: () => void): () => void {
  const unsub = subscribeCapabilityChange(listener)
  unsubscribers.push(unsub)
  return unsub
}

afterEach(() => {
  while (unsubscribers.length) unsubscribers.pop()?.()
})

describe('notifyCapabilityChange', () => {
  it('delivers one publish to every current subscriber', () => {
    const a = vi.fn()
    const b = vi.fn()
    subscribe(a)
    subscribe(b)

    notifyCapabilityChange()

    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('stops delivering after unsubscribe', () => {
    const kept = vi.fn()
    const dropped = vi.fn()
    subscribe(kept)
    const unsub = subscribe(dropped)

    unsub()
    notifyCapabilityChange()

    expect(kept).toHaveBeenCalledTimes(1)
    expect(dropped).not.toHaveBeenCalled()
  })

  it('keeps notifying others when a listener throws', () => {
    const boom = vi.fn(() => {
      throw new Error('subscriber failed')
    })
    const later = vi.fn()
    subscribe(boom)
    subscribe(later)

    expect(() => notifyCapabilityChange()).not.toThrow()
    expect(boom).toHaveBeenCalledTimes(1)
    expect(later).toHaveBeenCalledTimes(1)
  })

  it('iterates a snapshot so unsubscribing during notify does not skip others', () => {
    const later = vi.fn()
    let unsubSelf: () => void = () => undefined
    const self = vi.fn(() => {
      unsubSelf()
    })
    unsubSelf = subscribe(self)
    subscribe(later)

    notifyCapabilityChange()

    expect(self).toHaveBeenCalledTimes(1)
    expect(later).toHaveBeenCalledTimes(1)
  })
})
