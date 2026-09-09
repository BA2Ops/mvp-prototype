# Phase F3 — 可视化浏览(Web 应用,只读)

> **Phase 目标**:搭建 Web 应用骨架,实现经验列表 + 模糊搜索 + 详情展示 + DAG 可视化
> **Gate-F3**:Web 应用可列表浏览 + 模糊搜索 + 详情展示 + DAG 可视化 9 条经验
> **计划文档**:[doc 20](../../docs/mvp/20-experience-design-tool.md) | [主任务计划](../README.md)
> **状态**:未开始

---

## 一、任务分解

### F3.1 — 后端 API 服务搭建

**目标**:搭建 Fastify 服务,提供经验列表/详情/搜索/编译预览 API。

**输入**:F2.6(搜索 API)

**输出**:
- `web/server/index.ts`:服务入口
- `web/server/routes/experiences.ts`:经验 CRUD API
- `web/server/routes/compile.ts`:编译预览 API

**实现要点**:

API 端点:

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/experiences` | 经验列表(含元数据摘要) |
| GET | `/api/experiences/:id` | 经验详情(含 XML + 元数据) |
| GET | `/api/experiences/:id/xml` | 经验 XML 原文 |
| GET | `/api/experiences/:id/l3` | 编译后的 L3 Experience JSON |
| GET | `/api/experiences/:id/stack` | compileExperience 输出的 StackEntry 序列 |
| GET | `/api/search?q=&k=` | 模糊搜索(F2.6) |
| PUT | `/api/experiences/:id/metadata` | 更新元数据(F3.9 基础信息编辑) |

- 服务启动时加载经验库到内存(从文件系统)
- 编译预览实时调用 F1.4 XML→L3 + F1.5 验证

**验收标准**:
- API 服务可启动,监听端口(默认 3000)
- 全部端点可调用,返回正确数据

**依赖**:F2.6
**估算**:M(3-4h)

---

### F3.2 — 前端骨架搭建

**目标**:搭建 React + Vite + Tailwind 前端骨架,路由、布局、API 客户端。

**输入**:无

**输出**:
- `web/client/`:前端项目
- 路由:React Router
- 布局:顶部导航 + 主内容区
- API 客户端:`web/client/src/api/`

**实现要点**:

页面路由:
- `/` → 经验列表页
- `/experiences/:id` → 经验详情页

布局:
```
┌─────────────────────────────────────┐
│  经验设计工具          [搜索栏]     │  顶部导航
├─────────────────────────────────────┤
│                                     │
│         主内容区(路由出口)          │
│                                     │
└─────────────────────────────────────┘
```

技术栈:
- React 18 + Vite
- Tailwind CSS
- Zustand(状态管理)
- React Router

**验收标准**:
- 前端可启动(`npm run dev`)
- 路由可切换,布局正确渲染

**依赖**:无(可与 F3.1 并行)
**估算**:M(3-4h)

---

### F3.3 — 经验列表页

**目标**:卡片式展示经验列表(id + description + tags + sideEffects)。

**输入**:F3.1(列表 API)、F3.2(前端骨架)

**输出**:
- `web/client/src/pages/ExperienceListPage.tsx`
- `web/client/src/components/ExperienceCard.tsx`

**实现要点**:

卡片展示:
```
┌─────────────────────────────────┐
│ read_file                    📄  │  id + sideEffects 图标
│ 读取文件内容                     │  description
│ #file #read                     │  tags
│ file-io · read-only             │  category · sideEffects
└─────────────────────────────────┘
```

- 点击卡片跳转详情页
- sideEffects 用图标区分:📄 read-only / ✏️ fs-write / ⚡ exec

**验收标准**:
- 列表展示 9 条经验
- 卡片信息正确
- 点击跳转详情页

**依赖**:F3.1, F3.2
**估算**:S(2-3h)

---

### F3.4 — 模糊搜索栏

**目标**:实时过滤经验列表(名称 + 简述模糊匹配)。

**输入**:F3.3(列表页)

**输出**:
- `web/client/src/components/SearchBar.tsx`
- 集成到列表页

**实现要点**:
- 搜索栏置于顶部导航或列表页顶部
- 输入时调用 `/api/search` API(防抖 300ms)
- 搜索结果替换列表展示
- 空输入恢复全量列表

**验收标准**:
- 输入"文件"实时过滤出 file-io 类经验
- 输入"shell"过滤出 run_shell
- 清空搜索恢复全量

**依赖**:F3.3
**估算**:S(1-2h)

---

### F3.5 — 经验详情页

**目标**:展示经验三段式结构(pre/judgment/target)+ 元数据。

**输入**:F3.1(详情 API)

**输出**:
- `web/client/src/pages/ExperienceDetailPage.tsx`
- `web/client/src/components/ExperienceOverview.tsx`
- `web/client/src/components/ThreeStageView.tsx`

**实现要点**:

详情页布局:
```
┌─────────────────────────────────────┐
│ read_file                      [编辑]│  id + 编辑按钮
│ 读取文件内容                         │  description
│ #file #read · file-io · read-only   │  元数据
├─────────────────────────────────────┤
│ Tab: 概览 | DAG | XML | L3 | 编译产物 │  Tab 切换
├─────────────────────────────────────┤
│                                     │
│           Tab 内容区                 │
│                                     │
└─────────────────────────────────────┘
```

概览 Tab:
- 输入参数 schema(inputs)
- 输出参数 schema(outputs)
- 三段式结构:pre_processing / conditional_judgment / target_op
- 元数据:tags/category/sideEffects/version

**验收标准**:
- 详情页展示 9 条经验的完整信息
- 三段式结构正确展示
- Tab 可切换

**依赖**:F3.1
**估算**:S(2-3h)

---

### F3.6 — DAG 可视化(React Flow 只读)

**目标**:XML 节点 → DAG 图渲染,三类节点 + 参数连接。

**输入**:F3.5(详情页)、F1.2(XML 解析器)

**输出**:
- `web/client/src/components/DagViewer.tsx`
- `web/client/src/components/nodes/OpNode.tsx`
- `web/client/src/components/nodes/ExperienceNode.tsx`
- `web/client/src/components/nodes/ConditionNode.tsx`

**实现要点**:

节点渲染:
- op 节点:矩形,显示 op 名 + 输入/输出端口
- 经验节点:圆角矩形,显示经验 ID + 输入/输出端口
- 条件节点:菱形,显示条件变量 + then/else 分支

边渲染:
- 参数连接:实线箭头,标注参数名
- 顺序界定:虚线箭头
- 分支:then 实线 / else 虚线

布局:
- 自动布局(dagre 或 ELK)
- 只读模式(不可拖拽编辑)

**关键**:DAG 可视化不显示寄存器名/错误码等运行时细节,只显示业务语义。

**验收标准**:
- 9 条经验的 DAG 正确渲染
- 三类节点视觉可区分
- 参数连接正确标注
- 无寄存器名/错误码等运行时细节

**依赖**:F3.5, F1.2
**估算**:M(4-6h)

---

### F3.7 — XML 查看(Monaco 只读)

**目标**:展示经验 XML 中间定义。

**输入**:F3.5(详情页)

**输出**:
- `web/client/src/components/XmlViewer.tsx`

**实现要点**:
- Monaco Editor 只读模式
- XML 语法高亮
- 代码折叠

**验收标准**:
- XML 正确展示,语法高亮
- 只读不可编辑

**依赖**:F3.5
**估算**:S(1h)

---

### F3.8 — 编译产物视图

**目标**:展示 XML → L3 Experience JSON + compileExperience 输出的 StackEntry 序列。

**输入**:F3.5(详情页)、F1.4(编译器)

**输出**:
- `web/client/src/components/CompilePreview.tsx`
- `web/client/src/components/StackView.tsx`

**实现要点**:

两个子 Tab:
1. **L3 JSON**:编译后的 Experience 对象(JSON 格式)
2. **StackEntry 序列**:compileExperience 输出的指令栈(汇编清单风格)

StackEntry 展示:
```
[0] move $r_input_path → $S0.in0
[1] execute_op file_read
[2] move $S0.out0 → $r_content
[3] move $S0.out1 → $r_err
[4] conditional_skip ...
```

- 编译失败时显示错误信息

**验收标准**:
- L3 JSON 正确展示
- StackEntry 序列正确展示
- 编译失败显示错误

**依赖**:F3.5, F1.4
**估算**:S(2-3h)

---

### F3.9 — 基础信息编辑

**目标**:经验 id/description/tags 等元数据表单编辑 + 保存。

**输入**:F3.1(更新元数据 API)、F2.1(元数据 schema)

**输出**:
- `web/client/src/components/MetadataEditor.tsx`

**实现要点**:

可编辑字段:
- description(textarea)
- tags(标签输入器,逗号分隔)
- category(下拉选择)
- sideEffects(单选:read-only/fs-write/exec)
- version(文本输入)

不可编辑字段:
- id(创建后不可改)

保存:
- 调用 `PUT /api/experiences/:id/metadata`
- 保存到 metadata.json
- 保存后刷新详情页

**验收标准**:
- 可编辑元数据并保存
- 保存后文件系统 metadata.json 更新
- 刷新页面后元数据保持

**依赖**:F3.1, F2.1
**估算**:S(2-3h)

---

## 二、任务依赖图

```
F3.1 ──→ F3.3 ──→ F3.4
  │                   │
  ├──→ F3.5 ──→ F3.6
  │         ├──→ F3.7
  │         ├──→ F3.8
  │         └──→ F3.9
  │
F3.2 ──→ F3.3
```

**关键路径**:F3.1 → F3.5 → F3.6

**并行窗口**:
- F3.1(后端)∥ F3.2(前端骨架)
- F3.6(DAG)∥ F3.7(XML 查看)∥ F3.8(编译产物)∥ F3.9(元数据编辑)

---

## 三、Gate-F3 验收标准

| 验收项 | 标准 |
|--------|------|
| Web 应用 | 可访问,正常启动 |
| 列表浏览 | 9 条经验卡片展示 |
| 模糊搜索 | "文件"/"shell"/"search" 能过滤 |
| 详情展示 | 三段式结构 + 元数据 |
| DAG 可视化 | 三类节点 + 参数连接,无运行时细节 |
| XML 查看 | XML 语法高亮只读展示 |
| 编译产物 | L3 JSON + StackEntry 序列 |
| 基础信息编辑 | 元数据可编辑保存 |

---

## 四、进度追踪

| 任务 | 状态 | 开始时间 | 完成时间 | 备注 |
|------|------|----------|----------|------|
| F3.1 | ✅ 完成 | 2026-09-09 | 2026-09-09 | Fastify 后端,CRUD+搜索+编译预览 API |
| F3.2 | ✅ 完成 | 2026-09-09 | 2026-09-09 | React+Vite+Tailwind v4,Monaco+ReactFlow |
| F3.3 | ✅ 完成 | 2026-09-09 | 2026-09-09 | 经验列表页,卡片式展示 |
| F3.4 | ✅ 完成 | 2026-09-09 | 2026-09-09 | 搜索栏,300ms 防抖 |
| F3.5 | ✅ 完成 | 2026-09-09 | 2026-09-09 | 详情页,Tab 切换 |
| F3.6 | ✅ 完成 | 2026-09-09 | 2026-09-09 | ReactFlow DAG,拓扑分层布局 |
| F3.7 | ✅ 完成 | 2026-09-09 | 2026-09-09 | Monaco XML 只读查看 |
| F3.8 | ✅ 完成 | 2026-09-09 | 2026-09-09 | L3 编译结果+StackEntry JSON 查看 |
| F3.9 | ✅ 完成 | 2026-09-09 | 2026-09-09 | 元数据编辑(描述/标签/分类/副作用/版本/状态) |
