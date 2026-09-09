# Test #17: public kind 抛 ConditionalSkipError

> **Source**: `` → describe('')

## 目的

非法 kind 第二种：验证按'是否 internal'二元分类而非逐枚举黑名单。

## 主图

![main](./main.puml)

## 数据准备

```ts
conditionAddr={kind:'public', name:'business_var'} as any
```

## 预期结果与验证

```ts
expect(executeConditionalSkip(cond, state)).rejects.toThrow(ConditionalSkipError)
```

## 设计决策说明

拦的是'只记住几个常见敌人'的不彻底防御写法。

