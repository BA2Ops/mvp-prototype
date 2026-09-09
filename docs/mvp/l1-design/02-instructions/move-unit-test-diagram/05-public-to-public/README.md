# Test #5: public → public（业务变量重命名）

> **Source**: `tests/phase-a/tier-a04-move.test.ts` → describe('public → public（业务变量重命名）')

## 目的

与 #4 同构但发生在业务侧。防止有人误以为只有内部区才享受'复制语义'，业务侧是另一套更弱的规则。

## 主图

![main](./main.puml)

## 数据准备

```ts
state.publicStore.set('old_name', 'data')\nstate.stack.push({\n  kind: 'move',\n  from: { kind: 'public', name: 'old_name' },\n  to:   { kind: 'public', name: 'new_name' }\n})
```

## 预期结果与验证

```ts
expect(state.publicStore.get('old_name'))\n  .toBe('data')  // 不变\nexpect(state.publicStore.get('new_name'))\n  .toBe('data')  // 新写入
```

## 设计决策说明

确认业务侧存储与 internal 享有完全一致的 copy 语义——不会出现'业务侧是 move 真的搬走'这种隐性差异。

