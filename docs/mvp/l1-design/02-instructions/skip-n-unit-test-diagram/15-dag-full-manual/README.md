# Test #15: 场景 3：完整 DAG 模拟（手动驱动）

> **Source**: `` → describe('')

## 目的

端到端 DAG 模拟：栈 [thenBlock, skip(n=0)]，skip 弹 self 后剩 thenBlock。

## 主图

![main](./main.puml)

## 子图：DAG 三步调度时序

![DAG 三步调度时序](./subfigures/dag-sequence.puml)

## 数据准备

```ts
stack: [thenBlock, skip(n=0)]
```

## 预期结果与验证

```ts
执行前 stack.length===2 且顶部为 skip
执行 skip_n(0) 后 stack.length===1 仅剩 thenBlock
```

## 设计决策说明

DAG 调度手驱动测试——执行前后两个完整状态快照对比。

