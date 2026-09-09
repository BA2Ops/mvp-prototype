# Test #5: literal input 抛 ExecuteOpError

> **Source**: `` → describe('')

## 目的

非法 kind 第一种。

## 主图

![main](./main.puml)

## 数据准备

```ts
inputs:{x:{kind:'literal', value:5} as any}
outputs 合法
```

## 预期结果与验证

```ts
rejects.toThrow(ExecuteOpError)
rejects.toThrow(/input 'x' must be internal/)
```

## 设计决策说明

双断言——类型对 + 错误消息含 'input x must be internal'。

