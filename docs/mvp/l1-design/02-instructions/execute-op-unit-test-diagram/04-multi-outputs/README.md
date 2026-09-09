# Test #4: 多个 outputs

> **Source**: `` → describe('')

## 目的

自定义可编程 op 验证单 input 同时写入多 output。

## 主图

![main](./main.puml)

## 数据准备

```ts
createProgrammableOp({name:'multi_out', inputs:{x:$r0}, outputs:{out1:$r1, out2:$r2}}, behavior:{kind:'return', outputs:{out1:100, out2:200}})
```

## 预期结果与验证

```ts
$r1 === 100
$r2 === 200
```

## 设计决策说明

验证 outputs 是全量写入而非首写即返。

