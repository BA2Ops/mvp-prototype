# Test #10: n=-1 抛 SkipNError

> **Source**: `` → describe('')

## 目的

最小越下界样本。

## 主图

![main](./main.puml)

## 数据准备

```ts
stack: [skip(n=-1)]
```

## 预期结果与验证

```ts
expect(executeSkipN(skip, state)).rejects.toThrow(SkipNError)
expect(ex.executeSkipN(skip, state)).rejects.toThrow(/n must be >= /0/)
```

## 设计决策说明

message含 text 含 'n must be >= 0'——上层可差异化处理。

