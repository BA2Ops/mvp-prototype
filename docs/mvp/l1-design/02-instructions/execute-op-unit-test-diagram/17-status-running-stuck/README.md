# Test #17: 硬错误：pending → running（保持，因为 throw 后未到 done）

> **Source**: `` → describe('')

## 目的

硬错误路径下 status 在 catch 之前已置为 running 且不再推进。

## 主图

![main](./main.puml)

## 数据准备

```ts
entry=throwing_op + try/catch 包裹 await
```

## 预期结果与验证

```ts
初始 status==='pending'
执行后 status==='running'
```

## 设计决策说明

'running' 表示'正在执行但未完成'——throw 后未推进到 done。

