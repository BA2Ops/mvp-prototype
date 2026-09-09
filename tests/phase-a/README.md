# Phase A — L1 基础设施(单元测试,mock-first)

> 343 个测试 / 22 个文件 / 全部通过
> 策略:mock L2/L3,纯单元测试,无真实 IO

[← 返回主索引](../README.md)

---

## Phase 目标

验证 L1 调度器的 5 个 primitive(move / execute_op / execute_intent / skip_n / conditional_skip)
在 mock L2/L3 下的独立正确性。L1 是无业务语义的底层调度器,可以脱离具体业务单独测试。

## 测试策略

- L2 operation 和 L3 service 全部用 mock 注入
- 不需要真实文件系统
- 测试速度快,失败定位明确
- 覆盖正常路径、边界条件、错误处理、状态保持

---

## 文件索引

### A0 — 项目骨架与 Mock 基础设施

| 文件 | 测试数 | 意图 |
|------|--------|------|
| [a00-skeleton](./tier-a00-skeleton.test.ts) | 8 | Mock L2/L3 基础设施:createMockL2 返回 registry+tracker,mock_op/throwing_op 行为验证 |
| [a00b-manual-l2](./tier-a00b-manual-l2-call-demo.test.ts) | 5 | 手动调用 L2 + state 集成演示:直接调用 mock_op、写入 internalStore、与 executeMove 集成 |
| [a00c-l2-registry](./tier-a00c-l2-registry.test.ts) | 10 | L2Registry:register/get/has/list/clear、重复注册抛错 |
| [a00f-experience-types](./tier-a00f-experience-types.test.ts) | 18 | Experience 数据结构:ParamRef 4 种 kind(literal/input/register/registerOutput)、PreProcessing、ConditionalJudgment、TargetOp、FeedbackRecord |
| [a00g-mock-l3](./tier-a00g-mock-l3-experience.test.ts) | 15 | Mock L3:createMockL3/createSpyL3/createProgrammableL3,与 ExecutionState 集成 |

### A1 — 类型定义层

| 文件 | 测试数 | 意图 |
|------|--------|------|
| [a01-types](./tier-a01-types.test.ts) | 17 | Value 7 种基本类型、Address 3 种 kind(literal/public/internal)、5 种 StackEntry、discriminated union 穷尽 |
| [a01b-formal-param](./tier-a01b-formal-param.test.ts) | 13 | FormalParam 元数据:register/businessName/type/required 字段、OperationFormalSpec 结构 |
| [a01c-operation-error](./tier-a01c-operation-error.test.ts) | 13 | OperationError:4 必填字段(code/message/op/timestamp)、isOperationError 守卫、ERROR_REGISTER 常量 |
| [a01d-address-guards](./tier-a01d-address-guards.test.ts) | 9 | Address 类型守卫:isLiteralAddress/isPublicAddress/isInternalAddress + 互斥 |
| [a01e-stackentry-guards](./tier-a01e-stackentry-guards.test.ts) | 12 | StackEntry 类型守卫:5 种 kind 的 is* 函数 + 互斥 + assertNever |

### A2-A3 — 执行状态与地址解析

| 文件 | 测试数 | 意图 |
|------|--------|------|
| [a02-execution-state](./tier-a02-execution-state.test.ts) | 23 | createInitialState:双区(publicStore/internalStore)、RegisterAllocator、stack 基础操作、resetState、l2/l3 引用 |
| [a03-address-resolver](./tier-a03-address-resolver.test.ts) | 18 | resolveAddress/writeAddress:literal 直返、public 从 publicStore、internal 从 internalStore、错误码 |
| [a03c-address-error-codes](./tier-a03c-address-error-codes.test.ts) | 5 | AddressError.code 字段:LITERAL_WRITE / VARIABLE_NOT_FOUND / readonly |

### A4-A6 — 数据搬运与控制流 primitive

| 文件 | 测试数 | 意图 |
|------|--------|------|
| [a04-move](./tier-a04-move.test.ts) | 16 | move primitive:跨区(literal→internal/public→internal 等)、同区、各种 Value 类型、栈行为(pop on success)、错误处理、bestEffort 跳过 |
| [a05-skip-n](./tier-a05-skip-n.test.ts) | 21 | skip_n:帧边界保护(不跨 IntentEntry)、n=0/1/3/large、graceful underflow、参数校验、DAG if-then-else 场景、与 move 配合 |
| [a06-conditional-skip](./tier-a06-conditional-skip.test.ts) | 31 | conditional_skip:isTruthy helper(null/undefined/boolean/number/string)、条件为真/假、帧边界、n<0 抛错、DAG if-then-else、与其他 primitive 配合 |

### A7-A8 — op 调度与 intent 调度

| 文件 | 测试数 | 意图 |
|------|--------|------|
| [a07-execute-op](./tier-a07-execute-op.test.ts) | 25 | execute_op:mock_op 调用、硬错误 throw、已知错误返回、inputs/outputs 必须 internal、status 生命周期、与 move 配合 |
| [a08-execute-intent](./tier-a08-execute-intent.test.ts) | 20 | execute_intent(帧保留版):children 逆序压栈、phase 状态机(pending→awaiting_children→done)、L3 compile 抛错传播、handleError 标志、嵌套调用 |

### A9-A11 — 主循环、异常冒泡、递归深度

| 文件 | 测试数 | 意图 |
|------|--------|------|
| [a09-main-loop](./tier-a09-main-loop.test.ts) | 20 | l1MainLoop:5-case dispatch、createRootIntentEntry、最小意图(空 children)、线性序列(move+op)、DAG if-then-else、嵌套意图、硬错误传播、maxSteps 防御 |
| [a10-error-bubbling](./tier-a10-error-bubbling.test.ts) | 14 | 异常冒泡:bubbleError 单元测试、handleError 截获(返回 true)、无 handler 冒泡到顶(返回 false)、A/B/C 嵌套冒泡、$r_err 写入 OperationError、UnhandledError |
| [a11-recursion](./tier-a11-recursion.test.ts) | 17 | 递归深度跟踪:enterIntent/exitIntent 计数、有限递归(countdown 3 层)、无限递归防御(RecursionDepthError)、异常冒泡与深度计数清零 |

### AC1 — CRR FrameScopeAllocator

| 文件 | 测试数 | 意图 |
|------|--------|------|
| [aC1-frame-scope-allocator](./tier-aC1-frame-scope-allocator.test.ts) | 18 | FrameScopeAllocator(CRR P1/T-1.1):enter/exit 基本行为、R-1 对称性(error path/retry 嵌套/MAX_ACTIVE_SCOPES 软限)、literal/judge pool round-robin、reset 语义、slot name 格式契约 |

---

## 关键覆盖点

- 5 种 L1 primitive 的完整行为(正常/边界/错误)
- 双区架构(publicStore/internalStore)隔离性
- 帧保留语义(execute_intent 不一次性 pop)
- 异常冒泡机制(handleError 截获 vs 向上传播)
- 递归深度防御(RecursionDepthError)
- CRR FrameScopeAllocator 的 scope 生命周期与对称性
