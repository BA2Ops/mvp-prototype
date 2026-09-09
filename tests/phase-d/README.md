# Phase D — 集成场景(全栈集成)

> 11 个测试 / 1 个文件 / 全部通过
> 策略:全栈真实(L1+L2+L3+真实文件系统),多经验编排

[← 返回主索引](../README.md)

---

## Phase 目标

验证 L1+L2+L3 全栈集成的核心场景:递归循环、多经验协作、错误恢复、
CRR scope/register 机制。这是从单元测试到端到端的桥梁层。

## 测试策略

- 全栈真实:真实 L1 main loop、真实 L2 ops、真实 L3 编译器、真实经验库
- 真实文件系统(tmpdir 隔离)
- 递归场景使用共享业务变量 $r_cur(绕过嵌套 params 仅 literal/input 的 MVP 限制)
- 性能基线:200 层递归 5 秒内完成

---

## 文件索引

| 文件 | 测试数 | 意图 |
|------|--------|------|
| [d-scenarios](./tier-d-scenarios.test.ts) | 11 | 见下方场景分解 |

### 场景分解

| 场景 | 测试数 | 覆盖内容 |
|------|--------|----------|
| **D-A 递归循环** | 4 | count_to(5):递归 5 层后终止,$r_cur=5;边界 target=1(一次即止);性能基线 target=200(5s 内完成);递归深度防护(超 maxRecursionDepth→RecursionDepthError,不走业务冒泡) |
| **D-B 多经验协作** | 3 | setup_workspace:safe_write→write_file→replace_in_file→read_file 四条核心经验串联编排,验证多经验协作的数据流传递 |
| **D-C 错误恢复** | 2 | 业务级失败检测+换策略重试:read_file 失败→$r_err 非空→切换到 fallback 路径→恢复成功 |
| **D-D CRR scope/register** | 2 | CRR new-path scope/register 机制端到端验证:scope-prefixed 物理寄存器隔离、$r_cur 共享业务变量跨递归帧 |

---

## 关键覆盖点

- 递归循环:共享业务变量 $r_cur 作为循环携带状态、递归深度防护
- 多经验协作:4 条核心经验串联编排的数据流传递
- 错误恢复:业务级失败检测($r_err)+ 换策略重试
- CRR scope/register:物理寄存器隔离 + 业务变量共享的端到端验证

## 已知未覆盖

- 链式经验中间错误不拦截(replace_in_file 步骤失败带 null 继续走)
- 嵌套 params 不支持 register 引用(全局寄存器方案绕过大半场景)
