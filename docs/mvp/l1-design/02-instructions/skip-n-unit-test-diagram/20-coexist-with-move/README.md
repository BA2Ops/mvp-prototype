# Test #20: move 完成后再 skip_n

> **Source**: `` → describe('')

## 目的

skip_n 在 move entry 已被弹出的栈基础上正常工作。

## 主图

![main](./main.puml)

## 数据准备

```ts
stack: [skip, move]
模拟 pop move → 栈顶变 skip
```

## 预期结果与验证

```ts
执行后 stack.length === 0
```

## 设计决策说明

与其他 primitive 共存的最小集成测试。

