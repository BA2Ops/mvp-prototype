# Test #11: 按 type 路由到不同 children

> **Source**: `` → describe('')

## 目的

L3 按 entry.intent.type 分派到预先 setChildren() 注册的 children 集合。

## 主图

![main](./main.puml)

## 数据准备

```ts
createProgrammableL3()
setChildren('read_file', [read_step])
setChildren('write_file', [write_step1, write_step2])
```

## 预期结果与验证

```ts
两次 executeIntent 后:
stack=[entry1, read_step]
stack=[entry2, write_step2, write_step1]
```

## 设计决策说明

按 type 路由——L3 注册表查询。

