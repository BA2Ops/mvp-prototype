# Test #15: 链式 literal → $r0 → $r1 → public

> **Source**: `tests/phase-a/tier-a04-move.test.ts` → describe('多次执行场景') → test('链式：literal → $r0 → $r1 → public')

## 目的

三步串联，每步输出都成为下一步输入来源（后一步 from 引用的正是前一步 to 写下的地址）。等价于把一条 compiler 可能生成的典型多段搬运序列手动重放一遍。如果某步是覆盖而非追加、或 resolve/write 对同一 key 的连续访问时表现不一致都会在此显形。

## 主图

![main](./main.puml)

## 子图：三步链式调用时序

![chain-sequence](./subfigures/chain-sequence.puml)

## 数据准备

```ts
// 纯靠三次 executeMove 逐步构建数据流
// 无任何手工 set() 预置值
```

## 预期结果与验证

```ts
// 三处终点全部持有相同字符串
expect(state.internalStore.get('$r0'))
  .toBe('chain')
expect(state.internalStore.get('$r1'))
  .toBe('chain')
expect(state.publicStore.get('final_output'))
  .toBe('chain')
```

## 设计决策说明

刻意做到"除了被测代码自身之外没有任何外部干预"——所有中间值都靠 move 自身产生。如果某步的实现错误地依赖了某个未声明的全局 / 隐式预置，这条会暴露"依赖巧合"的脆弱平衡。三处终点一致还顺便验证了 cross-zone（internal→public）的链路完整。
