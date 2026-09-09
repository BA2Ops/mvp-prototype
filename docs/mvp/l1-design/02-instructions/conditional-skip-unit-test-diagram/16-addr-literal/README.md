# Test #16: literal kind 抛 ConditionalSkipError

> **Source**: `` → describe('')

## 目的

非法 kind 第一种代表样本。

## 主图

![main](./main.puml)

## 数据准备

```ts
conditionAddr={kind:'literal', value:true} as any
stack: [cond]
```

## 预期结果与验证

```ts
expect(executeConditionalSkip(cond, state)).rejects.toThrow(ConditionalSkipError)
expect(...).rejects.toThrow(/must be internal/)
```

## 设计决策说明

双断言：类型对 + message 含 'must be internal'。

