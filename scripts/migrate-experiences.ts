/**
 * 迁移脚本:将 9 条现有经验导出为文件系统 XML + metadata.json
 *
 * 用法: npx tsx scripts/migrate-experiences.ts [experiences-dir]
 * 默认输出到 experiences/ 目录
 *
 * @see tasks/phase-f2/README.md F2.3
 */

import { promises as fs } from 'fs'
import { join, resolve } from 'path'
import {
  FileSystemExperienceStore,
  createEntryFromXml
} from '../web/server/services/experience-store.js'
import { ALL_XML_EXPERIENCES } from '../web/tests/fixtures/xml-experiences.js'

async function main(): Promise<void> {
  const outputDir = process.argv[2] ?? join(process.cwd(), 'experiences')
  console.log(`迁移 9 条经验到: ${resolve(outputDir)}`)

  await fs.mkdir(outputDir, { recursive: true })
  const store = new FileSystemExperienceStore(outputDir)

  let success = 0
  let failed = 0

  for (const xmlExp of ALL_XML_EXPERIENCES) {
    try {
      const entry = createEntryFromXml(xmlExp)
      await store.save(entry)
      console.log(`  ✅ ${xmlExp.id} → ${entry.id}/`)
      success++
    } catch (e) {
      console.error(`  ❌ ${xmlExp.id} 迁移失败: ${e instanceof Error ? e.message : String(e)}`)
      failed++
    }
  }

  console.log(`\n迁移完成: ${success} 成功, ${failed} 失败`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(e => {
  console.error('迁移脚本异常:', e)
  process.exit(1)
})
