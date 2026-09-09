# Test #12: SkipNError 是 Error 子类

> **Source**: `` → describe('')

## 目的

配套错误类的 name/message/instanceof Error 三项基本身份。

## 主图

![main](./main.puml)

## 数据准备

```ts
new SkipNError('test')
```

## 预期结果与验证

```ts
expect(err).toBeInstanceOf(Error)
expect(err.name).toBe('SkipNError')
expect(err.message).toBe('test')
```

## 设计决策说明

sanity check——三项缺一不可，少验任何一项都可能掩盖字段丢失型退化。

