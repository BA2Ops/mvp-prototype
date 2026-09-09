# Phase F2 — 元数据 + 文件系统存储 + 检索

> **Phase 目标**:经验库文件系统持久化,元数据 schema 定义,模糊搜索索引
> **Gate-F2**:9 条现有经验持久化到文件系统,可被模糊搜索
> **计划文档**:[doc 20](../../docs/mvp/20-experience-design-tool.md) | [主任务计划](../README.md)
> **状态**:未开始

---

## 一、任务分解

### F2.1 — 元数据 schema 定义(T4)

**目标**:定义经验的元数据字段 schema(tags/category/sideEffects/version)。

**输入**:doc 17(元数据规范候选目录)

**输出**:
- `web/shared/metadata.ts`:Zod schema + TypeScript 类型
- `ExperienceMetadata` 类型定义

**实现要点**:

```typescript
interface ExperienceMetadata {
  tags: string[]                          // 检索字段
  category: string                        // 分类(file-io / shell / search ...)
  sideEffects: 'read-only' | 'fs-write' | 'exec'  // 副作用声明
  version: string                         // 语义版本(如 "1.0.0")
  // 可选
  description?: string                    // 补充描述(与 Experience.description 同步)
  timeout?: number                        // 超时 ms
  retryStrategy?: { maxRetries: number; backoffMs: number }
}
```

- MVP 副作用粒度:经验级(非 step 级)
- version 格式:semver
- schema 设计预留数据库适配空间

**验收标准**:
- Zod schema 能解析/校验元数据 JSON
- 9 条经验的元数据可被表达

**依赖**:无(可与 F1 并行)
**估算**:S(2-3h)

---

### F2.2 — 经验库文件系统存储

**目标**:实现 XML + metadata.json 的文件系统读写。

**输入**:F1.2(XML 解析器)、F2.1(元数据 schema)

**输出**:
- `web/server/services/experience-store.ts`
- 接口:`ExperienceStore`(预留数据库适配空间)

**实现要点**:

目录结构:
```
experiences/
├── read_file/
│   ├── experience.xml
│   └── metadata.json
├── safe_write/
│   ├── experience.xml
│   └── metadata.json
...
```

接口设计(预留数据库适配):
```typescript
interface ExperienceStore {
  list(): Promise<ExperienceEntry[]>
  get(id: string): Promise<ExperienceEntry | null>
  save(entry: ExperienceEntry): Promise<void>
  delete(id: string): Promise<void>
  exists(id: string): Promise<boolean>
}

interface ExperienceEntry {
  id: string
  xml: string                    // XML 文本
  metadata: ExperienceMetadata   // 元数据
  createdAt: number
  updatedAt: number
}
```

- 文件系统实现:`FileSystemExperienceStore`
- 未来:`SqlExperienceStore` / `VectorExperienceStore` 实现同接口
- 写入时自动创建目录
- 读取时 XML + metadata.json 合并返回

**验收标准**:
- 能读写经验到 `experiences/<id>/` 目录
- 删除经验时清理目录
- 接口设计支持未来替换为数据库实现

**依赖**:F1.2, F2.1
**估算**:M(3-4h)

---

### F2.3 — 现有 9 条经验迁移

**目标**:从 experience-library.ts 导出现有 9 条经验为 XML + metadata.json。

**输入**:F1.4(XML→L3 编译器,用于验证迁移正确性)、F2.2(文件系统存储)

**输出**:
- `experiences/` 目录下 9 条经验的 XML + metadata.json
- 迁移脚本 `scripts/migrate-experiences.ts`

**实现要点**:

迁移流程:
1. 遍历 `CORE_EXPERIENCES`(9 条)
2. 每条经验手工构造对应 XML(F1.6 已完成部分)
3. 手工标注元数据(tags/category/sideEffects)
4. 写入文件系统
5. 编译回 L3 验证语义等价

9 条经验元数据标注:

| 经验 ID | tags | category | sideEffects |
|---------|------|----------|-------------|
| read_file | file, read | file-io | read-only |
| read_file_with_default | file, read, default | file-io | read-only |
| check_file_exists | file, exists | file-io | read-only |
| write_file | file, write | file-io | fs-write |
| safe_write | file, write, safe | file-io | fs-write |
| find_files | file, search, glob | search | read-only |
| search_in_files | file, search, grep | search | read-only |
| run_shell | shell, exec | shell | exec |
| replace_in_file | file, replace | file-io | fs-write |

**验收标准**:
- 9 条经验全部持久化到 `experiences/` 目录
- 每条含 experience.xml + metadata.json
- 迁移后编译回 L3 与原 L3 语义等价

**依赖**:F1.4, F2.2
**估算**:M(3-4h)

---

### F2.4 — ParamSpec.type 编译期强校验

**目标**:字面量参数与声明类型矛盾时编译失败。

**输入**:F2.1(元数据 schema,含 type 定义)

**输出**:
- `web/shared/type-validator.ts`
- 集成到 F1.3 校验器或 F1.4 编译器

**实现要点**:

校验规则:
- ParamRef.kind === 'literal' 时,检查 value 类型与 ParamSpec.type 兼容
- 类型兼容矩阵:string ← string, number ← number, path ← string, any ← 任意
- 不兼容时抛 `ParamRefError('incompatible type: ${srcType} → ${dstType}')`

**验收标准**:
- ParamSpec.type 声明 `path` 但给数字字面量 → 编译失败
- 声明 `any` 接受任意类型
- 声明 `string` 接受 path 类型(path 是 string 子类型)

**依赖**:F2.1
**估算**:M(3-4h)

---

### F2.5 — 模糊搜索索引

**目标**:基于名称(id)+ 简述(description)构建模糊搜索索引。

**输入**:F2.2(文件系统存储)

**输出**:
- `web/server/services/search-index.ts`
- 函数:`buildIndex(store: ExperienceStore): SearchIndex`
- 函数:`search(index: SearchIndex, query: string): SearchResult[]`

**实现要点**:

MVP 搜索策略(不含向量搜索):
1. 关键词分词:query 按空格/标点分词
2. 匹配字段:id(精确 + 前缀)、description(包含匹配)、tags(精确)
3. 加权评分:id 精确 > id 前缀 > tags 精确 > description 包含
4. 返回 top-k(默认 20)

```typescript
interface SearchIndex {
  search(query: string, k?: number): SearchResult[]
}

interface SearchResult {
  id: string
  description: string
  score: number
  matchedFields: string[]
}
```

- 索引在启动时构建,经验变更时刷新
- 预留向量搜索接口(未来实现 `VectorSearchIndex`)

**验收标准**:
- 搜索"文件"能召回 read_file/write_file/safe_write/check_file_exists
- 搜索"shell"能召回 run_shell
- 搜索"search"能召回 find_files/search_in_files
- 结果按相关性排序

**依赖**:F2.2
**估算**:S(2-3h)

---

### F2.6 — 搜索 API

**目标**:提供 HTTP API 供前端调用。

**输入**:F2.5(搜索索引)

**输出**:
- `web/server/routes/search.ts`
- API:`GET /api/search?q=<query>&k=<limit>`

**实现要点**:

API 规格:
```
GET /api/search?q=文件&k=20
→ 200 {
  results: [
    { id: "read_file", description: "...", score: 0.9, matchedFields: ["id", "description"] },
    ...
  ],
  total: 5
}
```

- 空查询返回全部经验(分页)
- k 默认 20,最大 100

**验收标准**:
- API 可调用,返回正确搜索结果
- 空查询返回全部 9 条经验

**依赖**:F2.5
**估算**:S(1-2h)

---

### F2.7 — 测试

**目标**:验证文件系统读写 + 模糊搜索 + type 校验。

**输入**:F2.1-F2.6 全部完成

**输出**:
- `web/tests/phase-f2.test.ts`

**测试用例**:

| 测试 | 内容 |
|------|------|
| 文件系统读写 | 保存经验 → 读取 → 删除 → 验证目录清理 |
| 9 条经验持久化 | 验证 experiences/ 目录含 9 条经验 |
| 模糊搜索"文件" | 召回 file-io 类经验 |
| 模糊搜索"shell" | 召回 run_shell |
| 模糊搜索"search" | 召回 find_files/search_in_files |
| type 校验 | path 声明 + 数字字面量 → 编译失败 |
| type 校验 | any 声明 + 任意类型 → 通过 |

**验收标准**:全部测试通过

**依赖**:F2.3, F2.4, F2.5, F2.6
**估算**:S(2-3h)

---

## 二、任务依赖图

```
F2.1 ──→ F2.2 ──→ F2.3
    │         │
    │         ├──→ F2.5 ──→ F2.6
    │         │
    └──→ F2.4 │
              └──→ F2.7
```

**关键路径**:F2.1 → F2.2 → F2.3

**并行窗口**:
- F2.1(元数据 schema)不依赖 F1,可与 F1 并行
- F2.4(type 校验)可与 F2.3(迁移)并行

---

## 三、Gate-F2 验收标准

| 验收项 | 标准 |
|--------|------|
| 元数据 schema | tags/category/sideEffects/version 定义完成 |
| 文件系统存储 | 9 条经验持久化到 experiences/ 目录 |
| 模糊搜索 | "文件"/"shell"/"search" 能召回相关经验 |
| type 校验 | 非法字面量类型被编译拒绝 |
| 接口设计 | ExperienceStore 预留数据库适配空间 |

---

## 四、进度追踪

| 任务 | 状态 | 开始时间 | 完成时间 | 备注 |
|------|------|----------|----------|------|
| F2.1 | ✅ 完成 | 2026-09-09 | 2026-09-09 | Zod schema,含时间戳/状态字段 |
| F2.2 | ✅ 完成 | 2026-09-09 | 2026-09-09 | FileSystemExperienceStore,预留数据库适配 |
| F2.3 | ✅ 完成 | 2026-09-09 | 2026-09-09 | 9 条经验持久化到 experiences/ 目录 |
| F2.4 | ✅ 完成 | 2026-09-09 | 2026-09-09 | 类型兼容矩阵,path←string 双向兼容 |
| F2.5 | ✅ 完成 | 2026-09-09 | 2026-09-09 | FuzzySearchIndex,加权评分 |
| F2.6 | ✅ 完成 | 2026-09-09 | 2026-09-09 | SearchService,封装 store+index |
| F2.7 | ✅ 完成 | 2026-09-09 | 2026-09-09 | 20 个测试全部通过 |
