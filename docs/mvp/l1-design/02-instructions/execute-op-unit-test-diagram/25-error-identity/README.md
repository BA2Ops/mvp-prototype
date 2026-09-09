# Test #25: 是 Error 子类

> **Source**: `` → describe('')

## 目的

配套错误类的 name/message/instanceof Error 三项基本身份。

## 主图

![main](./main.puml)

## 数据准备

```ts
new ExecuteOpError('test')
```

## 预期结果与验证

```ts
err instanceof Error
err.name === 'ExecuteOpError'
err.message === 'test'
```

## 设计决策说明

sanity check——三项缺一不可。

