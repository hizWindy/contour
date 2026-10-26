import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * Tailwind class merging that knows our own names from `styles/index.css`:
 * the type scale (`text-title`, `text-ui`, ...), the float shadow and the one easing curve.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['title', 'section', 'body', 'ui', 'caption'] }],
      shadow: [{ shadow: ['float'] }],
      ease: [{ ease: ['standard'] }],
    },
  },
})

/** Joins class names (like clsx) and resolves Tailwind conflicts (like tailwind-merge). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
