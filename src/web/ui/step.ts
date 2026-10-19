/** Returns the index after moving one place from `current` in a list of `count` items, wrapping at both ends. `current` is -1 when nothing has focus, so ArrowDown lands on 0. Pure: no DOM. */
export const step = (count: number, current: number, delta: 1 | -1): number => (current < 0 ? (delta > 0 ? 0 : count - 1) : (current + delta + count) % count);
