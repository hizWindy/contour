// @vitest-environment node
/**
 * No message the website can show holds a command, a settings file, a local address or a code
 * file's name (PLAN-V15 "Words for errors", T2-3). Those belong in the backend's log, under the
 * request id, never on screen: a salesperson can do nothing with "uv run engine serve".
 *
 * It reads every source file the app is built from, and checks each piece of text in it: string
 * literals, template text and JSX text. Comments and import paths are code, not screen text, so
 * they are skipped. Tests, test helpers and the generated API types are not part of the app.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const SRC = join(import.meta.dirname, '..')

/** What never goes on screen, and how to spot it. */
const FORBIDDEN: readonly { what: string; pattern: RegExp }[] = [
  {
    what: 'a command',
    pattern:
      /\b(uv run|npm (run|ci|install)|npx |docker( |-)compose|pytest|alembic|python -m|pg_dump|psql )/i,
  },
  { what: 'the settings file', pattern: /(^|[\s("'`])\.env\b|engine\/\.env/ },
  { what: 'a local address', pattern: /\blocalhost\b|127\.0\.0\.1|\[::1\]|:5173\b|:8000\b/ },
  {
    what: "a setting's own name",
    pattern: /\b[A-Z][A-Z0-9]*_(API_KEY|SERVICE_KEY|TOKEN|SECRET|PASSWORD|URL)\b/,
  },
  { what: "a code file's name", pattern: /\b[\w-]+\.(py|tsx?|ya?ml|toml|sh|ps1)\b/ },
]

/** Files the app isn't built from. */
function isAppSource(path: string): boolean {
  return (
    /\.(ts|tsx)$/.test(path) &&
    !/\.test\.(ts|tsx)$/.test(path) &&
    !path.endsWith('.d.ts') &&
    !path.startsWith('test/')
  )
}

function collect(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    return entry.isDirectory() ? collect(full) : [relative(SRC, full).split(sep).join('/')]
  })
}

/** An import or export path, or `import('...')`: code, not words. */
function isModulePath(node: ts.Node): boolean {
  const parent = node.parent
  return (
    ts.isImportDeclaration(parent) ||
    ts.isExportDeclaration(parent) ||
    ts.isExternalModuleReference(parent) ||
    (ts.isCallExpression(parent) && parent.expression.kind === ts.SyntaxKind.ImportKeyword) ||
    (ts.isCallExpression(parent) &&
      ts.isPropertyAccessExpression(parent.expression) &&
      parent.expression.getText() === 'vi.mock')
  )
}

interface Text {
  file: string
  line: number
  text: string
}

/** Every piece of text in one file that could reach the screen. */
function textsOf(file: string): Text[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(join(SRC, file), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const found: Text[] = []
  const visit = (node: ts.Node): void => {
    let text: string | null = null
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      !isModulePath(node)
    ) {
      text = node.text
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      text = node.text
    } else if (ts.isJsxText(node)) {
      text = node.text
    }
    if (text?.trim()) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart())
      found.push({ file, line: line + 1, text })
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

const files = collect(SRC).filter(isAppSource).sort()

describe('the words on screen (PLAN-V15 T2-3)', () => {
  it('reads the app', () => {
    expect(files.length).toBeGreaterThan(100)
    expect(files).toContain('api/words.ts')
    expect(files).toContain('components/support-details.tsx')
    const words = textsOf('api/words.ts').map(({ text }) => text)
    expect(words).toContain("You're offline")
    expect(textsOf('components/support-details.tsx').map(({ text }) => text.trim())).toContain(
      'Details for support',
    )
  })

  it.each(FORBIDDEN)('never show $what', ({ pattern }) => {
    const hits = files
      .flatMap(textsOf)
      .filter(({ text }) => pattern.test(text))
      .map(({ file, line, text }) => `${file}:${String(line)} ${JSON.stringify(text.trim())}`)
    expect(hits).toEqual([])
  })

  it('catches each kind in a sample', () => {
    const samples = [
      'Check that it is running (uv run engine serve).',
      'Add the key to engine/.env.',
      'Open the site at http://localhost:5173.',
      'Missing: add HUBSPOT_SERVICE_KEY.',
      'See criteria.yaml.',
    ]
    for (const [index, { pattern }] of FORBIDDEN.entries()) {
      expect(pattern.test(samples[index] ?? ''), FORBIDDEN[index]?.what).toBe(true)
    }
  })
})
