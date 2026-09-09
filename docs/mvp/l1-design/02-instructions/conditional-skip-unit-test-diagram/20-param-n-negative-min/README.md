# Test #20: n=-1 抛 ConditionalSkipError

> **Source**: `` → describe('')

## 目的

最小越下界代表样本点。

## 主图

![main](./main.puml)

## 数据准备

```ts
entry.n=-1
$r_cond=true
```

## 预期结果与验证

```ts
expect(...).rejects.toThrow(ConditionalSkipError)
expect(...).rejects.toThrow(/n must be >= 0/)
```

## 设计决策说明

message 含 'n must be >= 0'。

