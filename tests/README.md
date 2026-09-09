# 测试索引看板

> 670 个测试 / 41 个文件 / 5 个阶段 / 全部通过
> 最后更新:2026-09-09(CRR P4 + C6 三层数据模型完成后)

---

## 运行命令

```bash
# 全量测试
npx vitest run

# 单个阶段
npx vitest run tests/phase-a/
npx vitest run tests/phase-b/
npx vitest run tests/phase-c/
npx vitest run tests/phase-d/
npx vitest run tests/phase-e/

# 单个文件
npx vitest run tests/phase-c/tier-c6-e2e.test.ts

# 覆盖率
npx vitest run --coverage

# typecheck + build
npm run build
```

---

## 测试金字塔

```
            ╱╲
           ╱  ╲            Phase E  (48 测试,  3 文件)   L4 + 端到端
          ╱──────╲
         ╱        ╲          Phase D  (11 测试,  1 文件)   集成场景
        ╱──────────╲
       ╱            ╲        Phase C  (91 测试,  7 文件)   L3 编译器 + 经验库
      ╱──────────────╲
     ╱                ╲      Phase B (162 测试,  8 文件)   L2 真实操作
    ╱──────────────────╲
   ╱                    ╲    Phase A (343 测试, 22 文件)   L1 基础设施 (mock-first)
  ╱──────────────────────╲
```

| 阶段 | 测试数 | 文件数 | 占比 | 策略 | 导航 |
|------|--------|--------|------|------|------|
| **Phase A** | 343 | 22 | 51% | mock L2/L3,纯单元测试 | [README](./phase-a/README.md) |
| **Phase B** | 162 | 8 | 24% | 真实 IO,tmpdir 隔离 | [README](./phase-b/README.md) |
| **Phase C** | 91 | 7 | 14% | 真实编译器 + 经验库 | [README](./phase-c/README.md) |
| **Phase D** | 11 | 1 | 2% | 全栈集成,多经验编排 | [README](./phase-d/README.md) |
| **Phase E** | 48 | 3 | 7% | Mock L4 + Pipeline 端到端 | [README](./phase-e/README.md) |
| **合计** | **670** | **41** | 100% | | |

---

## CRR 新路径测试

CRR (Canonical Register Refactoring) P0-P4 引入了 scope-prefixed 物理寄存器、
formalSpec.slotIndex、$err/$path 全局改名、outputs_bindings 持久化、registerOutput
跨经验引用等机制。相关测试文件以 `C` 后缀标注(如 `aC1`/`bC2`/`cC1`/`eC5`),
分布在各 Phase 中:

| 文件 | Phase | 覆盖的 CRR 机制 |
|------|-------|----------------|
| `aC1-frame-scope-allocator` | A | FrameScopeAllocator enter/exit、R-1 对称性、MAX_ACTIVE_SCOPES、pool round-robin |
| `bC2-formal-spec-slot-index` | B | FormalParam.slotIndex 迁移、全部 11 ops 一致性 |
| `bC4-outputs-bindings-schema` | B | outputs_bindings schema、persist 默认 false、CORE 经验覆盖 |
| `cC1-crr-new-path` | C | scope-prefixed slot 编译产物、$r_input 语义、多次 compile |
| `cC3-crr-env-map` | C | evaluate_expr env map、resolveVar 优先级、buildEnvMap |
| `cC4-outputs-bindings` | C | post-bindings move 生成、persist:true、publicStore 端到端 |
| `cC5-register-output` | C | ParamRef.registerOutput、compiler binding move、类型不匹配检测 |
| `eC5-pipeline-public-store` | E | pipeline.collect + PRIMARY_OUTPUT、9 条 CORE 经验 primary 提取 |

---

## 已知未覆盖项

来自 [Gate-E FDR](../docs/dev-log/2026-08-20-gate-e-fdr.md) 第 64-73 行:

1. **链式经验中间错误不拦截** — replace_in_file 步骤失败带 null 继续走,编译器未自动插入步骤间错误检查
2. **嵌套 params 不支持 register 引用** — 全局寄存器方案绕过大半场景,剩余"按值传参"待补
3. **多 judgment 链 else_path 组合语义** — 复杂组合未测
4. **recompile 无重试策略** — MVP 与 compile 相同
5. **feedback_history 仅存储** — 经验演化是后续话题
6. **evaluate_expr 无 lambda** — map/filter 内联函数不支持

---

## 关联文档

| 文档 | 位置 | 内容 |
|------|------|------|
| 实现计划 | [doc 11](../docs/mvp/11-prototype-implementation-plan.md) | Phase A-E 每个 tier 的目标、反思触发条件 |
| Gate-A FDR | [gate-a-fdr](../docs/dev-log/2026-08-20-gate-a-fdr.md) | Phase A 完成反思 |
| Gate-B FDR | [gate-b-fdr](../docs/dev-log/2026-08-20-gate-b-fdr.md) | Phase B 完成反思(含 evaluate_expr 重构) |
| Gate-C FDR | [gate-c-fdr](../docs/dev-log/2026-08-20-gate-c-fdr.md) | Phase C 完成反思(MVP 三层全链路贯通) |
| Gate-D FDR | [gate-d-fdr](../docs/dev-log/2026-08-20-gate-d-fdr.md) | Phase D 完成反思(递归/协作/恢复) |
| Gate-E FDR | [gate-e-fdr](../docs/dev-log/2026-08-20-gate-e-fdr.md) | Phase E 完成反思(MVP 收官) |
| CRR 实施计划 | [doc 19c](../docs/mvp/19c-implementation-plan.md) | P0-P4 任务分解,每个 Task 关联测试用例编号 |
| L1 单元测试图 | [l1-design](../docs/mvp/l1-design/02-instructions/) | move/skip_n/conditional_skip/execute_op/execute_intent 每个用例的 PlantUML 图 |
