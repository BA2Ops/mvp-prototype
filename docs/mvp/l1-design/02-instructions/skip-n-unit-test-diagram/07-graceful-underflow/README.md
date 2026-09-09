# Test #7: 栈不足时不抛错（graceful）

> **Source**: `` → describe('')

## 目的

n=5 但栈只剩 self——栈不足 graceful 处理而非越界抛错。

## 主图

![main](./main.puml)

## 数据准备

```ts
stack: [skip(n=5)]
```

## 预期结果与验证

```ts
expect(executeSkipN(skip, state)).resolves.not.toThrow()
expect(stack.length).toBe(0)
```

## 设计决策说明

与 move 的同类设计哲学一致：栈不足不构成致命故障。

