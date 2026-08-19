/**
 * Post-build wrapper: turns tsdown's CJS client output into the browser
 * module-loader bundle format the dsh web shell expects:
 *
 *   window.__ModuleLoader__.load({ id, factory: (require) => { ...cjs body...; return module.exports; } })
 *
 * It also inlines the extracted stylesheet as a <style data-plugin-css> tag so
 * the single client.js stays self-contained (the browser loads it standalone,
 * with no sidecar .css). Mirrors the dsh-web-ui family's published client.js
 * shape.
 */
import { readFileSync, writeFileSync, rmSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const pkgName = pkg.name

const cjsPath = new URL('../lib/client.cjs', import.meta.url)
const cssPath = new URL('../lib/style.css', import.meta.url)
const outPath = new URL('../lib/client.js', import.meta.url)

let body = readFileSync(cjsPath, 'utf8')
// Drop the extracted-stylesheet import; the CSS is inlined below.
body = body.replace(/^import\s+['"]\.\/style\.css['"];\s*\n/m, '')

let css = ''
try { css = readFileSync(cssPath, 'utf8') } catch { /* no css */ }

const cssInject = css
  ? 'var __cssId = ' + JSON.stringify(pkgName + '/style.css') + ';\n' +
    'if (typeof document !== "undefined") {\n' +
    '  var __old = document.querySelector("style[data-plugin-css=" + JSON.stringify(__cssId) + "]");\n' +
    '  if (__old) __old.remove();\n' +
    '  var __cssTag = document.createElement("style");\n' +
    '  __cssTag.dataset.plugin = ' + JSON.stringify(pkgName) + ';\n' +
    '  __cssTag.dataset.pluginCss = __cssId;\n' +
    '  __cssTag.textContent = ' + JSON.stringify(css) + ';\n' +
    '  document.head.appendChild(__cssTag);\n' +
    '}\n'
  : ''

const indented = body.split('\n').map((line) => '\t\t' + line).join('\n')
const wrapped = [
  'window.__ModuleLoader__.load({',
  '\tid: ' + JSON.stringify(pkgName) + ',',
  '\tfactory: (require) => {',
  '\t\tvar module = { exports: {} };',
  '\t\tvar exports = module.exports;',
  ...(cssInject ? cssInject.split('\n').map((l) => '\t\t' + l) : []),
  indented,
  '\t\treturn module.exports;',
  '\t}',
  '});',
  '',
].join('\n')

writeFileSync(outPath, wrapped, 'utf8')
rmSync(cjsPath, { force: true })
rmSync(cssPath, { force: true })
console.log('[wrap-client] wrote lib/client.js (' + wrapped.length + ' bytes)')
