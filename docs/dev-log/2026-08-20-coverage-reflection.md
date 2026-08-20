# 覆盖率反思报告（Coverage Reflection）

**日期**：2026-08-20
**作者**：与 pi coding agent 协同
**触发**：覆盖率分析发现 address-resolver.ts 2 个分支未覆盖

---

## 一、目的

本文档反思 **覆盖率作为度量衡的局限性**，记录：
- 当前覆盖率的真实含义
- 未覆盖代码的合理性
- 不追求100% 的理由
- 覆盖率作为反思工具而非 KPI

**核心立场**：覆盖率是**反思工具**，不是**目标**。

---

## 二、当前状态

### 总体覆盖率

| 维度 | % |
|---|---|
| Statements | 99.47% |
| Functions | 100% |
| **Branches** | **97.29%** |
| Lines | 99.47% |

### 文件级覆盖

| 文件 | Stmts | Branch | Funcs | Lines |
|---|---|---|---|---|
| l1/types.ts | 100% | 100% | 100% | 100% |
| l1/execution-state.ts | 100% | 100% | 100% | 100% |
| l1/address-resolver.ts | 97% | 90.9% | 100% | 97% |
| l1/primitives/move.ts | 100% | 100% | 100% | 100% |
| l1/primitives/skip-n.ts | 100% | 100% | 100% | 100% |
| l2/operation.ts | 100% | 100% | 100% | 100% |
| l2/errors.ts | 100% | 100% | 100% | 100% |
| l2/registry.ts | 100% | 100% | 100% | 100% |

---

## 三、未覆盖代码分析

### 唯一缺口：address-resolver.ts 的5 行（lines 70, 73-76）

```typescript
function extractErrorInfo(err: unknown): { message: string; code: string | undefined } {
  if (err instanceof Error) {
    // True branch（已覆盖）：
    const code = 'code' in err && typeof (err as { code?: unknown }).code === 'string'
      ? (err as { code: string }).code  // ← line 71（覆盖：ENOENT 等有 code 属性的 Error）
      : undefined                          // ← line 72（未覆盖：Error 但无 string code）
    return { message: err.message, code }
  }

  // False branch（未覆盖）：
  // 非 Error 抛出（理论不应该发生，但是防御性）
  return { message: String(err), code: 'NON_ERROR_THROW' }  // ← line 77
}
```

### 为什么这些行没被覆盖？

| 行 | 内容 | 触发条件 | 实际可能吗？ |
|---|---|---|---|
| 72 | `undefined`（Error 但无 string code） | Error 对象但没有 string 类型的 code 属性 | 极少见（仅自定义 Error）|
| 77 | `String(err)` 兜底 | throw 非 Error 对象 | **不可能**（Node.js fs 契约）|

### 这些代码是"无意义"的死代码吗？

**不是**，而是**为不可能场景写的防御性代码**：

1. **Node.js fs/promises 契约**：永远 throw Error 子类（ENOENT、EACCES 等）
2. **唯一能 throw 非 Error 的情况**：Promise 被外部篡改（不应该发生）
3. **实际代价**：
   - 防御代码：~5 行
   - 不防御的代价：若未来换 fs 实现（如 mock），可能拿到非 Error

### 为什么**不**为这些分支写测试？

如果硬要测试，需要：
```typescript
// 用 vi.mock 让 fs.readFile throw 非 Error 对象
vi.doMock('fs/promises', () => ({
  readFile: vi.fn(async () => { throw 'not an Error' })
}))
```

这种测试的问题是：
1. **测试实现，不测行为**——验证"代码处理字符串 throw"，而不是"代码做对的事"
2. **mock 行为违反 fs 契约**——mock 设置本身就不真实
3. **测试通过 ≠ 代码正确**——即使此测试通过，真实场景下 fs 仍 throw Error
4. **维护成本**——若有人改了 fs 实现，需同步更新 mock

**结论**：这种测试是**为了覆盖率而存在**，不是**为了验证代码正确性**。

---

## 四、设计反馈发现的真问题

覆盖率分析触发了**对真实设计问题的反思**，不是覆盖率本身。

### 问题1：AddressError 丢失了原始错误码（已解决）

**发现**：原 AddressError 只保留 message，丢弃了 err.code（如 'ENOENT'）

**影响**：DAG 条件分支无法基于错误类型决策：
```typescript
// 原本：只能基于 truthy 判断（无法区分）
if ($error_is_null) { ... }

// 现在：可以基于 code 区分
if ($error.code === 'ENOENT') { /* 创建默认文件 */ }
else if ($error.code === 'EACCES') { /* 报告权限错误 */ }
```

**修复**（P1，2026-08-20）：
- `AddressError` 加 `code: string | undefined` 字段
- `extractErrorInfo` 提取原始 err.code
- 编程错误（`LITERAL_WRITE`）、语义错误（`VARIABLE_NOT_FOUND`）、系统错误（保留原始 fs code）分类清晰

**代价**：
- 新增 6 行（含防御 fallback）
- 覆盖率从 100% → 99.47%（statements）
- 分支覆盖率 97.29%（不变）

**收益**：
- DAG 错误处理能力大幅提升
- 与 doc 06 §11.3 设计意图对齐

### 问题2：错误分类混杂（待解决，P2）

AddressError 当前处理 3 类错误：
| 类别 | 示例 | 性质 |
|---|---|---|
| 编程错误 | LITERAL_WRITE | 调用方 bug |
| 语义错误 | VARIABLE_NOT_FOUND | 数据问题 |
| 系统错误 | ENOENT, EACCES | 环境问题 |

**当前用 `code` 字段区分**，但仍是单一 Error 类。

**可能的更好方案**：拆为 3 个子类。
**当前选择**：保留 P1 方案，因为：
- 实施成本低
- code 字段已足够表达分类
- 拆分类会改变接口，影响更多代码

**结论**：暂不实施 P2，等 Phase B/C 有更多错误模式时再评估。

---

## 五、覆盖率作为反思工具

### 覆盖率能告诉你的

1. **100% 函数覆盖**：所有函数都被调用过 ✓
2. **100% 行覆盖**：所有语句都执行过 ✓
3. **97.29% 分支覆盖**：大多数条件分支走过 ✓
4. **未覆盖的具体行号**：让你看到"哦，这里有防御代码"

### 覆盖率**不能**告诉你的

1. **代码是否正确**：100% 覆盖 ≠ 无 bug
2. **设计是否合理**：覆盖率分析触发了**真问题**（问题1），但这需要**人**去反思
3. **业务是否覆盖**：测试可能覆盖了代码，但没覆盖业务逻辑
4. **未覆盖代码是否有必要**：需要人工判断

### 覆盖率作为 KPI 的危害

- 团队为了100% 写出"为了测试而扭曲的代码"
- 例如：删除防御代码（导致生产 bug）、拆分类为多个 trivial 函数（稀释逻辑）
- 测试通过 ≠ 质量好

---

## 六、阈值设置策略

### 当前阈值（vitest.config.ts）

```typescript
thresholds: {
  lines: 60,
  functions: 60,
  branches: 50,
  statements: 60
}
```

### 阈值哲学

- **低阈值**：60% / 50% —— 防止完全无测试，不追求 100%
- **当前实际**：97.29% branches 远高于阈值
- **不收紧阈值**：因为 100% 不一定是目标

### 什么时候收紧阈值？

- Phase B/C 完成后，关键模块（execute_op、execute_intent）必须 95%+
- 但**永远不强制100% 分支**（保留防御代码的合理性）

---

## 七、未来检查点

### Gate-A 检查点（Phase A 完成时）

- [ ] 整体覆盖率 ≥ 95%（除防御代码外）
- [ ] 关键 primitive（move, skip_n, conditional_skip, execute_op, execute_intent）≥ 95%
- [ ] 错误路径全部有测试（即使防御代码不强制）

### 每个 Gate 的覆盖率报告

- 在 FDR 报告中加入"覆盖率"章节
- 列出未覆盖的具体行 + 理由（防御代码 / 测试缺口）
- 评估是否需要为这些行添加测试

---

## 八、总结

### 覆盖率指标

| 维度 | 实际 | 阈值 | 含义 |
|---|---|---|---|
| Statements | 99.47% | 60% | 几乎所有语句都执行过 |
| Functions | 100% | 60% | 所有函数都被调用 |
| Branches | 97.29% | 50% | 几乎所有分支都走过 |
| Lines | 99.47% | 60% | 等同语句 |

### 关键洞察

1. **97.29% 分支覆盖是合理的**，不是"需要修补的缺口"
2. **未覆盖代码是防御性代码**，写在文档里比写在测试里更合理
3. **覆盖率触发了真问题**（AddressError 错误码丢失），但问题解决**不是**为了覆盖率
4. **覆盖率是反思工具**，不是目标

### 不做的事

- ❌ 不为了 100% 而扭曲代码
- ❌ 不为了 100% 而添加无意义的 mock 测试
- ❌ 不把覆盖率当 KPI 强加给团队

### 做的事

- ✅ 写覆盖率反思报告（本文）
- ✅ 用覆盖率触发设计问题反思
- ✅ 修复真问题（AddressError code）
- ✅ 防御代码保留并文档化

---

## 附录：相关文档

- doc 06 §11.3：错误恢复（AddressError 协议）
- doc 10 §三.8：硬错误传播
- doc 11 §Phase A：覆盖率反思作为 gate-A 检查点的一部分
- 设计反馈报告：2026-08-20-design-feedback-major-rewrite.md

---

**结论**：覆盖率 97.29% 是当前架构和测试策略下的合理状态。未覆盖的 5 行是防御性代码，处理"理论上不可能但需要兜底"的场景。覆盖率触发的 AddressError 错误码丢失是真问题，已通过 P1 修复。