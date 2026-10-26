/**
 * The design rules from engine/DESIGN.md that a machine can check by reading source text.
 * `design-lint.test.ts` runs them over `src`. Each rule has examples it must flag (`bad`) and
 * examples it must leave alone (`good`), and the test proves both, so a typo in a pattern
 * cannot silently switch a rule off.
 */

export interface DesignRule {
  id: string
  /** Shown when the rule finds something. Say what to do instead. */
  message: string
  pattern: RegExp
  bad: string[]
  good: string[]
  /** Paths (relative to src, with forward slashes) that this rule does not scan. */
  skip?: (path: string) => boolean
}

export interface Violation {
  rule: string
  file: string
  line: number
  text: string
  message: string
}

/** The one file where colours may be written. */
const TOKENS_FILE = 'styles/tokens.css'

const COLOUR_FAMILIES =
  'red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone|black|white'

export const DESIGN_RULES: DesignRule[] = [
  {
    id: 'em-dash',
    message: 'No em dashes anywhere. Use a full stop, a comma or a colon.',
    // Written as an escape, so this folder holds no literal em dash, even in the rule that bans it.
    pattern: /\u2014/,
    bad: ['Lead Finder \u2014 results', '// note \u2014 here'],
    good: ['Lead Finder - results', 'a-b', 'en dash – is not banned here'],
  },
  {
    id: 'pills',
    message: 'No pills. Buttons, badges, switches and progress use the 10px radius steps.',
    pattern: /\brounded-full\b/,
    bad: ['className="rounded-full"', 'md:rounded-full px-2'],
    good: ['rounded-lg', 'rounded-md', 'rounded-xs'],
  },
  {
    id: 'big-radius',
    message: 'One radius (10px). Use rounded-lg or a smaller step.',
    pattern: /\brounded(?:-[a-z]{1,2})?-(?:xl|2xl|3xl|4xl)\b/,
    bad: ['rounded-xl', 'rounded-t-2xl', 'rounded-4xl'],
    good: ['rounded-lg', 'rounded-t-lg', 'rounded-sm', 'xl:grid-cols-3'],
  },
  {
    id: 'looping-motion',
    message: 'Nothing pulses, spins, bounces or loops. Content fades in.',
    pattern:
      /(?<!-)\banimate-(?:spin|pulse|bounce|ping|caret-blink)\b|\brepeat-infinite\b|animation-iteration-count:\s*infinite/,
    bad: [
      'animate-spin',
      'animate-pulse rounded-md',
      'animate-bounce',
      'animate-ping',
      'repeat-infinite',
    ],
    good: ['animate-in fade-in-0', 'animate-out', 'Infinity', '--animate-spin: initial;'],
  },
  {
    id: 'shimmer',
    message: 'No shimmer and no fade masks. Content fades in, and a skeleton stays still.',
    pattern: /\bshimmer\b|\bscroll-fade\b/,
    bad: ['shimmer', 'shimmer-once', 'scroll-fade-y', 'scroll-fade'],
    good: ['animate-in fade-in-0', 'data-closed:fade-out-0', 'bg-muted', 'shimmering'],
  },
  {
    id: 'backdrop-blur',
    message: 'No blur and no glass. Surfaces are flat.',
    pattern: /\bbackdrop-(?:blur|filter)\b/,
    bad: [
      'backdrop-blur-sm',
      'supports-backdrop-filter:backdrop-blur-xs',
      'backdrop-filter: blur(4px)',
    ],
    good: ['bg-overlay', 'blur-none'],
  },
  {
    id: 'gradients',
    message: 'No gradients. One accent, Navy.',
    pattern: /gradient|\bbg-(?:linear|radial|conic)\b/i,
    bad: ['bg-gradient-to-r', 'linear-gradient(red, blue)', 'bg-linear-to-b', 'bg-radial'],
    good: ['bg-card', 'bg-primary/90'],
  },
  {
    id: 'hover-size-or-shadow',
    message:
      'Hover changes the border, background or opacity. Never the size, the shadow or the ring.',
    pattern: /hover:(?:shadow|scale|ring)/,
    bad: ['hover:shadow-lg', 'hover:scale-105', 'group-hover:shadow-float', 'hover:ring-2'],
    good: ['hover:bg-muted', 'hover:opacity-80', 'hover:border-input', 'shadow-float'],
  },
  {
    id: 'hex-colour',
    message: 'A colour is written once, in styles/tokens.css. Use a token such as bg-card.',
    pattern: /(?<![&\w])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![\w-])/,
    bad: ['color: #fff;', 'fill="#233A56"', "stroke: '#ccc'", 'background: #12345678'],
    good: ['href="#main"', '&#123;', 'issue #1234567', 'var(--primary)', 'bg-[#]'],
    skip: (path) => path === TOKENS_FILE,
  },
  {
    id: 'colour-function',
    message: 'A colour is written once, in styles/tokens.css. Use a token such as bg-card.',
    pattern: /(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/,
    bad: ['rgb(0 0 0 / 50%)', 'hsl(210 40% 96%)', 'oklch(0.5 0.1 200)', 'rgba(0,0,0,.5)'],
    good: ['color-mix(in oklch, red, blue)', 'var(--primary)', 'translate(1px)'],
    skip: (path) => path === TOKENS_FILE,
  },
  {
    id: 'palette-colour',
    message:
      'Only our tokens exist (bg-card, text-muted-foreground, ...). Palette colours do nothing.',
    pattern: new RegExp(
      `\\b(?:bg|text|border|ring|outline|fill|stroke|decoration|divide|from|via|to|accent|caret|shadow)-(?:${COLOUR_FAMILIES})(?:-\\d{2,3})?(?:/\\d+)?\\b`,
    ),
    bad: ['bg-white', 'text-black', 'border-red-500', 'fill-blue-600/50', 'bg-stone-100'],
    good: ['bg-card', 'text-muted-foreground', 'border-input', 'bg-selected', 'text-pass-ink'],
  },
  {
    id: 'font-weight',
    message: 'Titillium Web has two weights: font-normal (400) and font-semibold (600).',
    pattern: /\bfont-(?:thin|extralight|light|medium|bold|extrabold|black)\b/,
    bad: ['font-medium', 'font-bold text-ui', 'font-light'],
    good: ['font-normal', 'font-semibold', 'font-sans', 'font-serif'],
  },
  {
    id: 'type-scale',
    message:
      'Sizes: text-title, text-section, text-body, text-ui, text-caption (or xs, sm, base, lg). Nothing under 13px.',
    pattern: /\btext-(?:xl|[2-9]xl)\b|\btext-\[\d/,
    bad: ['text-xl', 'text-3xl', 'text-[0.8rem]', 'text-[12px]'],
    good: ['text-ui', 'text-caption', 'text-title', 'text-base', 'text-[var(--x)]', 'text-xs'],
  },
  {
    id: 'motion-timing',
    message:
      'Motion is 150ms or 250ms on the one curve. Use duration-150 or duration-250, no ease-* class.',
    pattern: /\bduration-(?!150\b|250\b)\d+\b|\bease-(?:linear|in-out|in|out)\b/,
    bad: [
      'duration-100',
      'duration-300',
      'duration-1000',
      'ease-linear',
      'ease-in-out',
      'ease-out',
    ],
    good: ['duration-150', 'duration-250', 'ease-standard', 'duration-(--x)'],
  },
  {
    id: 'shadow',
    message: 'Surfaces are flat. Only things that float (menus, dialogs, toasts) use shadow-float.',
    pattern: /\bshadow-(?:2xs|xs|sm|md|lg|xl|2xl|inner)\b/,
    bad: ['shadow-sm', 'shadow-md', 'shadow-xl', 'shadow-xs'],
    good: ['shadow-float', 'shadow-none', 'shadow-[inset_3px_0_0_var(--primary)]'],
  },
]

/** Reads one file's text and returns every place a rule applies. */
export function scanSource(path: string, text: string): Violation[] {
  const violations: Violation[] = []
  const lines = text.split(/\r?\n/)
  for (const rule of DESIGN_RULES) {
    if (rule.skip?.(path)) {
      continue
    }
    lines.forEach((line, index) => {
      if (rule.pattern.test(line)) {
        violations.push({
          rule: rule.id,
          file: path,
          line: index + 1,
          text: line.trim().slice(0, 120),
          message: rule.message,
        })
      }
    })
  }
  return violations
}

/** True for files the lint leaves out: tests and test helpers, and generated code. */
export function isExcluded(path: string): boolean {
  return path.startsWith('test/') || /\.test\.(?:ts|tsx)$/.test(path) || path === 'api/schema.d.ts'
}

export const SCANNED_EXTENSIONS = ['.ts', '.tsx', '.css', '.html', '.svg']
