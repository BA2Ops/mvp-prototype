# 20 - 经验设计工具:可视化检索、浏览、设计修改项目计划

> **状态**:项目计划(2026-09-09 创建,2026-09-09 范围调整)
> **定位**:将 T3(LLM 辅助经验设计)提升为近期优先级,构建一个 Web 应用,
> 提供经验库的可视化检索、浏览、设计修改能力。
> **关联**:[13 方向总览](./13-next-directions.md)、[15 可视化](./15-experience-visualization.md)、
> [16 LLM 辅助设计](./16-experience-llm-assisted-design.md)、
> [17 元数据规范](./17-experience-metadata.md)、[18 XML→L3 编译器](./18-xml-to-l3-compiler.md)

---

## 一、项目背景与战略调整

### 1.1 为什么调整优先级

原路线图(doc 13)推荐"近期 A 接入真 LLM",但存在以下问题:

1. **经验库不足**:仅 9 条核心经验,真 LLM 识别质量不可控
2. **编写成本高**:手工构造 L3 JSON 需正确表达 pre/judgment/paths/steps/
   寄存器传递/回复消息,难以规模化到 30-50 条
3. **编排复杂**:AI 完整识别语义并构造编排符合 L3 定义的经验调用序列,
   在经验数量不足时复杂度过高
4. **元经验问题**:未来需要面对经验库不覆盖用户需求时的自主学习和创造经验

因此调整为:**先建设经验设计工具,降低经验创建成本,扩充经验库,
再接入真 LLM 做运行时识别**。

### 1.2 项目目标

构建一个 Web 应用,提供:

| 能力 | 说明 | 对应设计文档 |
|------|------|-------------|
| **列表浏览** | 经验库列表,展示 id + 简述 + 元数据 | doc 15 (T2) |
| **模糊搜索** | 按名称 + 简述信息模糊匹配(MVP 不含向量搜索) | doc 14 (T1) |
| **详情展示** | 经验三段式结构 + 元数据 + DAG 可视化 | doc 15 (T2) |
| **基础信息编辑** | 经验 id/description/tags 等元数据直接编辑 | doc 17 (T4) |
| **DAG 可视化** | 经验 DAG 图形化展示(只读,不支持 UI 拖拽编辑) | doc 15 (T2) |
| **LLM 对话编辑** | 通过 LLM 对话理解用户意图,映射到 XML 节点/DAG 概念节点的 CRUD 操作 | doc 16 (T3) |

### 1.3 关键设计决策(2026-09-09 确认)

1. **经验库存储**:使用文件系统持久化 XML + 元数据;
   未来结合关系型和向量数据库作为经验库的持久层
2. **LLM 选型**:使用本地模型(具体 URL 和参数待定)
3. **DAG 编辑方式**:不支持 UI 拖拽操作;引入 LLM 能力,
   通过理解用户对话输入,映射到对实际 XML 节点、DAG 相关概念节点的 CRUD 操作
4. **搜索范围**:MVP 仅支持名称 + 简述信息模糊匹配,不含向量搜索

### 1.4 核心设计原则(继承自 doc 15/18)

1. **XML 中间定义层**:用户/LLM 编辑 XML(业务语义),不接触 L3 JSON(执行细节)
2. **三类节点**:经验节点(引用现有经验)、op 节点(引用 L2 op)、条件节点(单变量判断)
3. **用户不接触寄存器**:参数连接 → 编译器自动推导寄存器/move/表达式
4. **编译器即验收器**:XML→L3 编译通过 = 语法正确;人审 = 语义正确
5. **受限子集先行**:R1-R6 验证规则限定 XML 落在"易于映射 L3"的子集内

---

## 二、架构设计

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────┐
│                   Web 应用 (前端)                     │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │ 经验列表  │  │ 经验详情  │  │ DAG 可视化│           │
│  │ + 模糊   │  │ + 基础信息│  │ (只读展示)│           │
│  │   搜索   │  │   编辑   │  │ React Flow│           │
│  └──────────┘  └──────────┘  └──────────┘           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │ XML 查看  │  │ 编译预览  │  │ LLM 对话  │           │
│  │ (Monaco) │  │ (L3 JSON)│  │ (编辑驱动) │           │
│  └──────────┘  └──────────┘  └──────────┘           │
└──────────────────────┬──────────────────────────────┘
                       │ HTTP API
┌──────────────────────┴──────────────────────────────┐
│                   后端 API 服务                       │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │ 经验 CRUD │  │ 模糊搜索  │  │ XML 校验  │           │
│  │ (文件系统)│  │ (名称+简述)│  │ (R1-R6)  │           │
│  └──────────┘  └──────────┘  └──────────┘           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │ XML→L3   │  │ LLM 代理  │  │ 元数据    │           │
│  │ 编译器    │  │ (本地模型)│  │ 管理      │           │
│  └──────────┘  └──────────┘  └──────────┘           │
└──────────────────────┬──────────────────────────────┘
                       │ 直接 import
┌──────────────────────┴──────────────────────────────┐
│              现有 mvp-prototype 核心                  │
│                                                      │
│  L3 Experience 类型 + 编译器 + 经验库(9 条)           │
│  L2 Operations(11 个 op + formalSpec)               │
│  L1 调度器(5 primitives)                             │
│  L4 Pipeline(现有 MockL4)                            │
└─────────────────────────────────────────────────────┘
```

### 2.2 LLM 对话驱动的编辑模式

DAG 编辑不通过 UI 拖拽,而是通过 LLM 对话理解用户意图,
映射到对 XML 节点和 DAG 概念节点的 CRUD 操作:

```
用户对话输入                         LLM 理解意图
"在读取文件后加一步检查文件大小"  →   在 read_file 节点后插入 evaluate_expr 节点
"把替换节点的 find 参数改成 'foo'" →   修改 string_replace 节点的 find 参数
"删除条件判断节点"                →   删除条件节点及其分支
"加一个错误处理:文件不存在时返回默认值" → 添加条件分支 + 默认值节点
"读取 CSV 文件并统计行数"          →   从空白创建:file_read + evaluate_expr 组合
```

**LLM 的操作粒度**:

| 操作对象 | CRUD 示例 |
|----------|----------|
| XML 节点 | 增删改经验节点/op 节点/条件节点 |
| 节点参数 | 修改节点输入参数(字面量/连接来源) |
| 参数连接 | 建立/修改/删除节点间参数传递关系 |
| 顺序关系 | 调整节点间顺序界定 |
| 分支结构 | 添加/修改条件分支(then/else path) |
| 经验元数据 | 修改 id/description/tags/sideEffects |

**LLM 输出格式**:结构化操作指令(JSON),非直接 XML 文本生成:

```json
{
  "operations": [
    { "type": "add_node", "node": { "kind": "op", "opName": "evaluate_expr", "id": "calc_size" } },
    { "type": "connect", "from": "read_file.content", "to": "calc_size.input.expr" },
    { "type": "set_literal", "node": "calc_size", "param": "expr", "value": "len(content.split('\\n'))" }
  ]
}
```

后端收到操作指令 → 应用到 XML DOM → 校验 → 返回结果(成功/失败 + 错误提示)。

### 2.3 技术栈

| 层 | 技术 | 理由 |
|----|------|------|
| **前端框架** | React 18 + Vite | 生态最成熟 |
| **DAG 可视化** | React Flow(只读模式) | 成熟的节点图渲染,支持自定义节点/边 |
| **代码查看器** | Monaco Editor(只读/查看模式) | XML 语法高亮,查看编译产物 |
| **流程图预览** | Mermaid.js | 与 doc 15 设计一致,PlantUML 的 JS 替代 |
| **状态管理** | Zustand | 轻量,适合中等复杂度 |
| **样式** | Tailwind CSS | 快速迭代 |
| **后端 API** | Fastify | 轻量高效,TypeScript 原生支持 |
| **XML 解析** | fast-xml-parser | doc 15 评估中推荐的成熟方案 |
| **Schema 校验** | Zod | 运行时类型校验,与 TypeScript 类型同步 |
| **经验库存储** | 文件系统(XML + 元数据 JSON) | MVP 持久层;未来结合关系型+向量数据库 |
| **LLM 接入** | LiteLLM 代理(OpenAI 兼容 API) | `http://127.0.0.1:4000`,API Key 从 `LITELLM_MASTER_KEY` 环境变量读取,具体模型可配置 |

### 2.4 经验库文件系统布局

```
experiences/                        # 经验库根目录(文件系统持久化)
├── read_file/
│   ├── experience.xml              # XML 中间定义
│   └── metadata.json               # 元数据(tags/category/sideEffects/version)
├── safe_write/
│   ├── experience.xml
│   └── metadata.json
├── read_file_with_default/
│   ├── experience.xml
│   └── metadata.json
├── check_file_exists/
│   ├── experience.xml
│   └── metadata.json
├── write_file/
│   ├── experience.xml
│   └── metadata.json
├── find_files/
│   ├── experience.xml
│   └── metadata.json
├── search_in_files/
│   ├── experience.xml
│   └── metadata.json
├── run_shell/
│   ├── experience.xml
│   └── metadata.json
└── replace_in_file/
    ├── experience.xml
    └── metadata.json
```

> **未来扩展**:关系型数据库存储元数据(支持复杂查询),
> 向量数据库存储 description embedding(支持语义检索)。
> 文件系统作为 MVP 持久层,接口设计预留数据库适配空间。

### 2.5 项目结构

```
mvp-prototype/
├── src/                        # 现有核心(L1-L4,不变)
├── tests/                      # 现有测试(不变)
├── docs/                       # 现有文档(不变)
├── experiences/                # 新增:经验库文件系统存储
│   └── <exp-id>/
│       ├── experience.xml
│       └── metadata.json
├── web/                        # 新增:经验设计工具
│   ├── server/                 # 后端 API 服务
│   │   ├── routes/             # API 路由
│   │   │   ├── experiences.ts  # 经验 CRUD
│   │   │   ├── search.ts      # 模糊搜索
│   │   │   ├── compile.ts     # XML→L3 编译
│   │   │   └── llm.ts          # LLM 对话代理
│   │   ├── services/           # 业务逻辑
│   │   │   ├── experience-store.ts    # 文件系统存储
│   │   │   ├── search-index.ts        # 模糊搜索索引
│   │   │   ├── xml-validator.ts       # 受限子集校验
│   │   │   ├── xml-to-l3.ts          # XML→L3 编译器
│   │   │   ├── llm-agent.ts           # LLM 对话→操作指令
│   │   │   └── llm-client.ts          # 本地模型 API 客户端
│   │   └── index.ts            # 服务入口
│   ├── client/                 # 前端 React 应用
│   │   ├── src/
│   │   │   ├── components/     # UI 组件
│   │   │   │   ├── ExperienceList.tsx
│   │   │   │   ├── ExperienceDetail.tsx
│   │   │   │   ├── DagViewer.tsx        # React Flow 只读 DAG
│   │   │   │   ├── XmlViewer.tsx        # Monaco 只读 XML
│   │   │   │   ├── CompilePreview.tsx  # L3 JSON 预览
│   │   │   │   ├── MetadataEditor.tsx  # 基础信息编辑
│   │   │   │   └── LlmChat.tsx         # LLM 对话编辑
│   │   │   ├── pages/          # 页面
│   │   │   ├── stores/         # Zustand store
│   │   │   └── api/            # API 客户端
│   │   └── index.html
│   ├── shared/                 # 前后端共享
│   │   ├── xml-schema.ts       # XML schema 定义(Zod)
│   │   ├── xml-validator.ts    # 受限子集校验(R1-R6)
│   │   ├── xml-to-l3.ts        # XML→L3 编译器
│   │   ├── llm-operations.ts   # LLM 操作指令类型定义
│   │   ├── metadata.ts         # 元数据 schema(T4)
│   │   └── types.ts            # 共享类型
│   └── tests/                  # web 模块测试
├── package.json                # workspace 根配置
└── tsconfig.json               # TypeScript 配置
```

---

## 三、阶段切分

### 3.1 总览

```
Phase F1: XML 中间定义层 + 编译器(纯后端,无 UI)
   ↓ Gate-F1: XML→L3 编译器能将受限子集 XML 编译为合法 L3 Experience
Phase F2: 元数据 + 文件系统存储 + 检索(纯后端,无 UI)
   ↓ Gate-F2: 9 条现有经验持久化到文件系统,可被模糊搜索
Phase F3: 可视化浏览(Web 应用,只读)
   ↓ Gate-F3: Web 应用可列表浏览+模糊搜索+详情展示+DAG 可视化 9 条经验
Phase F4: LLM 对话驱动编辑(Web 应用,可写)
   ↓ Gate-F4: LLM 对话→操作指令→XML CRUD→校验→编译预览→人审入库
```

> **注意**:原 F4(交互式画布编辑)和 F5(LLM 辅助设计)已融合为 F4。
> DAG 编辑不通过 UI 拖拽,而是通过 LLM 对话驱动。

### 3.2 阶段详情

#### Phase F1 — XML 中间定义层 + 编译器

**目标**:实现 XML schema 定义、解析、受限子集校验、XML→L3 直接映射编译。

**任务**:

| Task ID | 内容 | 依赖 | 估算 |
|---------|------|------|------|
| F1.1 | XML schema 定义(Zod):节点类型(经验/op/条件)、参数端口、连接、顺序界定、字面量 | doc 15 §3 | M |
| F1.2 | XML 解析器(fast-xml-parser):XML → Zod 校验 → 结构化对象 | F1.1 | S |
| F1.3 | 受限子集校验器(R1-R6):尾部分支/树形/else-if 链/受控回环/单来源/单变量判断 | F1.1 | M |
| F1.4 | XML→L3 编译器(直接映射):参数连接→寄存器分配、顺序→pre/steps、分支→cskip/skip | F1.1-F1.3 | L |
| F1.5 | 编译产物校验:编译出的 L3 Experience 过现有 `compileExperience` 验证合法性 + `l1MainLoop` 端到端试执行 | F1.4 | S |
| F1.6 | 测试:用现有 9 条经验反推 XML(手工构造),编译后与原 L3 语义等价 | F1.4 | M |

**验收标准**:
- 手工构造的 XML(对应 safe_write / read_file_with_default / setup_workspace)能编译为合法 L3
- 受限子集违规(R1-R6)能被校验器正确拒绝并给出引导提示
- 编译产物过现有 `compileExperience` + `l1MainLoop` 端到端测试

**反思触发**:
- 如果 XML schema 无法表达现有 9 条经验的全部结构 → 调整 schema 或放宽受限子集
- 如果直接映射编译需要复杂的结构变换 → 确认是否在受限子集范围内

---

#### Phase F2 — 元数据 + 文件系统存储 + 检索

**目标**:经验库文件系统持久化,元数据 schema 定义,模糊搜索索引。

**任务**:

| Task ID | 内容 | 依赖 | 估算 |
|---------|------|------|------|
| F2.1 | 元数据 schema(T4):tags、category、sideEffects(read-only/fs-write/exec)、version | doc 17 | S |
| F2.2 | 经验库文件系统存储:XML + metadata.json 读写,目录结构管理 | F1.2, F2.1 | M |
| F2.3 | 现有 9 条经验迁移:从 experience-library.ts 导出为 XML + metadata.json | F1.4, F2.2 | M |
| F2.4 | ParamSpec.type 编译期强校验(字面量参数与声明类型矛盾 → 编译失败) | F2.1 | M |
| F2.5 | 模糊搜索索引:名称(id)+ 简述(description)模糊匹配 | F2.2 | S |
| F2.6 | 搜索 API:query → top-k 经验元数据(名称+简述模糊匹配,不含向量搜索) | F2.5 | S |
| F2.7 | 测试:9 条经验文件系统读写 + 模糊搜索覆盖 + type 校验 | F2.3-F2.6 | S |

**验收标准**:
- 9 条经验持久化到 `experiences/` 目录,每条含 experience.xml + metadata.json
- 模糊搜索"文件"能召回 read_file/write_file/safe_write/check_file_exists
- ParamSpec.type 声明 `path` 但给数字字面量 → 编译失败
- 文件系统存储接口设计预留数据库适配空间(关系型+向量数据库)

---

#### Phase F3 — 可视化浏览(Web 应用,只读)

**目标**:搭建 Web 应用骨架,实现经验列表 + 模糊搜索 + 详情展示 + DAG 可视化。

**任务**:

| Task ID | 内容 | 依赖 | 估算 |
|---------|------|------|------|
| F3.1 | 后端 API 服务搭建(Fastify):经验列表/详情/搜索/编译预览 | F2.6 | M |
| F3.2 | 前端骨架(React + Vite + Tailwind):路由、布局、API 客户端 | — | M |
| F3.3 | 经验列表页:卡片式展示(id + description + tags + sideEffects) | F3.1-F3.2 | S |
| F3.4 | 模糊搜索栏:实时过滤(名称 + 简述模糊匹配) | F3.3 | S |
| F3.5 | 经验详情页:三段式结构展示(pre/judgment/target)+ 元数据 | F3.1 | S |
| F3.6 | DAG 可视化(React Flow 只读):XML 节点 → DAG 图渲染,三类节点 + 参数连接 | F3.5, F1.2 | M |
| F3.7 | XML 查看(Monaco 只读):经验 XML 中间定义展示 | F3.5 | S |
| F3.8 | 编译产物视图:XML → L3 Experience JSON,compileExperience 输出 StackEntry 序列 | F3.5, F1.4 | S |
| F3.9 | 基础信息编辑:经验 id/description/tags 等元数据表单编辑 + 保存 | F3.1, F2.1 | S |

**验收标准**:
- Web 应用可访问,列表浏览 + 模糊搜索 9 条经验
- DAG 可视化正确展示三类节点 + 参数连接(无寄存器名/错误码等运行时细节)
- 搜索"文件"能召回相关经验
- 基础信息编辑后保存到文件系统

---

#### Phase F4 — LLM 对话驱动编辑(Web 应用,可写)

**目标**:LLM 对话理解用户意图 → 操作指令 → XML 节点/DAG 概念节点 CRUD → 校验 → 编译预览 → 人审入库。

**任务**:

| Task ID | 内容 | 依赖 | 估算 |
|---------|------|------|------|
| F4.1 | LLM 操作指令 schema 定义:add_node/remove_node/update_node/connect/disconnect/set_literal/set_order/add_branch/remove_branch/update_metadata | — | M |
| F4.2 | LLM 客户端(LiteLLM 代理):`http://127.0.0.1:4000` + `LITELLM_MASTER_KEY` 环境变量 + 配置文件(模型名/temperature/maxTokens) | — | M |
| F4.3 | Prompt 设计:角色(经验设计器)+ 当前 XML 状态 + 可用经验/op 清单 + 操作指令 schema + 对话历史 | F4.1, F4.2, F1.1 | M |
| F4.4 | LLM 对话 → 操作指令:用户对话 → LLM 理解意图 → 输出结构化操作指令(JSON) | F4.3 | M |
| F4.5 | 操作指令执行器:接收操作指令 → 应用到 XML DOM → 生成新 XML | F4.1, F1.2 | M |
| F4.6 | 三层验证:操作后自动跑①R1-R6 受限子集校验(XML 架构完整性)②compileExperience 编译(L3 合法性)③l1MainLoop 试执行(端到端) | F4.5, F1.3, F1.4, F1.5 | S |
| F4.7 | 校验反馈循环:任一层验证失败 → 反馈 LLM → 修正操作 → 再校验(自动迭代 ≤3 轮) | F4.6 | M |
| F4.8 | DAG 可视化刷新:操作后 DAG 实时刷新,高亮变更节点/边 | F4.5, F3.6 | S |
| F4.9 | 从空白创建:自然语言描述场景 → LLM 生成完整 XML 草稿(新建经验) | F4.4 | M |
| F4.10 | 查重提示:生成前模糊搜索相似经验,提示"已有类似经验,是否仍新建" | F4.9, F2.6 | S |
| F4.11 | 人审入库:预览确认 → 保存 XML + 编译 L3 + 写入文件系统 | F4.6, F2.2 | S |
| F4.12 | 测试:LLM 对话生成/修改经验 → 过三层验证全部通过 | F4.7 | M |

**验收标准**:
- 输入"在读取文件后加一步检查文件大小" → LLM 输出操作指令 → XML 更新 → DAG 刷新
- 输入"读取 CSV 文件并统计行数" → LLM 从空白创建 XML 草稿(file_read + evaluate_expr 组合)
- 操作后自动跑三层验证(XML 架构校验 + L3 编译合法性 + 端到端执行),失败时 LLM 自动修正(≤3 轮)
- 人审通过后入库的新经验可通过 l1MainLoop 执行
- 查重能提示与现有 read_file 的语义重叠

**反思触发**:
- 如果 LLM 输出的操作指令经常非法(引用不存在的节点/op)→ 增强 prompt 中的上下文(当前 XML 状态 + 可用清单)
- 如果 LLM 对复杂 DAG 修改的理解准确率低 → 拆分为多轮对话,每轮聚焦一个操作
- 如果 structured output 在本地模型上效果差 → 改为 JSON 模式 + 后处理解析

---

## 四、依赖图

```
F1.1 ──→ F1.2 ──→ F1.3 ──→ F1.4 ──→ F1.5
                    │                  │
                    └──→ F1.6 ←────────┘
                              │
F2.1 ──→ F2.2 ──→ F2.3         │
    │         │                │
    │         ├──→ F2.5 ──→ F2.6
    │         │                │
    └──→ F2.4 │                │
              └──→ F2.7        │
                                │
F3.1 ←── F2.6                   │
F3.2                            │
F3.3 ←── F3.1, F3.2             │
F3.4 ←── F3.3                   │
F3.5 ←── F3.1                   │
F3.6 ←── F3.5, F1.2             │
F3.7 ←── F3.5                   │
F3.8 ←── F3.5, F1.4 ←───────────┘
F3.9 ←── F3.1, F2.1
                                │
F4.1                            │
F4.2                            │
F4.3 ←── F4.1, F4.2, F1.1       │
F4.4 ←── F4.3                   │
F4.5 ←── F4.1, F1.2             │
F4.6 ←── F4.5, F1.3, F1.4 ←─────┘
F4.7 ←── F4.6
F4.8 ←── F4.5, F3.6
F4.9 ←── F4.4
F4.10 ←── F4.9, F2.6
F4.11 ←── F4.6, F2.2
F4.12 ←── F4.7
```

### 关键路径

```
F1.1 → F1.2 → F1.3 → F1.4 → F4.6 → F4.7 → F4.12
```

F1(XML 层 + 编译器)是所有后续阶段的地基,不可压缩。

### 可并行窗口

| 窗口 | 可并行任务 |
|------|-----------|
| F1 内部 | F1.3(校验)∥ F1.6(测试桩) |
| F2 内部 | F2.1(元数据 schema)∥ F2.4(type 校验,写测试桩) |
| F1 ∥ F2 | F2.1(元数据 schema)不依赖 F1,可并行 |
| F3 内部 | F3.1(后端)∥ F3.2(前端骨架) |
| F4 内部 | F4.1(操作指令 schema)∥ F4.2(LLM 客户端)可早开工 |

---

## 五、工作量估算

| Phase | 主开发 | 测试 + buffer | 合计 |
|-------|--------|-------------|------|
| F1 XML 层 + 编译器 | 3-4d | 1-2d | 4-6d |
| F2 元数据 + 文件存储 + 检索 | 3-4d | 1d | 4-5d |
| F3 可视化浏览 | 3-4d | 1d | 4-5d |
| F4 LLM 对话驱动编辑 | 5-7d | 1-2d | 6-9d |
| **合计** | **14-19d** | **4-6d** | **18-25d** |

> F1 ∥ F2.1 可并行(节省 1d);F4.1/F4.2 可在 F3 期间并行(节省 1-2d)。
> 实际关键路径约 **16-20 个工作日**。

---

## 六、风险与对策

| 风险 | 严重度 | 对策 |
|------|--------|------|
| XML schema 无法表达现有 9 条经验的全部结构 | 🟡中 | F1.6 用 9 条经验做回归测试,发现缺口即调整 schema |
| LLM 输出的操作指令经常非法 | 🟡中 | F4.3 prompt 中提供完整当前 XML 状态 + 可用经验/op 清单;F4.7 自动迭代修正 |
| LLM 对复杂 DAG 修改的理解准确率低 | 🟡中 | F4.4 拆分为多轮对话,每轮聚焦一个操作;提供操作历史上下文 |
| 本地模型 structured output 效果差 | �中 | F4.2 改为 JSON 模式 + 后处理解析;或增加 few-shot 示例 |
| 现有 9 条经验迁移到 XML 有信息丢失 | �中 | F2.3 迁移后编译回 L3 与原 L3 语义等价验证 |
| 经验 description 作为 LLM prompt 素材质量不足 | 🟡中 | F4.3 prompt 设计时补充 op 清单 + 参数契约 |
| 文件系统并发写入冲突 | 🟢低 | MVP 单用户,不考虑并发;未来数据库层处理 |

---

## 七、与现有路线图的关系

### 路线图调整

```
原路线图(doc 13):
  近期: A 真LLM + E trace + T2 可视化 + T4 元数据
  中期: B 环境上下文 + D1 错误拦截 + T1 搜索
  远期: T3 LLM辅助设计 → C 经验演化闭环 → F 应用化

调整后路线图:
  近期: F1-F4 经验设计工具(含 T2 可视化 + T4 元数据 + T3 LLM辅助设计)
  中期: A 真LLM(经验库扩充后) + E trace + B 环境上下文
  远期: C 经验演化闭环 + T1 搜索+编排 + F 应用化
  缓行: D1 错误拦截 + D2 嵌套 register 传参
```

### 关键变化

1. **T3 提升为近期优先级**:经验设计工具是经验库扩充的前提
2. **A 降为中期**:经验库扩充后再接真 LLM,识别质量更可控
3. **T2/T4 并入 F 系列**:不再独立,作为经验设计工具的组件
4. **T1(搜索+编排)降为远期**:编排依赖经验库规模,暂缓
5. **E(观测性)降为中期**:接真 LLM 时再做

---

## 八、MVP 边界与待决策问题

### 8.1 MVP 不纳入(明确排除)

| 项 | 决策 | 理由 |
|----|------|------|
| **多用户** | 不纳入 | MVP 单用户工具,不考虑协作编辑 |
| **版本管理** | 不纳入 | 经验修改直接覆盖,不做版本历史/Git 集成 |
| **沙箱执行** | 不纳入 | LLM 生成经验的执行验证直接用真实文件系统 |
| **向量搜索** | 不纳入 | MVP 仅名称+简述模糊匹配,向量检索留到未来 |

### 8.2 MVP 必须纳入(明确包含)

| 项 | 对应任务 | 说明 |
|----|----------|------|
| **XML 架构完整性验证** | F1.3(R1-R6 受限子集校验) | XML 必须通过受限子集校验:尾部分支/树形/else-if 链/受控回环/单来源/单变量判断 |
| **L3 编译结果合法性验证** | F1.5(编译产物校验) | XML→L3 编译产物必须过现有 `compileExperience` 验证为合法 L3 Experience |
| **端到端执行验证** | F1.6 / F4.12 | 编译产物必须能通过 `l1MainLoop` 端到端执行 |

> 这三层验证构成"编译器即验收器"原则的完整链路:
> XML 架构校验 → L3 编译合法性 → L1 端到端执行。
> LLM 生成的经验草稿必须通过全部三层才能入库。

### 8.3 待决策问题

1. ~~**LLM 选型**:OpenAI API?本地模型?~~ → **已决策:本地模型,URL/参数待定**
2. ~~**经验库存储**:硬编码?文件系统?数据库?~~ → **已决策:文件系统(MVP),未来+关系型+向量数据库**
3. ~~**DAG 编辑方式**:UI 拖拽?LLM 对话?~~ → **已决策:LLM 对话驱动,不支持 UI 拖拽**
4. ~~**搜索范围**:向量搜索?模糊匹配?~~ → **已决策:MVP 仅名称+简述模糊匹配,不含向量搜索**
5. ~~**多用户**~~ → **已决策:不纳入 MVP**
6. ~~**版本管理**~~ → **已决策:不纳入 MVP**
7. ~~**沙箱执行**~~ → **已决策:不纳入 MVP**
8. ~~**本地模型选型**~~ → **已决策:LiteLLM 代理服务,见 §8.4**

### 8.4 LLM 接入配置

**服务**:LiteLLM 代理(OpenAI 兼容 API)

| 配置项 | 值 | 来源 |
|--------|-----|------|
| **Base URL** | `http://127.0.0.1:4000` | 固定(LiteLLM 默认端口) |
| **API Key** | 系统环境变量 `LITELLM_MASTER_KEY` | `process.env.LITELLM_MASTER_KEY` |
| **具体模型** | 可配置(通过 LiteLLM 路由) | 配置文件或环境变量 |
| **请求格式** | OpenAI Chat Completions 兼容 | `/v1/chat/completions` |

**配置文件设计**(F4.2 实现):

```json
{
  "llm": {
    "baseUrl": "http://127.0.0.1:4000",
    "apiKeyEnv": "LITELLM_MASTER_KEY",
    "model": "gpt-4o-mini",
    "temperature": 0.2,
    "maxTokens": 4096
  }
}
```

- `baseUrl`:LiteLLM 代理地址,默认 `http://127.0.0.1:4000`,可配置
- `apiKeyEnv`:API Key 的环境变量名,默认 `LITELLM_MASTER_KEY`,从 `process.env` 读取
- `model`:具体模型名,通过 LiteLLM 路由到实际后端模型,可配置
- `temperature`/`maxTokens`:生成参数,可配置

> **设计原则**:Base URL 和 API Key 环境变量名固定为 LiteLLM 默认值,
> 具体模型名和生成参数通过配置文件调整,无需修改代码。
