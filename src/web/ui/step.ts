// The index after moving `delta` places from `current` in a list of `count` items, wrapping at both ends. Pure: no DOM.
// (`current` is -1 when nothing has the focus yet: the first ArrowDown lands on 0.)
export const step = (count: number, current: number, delta: 1 | -1): number => (current < 0 ? (delta > 0 ? 0 : count - 1) : (current + delta + count) % count);
