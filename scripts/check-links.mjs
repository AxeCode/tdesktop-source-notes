import { readdir, readFile, access } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

const docs = resolve('docs')
const files = []

async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === '.vitepress') continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) await walk(path)
    else if (entry.name.endsWith('.md')) files.push(path)
  }
}

await walk(docs)
const failures = []
const linkPattern = /\[[^\]]*\]\(([^)]+)\)/g

for (const file of files) {
  const source = (await readFile(file, 'utf8'))
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`\n]+`/g, '')
  for (const match of source.matchAll(linkPattern)) {
    const href = match[1].split('#')[0]
    if (!href || /^(https?:|mailto:)/.test(href)) continue
    const target = href.startsWith('/')
      ? join(docs, href.replace(/^\//, ''))
      : resolve(dirname(file), href)
    const candidates = [target, `${target}.md`, join(target, 'index.md')]
    let ok = false
    for (const candidate of candidates) {
      try { await access(candidate); ok = true; break } catch {}
    }
    if (!ok) failures.push(`${file.replace(`${docs}/`, '')}: ${href}`)
  }
}

if (failures.length) {
  console.error(`发现 ${failures.length} 个无效内部链接：\n${failures.join('\n')}`)
  process.exit(1)
}

console.log(`已检查 ${files.length} 个 Markdown 文件，内部链接有效。`)
