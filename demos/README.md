# MVP Demo Scripts — 核心能力演示与验证

8 个独立可运行的演示脚本，覆盖 MVP 全部核心能力。每个脚本自带：
**环境确认 → 演示数据准备 → 分步演示（每步观察点）→ 程序化验证清单**。

## 运行方式

```bash
cd mvp-prototype
npx tsx demos/demo-01-l1-primitives.ts   # 逐个运行
npx tsx demos/demo-0X-....ts
```

任一脚本的验证清单全部通过时以退出码 0 结束；任一失败非零退出（CI 可感知）。
演示数据写入独立 tmpdir，结束自动清理，不污染工作区。

## 环境要求

| 项目 | 要求 | 说明 |
|---|---|---|
| Node.js | >= 22.5 | `fs.promises.glob` 需要（demo 启动时自动检查）|
| 操作系统 | Windows / Linux / macOS | shell 演示用 `process.execPath` 保证跨平台 |
| 网络 | 无需 | 全部本地操作 |

## Demo 清单

| # | 脚本 | 演示能力 | 关键观察点 |
|---|---|---|---|
| 01 | `demo-01-l1-primitives.ts` | L1 五原语 + 主循环 | 寄存器装载 / Jcc 条件跳过 / JMP / CALL 帧保留与收尾 |
| 02 | `demo-02-l2-operations.ts` | L2 真实操作契约 | 磁盘往返 / ENOENT 数据化 / glob/grep/替换 / execFile 子进程 |
| 03 | `demo-03-evaluate-expr.ts` | 表达式求值 | 嵌套 AST / and-or 短路 / 三元 if / 三类错误数据化 / 运算符全景 |
| 04 | `demo-04-error-handling.ts` | 错误处置权三态 | 数据化 vs 冒泡 vs handleError 截获；截获后执行流继续 |
| 05 | `demo-05-l3-compiler.ts` | L3 编译器 | 输入绑定 / skip_cost 裁剪产物对比 / 分支骨架 / 同产物异路径执行 |
| 06 | `demo-06-nested-experience.ts` | 嵌套经验调用 | 编排经验串联核心经验 / 幂等重跑 / register 引用编译期拒绝 |
| 07 | `demo-07-recursion-loop.ts` | 递归循环 | 两经验递归设计 / 200 层性能基线 / RecursionDepthError 防护 |
| 08 | `demo-08-nl-pipeline.ts` | 自然语言端到端 | 话语→intent→真实文件操作闭环 / 条件分支 / 幂等 / 未识别不执行 |

## 推荐演示顺序

```
01（L1 地基）→ 02（L2 真实操作）→ 03（表达式基石）
→ 04（错误模型）→ 05（L3 编译）→ 06（嵌套）
→ 07（循环）→ 08（自然语言全链路收官）
```

01-04 展示「层内能力」，05-07 展示「层间协作」，08 是完整闭环。

## 每个脚本的统一结构

1. **环境确认**：Node 版本、tmpdir 可写、工作目录创建（失败即终止）
2. **演示数据准备**：真实 tmpdir 文件 / 经验 fixtures / registry 注册
3. **分步演示**：每步含说明（💡）、观察输出（👁）、程序化验证（✓/✗）
4. **结束验证清单**：汇总全部检查项，全部通过才算演示成功

## 与测试套件的关系

- 测试（557 个）：回归保障，覆盖边界与异常路径
- Demo（8 个）：能力叙事，每一步为人工观察设计输出，
  同时内置程序化断言——**演示即验证**
