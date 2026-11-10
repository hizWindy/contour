/**
 * The design rules from engine/DESIGN.md that a machine can check by reading source text.
 * `design-lint.test.ts` runs them over `src`. Each rule has examples it must flag (`bad`) and
 * examples it must leave alone (`good`), and the test proves both, so a typo in a pattern
 * cannot silently switch a rule off.
 *
 * Outside `src` (index.html, everything in public/ and the config files in the frontend root),
 * only the em dash rule runs (`OUTSIDE_SRC_RULES`). Those files carry text people read, like the
 * page title and the favicon title, but they hold colours and sizes of their own on purpose.
 *
 * The patterns are plain regular expressions run on one line at a time, so they cannot tell code
 * from a comment: a comment that names a banned class is flagged too. Write such a comment in
 * other words, or write the example as an escape (this file does so for the em dash and emoji).
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
    good: ['Lead Finder - results', 'a-b', 'en dash \u2013 is not banned here'],
  },
  {
    id: 'pills',
    message: 'No pills. Buttons, badges, switches and progress use the 10px radius steps.',
    // `rounded-full`, and the one-side and one-corner forms: `rounded-t-full`, `rounded-l-full`,
    // `rounded-tl-full`, `rounded-ss-full`.
    pattern: /\brounded(?:-[a-z]{1,2})?-full\b/,
    bad: [
      'className="rounded-full"',
      'md:rounded-full px-2',
      'rounded-t-full',
      'rounded-l-full',
      'rounded-tl-full',
      'hover:rounded-b-full',
    ],
    good: ['rounded-lg', 'rounded-md', 'rounded-xs', 'rounded-t-lg', 'rounded-fullish'],
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
    message: 'No gradients. Flat fills from the tokens only.',
    pattern: /gradient|\bbg-(?:linear|radial|conic)\b/i,
    bad: ['bg-gradient-to-r', 'linear-gradient(red, blue)', 'bg-linear-to-b', 'bg-radial'],
    good: ['bg-card', 'bg-primary/90'],
  },
  {
    id: 'hover-size-or-shadow',
    message:
      'Hover changes the border, background or opacity. Never the size, the shadow or the ring.',
    // `hover:` with an optional group name (`group-hover/item:`, `peer-hover/row:`), then any
    // other variants (`*:` for a child, `md:`, `focus:`), then the utility. `[^\s:]+:` is one
    // variant. It cannot cross a space, so `hover:bg-muted data-open:shadow-float` is not read as
    // one chain.
    pattern: /hover(?:\/[\w-]+)?:(?:[^\s:]+:)*(?:shadow|scale|ring)/,
    bad: [
      'hover:shadow-lg',
      'hover:scale-105',
      'group-hover:shadow-float',
      'hover:ring-2',
      'group-hover/item:scale-105',
      'group-hover/item:shadow-lg',
      'peer-hover/row:ring-2',
      'hover:*:scale-105',
      'hover:md:shadow-lg',
      'md:hover:scale-105',
    ],
    good: [
      'hover:bg-muted',
      'hover:opacity-80',
      'hover:border-input',
      'shadow-float',
      // shadcn's own: a group hover that only changes opacity
      'group-hover/menu-item:opacity-100',
      'group-hover/item:bg-muted',
      'hover:*:opacity-80',
      'hover:bg-muted data-open:shadow-float',
      '@media (hover: hover) {',
    ],
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
  {
    id: 'uppercase',
    message: 'Sentence case everywhere, with no all-caps labels. Write the text in sentence case.',
    pattern: /(?<![\w-])uppercase(?![\w-])|text-transform\s*:\s*uppercase/,
    bad: [
      'uppercase',
      'text-caption uppercase tracking-wide',
      'md:uppercase',
      'text-transform: uppercase;',
      'text-transform:uppercase',
      "style={{ textTransform: 'uppercase' }}",
      '[text-transform:uppercase]',
    ],
    good: ['normal-case', 'lowercase', 'text.toUpperCase()', 'text-transform: none', 'uppercased'],
  },
  {
    id: 'blur',
    message: 'No blur and no glass. Surfaces are flat. Use a border or a background instead.',
    // `blur-sm`, `blur-[4px]`, `blur-(--x)` and `filter: blur(...)`. A leading hyphen is left to
    // the backdrop-blur rule, and `blur-none`, `.blur()` and the `blur` event are fine.
    pattern: /(?<![\w.-])blur-(?!none\b)[\w[(]|filter\s*:[^;]*\bblur\(/,
    bad: [
      'blur-sm',
      'md:blur-lg',
      'blur-[4px]',
      'blur-(--amount)',
      'filter: blur(4px);',
      '[filter:blur(2px)]',
      'filter: grayscale(1) blur(2px)',
    ],
    good: [
      'blur-none',
      'input.blur()',
      'onBlur={save}',
      "addEventListener('blur', save)",
      'blurred',
      'bg-overlay',
    ],
  },
  {
    id: 'hover-translate-active-scale',
    message:
      'Hover and press never move or resize a part. Change the border, background or opacity.',
    // Same shape as `hover-size-or-shadow`: an optional group name, and any variants in between.
    pattern: /hover(?:\/[\w-]+)?:(?:[^\s:]+:)*-?translate|active(?:\/[\w-]+)?:(?:[^\s:]+:)*-?scale/,
    bad: [
      'hover:-translate-y-1',
      'hover:translate-x-2',
      'group-hover:-translate-y-0.5',
      'md:hover:translate-y-px',
      'active:scale-95',
      'active:-scale-x-100',
      'group-hover/item:translate-y-1',
      'group-hover/item:-translate-y-1',
      'hover:*:translate-x-1',
      'group-active/item:scale-95',
      'active:*:scale-95',
    ],
    good: [
      'hover:bg-muted',
      'active:bg-border',
      'translate-y-px',
      'scale-100',
      'hover:opacity-80',
      'group-hover/menu-item:opacity-100',
      'group-hover/item:bg-muted',
    ],
  },
  {
    id: 'animation-infinite',
    message: 'Nothing loops. Remove "infinite" and let content fade in once.',
    // The shorthand (`animation: spin 1s linear infinite`), in CSS, in an inline style and in a
    // class such as `[animation:spin_1s_linear_infinite]`, and the camelCase property.
    pattern:
      /\banimation\s*:[^;]*(?<![a-zA-Z])infinite(?![a-zA-Z])|\banimationIterationCount\s*:\s*['"]?infinite/,
    bad: [
      'animation: spin 1s linear infinite;',
      'animation:spin 1s infinite',
      "style={{ animation: 'spin 1s linear infinite' }}",
      '[animation:spin_1s_linear_infinite]',
      "animationIterationCount: 'infinite'",
    ],
    good: [
      'animation: fade-in 250ms var(--ease) 1',
      'animation-duration: 0.01ms !important;',
      'animation-iteration-count: 1 !important;',
      'Infinity',
      'gcTime: Infinity',
      'infinite scroll',
    ],
  },
  {
    id: 'animate-arbitrary',
    message:
      'Only the enter and exit animations (animate-in, animate-out) exist. No animate-[...] and no animate-(...).',
    pattern: /(?<![\w-])animate-(?:\[|\()/,
    bad: ['animate-[wiggle_1s_ease-in-out_infinite]', 'md:animate-[fade_1s]', 'animate-(--spin)'],
    good: ['animate-in fade-in-0', 'animate-out', '--animate-spin: initial;', 'animated'],
  },
  {
    id: 'arbitrary-radius',
    message: 'One radius (10px). Use rounded-lg or a smaller step, not rounded-[...].',
    // `rounded-[inherit]` is not a size: the part takes the radius of the part around it, which
    // these rules already hold to the one radius.
    pattern: /(?<![\w-])rounded(?:-[a-z]{1,2})?-\[(?!inherit\])/,
    bad: ['rounded-[12px]', 'rounded-t-[1rem]', 'md:rounded-tl-[3px]', 'rounded-[var(--r)]'],
    good: [
      'rounded-lg',
      'rounded-t-sm',
      'rounded-[inherit]',
      'rounded-(--cell-radius)',
      'rounded-none',
    ],
  },
  {
    id: 'inline-radius',
    message: 'One radius (10px). Use a rounded-* class, not an inline borderRadius.',
    pattern: /\bborderRadius\b/,
    bad: ['style={{ borderRadius: 8 }}', "{ borderRadius: '50%' }", 'const borderRadius = 4'],
    good: [
      'border-radius: var(--radius);',
      'rounded-lg',
      '"--border-radius": "var(--radius)"',
      '<Bar radius={[4, 4, 0, 0]} />',
    ],
  },
  {
    id: 'sparkles',
    message: 'No sparkle icons. Use a plain Lucide icon with a label.',
    pattern: /sparkle/i,
    bad: [
      "import { Sparkles } from 'lucide-react'",
      '<SparklesIcon className="size-4" />',
      '<Sparkle />',
      'WandSparkles',
      'lucide-sparkles',
    ],
    good: ['Sparkline', "import { Sparkline } from './sparkline'", 'Spark', 'SearchIcon'],
  },
  {
    id: 'emoji',
    message: 'No emoji. Use a Lucide icon with a label, or plain words.',
    // Pictographs and emoji-presentation characters, plus the emoji selector and the keycap
    // mark. The copyright, registered and trade mark signs are text and stay allowed. Written
    // with the `u` flag so \p{...} works. Samples below use escapes, so this file stays ASCII.
    pattern:
      /(?![\u00A9\u00AE\u2122])[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u20E3]/u,
    bad: [
      'Launch \u{1F680}',
      'Done \u2705',
      '\u{2764}\uFE0F',
      '\u2728 New',
      'Careful \u26A0',
      '\u{1F1E6}\u{1F1FA}',
      '1\uFE0F\u20E3',
    ],
    good: [
      'About 3,000 m\u00B2 and 2\u00D7 the staff',
      '\u00A9 2026 Contour\u2122',
      'caf\u00E9, \u4E2D\u6587, \u00B0C',
      'a \u2013 b and a \u2192 b',
      'issue #12, 3*4, 5.',
    ],
  },
]

/** The rules that also run on index.html, on public/ and on the config files in the root. */
export const OUTSIDE_SRC_RULES: DesignRule[] = DESIGN_RULES.filter((rule) => rule.id === 'em-dash')

/**
 * Reads one file's text and returns every place a rule applies.
 * Pass `rules` to run fewer than all of them (see `OUTSIDE_SRC_RULES`).
 */
export function scanSource(
  path: string,
  text: string,
  rules: DesignRule[] = DESIGN_RULES,
): Violation[] {
  const violations: Violation[] = []
  const lines = text.split(/\r?\n/)
  for (const rule of rules) {
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
