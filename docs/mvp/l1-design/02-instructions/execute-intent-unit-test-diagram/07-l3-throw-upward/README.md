# Test #7: L3 抛错时向上传播，不被 catch

> **Source**: `` → describe('')

## 目的

L3.compile 抛出的异常不能被 executeIntent 静默吞掉，必须原样上抛。

## 主图

![main](./main.puml)

## 数据准备

```ts
手写 mockL3：compile 抛 new Error('L3 compile failed')
```

## 预期结果与验证

```ts
rejects.toThrow('L3 compile failed')
entry.phase === 'awaiting_children'（compile 前已标记）
```

## 设计决策说明

错误向上传播——executeIntent 不做错误处理。

