# 设计反馈报告（FDR）：双区架构重大重写

**日期**：2026-08-20  
**触发条件**：双区存储 + register metadata 架构达成共识（基于 8 月 19 日-20 日讨论）  
**作者**：与 pi coding agent 协同  
**类型**：重大架构重写（Major Rewrite）

---

## 一、触发原因

原设计（commit `ec16ecf` 之前）有以下问题：

### 1.1 单 resultStore 不区分业务/寄存器
- 所有数据都存在 `resultStore: Map<string, Value>`
- 没有"业务命名"和"寄存器命名"的区分
- L2 op 的 input/output 无法明确"哪个寄存器"
- 违反了 L3 should-read-metadata-only 的原则（D8）

### 1.2 缺少 FormalParam 桥接
- Operation 只有 inputs/outputs schema（弱类型描述）
- 缺少"业务语义名" ↔ "L1 寄存器地址"的显式映射
- L3 编译时无法确定每个 param 应分配哪个寄存器

### 1.3 错误处理无统一结构
- 没有标准 OperationError 接口
- 各 op 自己决定 error 输出格式
- $r_err 概念未确立

### 1.4 寄存器分配语义不清
- 没有 RegisterAllocator
- L3 分配还是 L1 分配？
- 每个外部意图循环 vs 每次 compile？

---

## 二、设计决策（已确认）

### D-T1：双区存储
- `publicStore: Map<string, Value>` — 业务数据，持久，业务命名
- `internalStore: Map<string, Value>` — 寄存器，瞬态，形参命名

### D-T2：每个 op 的 input/output 独立寄存器
- 不共享 frame
- 每个 input 单独寄存器，每个 output 单独寄存器

### D-T3：单个 $r_err 寄存器
- 全局共享（last op wins）
- 所有 op 遵守统一 OperationError 结构

### D-T4：标准 OperationError 结构
```typescript
{
  code: string      // 'ENOENT', 'EXEC_FAILED', ...
  message: string
  op: string        // operation name
  timestamp: number
  details?: unknown // optional
}
```

### D-T5：寄存器分配器在 L1
- L1 创建 `RegisterAllocator`，挂在 `state.allocator`
- 每个外部意图处理循环初始化一次
- L3 通过 `state.allocator.allocate()` 分配
- $r_err 是保留名（不通过 allocate 分配）

### D-T6：FormalParam.register 必选
- 类型层面强制
- 编译期保证每个 param 都有 register

### D-T7：Primitive 约束
- `move`：from 可为 literal/public/internal/file；to 不能是 literal
- `execute_op`：inputs/outputs 只能是 internal
- `execute_intent`：inputs/outputs 只能是 internal
- `conditional_skip`：conditionAddr 必须是 internal
- `skip_n`：无 Address 访问

### D-T8：literal 必须先 move 到 internal
- literal 不能直接喂给 execute_op
- 必须先 `move(literal → $rN)`

### D-T9：file 必须先 move 到 internal
- 同 D-T8 逻辑

---

## 三、影响范围

### 3.1 代码变更（已实施）

| 文件 | 变更类型 | 说明 |
|---|---|---|
| `src/l1/types.ts` | 重写 | Address 重构（4 kinds）+ Address type guards |
| `src/l1/execution-state.ts` | 重写 | 双区 + RegisterAllocator |
| `src/l1/address-resolver.ts` | 重写 | 处理 public/internal |
| `src/l1/primitives/move.ts` | 更新 | 新约束（to ≠ literal） |
| `src/l2/operation.ts` | 重写 | 加 formalSpec, FormalParam, OperationFormalSpec |
| `src/l2/errors.ts` | 新增 | 标准 OperationError + helpers |
| `src/mocks/mock-l2.ts` | 更新 | mock_op 加 formalSpec |
| `src/mocks/mock-l3.ts` | 更新 | 类型更新 |
| `tests/phase-a/tier-a01*.ts` | 重写+新增 | Address 类型 + FormalParam + OperationError |
| `tests/phase-a/tier-a02*.ts` | 重写 | 双区 + RegisterAllocator |
| `tests/phase-a/tier-a03*.ts` | 重写 | 新 Address 类型 |
| `tests/phase-a/tier-a04*.ts` | 重写 | 新约束 move |
| `tests/phase-a/tier-a00b*.ts` | 重写 | demo 测试 |

### 3.2 文档变更（待办）

| 文档 | 章节 | 待更新内容 |
|---|---|---|
| `docs/mvp/06-execution-layer.md` | §3 Primitive 规范 | 4 kinds Address + 跨区约束 |
| `docs/mvp/06-execution-layer.md` | §13 CPU 类比 | 双区类比 |
| `docs/mvp/09-l1-implementation.md` | §5 类型定义 | Address + FormalParam |
| `docs/mvp/09-l1-implementation.md` | §6 Operation | formalSpec |
| `docs/mvp/09-l1-implementation.md` | §7 ExecutionState | 双区 + RegisterAllocator |
| `docs/mvp/10-reactive-execution-model.md` | §二 数据结构 | 双区 + 形参元数据 |
| `docs/mvp/10-reactive-execution-model.md` | §三 main loop | 5 case dispatch 调整 |
| `docs/mvp/11-prototype-implementation-plan.md` | Phase A 描述 | 调整 A2-A4 描述 |

### 3.3 架构改进

**之前**（commit `ec16ecf`）:
```
ExecutionState {
  stack: StackEntry[]
  resultStore: Map<string, Value>  // 单一存储区
}

Operation {
  name: string
  inputs: Record<string, FieldSchema>
  outputs: Record<string, FieldSchema>
}
```

**现在**（commit pending）:
```
ExecutionState {
  stack: StackEntry[]
  publicStore: Map<string, Value>     // 业务数据
  internalStore: Map<string, Value>   // 寄存器
  allocator: RegisterAllocator        // L1 拥有
  l2: L2Registry
  l3: L3Service
}

Operation {
  name: string
  formalSpec: OperationFormalSpec {   // 形参元数据
    inputs: Record<string, FormalParam>
    outputs: Record<string, FormalParam>
  }
}

FormalParam {
  businessName: string
  register: string                    // 必填
  type: 'string' | 'number' | ...
  required: boolean
}
```

---

## 四、验证结果

### 4.1 测试
- **120/120 tests passing**（重写后）
- 之前：122/122（含旧测试，重写后重新统计）
- 新增：FormalParam (16) + OperationError (15) 测试

### 4.2 类型
- `npm run typecheck` 通过
- 严格 strict mode，无 `any` 滥用

### 4.3 CPU 类比准确性
- publicStore = RAM（持久）
- internalStore = 寄存器（瞬态）
- move = MOV / LOAD / STORE
- execute_op = ALU 操作
- $r_err = 标志寄存器（FLAGS）
- ✅ 类比准确

---

## 五、设计债务（已清理）

| 债务项 | 状态 |
|---|---|
| 业务/寄存器命名混淆 | ✅ 解决 |
| L2 op 形参元数据缺失 | ✅ 解决 |
| 错误结构不统一 | ✅ 解决 |
| 寄存器分配语义不清 | ✅ 解决 |
| literal 可直接喂 op | ✅ 解决（强制 move）|
| file 可直接喂 op | ✅ 解决（强制 move）|

---

## 六、影响后续实现

### 6.1 A5+（后续 tier）变更
- **A5 (skip_n)**: 不需要 Address，只依赖 stack。无变更。
- **A6 (conditional_skip)**: 强制 conditionAddr 为 internal。新约束测试。
- **A7 (execute_op)**: inputs/outputs 强制为 internal（编译期+运行时校验）。
- **A8 (execute_intent)**: 同 A7。
- **A9 (main loop)**: 5 case dispatch + 错误传播逻辑需要更新。

### 6.2 Phase B/C 影响
- **B1 (file_read)**: 必须声明 formalSpec（含 error 输出用 $r_err）。
- **B2 (file_write)**: 同上。
- **C1 (DAG compiler)**: 必须通过 state.allocator.allocate() 分配寄存器。
- **C2 (sub_intent)**: 重用父意图的 allocator。

### 6.3 文档同步
- 6 个文档章节需要更新（见 §3.2）

---

## 七、风险与缓解

| 风险 | 等级 | 缓解措施 |
|---|---|---|
| 文档脱节 | 中 | 已记录 §3.2 清单，逐个更新 |
| A5-A11 实现依赖此架构 | 低 | 设计清晰，单元测试充分 |
| L3 编译器语义需细化 | 中 | 在 Phase C 实施时验证 |
| OperationError 各 op 实际遵循 | 低 | 通过 static type 强制 |

---

## 八、后续行动

### 立即（已完成）
1. ✅ 代码重写
2. ✅ 测试重写 + 新增
3. ✅ TypeScript 类型检查通过
4. ✅ 写本设计反馈报告

### 短期
1. 更新 docs/mvp/06, 09, 10, 11（待办）
2. 继续 A5 (skip_n) 实现

### 中期
1. Phase B (真实 L2 ops) - 验证 OperationError 实践
2. Phase C (DAG compiler) - 验证 RegisterAllocator 使用

---

## 附录：变更统计

```
src/                    | ± lines | 说明
------------------------|---------|------
src/l1/types.ts         | + 80  | Address 重构 + guards
src/l1/execution-state.ts | + 80 | 双区 + RegisterAllocator
src/l1/address-resolver.ts | + 40 | public/internal 处理
src/l1/primitives/move.ts | = 30 | 新约束
src/l2/operation.ts      | + 90 | FormalParam + formalSpec
src/l2/errors.ts         | + 80 | 新增文件
src/mocks/mock-l2.ts     | + 30 | formalSpec
src/mocks/mock-l3.ts     | = 20 | 类型更新

tests/                  | ± lines | 说明
------------------------|---------|------
tests/phase-a/a01*.ts    | + 200 | 重写 + 新增
tests/phase-a/a02*.ts    | + 250 | 重写
tests/phase-a/a03*.ts    | + 230 | 重写
tests/phase-a/a04*.ts    | + 280 | 重写
tests/phase-a/a00b*.ts   | + 130 | 重写
```

总计：约 +1500 行新代码（含测试），约 -200 行旧代码。

---

**结论**：本次重写解决了双区架构和形参元数据的关键架构问题，建立了 L1/L2/L3 之间的清晰桥接。代码状态干净，120 个单元测试全部通过，TypeScript 类型严格。可以继续推进后续 tier（A5+）。

**下一步**：继续 A5 (skip_n primitive) 实现。