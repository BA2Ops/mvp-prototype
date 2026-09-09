# Test #13: DAG if-then-else 编译产物正确压栈

> **Source**: `` → describe('')

## 目的

真实 L3 输出常是混合多指令的 children 序列：5 步 [op_file_read, cs, op_move, sn, op_write] 逆序压栈。

## 主图

![main](./main.puml)

## 子图：DAG 编译产物逆序压栈时序

![DAG 编译产物逆序压栈时序](./subfigures/dag-stacking.puml)

## 数据准备

```ts
createMockL3(5 entries 混合 execute_op/conditional_skip/skip_n)
entry={type:'read_or_create_file'}
```

## 预期结果与验证

```ts
stack=[entry, op_write, sn, op_move, cs, op_file_read]
```

## 设计决策说明

DAG 编译产物的真实场景——5 步混合指令。

