# Test #10: 未注册的 op 抛 ExecuteOpError

> **Source**: `` → describe('')

## 目的

registry lookup 失败的错误路径与消息内容锚定。

## 主图

![main](./main.puml)

## 数据准备

```ts
entry=createOpEntry('nonexistent_op',{},{})
```

## 预期结果与验证

```ts
rejects.toThrow(ExecuteOpError)
rejects.toThrow(/not registered/)
```

## 设计决策说明

message 含 'not registered'——上层可差异化处理。

