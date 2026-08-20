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
| A | L1 Foundations（mock-first）| 🚧 进行中 |
| B | L2 Operations（真实）| ⏳ 待开始 |
| C | L3 Service | ⏳ 待开始 |
| D | Integration | ⏳ 待开始 |
| E | LLM + E2E | ⏳ 待开始 |

## 测试命令

```bash
npm test                  # 跑所有测试
npm run test:phase-a      # 只跑 Phase A
npm run test:a00          # 只跑 A0
npm run test:watch        # watch 模式
npm run typecheck         # TypeScript 类型检查
npm run build             # 编译
```