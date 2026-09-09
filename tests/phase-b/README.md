# Phase B — L2 真实操作(真实 IO)

> 162 个测试 / 8 个文件 / 全部通过
> 策略:真实文件系统(tmpdir 隔离)、真实 shell、真实表达式求值

[← 返回主索引](../README.md)

---

## Phase 目标

验证 11 个 L2 operation 的真实实现。每个 op 有真实使用方(L3 经验库引用),
不再用 mock。文件操作使用 `os.tmpdir()` 隔离,shell 操作使用跨平台 `node -e`。

## 测试策略

- 文件操作:`fs.mkdtemp(join(tmpdir(), ...))` 创建临时目录,测试后清理
- shell 操作:使用 `node -e` 替代 `echo`(跨平台兼容)
- formalSpec 结构验证:每个 op 声明 inputs/outputs 的 businessName/register/slotIndex/type
- 集成测试:通过 l1MainLoop 端到端验证 op 与 L1 调度器的配合

---

## 文件索引

### B01-B04 — 文件与 shell 操作

| 文件 | 测试数 | 意图 |
|------|--------|------|
| [b01-file-read](./tier-b01-file-read.test.ts) | 13 | file_read:formalSpec(path/encoding/content/error)、读存在文件(utf-8/binary)、读不存在(ENOENT→$r_err)、throw 异常→L1 冒泡 |
| [b02-file-write](./tier-b02-file-write.test.ts) | 14 | file_write:formalSpec(path/content/mode/encoding/bytes_written)、写入新文件、覆盖、追加(mode='a')、bytes_written 返回值 |
| [b03-shell-exec](./tier-b03-shell-exec.test.ts) | 14 | shell_exec:formalSpec(command/args/cwd/timeout/stdout/stderr/exit_code)、简单命令(node -e)、非零退出码、ENOENT、timeout、安全性(args 含特殊字符不注入) |
| [b04-file-search](./tier-b04-file-search.test.ts) | 16 | glob_match + grep_search:单层通配(*.ts)、递归通配(**/*.ts)、正则搜索、无匹配返回空数组 |

### B05-B07 — 数据处理与表达式求值

| 文件 | 测试数 | 意图 |
|------|--------|------|
| [b05-data-processing](./tier-b05-data-processing.test.ts) | 28 | string_replace(字面量/正则/全局替换/replace_all)、sort_by(升序/降序)、take_first、increment_counter(+1、非数字错误) |
| [b07-evaluate-expr](./tier-b07-evaluate-expr.test.ts) | 51 | evaluate_expr:AST 求值(literal/var/op)、算术(+/-/*/÷/%)、比较(==/!=/>/</>=/<=)、逻辑短路(and/or/not)、位运算、字符串(concat/length/contains)、列表、对象、错误处理(error_code/extract_error_code)、空检查(is_null/is_truthy)、typeof、集成 l1MainLoop |

### BC2-BC4 — CRR 元数据迁移

| 文件 | 测试数 | 意图 |
|------|--------|------|
| [bC2-formal-spec-slot-index](./tier-bC2-formal-spec-slot-index.test.ts) | 13 | FormalParam.slotIndex 迁移(CRR T-1.2):全部 11 ops 都有 slotIndex、slotIndex 与 register 同步、parseSlotIndexFromRegister 双向一致、ERROR_SLOT_INDEX=99 唯一性、type 字段不丢失、getSpec() 完整性 |
| [bC4-outputs-bindings-schema](./tier-bC4-outputs-bindings-schema.test.ts) | 13 | outputs_bindings schema(CRR T-2.1):OutputBinding 字段完整性(register/type/persist/description)、persist 默认 false(opt-in)、type 六种+any、9 条 CORE 经验 outputs_bindings 声明覆盖、safe_write/read_file_with_default 显式声明示例 |

---

## 关键覆盖点

- 11 个 L2 operation 的 formalSpec 结构与 execute 行为
- 文件 IO 真实场景(存在/不存在/权限/编码)
- shell_exec 跨平台兼容与安全性(注入防护)
- evaluate_expr 完整 AST 求值(算术/比较/逻辑/字符串/列表/对象/错误处理)
- CRR formalSpec.slotIndex 迁移一致性(全部 11 ops)
- CRR outputs_bindings schema 完整性与 opt-in 语义
