# Phase C — L3 编译器 + 经验库(真实编译 + 端到端)

> 91 个测试 / 7 个文件 / 全部通过
> 策略:真实 L3 编译器、真实 L2 ops、真实经验库,通过 l1MainLoop 端到端验证

[← 返回主索引](../README.md)

---

## Phase 目标

验证 L3 编译器将 Experience 定义编译为 L1 指令序列(StackEntry[])的正确性,
以及 9 条核心经验库的结构完整性。包含 CRR P1-P3 引入的 scope-prefixed 物理寄存器、
env map 显式填充、outputs_bindings 持久化、registerOutput 跨经验引用等机制。

## 测试策略

- 真实 L3 编译器(compileExperience),验证编译产物的 StackEntry 结构
- 真实 L2 ops(file_read/file_write/evaluate_expr 等)
- 真实经验库(CORE_EXPERIENCES 9 条 + 测试 fixture)
- 通过 l1MainLoop 端到端验证编译→执行→结果的完整链路
- CRR 新路径测试验证 scope-prefixed slot、env map、binding move 等

---

## 文件索引

### C2-C5 — 编译器与经验库

| 文件 | 测试数 | 意图 |
|------|--------|------|
| [c2-compiler](./tier-c2-compiler.test.ts) | 20 | L3 编译器:输入绑定(required+optional default→$r_input_*)、pre_processing(skip_threshold 过滤)、条件判断分支(then/else 编译)、target-op 步骤编译、ParamRef 4 种 kind 展开、ExperienceService 集成 |
| [c5-experience-library](./tier-c5-experience-library.test.ts) | 16 | 9 条核心经验库:id 唯一、target_op+default_path 完整、steps.operation 已注册、handleError 标志(read_file_with_default/check_file_exists/safe_write/replace_in_file=true)、条件判断与路径响应模板 |
| [c6-e2e](./tier-c6-e2e.test.ts) | 8 | 端到端(C6 三层数据模型):S1 嵌套 experience(init_config→safe_write)、S2 子帧 handleError 自处理(宽容管道/根层自处理)、S3 父帧截获子异常(严格管道)、S4 无处理器冒泡到顶 |

### CC1-CC5 — CRR 新路径机制

| 文件 | 测试数 | 意图 |
|------|--------|------|
| [cC1-crr-new-path](./tier-cC1-crr-new-path.test.ts) | 11 | CRR new path(T-1.5+T-1.3):scope-prefixed slot 编译产物($S<scope>.in/out)、$r_input_<key> 语义两路径通用、多次 compileExperience + 手动 enterScope/exitScope、MAX_ACTIVE_SCOPES 软限保护 |
| [cC3-crr-env-map](./tier-cC3-crr-env-map.test.ts) | 16 | evaluate_expr env map(T-1.6):collectVarNames AST 遍历、resolveVar 优先级($err→global/$r_input→input/$r_*→业务变量名)、buildEnvMap 产出、new path 编译产物 env inputs 填充、端到端 l1MainLoop + safe_write 全流程 |
| [cC4-outputs-bindings](./tier-cC4-outputs-bindings.test.ts) | 11 | post-bindings move(T-2.2+T-2.3):未声明/persist:false 不生成 move、persist:true 生成 move 到 publicStore、静态校验(key 不在 exp.outputs→throw、register 未在 step outputs→warn)、端到端 l1MainLoop + publicStore |
| [cC5-register-output](./tier-cC5-register-output.test.ts) | 9 | ParamRef.registerOutput(T-3.1+T-3.2):schema 结构、compiler binding move 生成(new path)、legacy path 兼容、端到端 l1MainLoop + binding、T-3.3 编译期类型不匹配+悬空检测、错误处理 |

---

## 关键覆盖点

- L3 编译器:输入绑定、pre_processing、条件分支、target-op 步骤、ParamRef 展开
- 9 条核心经验库结构完整性(id 唯一、operation 已注册、handleError 标志)
- C6 端到端:嵌套 experience、handleError 自处理/父帧截获/无处理器冒泡
- CRR scope-prefixed slot 编译产物一致性
- CRR env map 显式填充(resolveVar 优先级、buildEnvMap)
- CRR outputs_bindings post-bindings move 生成与 publicStore 持久化
- CRR registerOutput 跨经验引用与编译期类型校验
