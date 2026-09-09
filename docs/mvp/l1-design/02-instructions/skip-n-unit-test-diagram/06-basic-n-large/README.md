# Test #6: n=10：弹空所有栈（仅 1 个元素时）

> **Source**: `` → describe('')

## 目的

请求远超实际数量也能正常运行。

## 主图

![main](./main.puml)

## 数据准备

```ts
stack: [skip(n=10)]
```

## 预期结果与验证

```ts
expect(stack.length).toBe(0)
```

## 设计决策说明

弹空栈是合法终态，不应报错。

