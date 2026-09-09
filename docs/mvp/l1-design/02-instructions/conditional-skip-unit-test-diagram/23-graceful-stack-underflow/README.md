# Test #23: 栈不足时不抛错（truthy 但栈已空）

> **Source**: `` → describe('')

## 目的

truthy 侧请求弹 6 个但栈只剩 self——graceful 处理而非越界抛错。

## 主图

![main](./main.puml)

## 数据准备

```ts
$r_cond = true
stack: [cond(n=5)]
```

## 预期结果与验证

```ts
expect(...).resolves.not.toThrow()
expect(stack.length).toBe(0)
```

## 设计决策说明

与 skip_n 同哲学——栈不足不构成致命故障。

