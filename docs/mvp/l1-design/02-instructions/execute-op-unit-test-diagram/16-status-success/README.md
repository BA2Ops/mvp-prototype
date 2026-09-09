# Test #16: 成功：pending → running → done

> **Source**: `` → describe('')

## 目的

正常完成路径下 status 三阶段推进轨迹。

## 主图

![main](./main.puml)

## 数据准备

```ts
entry=mock_op + $r0=5
```

## 预期结果与验证

```ts
初始 status==='pending'
执行后 status==='done'
```

## 设计决策说明

status 字段是 main-loop 路由依据——需正确推进。

