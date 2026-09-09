# Test #18: file kind 抛 ConditionalSkipError

> **Source**: `` → describe('')

## 目的

非法 kind 第三种：即便 file 已从 Address union 移除，运行期仍独立识别。

## 主图

![main](./main.puml)

## 数据准备

```ts
conditionAddr={kind:'file', path:'/tmp/x'} as any
```

## 预期结果与验证

```ts
expect(executeConditionalSkip(cond, state)).rejects.toThrow(ConditionalSkipError)
```

## 设计决策说明

用 as any 绕过 TS 静态检查——验证运行时独立判断逻辑。

