# 08 - 环境上下文（Environment Context）

> 一种**持久化的会话级元数据容器**，与 AI 行业的"上下文（conversation context / token window）"概念刻意区分。

---

## 决策摘要

引入一个新概念：**Environment Context**（环境上下文）——一个**会话级、持久化、跨轮可复用**的环境元数据容器。

| 维度 | Environment Context | Conversation Context（AI 行业）| Execution Context（doc 06）|
|---|---|---|---|
| **生命周期** | 整个 session | 每个 turn 的 token 窗口 | 每个 sequence |
| **内容** | 环境元数据（OS、项目、工具）| 历史消息 + token | 临时变量 |
| **持久性** | 跨 turn 持久 | 通常不持久 | 不持久 |
| **写入方** | 系统检测 + 用户配置 | LLM + 用户输入 | primitive 执行 |
| **读取方** | L4/L3/L2 任意层 | LLM 推理 | L1/L2 primitives |
| **命名冲突** | **本文档定义的概念** | 业内通用名 | doc 06 已使用 |

### 为什么需要单独定义？

- **避免术语混淆**：业内"context"通常指 token 窗口
- **明确持久化边界**：跨 turn 信息需要明确归属
- **统一访问接口**：所有层用同一份元数据，避免重复检测
- **可观测性**：环境变更可被 trace 记录

### 关键属性

1. **会话级**：创建于 session 启动，销毁于 session 结束
2. **跨 turn 持久**：用户在 turn 5 设的 cwd，turn 10 还能用
3. **可观测**：所有读写都有 trace
4. **分层访问**：L4 只读摘要、L3 可读可填充、L2 可读
5. **不参与业务计算**：只提供参数，**不存中间结果**

---

## 一、概念区分

### 1.1 与 AI 行业"context"的区分

| AI 行业"context" | 本系统 Environment Context |
|---|---|
| LLM 的输入 token 序列 | 环境的结构化元数据 |
| 包含对话历史 | **不包含**对话历史 |
| 每次推理重新组装 | 一次 session 内稳定 |
| 受 token 数量限制 | 无大小限制（结构化数据）|
| 优化目标是"装下更多信息" | 优化目标是"参数精确复用" |

**重要澄清**：在本文档及后续讨论中，**"context" 一律指 Environment Context**。对话历史另称"Conversation History"。

### 1.2 与 Execution Context 的区分

| Execution Context（doc 06）| Environment Context（本文档）|
|---|---|
| 数据区（named variables）| 环境元数据（key-value）|
| 每个 sequence 独立 | 整个 session 共享 |
| 可写：primitive 写入 outputs | **只读**（执行层） |
| 包含：临时计算结果 | **不包含**计算结果 |
| 生命周期：< turn | 生命周期：= session |

**关键边界**：执行层**不**通过 Environment Context 传递数据。数据走 Data Area（`$variable`）；环境走 Environment Context（`$env.*`）。

### 1.3 与 L3/L4 "上下文"的区分

在之前的文档中，"上下文"曾用于多个含义：

| 之前的"上下文"含义 | 本文档对应概念 |
|---|---|
| doc 03 Layer 2 上下文追踪 | **Environment Context**（会话级）|
| doc 06 数据区 + `$ctx.*` | Environment Context 在执行层的**只读投影** |
| doc 07 上下文推断 | Environment Context 的**读取行为** |

**统一约定**：从本文档开始，"context" 仅指 Environment Context；其他场景明确说"对话历史"或"数据区"。

---

## 二、数据结构

### 2.1 完整 Schema

```typescript
interface EnvironmentContext {
  // ────── 系统元数据（启动时检测，基本不变） ──────
  system: {
    os: 'linux' | 'macos' | 'windows' | 'wsl' | 'unknown'
    arch: 'x64' | 'arm64' | 'ia32' | 'unknown'
    shell: 'bash' | 'zsh' | 'fish' | 'powershell' | 'cmd' | 'sh' | 'unknown'
    shell_version?: string
    username: string
    hostname: string
    home_dir: string
    temp_dir: string
    path_separator: '/' | '\\'
  }

  // ────── 项目元数据（启动时检测，可重检测） ──────
  project: {
    root: string                          // 当前项目根目录
    type?: ProjectType                    // 自动推断
    build_system?: BuildSystem            // 自动推断
    test_runner?: TestRunner              // 自动推断
    package_manager?: PackageManager      // 自动推断
    primary_language?: string             // TypeScript / Python / Rust ...
    git?: GitInfo                         // git 仓库信息
  }

  // ────── 工具检测（按需检测，可缓存） ──────
  tools: {
    // 每个 detected 工具的可用性 + 版本
    git?: { available: boolean; version?: string; in_repo: boolean }
    docker?: { available: boolean; version?: string }
    node?: { available: boolean; version?: string }
    python?: { available: boolean; version?: string }
    npm?: { available: boolean; version?: string }
    cargo?: { available: boolean; version?: string }
    make?: { available: boolean; version?: string }
    [tool_name: string]: { available: boolean; version?: string } | undefined
  }

  // ────── 会话元数据 ──────
  session: {
    id: string                            // session UUID
    started_at: number                    // 启动时间戳
    working_directory: string             // 当前工作目录
    previous_cwd?: string                 // 上一次 CWD（用于相对路径推断）
    turn_count: number                    // 已发生的 turn 数
  }

  // ────── 用户/项目偏好（可配置） ──────
  preferences: {
    // 文件模式偏好
    default_log_pattern?: string          // 用户偏好的日志模式
    default_test_glob?: string            // 用户偏好的测试 glob
    default_exclude?: string[]            // 排除目录（.git, node_modules）

    // 命令偏好
    preferred_editor?: string             // 'vim' | 'code' | 'nano'
    confirm_destructive?: boolean         // 删除文件前是否确认

    // 输出偏好
    max_output_lines?: number             // 最大输出行数
    color_output?: boolean                // 是否彩色输出

    [key: string]: any                    // 扩展点
  }
}

type ProjectType = 'node' | 'python' | 'rust' | 'go' | 'java' | 'ruby' | 'cpp' | 'unknown'

type BuildSystem = 'npm' | 'yarn' | 'pnpm' | 'cargo' | 'maven' | 'gradle' | 'make' | 'cmake' | 'unknown'

type TestRunner = 'jest' | 'mocha' | 'pytest' | 'cargo test' | 'go test' | 'mvn test' | 'unknown'

type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'cargo' | 'pip' | 'gem' | 'maven' | 'unknown'

interface GitInfo {
  is_repo: boolean
  remote_url?: string
  current_branch?: string
  has_uncommitted?: boolean
}
```

### 2.2 类型枚举的来源

```typescript
// 这些枚举值需要在 L3 意图库中预定义
// 编译层根据这些 enum 选择具体的 L2 sequence

// 如果 project.type = 'node' + project.build_system = 'npm'
// → run_project_tests 编译为 shell_exec('npm test')
//
// 如果 project.type = 'rust'
// → run_project_tests 编译为 shell_exec('cargo test')
```

---

## 三、信息来源

### 3.1 三种来源

| 来源 | 时机 | 示例 |
|---|---|---|
| **自动检测**（Auto-detected） | 启动时 + 按需重检测 | `os`、`shell`、`project.type` |
| **用户配置**（User-provided） | 配置文件 / CLI 参数 | `preferences.max_output_lines` |
| **运行时推断**（Inferred） | 每次相关操作时 | `git.has_uncommitted` |

### 3.2 自动检测策略

```typescript
interface DetectionRule {
  field: string                          // 要填充的字段
  detect: (env: EnvironmentContext) => Promise<any>
  cache_duration?: number                // 缓存时长（ms）
  on_invalidate?: () => boolean          // 失效条件（如 CWD 变更）
}

const DETECTION_RULES: DetectionRule[] = [
  {
    field: 'system.os',
    detect: async () => process.platform,  // 'linux' | 'darwin' | 'win32'
    cache_duration: Infinity               // session 内不变
  },
  {
    field: 'project.type',
    detect: async (env) => {
      const root = env.project.root
      if (await exists(`${root}/package.json`)) return 'node'
      if (await exists(`${root}/Cargo.toml`)) return 'rust'
      if (await exists(`${root}/pyproject.toml`)) return 'python'
      return 'unknown'
    },
    on_invalidate: () => cwdChanged()      // CWD 变就重检测
  },
  {
    field: 'tools.git.available',
    detect: async () => {
      try {
        await exec('git --version')
        return true
      } catch { return false }
    },
    cache_duration: 5 * 60 * 1000          // 5 分钟
  }
]
```

### 3.3 用户配置来源

```typescript
// 项目级配置：./.pi/env-config.json
{
  "preferences": {
    "default_log_pattern": "logs/*.log",
    "default_exclude": [".git", "node_modules", "dist"]
  }
}

// 全局配置：~/.pi/env-config.json
{
  "preferences": {
    "preferred_editor": "code",
    "confirm_destructive": true,
    "max_output_lines": 1000
  }
}

// CLI 参数：--no-color, --max-lines=500
```

### 3.4 优先级

```
CLI 参数 > 项目级配置 > 全局配置 > 自动检测 > 默认值
```

---

## 四、生命周期

### 4.1 状态机

```
┌──────────────┐
│ UNINITIALIZED│  (启动前)
└──────┬───────┘
       │  session 启动 + 自动检测
       ▼
┌──────────────┐
│   INITIALIZING│  (检测中)
└──────┬───────┘
       │  所有关键字段检测完成
       ▼
┌──────────────┐
│     READY     │  ◀────┐
└──────┬───────┘       │
       │               │ CWD 变更 / 用户配置变更
       │               │
┌──────────────┐      │
│  UPDATING    │──────┘
└──────┬───────┘
       │  session 结束
       ▼
┌──────────────┐
│   DESTROYED  │
└──────────────┘
```

### 4.2 创建时机

```
Session 启动
    ↓
1. 初始化 EnvironmentContext（空对象）
    ↓
2. 检测 system.* （同步，基础信息）
    ↓
3. 并行检测 project.*、tools.*（异步，按需）
    ↓
4. 加载用户配置（preferences）
    ↓
5. 进入 READY 状态
    ↓
6. 第一条用户输入到达
```

### 4.3 更新触发

| 触发条件 | 更新范围 |
|---|---|
| 用户 `cd` 到新目录 | `project.*`、`session.working_directory` |
| 用户修改偏好 | `preferences.*` |
| 长时间未刷新 tools.* | 重检测工具可用性 |
| 用户调用"环境检测"命令 | 全量重检测 |
| 显式 invalidate | 单字段重检测 |

### 4.4 销毁时机

- session 正常结束
- session 异常退出
- 超过最大空闲时间

**关键**：销毁前 Environment Context 应被序列化（用于审计/调试），但**不用于跨 session 持久化**（避免状态污染）。

---

## 五、与其他层的关系

### 5.1 与 L4（意图识别）的关系

**L4 可读 Environment Context 的摘要**（不是完整内容，避免 LLM 上下文膨胀）：

```typescript
// L4 看到的 Environment Context 摘要
interface L4EnvironmentSummary {
  os: string                             // 一行字符串
  shell: string
  project_type?: string
  working_directory: string
  // ... 最多 20 个字段
}
```

**使用场景**：

```
用户: "运行测试"

L4 看到:
  - intent_type = 'execute_command'
  - semantic_params = { target: 'tests' }
  - context.project_type = 'node'
  - context.build_system = 'npm'

L4 输出 RecognizedIntent:
  - 识别为 "运行 npm test"
  - confidence = 0.9
```

### 5.2 与 L3（标准意图库）的关系

**L3 的标准意图可以"声明依赖"某些 Environment Context 字段**：

```typescript
{
  name: 'run_project_tests',
  description: '运行项目的测试套件',
  inputs: {
    // 注意：test_runner 不在 inputs 里
    // 因为它应该从 Environment Context 自动推断
  },
  context_dependencies: ['project.test_runner', 'project.root'],
  // ↑ 显式声明依赖哪些 env 字段

  outputs: { /* ... */ },
  implementation: {
    kind: 'composite',
    children: [
      { operation: 'shell_exec',
        inputs: {
          command: {
            kind: 'derived_from_context',  // ← 从 context 派生
            field: 'project.test_runner',  // 取 test_runner 字段
            transform: (runner) => `${runner}`  // 直接用作命令
          },
          cwd: { kind: 'derived_from_context', field: 'project.root' }
        },
        outputs: { /* ... */ } }
    ]
  }
}
```

**关键设计**：标准意图不"读取"Environment Context，而是**"声明依赖" + "派生输入"**。

### 5.3 与 L2（operations）的关系

**L2 operations 可以有"上下文默认值"参数**：

```typescript
{
  name: 'shell_exec',
  inputs: {
    command: { type: 'string', required: true },
    cwd: {
      type: 'path',
      required: false,
      default_source: 'environment',          // ← 默认值来源
      default_field: 'session.working_directory'  // ← 具体字段
    },
    timeout: { type: 'number', required: false }
  },
  // ...
}
```

**优先级**：

```
显式参数 > Environment Context 默认值 > operation 内部默认值 > 错误
```

### 5.4 与 L1（primitives）的关系

**L1 primitives 不感知 Environment Context**。

理由：
- L1 是不可分的硬件抽象
- Environment Context 是会话级概念，不属于执行原子
- 数据传递通过 `$variable`（数据区），不是 `$env.*`

### 5.5 完整交互图

```
                  ┌────────────────────────────┐
                  │  Environment Context       │
                  │  (会话级元数据)            │
                  └──────────┬─────────────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
   ┌─────────┐         ┌─────────┐         ┌─────────┐
   │   L4    │         │   L3    │         │   L2    │
   │ (只读   │         │ (声明依赖│         │ (默认值  │
   │  摘要)  │         │ + 派生) │         │  来源)  │
   └─────────┘         └─────────┘         └─────────┘
                                                 │
                                                 ▼
                                          ┌─────────┐
                                          │   L1    │
                                          │ (不感知)│
                                          └─────────┘
```

---

## 六、传播与失效机制

### 6.1 主动失效

```typescript
// 用户 cd 到新目录后
on_cwd_change(new_cwd: string) {
  env.session.working_directory = new_cwd
  invalidate('project.*')          // 项目相关字段重检测
  invalidate('tools.git')         // git 信息可能变了
  // 注意：system.* 不需要失效
}
```

### 6.2 被动失效

```typescript
// 检测到的字段超过 cache_duration
on_cache_expired(field: string) {
  reDetect(field)
  emit_trace({ event: 'env_cache_refresh', field })
}
```

### 6.3 失效传播

当 Environment Context 更新时：

| 字段 | 传播动作 |
|---|---|
| `project.type` | 通知 L3 重新评估依赖该字段的意图 |
| `session.working_directory` | 通知所有 L2 用 cwd 作为默认值的 operation |
| `preferences.*` | 立即生效，无需传播 |
| `system.*` | 不传播（session 内不变）|

### 6.4 冲突解决

当 Environment Context 的字段与显式参数冲突：

```typescript
// 例：用户说 "在 /tmp 运行 npm test"，但 session.cwd = /home/user
shell_exec({
  command: 'npm test',
  cwd: '/tmp'                          // ← 显式参数优先
})

// 结果：忽略 env.session.working_directory，使用 '/tmp'
```

---

## 七、与 AI 行业的"上下文管理"对照

### 7.1 不混淆

| AI 行业概念 | 本系统对应 |
|---|---|
| Context window（token 限制） | 不存在此概念（LLM 输入是结构化数据）|
| Conversation history | 单独概念，独立于 Environment Context |
| Memory / RAG | 不在本系统范围 |
| System prompt | 包含 Environment Context 摘要 |

### 7.2 我们有什么

| 本系统概念 | 用途 |
|---|---|
| **Environment Context** | 会话级环境元数据（本文档）|
| Conversation History | 用户的输入历史（用于上下文理解）|
| Data Area | 执行层的临时变量（doc 06）|
| Trace Log | 全链路可观测性（执行追踪）|

### 7.3 为什么避免用"上下文"

- "context" 在 AI 行业已有强约定（=token 窗口 + 历史）
- 使用新词（**Environment Context**）避免歧义
- 在本系统内部，可以用 "env" 作为简称（如 `$env.project.root`）

---

## 八、关键决策

### D1. 为什么叫"Environment Context"而非"Context"？

**决策**：明确命名为 **Environment Context**（环境上下文），刻意与 AI 行业"context"区分。

**理由**：
- 业内"context"通常指 token 窗口 + 对话历史
- 本概念是**环境元数据**，与对话无关
- 命名区分减少沟通歧义
- 在代码中可缩写为 `env`

### D2. 为什么 Environment Context 不存数据计算结果？

**决策**：Environment Context 只存**环境元数据**，不存中间结果或用户数据。

**理由**：
- 中间结果属于 Execution Data Area（doc 06）
- 用户数据属于文件系统（由 L2 operations 访问）
- Environment Context 只回答"环境是什么"，不回答"程序在做什么"

### D3. 为什么 L4 只看摘要而非完整内容？

**决策**：L4 看到的 Environment Context 是**精简摘要**（最多 20 个字段）。

**理由**：
- 完整 Environment Context 可能很大（包含所有检测到的工具）
- LLM 的注意力是有限资源
- 摘要保证 L4 关注最相关的环境信息
- 完整 Environment Context 由 L3 / L2 直接访问，不经过 LLM

### D4. 为什么 Environment Context 在执行层只读？

**决策**：L1 / L2 primitives **不能写入** Environment Context。

**理由**：
- Environment Context 是"环境事实"，不是"程序状态"
- 写入会破坏其"客观性"
- 程序产生的中间结果应该写到 Data Area 或文件
- 例外：某些特殊操作可触发 Environment Context 重检测（如 `cd`）

### D5. 为什么 Environment Context 不跨 session 持久化？

**决策**：Environment Context 在 session 结束时销毁，**不持久化到下次 session**。

**理由**：
- 避免状态污染（不同 session 的环境可能不同）
- 强制每次 session 重新检测（环境可能已变化）
- 简化生命周期模型
- 用户偏好通过**单独的配置文件**持久化，不通过 Environment Context

---

## 九、与现有系统的关系

### 9.1 与 doc 06（执行层）的关系

| doc 06 概念 | 本文档对应 |
|---|---|
| Data Area（`$variable`）| **不变**（程序数据） |
| `$ctx.*` | **改名为 `$env.*`**（语义清晰） |
| ExecutionContext.operation | **不变** |
| Operation 的 default_source | **新增**：`environment` |

### 9.2 与 doc 07（意图库）的关系

| doc 07 概念 | 本文档对应 |
|---|---|
| L4 看到的 context | 改用 **L4EnvironmentSummary**（精简版）|
| 标准意图的"上下文推断" | 改用 **context_dependencies + derived_from_context** |
| 10.3 上下文推断的归属 | **明确**：Environment Context 是独立的数据源 |

### 9.3 与 doc 03（六层架构）的关系

| doc 03 Layer 2 | 本文档 |
|---|---|
| 上下文追踪 | **形式化为 Environment Context** |
| explicit / inferred / derived | **改为**：auto-detected / user-configured / runtime-inferred |

### 9.4 命名统一建议

为避免混淆，建议后续文档统一：

| 旧命名 | 新命名 |
|---|---|
| `$ctx.*` | `$env.*` |
| 上下文推断 | Environment Context 派生 |
| Layer 2 上下文追踪 | Environment Context 管理 |

---

## 十、开放问题

### 10.1 敏感信息处理

**问题**：Environment Context 可能包含敏感信息（如 git remote URL 含 token、用户名、hostname）。

**方案**：
- A. 自动脱敏（git URL 替换为 `<repo>`）
- B. 用户显式标记敏感字段
- C. 默认全部不传给 LLM（仅系统内部使用）

**当前决策**：倾向 A（默认脱敏，用户可选关闭）。

### 10.2 大型项目的扫描性能

**问题**：检测 project.type 需要读 `package.json`、`Cargo.toml` 等多个文件，大型项目可能慢。

**方案**：
- A. 异步并行检测
- B. 增量检测（只检测必要字段）
- C. 缓存到磁盘（项目级）

**当前决策**：MVP 阶段用 A（异步并行）。

### 10.3 检测的可重现性

**问题**：Environment Context 检测的时机影响后续判断（如"在 commit 之前 vs 之后检测 git 状态"）。

**方案**：
- A. 检测时打时间戳，所有读取用"检测时的快照"
- B. 每次读取实时获取（不缓存）
- C. 用户可指定"快照模式"

**当前决策**：倾向 A（快照语义），但实现复杂。

### 10.4 配置文件的优先级

**问题**：项目配置和全局配置冲突时，谁优先？

**当前决策**：CLI > 项目级 > 全局级 > 检测 > 默认（已写入 D5 优先级表）。

但**项目级 vs 全局级**的边界有时模糊（如 `max_output_lines` 是用户偏好还是项目规范？）。

**开放**：需要更细粒度的字段分类（user / project / system）。

### 10.5 Environment Context 的版本

**问题**：Environment Context 自身有 schema，会随时间演化。

**当前决策**：Environment Context 内部使用 semver 版本号；旧版本字段保留兼容。

---

## 十一、MVP 范围

### 11.1 最小可用集

**MVP 必备字段**（v1 必须实现）：

```typescript
interface MVPEnvironmentContext {
  system: {
    os: 'linux' | 'macos' | 'windows' | 'wsl' | 'unknown'
    shell: string
    username: string
    home_dir: string
  }
  project: {
    root: string
    type?: 'node' | 'python' | 'rust' | 'unknown'
    build_system?: 'npm' | 'yarn' | 'cargo' | 'unknown'
    test_runner?: string
    git?: { is_repo: boolean; current_branch?: string }
  }
  session: {
    id: string
    working_directory: string
    turn_count: number
  }
}
```

### 11.2 推迟到 v2

- `tools.*` 完整检测（仅检测 git、docker、node）
- `preferences.*` 完整配置系统
- 自动脱敏
- 持久化（v1 不持久化）

### 11.3 实施步骤

```
Week 1: 定义 schema + 检测器骨架
Week 2: system.* + project.* 检测
Week 3: 与 L3 集成（context_dependencies）
Week 4: 与 L2 集成（default_source）
Week 5: L4 摘要 + 失效传播
Week 6: 用户配置 + 文档
```

---

## 十二、设计意图一页纸

### 一句话定义

**Environment Context 是会话级、持久化、跨轮可复用的环境元数据容器，与 AI 行业的"context"概念刻意区分。**

### 核心属性

1. **会话级**：启动时创建，结束时销毁
2. **跨 turn 持久**：不参与 turn-to-turn 的 token 窗口
3. **分层访问**：L4 只读摘要，L3 声明依赖，L2 默认值来源，L1 不感知
4. **不存业务数据**：只回答"环境是什么"，不回答"程序在做什么"
5. **可观测**：所有读写有 trace

### 数据流向

```
启动检测 → Environment Context ←┐
                                │
        ┌─────────┬─────────────┤
        ▼         ▼             ▼
       L4 摘要   L3 派生     L2 默认值
        │         │             │
        └─────────┴──────┬──────┘
                       ▼
                  L1 执行（不感知）
```

### MVP 范围

- 字段：system + project + session（最小集）
- 检测：启动时 + 按需重检测
- 集成：L3 context_dependencies + L2 default_source
- 配置：项目级 + 全局级 + CLI

### 与现有概念的边界

| 概念 | 归属 | 内容 |
|---|---|---|
| **Environment Context** | 本文档 | 环境元数据 |
| Conversation History | 单独概念 | 用户输入历史 |
| Data Area | doc 06 | 执行层临时变量 |
| Trace Log | 单独概念 | 可观测性 |

### 命名约定

- 完整名：**Environment Context**
- 简称：**env**
- 代码中：`$env.*` 访问
- 避免用："context"（歧义）

---

## 十三、参考与交叉引用

- **doc 02** 翻译层假说：解释了为什么需要 LLM 之外的持久化层
- **doc 03** 六层架构：原"Layer 2 上下文追踪"的概念升级为 Environment Context
- **doc 06** 执行层设计：Data Area 与 Environment Context 的边界
- **doc 07** 意图库：标准意图的 context_dependencies 依赖本文档
- **doc 05** 实施路线图：Environment Context 的实施步骤