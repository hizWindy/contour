import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/*
  Text from the backend (company names, notes, source quotes, website addresses) is shown as plain
  text and never as HTML. The rules below catch the usual ways code turns a string into markup:
  they are a guard against slips, not a sandbox, and a determined author can still find another
  route (a call through `Reflect`, a property name built at run time). The real protection is that
  every page renders text as React children, plus the Content-Security-Policy in index.html.
  src/test/eslint-rules.test.ts runs each rule over a small sample, so a typo here cannot switch
  one off without a test failing. It only proves the samples, not every possible spelling.
*/

const HTML_WRITE_MESSAGE =
  'Never write HTML from a string. Render text as React children, which are escaped.'

// Properties that parse or run a string as HTML. `no-restricted-properties` also catches
// `const { innerHTML } = node` and `node['innerHTML']`. `setHTMLUnsafe`, `parseHTMLUnsafe` and
// `createContextualFragment` are the newer and older calls that do the same as `innerHTML`;
// `srcdoc` makes an iframe run a string as a whole page.
const HTML_WRITE_PROPERTIES = [
  { property: 'innerHTML', message: HTML_WRITE_MESSAGE },
  { property: 'outerHTML', message: HTML_WRITE_MESSAGE },
  { property: 'insertAdjacentHTML', message: HTML_WRITE_MESSAGE },
  { property: 'setHTMLUnsafe', message: HTML_WRITE_MESSAGE },
  { property: 'parseHTMLUnsafe', message: HTML_WRITE_MESSAGE },
  { property: 'createContextualFragment', message: HTML_WRITE_MESSAGE },
  { property: 'srcdoc', message: HTML_WRITE_MESSAGE },
  { object: 'document', property: 'write', message: HTML_WRITE_MESSAGE },
  { object: 'document', property: 'writeln', message: HTML_WRITE_MESSAGE },
]

// The same HTML-from-a-string calls, in the shapes `no-restricted-properties` cannot see:
//  - `window.document.write(x)`, `globalThis.document.write(x)`: the object is `window.document`,
//    not the name `document`;
//  - `new DOMParser()`, `new window.DOMParser()`: parsing a string into a document;
//  - `el.setAttribute('srcdoc', x)`: the attribute spelling of the `srcdoc` property.
const HTML_STRING_SELECTORS = [
  {
    selector: `MemberExpression:matches([object.property.name='document'], [object.property.value='document']):matches([property.name=/^write(ln)?$/], [property.value=/^write(ln)?$/])`,
    message: HTML_WRITE_MESSAGE,
  },
  {
    selector:
      ":matches(NewExpression[callee.name='DOMParser'], NewExpression[callee.property.name='DOMParser'])",
    message: `${HTML_WRITE_MESSAGE} DOMParser turns a string into a document, so it needs a sanitised input and a file named *.raw-html.ts (see RAW_HTML_FILES).`,
  },
  {
    selector: "CallExpression[callee.property.name='setAttribute'][arguments.0.value=/^srcdoc$/i]",
    message: HTML_WRITE_MESSAGE,
  },
]

// Never allowed anywhere, not even in a *.raw-html.* file. `react/no-danger` reads only the JSX
// attribute. These selectors add the object spellings that it does not read:
// `createElement('div', { dangerouslySetInnerHTML })`, `cloneElement(el, { dangerouslySetInnerHTML })`
// and `<div {...{ dangerouslySetInnerHTML }} />`, plus `srcDoc` as a JSX attribute or an object key
// (an iframe that runs a string as a page).
const NEVER_ALLOWED_MESSAGE =
  'Never run a string as HTML or as a page. Render text as React children, which are escaped.'
const NEVER_ALLOWED_SELECTORS = [
  {
    selector:
      ":matches(Property[key.name='dangerouslySetInnerHTML'], Property[key.value='dangerouslySetInnerHTML'])",
    message: NEVER_ALLOWED_MESSAGE,
  },
  {
    selector: ':matches(Property[key.name=/^srcdoc$/i], Property[key.value=/^srcdoc$/i])',
    message: NEVER_ALLOWED_MESSAGE,
  },
  { selector: 'JSXAttribute[name.name=/^srcdoc$/i]', message: NEVER_ALLOWED_MESSAGE },
]

const LEAFLET_MESSAGE =
  'Leaflet reads a string as HTML. Put React children inside <Popup>, <Tooltip> or a marker instead.'

// Leaflet calls that take an HTML string. The map is built with React-Leaflet, and its Popup and
// Tooltip render React children. `divIcon` is fine without an `html` option (a styled empty box).
const DIV_ICON =
  ":matches(CallExpression[callee.name='divIcon'], CallExpression[callee.property.name='divIcon'], NewExpression[callee.name='DivIcon'], NewExpression[callee.property.name='DivIcon'])"

const LEAFLET_HTML_SELECTORS = [
  { selector: "CallExpression[callee.property.name='bindPopup']", message: LEAFLET_MESSAGE },
  { selector: "CallExpression[callee.property.name='bindTooltip']", message: LEAFLET_MESSAGE },
  { selector: "CallExpression[callee.property.name='setPopupContent']", message: LEAFLET_MESSAGE },
  {
    selector: "CallExpression[callee.property.name='setTooltipContent']",
    message: LEAFLET_MESSAGE,
  },
  { selector: "CallExpression[callee.property.name='setContent']", message: LEAFLET_MESSAGE },
  {
    selector: `${DIV_ICON} > ObjectExpression > :matches(Property[key.name='html'], Property[key.value='html'])`,
    message: LEAFLET_MESSAGE,
  },
  {
    // `divIcon(options)` or `divIcon({ ...options })`: the lint cannot see an `html` inside.
    selector: `${DIV_ICON}[arguments.length>0]:not([arguments.0.type='ObjectExpression'])`,
    message: `${LEAFLET_MESSAGE} Pass an object written out in the call, so the lint can check it.`,
  },
  {
    selector: `${DIV_ICON} > ObjectExpression > SpreadElement`,
    message: `${LEAFLET_MESSAGE} Write the options out instead of spreading, so the lint can check them.`,
  },
]

/*
  The one way to allow an exception to the rules above (HTML written from a string, and Leaflet
  HTML strings): name the file `something.raw-html.ts` or `something.raw-html.tsx`.
  The name makes it easy to find (`git ls-files "*.raw-html.*"`), the block at the end turns off
  `no-restricted-properties` and the HTML and Leaflet selectors for such files, and
  src/test/eslint-rules.test.ts lists the files that exist, so adding one changes a test and is
  seen in review. `react/no-danger` and NEVER_ALLOWED_SELECTORS stay on for them:
  dangerouslySetInnerHTML (as a JSX attribute or as an object key) and `srcDoc` are not allowed
  even there.
  Do not use `eslint-disable` for these rules. A file that needs a string turned into HTML must
  sanitise it first (src/lib), say so in a comment at the top, and be named as above.
*/
const RAW_HTML_FILES = ['**/*.raw-html.{ts,tsx}']

export default defineConfig([
  // dist is the build. schema.d.ts is generated by `npm run types`.
  globalIgnores(['dist', 'coverage', 'src/api/schema.d.ts']),

  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommendedTypeChecked,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    plugins: { react },
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
      parserOptions: {
        project: ['./tsconfig.app.json', './tsconfig.test.json', './tsconfig.node.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: {
      react: { version: '19' },
      // React Router's links count as links for the link rules below. This setting sits next to
      // `react`, not inside it.
      linkComponents: [
        { name: 'Link', linkAttribute: 'to' },
        { name: 'NavLink', linkAttribute: 'to' },
      ],
    },
    rules: {
      // `npm run lint` fails on any warning (--max-warnings 0), so every rule is an error or off.
      // The React Compiler is not used here. `incompatible-library` only reports that a library
      // cannot be compiled (TanStack Table's `useReactTable`, React Hook Form's `watch`), and the
      // spec needs both, so it is off. Do not work around it with `eslint-disable` in a page.
      'react-hooks/incompatible-library': 'off',
      // The one hooks warning that matters: a missing dependency is a stale value. Make it an error.
      'react-hooks/exhaustive-deps': 'error',
      // `eval` and `with`: not allowed in this code anyway.
      'react-hooks/unsupported-syntax': 'error',
      // Text from the backend is shown as plain text, and nothing should be written as HTML.
      'react/no-danger': 'error',
      'react/no-danger-with-children': 'error',
      'no-restricted-properties': ['error', ...HTML_WRITE_PROPERTIES],
      'no-restricted-syntax': [
        'error',
        ...HTML_STRING_SELECTORS,
        ...LEAFLET_HTML_SELECTORS,
        ...NEVER_ALLOWED_SELECTORS,
      ],
      // Links. A link to another site opens with rel="noopener noreferrer nofollow" (a dynamic
      // address counts as another site), and nothing runs script from a link.
      'react/jsx-no-target-blank': ['error', { enforceDynamicLinks: 'always' }],
      'react/jsx-no-script-url': [
        'error',
        [
          { name: 'Link', props: ['to'] },
          { name: 'NavLink', props: ['to'] },
        ],
      ],
      // `<p>// note</p>` shows the slashes on the page. A comment in JSX is {/* note */}.
      'react/jsx-no-comment-textnodes': 'error',
      // Underscore marks a value that is on purpose not used.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
    },
  },

  // Config files: plain JavaScript, run by Node, not type-checked.
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['vite.config.ts'],
    languageOptions: { globals: globals.node },
  },

  // Tests and test helpers: Node is available, and helpers may export more than components.
  // A test may read `container.innerHTML` to check what was rendered, so reading and writing
  // innerHTML and outerHTML is allowed here. The other calls that write HTML (insertAdjacentHTML,
  // setHTMLUnsafe, document.write, DOMParser, ...) stay banned, and so do the Leaflet rules.
  {
    files: ['src/**/*.test.{ts,tsx}', 'src/test/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      'react-refresh/only-export-components': 'off',
      'no-restricted-properties': [
        'error',
        ...HTML_WRITE_PROPERTIES.filter(
          ({ property }) => property !== 'innerHTML' && property !== 'outerHTML',
        ),
      ],
    },
  },

  // shadcn parts: generated, then restyled once (see DESIGN.md). Their shape follows shadcn, so
  // the style rules are relaxed here. The design rules still apply (src/test/design-lint.test.ts).
  {
    files: ['src/components/ui/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
      '@typescript-eslint/consistent-type-imports': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-redundant-type-constituents': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
    },
  },

  // The one exception mechanism for the HTML rules, last so that it wins over every block above.
  // See RAW_HTML_FILES. `no-restricted-syntax` is not turned off: it is set again with only the
  // selectors that are never allowed.
  {
    files: RAW_HTML_FILES,
    rules: {
      'no-restricted-properties': 'off',
      'no-restricted-syntax': ['error', ...NEVER_ALLOWED_SELECTORS],
    },
  },
])
