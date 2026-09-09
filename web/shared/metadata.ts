/**
 * 元数据 Schema(F2.1 / T4)
 *
 * 定义经验的元数据字段:tags/category/sideEffects/version。
 * 与 XML 中间定义中的 metadata 字段对齐,但独立为完整 schema,
 * 供文件系统存储(metadata.json)和未来数据库适配使用。
 *
 * @see tasks/phase-f2/README.md F2.1
 * @see docs/mvp/17-experience-metadata.md
 */

import { z } from 'zod'

// ============== 基础类型(从 xml-schema 复用) ==============

export const SideEffectSchema = z.enum([
  'read-only', 'fs-write', 'exec'
])
export type SideEffect = z.infer<typeof SideEffectSchema>

// ============== 完整元数据 Schema ==============

/**
 * 经验元数据(文件系统 metadata.json 格式)
 *
 * 与 XmlExperienceMetadata 的区别:
 * - XmlExperienceMetadata 是 XML 内嵌的精简版(仅 tags/category/sideEffects/version)
 * - ExperienceMetadata 是文件系统独立存储的完整版(含时间戳/状态等)
 */
export const ExperienceMetadataSchema = z.object({
  /** 经验 ID(与 XML id 一致) */
  id: z.string().min(1),

  /** 业务描述(与 XML description 同步) */
  description: z.string().min(1),

  /** 检索标签 */
  tags: z.array(z.string()).default([]),

  /** 分类(file-io / shell / search ...) */
  category: z.string().default(''),

  /** 副作用声明 */
  sideEffects: SideEffectSchema.default('read-only'),

  /** 语义版本(如 "1.0.0") */
  version: z.string().default('1.0.0'),

  /** 创建时间(Unix ms) */
  createdAt: z.number().int().positive(),

  /** 最后更新时间(Unix ms) */
  updatedAt: z.number().int().positive(),

  /** 经验状态:draft(草稿)/ active(已激活) */
  status: z.enum(['draft', 'active']).default('active')
})
export type ExperienceMetadata = z.infer<typeof ExperienceMetadataSchema>

// ============== 校验辅助 ==============

export interface MetadataParseResult {
  success: boolean
  data?: ExperienceMetadata
  errors: { path: string; message: string }[]
}

/**
 * 校验元数据对象
 */
export function validateMetadata(data: unknown): MetadataParseResult {
  const result = ExperienceMetadataSchema.safeParse(data)
  if (result.success) {
    return { success: true, data: result.data, errors: [] }
  }
  return {
    success: false,
    errors: result.error.issues.map(issue => ({
      path: issue.path.join('.'),
      message: issue.message
    }))
  }
}

// ============== 元数据 → XML metadata 转换 ==============

/**
 * 从完整元数据提取 XML 内嵌的精简元数据
 */
export function toXmlMetadata(meta: ExperienceMetadata): {
  tags: string[]
  category: string
  sideEffects: SideEffect
  version: string
} {
  return {
    tags: meta.tags,
    category: meta.category,
    sideEffects: meta.sideEffects,
    version: meta.version
  }
}

/**
 * 从 XML 精简元数据 + 基础信息构建完整元数据
 */
export function fromXmlMetadata(
  id: string,
  description: string,
  xmlMeta: { tags: string[]; category: string; sideEffects: SideEffect; version: string },
  existing?: ExperienceMetadata
): ExperienceMetadata {
  const now = Date.now()
  return {
    id,
    description,
    tags: xmlMeta.tags,
    category: xmlMeta.category,
    sideEffects: xmlMeta.sideEffects,
    version: xmlMeta.version,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    status: existing?.status ?? 'active'
  }
}
