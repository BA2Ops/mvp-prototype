# 设计反馈（重大重构）：B06 条件 op 族 → evaluate_expr 单 op

**日期**：2026-08-20  
**触发**：用户问题"L1 直接使用的比较运算符有哪些？"  
**类型**：架构级重构（关注点切分错误修正）

---

## 1. 触发问题

用户问：**"L1 直接使用的条件 op 有哪些？"**

诚实答案：**零个**。

L1 5 primitives（move / execute_op / execute_intent / skip_n / conditional_skip）**完全不使用任何条件 op**：
- `move`：寄存器复制，不调 op
- `execute_op`：通过 op 名间接调用
- `execute_intent`：调 L3 service 编译 DAG
- `skip_n`：跳过计数器
- `conditional_skip`：只读 truthy 值，**不调 op**

**B06 实现的 12 个独立 op = "为想象中的需求实现"**——L1 不需要。

---

## 2. 反思

### 2.1 错误的关注点切分

B06 把"表达式求值"切成 12 个独立 op（equals/gt/and/...），L3 编译器要把 `if x == 'ENOENT'` 编译成 4-6 个 execute_op DAG。

**问题**：
- "表达式求值" 是**单一关注点**（取一个或多个值 + 求值 + 返回结果）
- 12 个独立 op 是**错误的切分**——它们实际上是表达式的子节点
- 真正的设计：单一 op 接受完整表达式

### 2.2 类似先例

- **Lisp eval/apply**：单一求值函数
- **SQL 表达式树**：单一查询
- **jq transform**：单一 transform 表达式
- **电子表格公式**：单一公式解析

都是**"表达式即数据 + 单一求值器"**的成熟模式。

---

## 3. 重构方案（用户 2026-08-20 确认）

### 3.1 决策清单

| 决策 | 结论 |
|---|---|
| 启动重构 | ✅ 是 |
| 文档优先 | ✅ 先 doc 同步，再代码 |
| extract_error_code 整合 | ✅ 整合到 evaluate_expr（作为 `error_code` 操作符） |
| MVP lambda | ❌ 不实现 |
| 位运算 | ✅ 纳入（& \| ^ ~ << >> >>>） |
| sort_by/take_first | ✅ 保留（高层 API） |

### 3.2 新方案核心

**单一 op**：`evaluate_expr`，接受 JSON 树形表达式，递归求值。

```typescript
type Expr =
  | { type: 'literal'; value: Value }
  | { type: 'var'; name: string }                       // 读 internal 寄存器
  | { type: 'op'; name: OpName; args: Expr[] }          // 操作符调用
  | { type: 'if'; cond: Expr; then: Expr; else: Expr }  // 三元（短路）

// execute_op(evaluate_expr, { expr, env? }, { result, error })
```

**支持的 op**：算术(6) / 比较(6) / 逻辑(3) / 位运算(8) / 字符串(6) / 列表(8) / 对象(5) / 错误(3) / 空检查(3) / 类型(1)

**MVP 不实现**：lambda / in / between（可组合）

### 3.3 重构后 L2 op 清单（净变化：22 → 11）

**文件操作（4）**：file_read / file_write / glob_match / grep_search  
**进程操作（1）**：shell_exec  
**数据处理（5）**：string_replace / sort_by / take_first / increment_counter / decrement_counter  
**表达式求值（1）**：evaluate_expr ⭐

**总计 11 个**（从 22 → 11，减少 50%）

### 3.4 净变化

| | 旧 | 新 |
|---|---|---|
| L2 op 总数 | 22 | 11 |
| 条件相关 op | 12 | 0（整合到 evaluate_expr） |
| DAG 长度（条件判断） | N（5-6 个 op） | 1（evaluate_expr） |
| L3 编译器职责 | 组合原子 op | 构造表达式 JSON 树 |

---

## 4. 文档同步

**已完成**（先于代码）：
- [x] doc 06 §7.2.1：12 个独立条件 op → evaluate_expr 设计
- [x] doc 06 §7.3 示例：条件判断用 evaluate_expr
- [x] doc 09 §X.Y 示例：条件判断用 evaluate_expr
- [x] doc 10 §6.5 循环模式：check_max → evaluate_expr(gte(...))
- [x] doc 10 D30 示例：evaluate_expr(gte(...))
- [x] doc 11 B5：新增"表达式求值 op 重构"段；Phase C 依赖更新
- [x] doc 12 ConditionalJudgment.trigger：条件 op → Expr JSON 树

**待完成**（code 阶段后）：
- [ ] doc 06 §7.2 表：新增 evaluate_expr 行
- [ ] doc 06 §7.3 Schema：evaluate_expr Schema
- [ ] doc 11 Phase B 进度表：B05/B06 状态更新

---

## 5. 实施步骤（代码阶段）

1. **删除** 11 个 B06 op 文件 + 测试文件
2. **整合** extract_error_code 到 evaluate_expr（作为 `error_code` 操作符）
3. **实现** evaluate_expr：
   - JSON 树形求值器（~500 行）
   - 支持算术/比较/逻辑/位/字符串/列表/对象/错误/空检查/类型
   - 单元测试（~50 个）+ 集成测试
4. **dev-log**：本文件 + 实现完成后补 dev-log
5. **Phase C 调整**：compileConditionalJudgment 简化为"构造 Expr JSON 树"

---

## 6. 教训（未来避免）

### 教训 1：每个 op 必须有真实使用方
- B06 实现 12 个 op，但 L1 零使用
- 真实使用方 = L3 编译器
- **未来**：实现任何 op 前，问"谁会用？真实场景是什么？"

### 教训 2：避免为对称性而实现
- decrement_counter 是"对称设计"加的，无 MVP 场景
- not_equals/gt/lt/lte 是"对称 op 集"加的，可组合
- **未来**：对称性 ≠ 必要性；只实现有真实使用的

### 教训 3：识别"错误的关注点切分"
- 12 个独立 op 把"表达式求值"切碎
- 单一 op 替代更优雅
- **未来**：先识别**真实关注点**（如"求值"），再决定 op 边界

---

## 7. 决策与下一步

✅ **重构方案确认**（用户 2026-08-20 决策）

**下一步**：
1. 实现 evaluate_expr（~500-800 行 + ~50 测试）
2. 删除 11 个 B06 op 文件
3. 替换测试为 tier-b07-evaluate-expr.test.ts
4. 更新 doc 06 §7.2 表 + §7.3 Schema
5. Gate-B 补充评估

**预计工时**：1-1.5d（求值器 + 测试 + 文档）

---

## 附录 A：用户原话（设计反馈）

> 这些比较运算符，L1 直接使用的有哪些

答：零个。所有比较 op 的真实使用方是 L3 编译器。

> 基于当前 L1 的运行事实上不依赖任何比较运算，比较运算的实际使用方是 L3 的事实，希望进行一次整体重构。加重 L3 的职责，建立一个"数据表达式"的 L2 操作，使得 L3 能静态构建一个复杂的表达式，包含算数运算、比较运算、逻辑运算、优先级括号、甚至允许位运算、集合运算、lambda 等。返回一个结果值。更进一步可以是"数据转换"操作，可以做到对输入输入数据做任意的目标语法支持的处理，可以支持引用许可的数据处理库，唯一的限定是不存在 IO 操作。L3 利用"表达式"或"数据转换"操作，将后续用于处理逻辑分支判断的最终表达式求解并形成布尔或支持的空/非空等结果存入对应的寄存器，使得后续的条件跳转指令能获得预期的变量值。请先评估这个方案。

**这是真正的架构洞察**——把"表达式求值"作为 L2 单一 op，符合 Lisp/SQL/jq 等成熟模式。
---

## 8. 实施完成（2026-08-20 后续 commit）

### 代码实施

- ✅ `src/l2/builtins/evaluate-expr.ts`（~620 行，JSON 树形求值器）
- ✅ `src/l2/operation.ts`：`Operation.execute` 签名扩展为可选 `state` 参数
- ✅ `src/l1/primitives/execute-op.ts`：调 `op.execute(inputs, state)` 时传入 state
- ✅ `tests/phase-b/tier-b07-evaluate-expr.test.ts`（48 tests）

### 删除（已实施）

- ❌ `src/l2/builtins/equals.ts`
- ❌ `src/l2/builtins/gt.ts`
- ❌ `src/l2/builtins/gte.ts`
- ❌ `src/l2/builtins/and.ts`
- ❌ `src/l2/builtins/is-truthy.ts`
- ❌ `src/l2/builtins/extract-error-code.ts`
- ❌ `tests/phase-b/tier-b06-conditional-ops.test.ts`

### 文档同步

- ✅ `doc 06 §7.2`：核心 8 → 11 个（含 evaluate_expr）
- ✅ `doc 06 §7.3`：增 evaluate_expr Schema
- ✅ `doc 06 §7.2.1`：完整设计（设计反馈文档）
- ✅ `doc 06 §7.3 示例`：条件判断用 evaluate_expr
- ✅ `doc 09` L1 集成示例同步
- ✅ `doc 10 §6.5`：循环模式用 evaluate_expr(gte)
- ✅ `doc 10 D30`：counter 示例同步
- ✅ `doc 11`：B06 → B07 evaluate_expr；Phase C 依赖更新
- ✅ `doc 12`：trigger: Expr JSON 树（替代原 condition_op + compare_value）

### 验证

- ✅ 485/485 passing（27 文件）
- ✅ typecheck 通过
- ✅ evaluate-expr.ts 80.29% lines（剩余为各 op 参数校验防御；核心功能 100% 覆盖）

### 净效果（与本 dev-log 第二节预测对照）

| | 预测 | 实际 |
|---|---|---|
| L2 op 总数 | 11 | **11** ✓ |
| 条件判断 DAG 长度 | 1 | **1** ✓ |
| L3 编译器职责 | 构造 JSON 树 | 构造 JSON 树 ✓ |
| lambda MVP | 不实现 | 不实现 ✓ |
| 位运算 | 8 | | 8 | ✓ |
| sort_by/take_first | 保留 | 保留 ✓ |
