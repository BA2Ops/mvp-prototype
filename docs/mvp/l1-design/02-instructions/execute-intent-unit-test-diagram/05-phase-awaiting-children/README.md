# Test #5: pending → awaiting_children（done 由主循环收尾）

> **Source**: `` → describe('')

## 目的

executeIntent 只推进到 awaiting_children；done 由主循环在栈顶回到帧时收尾标记。

## 主图

![main](./main.puml)

## 数据准备

```ts
entry 初始 phase='pending'
createMockL3([一个 skip_n])
```

## 预期结果与验证

```ts
executeIntent 后 entry.phase === 'awaiting_children'
'done' 路径不归本层负责
```

## 设计决策说明

phase 字段归属——executeIntent 推进但不收尾。

