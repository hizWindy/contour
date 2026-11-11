import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * Tailwind class merging that knows our own names from `styles/index.css`:
 * the type scale (`text-display`, `text-title`, `text-ui`, ...), the float shadow, the one easing curve and the
 * springs.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['display', 'figure', 'title', 'section', 'body', 'ui', 'caption'] }],
      shadow: [{ shadow: ['float'] }],
      ease: [{ ease: ['standard', 'spring-snappy', 'spring-smooth', 'spring-soft'] }],
    },
  },
})

/** Joins class names (like clsx) and resolves Tailwind conflicts (like tailwind-merge). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
