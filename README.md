# MVP Prototype

> L1 5-primitive 调度器的原型实现。Mock-first，渐进式扩展。

## 相关设计文档

- [实现计划](../docs/mvp/11-prototype-implementation-plan.md)
- [响应式执行模型](../docs/mvp/10-reactive-execution-model.md)
- [L1 实现设计](../docs/mvp/09-l1-implementation.md)
- [执行层设计](../docs/mvp/06-execution-layer.md)

## 快速开始

```bash
npm install
npm test
```

## 项目结构

```
mvp-prototype/
├── src/
│   ├── l1/                    # L1 Runtime（5 primitive 调度器）
│   ├── l2/                    # L2 Operations（原子操作）
│   ├── l3/                    # L3 Service（意图分解）
│   ├── l4/                    # L4 LLM 集成
│   └── mocks/                 # Mock 基础设施
├── tests/
│   ├── phase-a/               # Phase A: L1 Foundations
│   ├── phase-b/               # Phase B: L2 Operations
│   ├── phase-c/               # Phase C: L3 Service
│   ├── phase-d/               # Phase D: Integration
│   └── phase-e/               # Phase E: E2E
└── docs/
    └── dev-log/               # 实施日志
```

## 开发阶段

| Phase | 内容 | 状态 |
|---|---|---|
| A | L1 Foundations（mock-first）| ✅ 完成 |
| B | L2 Operations（真实）| ✅ 完成 |
| C | L3 Service | ✅ 完成 |
| D | Integration | ✅ 完成 |
| E | LLM + E2E | ✅ 完成（MockL4，真 LLM 接口就绪）|

> MVP 已收官（670 tests / 41 files 全绿）。当前进行 **CRR（寄存器文件重设）** 重构，
> 详见 [doc 19 核心需求](../docs/mvp/19-register-file-core.md) /
> [doc 19b 详细设计](../docs/mvp/19b-register-design.md) /
> [doc 19c 实施计划](../docs/mvp/19c-implementation-plan.md)。
> CRR 进度：P0–P2 完成，P3 进行中（T-3.1~T-3.3 已提交，T-3.4 工作区完成待提交），P4 待开始。

## 测试命令

```bash
npm test                  # 跑所有测试
npm run test:phase-a      # 只跑 Phase A
npm run test:a00          # 只跑 A0
npm run test:watch        # watch 模式
npm run typecheck         # TypeScript 类型检查
npm run build             # 编译
```