# Test #3: 多个 inputs

> **Source**: `` → describe('')

## 目的

自定义可编程 op 验证多 input 同时读取与单 output 写入。

## 主图

![main](./main.puml)

## 数据准备

```ts
createProgrammableOp({name:'double_add', inputs:{a:$r0, b:$r1}, outputs:{sum:$r2}}, behavior:{kind:'return', outputs:{sum:99}})
```

## 预期结果与验证

```ts
$r2 === 99
entry.status === 'done'
```

## 设计决策说明

验证 inputs 是全量读取而非首读即返。

