# AliasChat — 项目状态（HANDOFF）

> automated coding agents 开始工作前先读此文件，完成后更新；工作中断后从这里继续。

## 项目一句话
AliasChat = mask2ai（MIT）的二次开发 fork：Chrome 浏览器插件，在用户消息发往 ChatGPT / Claude 网页版之前，把检测到的个人敏感信息替换成占位符，回答回来后在屏幕上还原真值。变现：planned monetization (TBD)。

## 关键决策（已定，不许擅改）
- 当前品牌名：AliasChat（2026-10-05 改名；上一个品牌名 PrivyAI，最初名称 VeilAI）
- Logo：第 1 个方案（盾牌+气泡+面纱）
- 基准项目：serkankorkut/mask2ai v0.6.0，MIT（Copyright 2026 Serkan Korkut，LICENSE 必须原样保留）
- 仓库：github.com/yhdhappy/AliasChat（public；当前 GitHub API 将仓库报告为 AliasChat，push 继续使用工作区配置的 origin）
- 变现：planned monetization (TBD)
- 维护安排：maintained alongside other work
- 文案语言：英文

## 当前进度
- [x] Phase 0 验货：仓库真实、MIT 确认、npm test 通过、机制读懂
- [x] 仓库建立 + 代码推送（2026-10-04 凌晨）
- [x] Logo：第 1 方案（盾牌+气泡+面纱），已切 16/32/48/128 换进 extension/icons/，原图存 brand/privyAI-logo-original.png（2026-10-04 早）
- [x] Phase 1：品牌重命名 mask2ai→PrivyAI + 去 Turkish（2026-10-04 上午，automated coding agents 执行与审查 FAIL→修完 7 项→PASS）
  - 改名：manifest/README/store listing/options.html/content.js toast/hooks/plugin.json/marketplace.json/demo 脚本；插件统一 kebab-case 身份 `privy-ai`；LICENSE 未动
  - 去 Turkish：删 TCKN 校验+模式、PLATE、土耳其地址/DOB/证件/姓名线索、FOLD 字符映射、土耳其手机号格式；保留 `\b0\d{4} ?\d{6}\b`（实为英国手机号，测试要求）
  - 刻意保留的旧配置入口和内部标识（兼容性）：MASK2AI_CONFIG、`~/.mask2ai/config.json`、`.mask2ai.json`、`data-mask2ai`、`mask2ai-config` postMessage、CLI 插件 ID `privy-ai`、JS 命名空间
  - `npm test` 通过（ok / office ok）
- [x] Phase 1b：安全修复（2026-10-04 上午，automated coding agents 执行与审查 PASS，3 处小问题已修）
  - 修了 8 项：同名二次遮蔽、中国手机号/身份证/银联卡识别、postMessage token 加固、出错拦下不放行、占位符 12 位+每会话盐、对照表搬进插件隔离区、自定义正则安检、XHR 拦截
  - automated coding agents 审查发现：同步 XHR 非聊天上传被误拦（已修）、身份证校验缺长度保护（已修）、商店文案过时（已修）
  - `npm test` 通过（ok / office ok / security ok）
  - 架构变化：content.js 只跑 MAIN world 做拦截，遮蔽/还原逻辑搬到 bridge.js（隔离世界），对照表不再经页面
- [ ] Phase 2：物料（截图、商店描述）
- [ ] Phase 3：planned monetization (TBD)
- [ ] Phase 4：Chrome 商店上架 + Edge（注意：store/listing.md 的 privacy policy URL 目前是 GitHub 仓库地址，上架前需换成真实隐私政策页）
- [ ] Phase 5：Product Hunt / Reddit 获客

## 技术要点（给 automated coding agents）
- Manifest V3，vanilla JS，无构建步骤，`npm test` 必须通过
- 拦截机制：content script 跑在 MAIN world，包裹 window.fetch，URL 匹配 `/completion|conversation|chat_conversations`，改写请求体；MutationObserver 扫文本节点还原占位符（不依赖对方 DOM 结构）
- 脆弱点：OpenAI/Anthropic 改 API 路径或请求格式 → 跟修。只做 chatgpt.com + claude.ai 两站
- 已知短板：ChatGPT 文件上传两步流程未处理；浏览器内 PDF/图片不检查；纯模式匹配
- 商店状态：原作者从未提交 Chrome 商店，我们有机会第一个上架

## 工作交接
- automated coding agents 将任务拆成独立可验证的小块；工作中断时把技术进度写入此文件。

## 分发与后续计划
- 分发：Chrome 商店、Edge；Firefox 计划支持，需先添加 `background.scripts` 和 `browser_specific_settings.gecko.id`。
- 变现：planned monetization (TBD)

## 待办修改清单（2026-10-04 记，等 Claude Chat 审核完统一改）
> 达叔指示：先记下来，等 Claude 审核完毕后，与审核发现的问题一起统一修改。
> 更新 2026-10-04 12:05：Claude 审核完成，A 级已修；欢迎页已按审核报告第 5 节建议实现（见下）。

### 代码层面（automated coding agents 执行）
1. **~~首次运行同意弹窗（高优先级，Chrome 8月新规强制）~~ ✅ 已完成（2026-10-04）**
   - 按 Claude 审核报告第 5 节修正：官方原文只要求"安装前显著披露"，没找到"必须首次运行弹窗、隐私政策不算数"的明文（那是第三方网站的说法）。
   - 实现方式：`extension/welcome.html` 安装后欢迎页（`chrome.runtime.onInstalled` reason=install 时打开），说明数据处理方式 + "Got it" 按钮，**不阻塞遮蔽功能**（用户没点之前也不能裸奔）。
   - 商店描述开头已加数据披露（安装前可见）。

2. **~~仓库 docs/PRODUCT.md 状态校准~~ ✅ 已完成（2026-10-04）**
   - Phase 1b 改成"已完成"。

3. **~~store/listing.md 按 8 月新规复查~~ ✅ 已完成（2026-10-04）**
   - 数据披露移到 Description 最前面；全文件扫描无 bypass/evade/hide from AI 等敏感词。

### 本地维护事项
4. **Mac 上多余的 privyAI 文件夹**
   - 路径：`<local machine>`（误 clone 的）
   - 要做：确认删除（之前移废纸篓审批超时，未确认）。

5. **GitHub Pages 开通（已完成）**
   - 已开启：main 分支的 docs 文件夹。
   - 目的：让 `https://yhdhappy.github.io/AliasChat/privacy.html` 生效（商店隐私政策 URL 用）。

### 产品与技术规划（2026-10-04）
6. **文案与检测范围**
   - 文案面向英文用户；保留中文身份证、手机号和银联卡检测能力。
   - 保留开源代码，方便审查检测逻辑与隐私边界。

7. **长期技术调研（未实现）**
   - 调研真名替换为假名对 AI 推理效果的影响（现阶段仍使用占位符）。
   - 团队策略与审计日志属于后续技术规划，尚未实现。
   - 变现：planned monetization (TBD)

## Claude 审核 A 级修复（2026-10-04 完成）
> 审核报告：`<local machine>`（达叔 Mac 本地）

- [x] **A1 无限循环（CRITICAL）**：`extension/content.js` 的 MutationObserver 在 unmask 找不到映射时写回原文触发死循环。修复：只在 `after !== before` 时写回；用 `unknownPlaceholders` Set 跳过已知无映射的占位符；每秒最多 10 次 unmask 请求限流。
- [x] **A2 刷新丢映射（CRITICAL UX）**：`extension/bridge.js` 的 `Map` 改存 `chrome.storage.session`（刷新保留、关浏览器清除、网页不可读）。新增 `extension/background.js` service worker（manifest.json 注册），`scripts/pack-extension.sh` 打包时包含它。
- [x] **A3 双重遮蔽**：`core/pii.js` 的 `addressLike` 拒绝含 `__PII_` 的值；`unmask` 改循环直到稳定（最多 10 轮）。
- [x] **A4 过度遮蔽**：`core/pii.js` 的 `repeatedNames` 只对 2+ 词全名做大小写变体；单字名只精确匹配；新增常见词 stoplist（will/may/mark/grace/bill 等）。
- [x] **A5.1 还原逻辑进隔离世界**：MutationObserver 从 `content.js`（MAIN）搬到 `bridge.js`（isolated），直接读 map 无需 RPC；彻底删除 `unmask-request` postMessage 接口（`content.js` 和 `bridge.js` 双向）；`content.js` 的 XHR 响应还原逻辑删除（页面 JS 只见占位符，DOM 显示由 observer 还原，更安全）。
- [x] **A5.2 PDF/图片默认拦截**：`core/pii.js` 新增 `allowOpaqueUploads` 配置（默认 false）；`extension/bridge.js` 默认抛错拦截，`options.html` 说明该选项。
- [x] **A5.3 文档去过度承诺**：`store/listing.md` 和 `docs/privacy.html` 的 "The model only ever sees placeholders" 改为 "replaces the personal data it detects"；新增 Limitations 章节；存储描述更新为 session storage。
- [x] **A7 清理旧作者文件**：`AGENTS.md` 重写为 PrivyAI 专用；删除仓库根 `HANDOFF.md`（只留 `docs/HANDOFF.md`）。
- [x] **C2 署名修正**：`LICENSE` 加 `Copyright (c) 2026 yhdhappy`（保留原作者）；`package.json`、`​.claude-plugin/plugin.json` 作者改为 yhdhappy；`README.md` 加 "Based on mask2ai (MIT) by Serkan Korkut"。
- [ ] **待做（Chrome 8月新规）**：首次运行同意弹窗（见上方待办第 1 项）。
- [ ] **待做**：`docs/PRODUCT.md` 状态校准为"已完成"（见上方待办第 2 项）。

## 上架前收尾（2026-10-04，0.7.0）

- 当时隐私政策链接使用 PrivyAI 的 Pages 路径；AliasChat 改名后链接已改为 `https://yhdhappy.github.io/AliasChat/privacy.html`。
- 版本统一为 0.7.0；当时补充的 `extension/manifest.json` 副本现已删除，根目录 `manifest.json` 是唯一清单。
- PDF/图片默认拦截通过 `opaque-blocked` 错误码显示专用提示；options 说明允许上传的方法和文件不会被遮蔽的风险。
- 删除页面 `map-clear` 接口；映射继续保存在 `chrome.storage.session`，页面消息不能清除映射。
- NAME_STOPLIST 仅保留指定的 11 个常见词；新增去重、姓氏重复遮蔽、上传拦截和实际 zip 内容回归检查。
- 验证：`npm test` 输出 ok / office ok / security ok；随后 `node test-security.js` 输出 security ok。未运行 `demo/verify-web.js`，由 Mac 上的真实 Chrome 补跑。
- 沙箱 `.git` 只读，提交因 index.lock 创建失败而未执行，未 push；六项独立补丁和外部提交脚本保存在 `/tmp/privyai-prepublish/`，等待外部以 Muse <muse@local> 逐项提交后统一 push。

## 四项复现问题修复（2026-10-05）

- 邮箱检测改为带起始边界的线性候选扫描及域名逐段校验；新增 4 万字符、长域名和多段无效域名的 200ms 回归限制。
- 占位符改为 HMAC-SHA-256 的十二位摘要：SW 生成随机 256 位密钥并存 session storage，只通过扩展内部消息返回摘要；MAIN world 不接收密钥或盐。bridge 先收集检测值，再生成最终请求；旧六位及十二位占位符仍能还原。
- Node 默认使用进程内随机密钥；hooks（包括 demo 驱动的 CLI）使用原子发布的 0600 本地密钥文件，保持跨进程和恢复会话的占位符稳定。DOM 还原仍仅在 bridge observer 中执行。
- 请求覆盖核查：历史交接明确将 retry_completion 留给真账号抓包，当前无相关固件；title 和 message_content 的真实请求结构仍待确认。规则合成探针及 Mac 编辑/重试/重新生成/标题抓包步骤见 docs/REQUEST-COVERAGE.md；未猜测或扩大运行时白名单。
- README 按实际代码修正默认 PDF/图片拦截、session 映射生命周期、检测范围承诺、保密 HMAC 密钥、单向遮蔽消息与 isolated DOM 还原；明确网站脚本可读取恢复后的 DOM 真值。
- 四项分别提交前均运行 npm test（node test.js && node test-security.js）通过。未运行 demo/verify-web.js（沙箱 Chromium 启动崩溃）；真实站点抓包仍待 Mac 端补充。版本保持 0.7.0（manifest/package 一致）。
- 原工作区 .git 只读，提交在 /tmp/privyai-four-fixes 临时克隆中完成；修复文件同步回原工作区。
- 推送未完成：git push 无法连接沙箱网络代理；已连接 GitHub 的 create_tree 写入被自动审批拒绝（需要审批，但 approval policy 为 never）。四个提交保留在临时克隆，另导出 /tmp/privyai-four-fixes.bundle；可在有写权限及网络的基线仓库 fetch bundle 后 fast-forward main 并 push。

## automated coding agents 审查问题修复（2026-10-05）

- 邮箱检测修复相邻邮箱漏检；bridge 无 PII 时复用首趟处理结果；占位符映射经 service worker 代理读写，session storage 保持默认可信上下文访问。
- 安装/更新时清除 HMAC 密钥缓存；密钥导入失败允许重试；无效长度的 session 密钥重新生成。
- CLI 密钥文件用 `writeFileSync` 的 `wx` 原子创建，读取并复用已存在密钥，清理残留 `.tmp`；目录创建统一收敛到 `ensureDir` 并设为 `0700`。
- 补充相邻邮箱、单趟处理、更新轮换、导入重试、密钥长度、临时文件清理、目录权限、HMAC 不可导出及 runtime 消息体密钥隔离测试。`npm test` 通过（ok / office ok / security ok）；manifest/package 版本仍为 0.7.0。
- 九个单独提交在 `/tmp/privyai-review-fixes`，bundle 在 `/tmp/privyai-review-fixes.bundle`。工作区 `.git` 只读；`git push origin main` 因沙箱代理无法连接失败，GitHub connector 的写入调用被自动审批拒绝（approval policy 为 never），因此尚未推送。

## AliasChat 品牌改名（2026-10-05）

- 浏览器扩展名称、商店文案、README、`docs/`、CLI 提示、欢迎页和设置页统一使用 AliasChat；版本仍为 0.7.0。
- extension session key 从 `privyMap` 迁移到 `aliasMap`。旧 key 存在时首次读取会合并并复制到新 key；更新处理不会主动清空 map，并轮换 HMAC key。Chrome 自身会在扩展更新或重载时清空 `storage.session`，所以该迁移只能读取仍留在 session storage 中的旧 map。
- 新 CLI 数据写入 `~/.claude/aliaschat/`；读取旧 `~/.claude/privyAI/` 的映射和 placeholder key。原有配置入口 `MASK2AI_CONFIG`、`.mask2ai.json`、`~/.mask2ai/config.json` 与 Claude 插件 ID `privy-ai` 继续支持。
- 仓库链接和隐私政策链接指向 AliasChat；工作区 `origin` 当前指向 AliasChat URL。本次推送受沙箱网络和 MCP 写入审批限制，临时克隆中的提交及 bundle 路径记录在交接更新末尾。
- 验证：`npm test` 通过（ok / office ok / security ok）；未运行 `demo/verify-web.js`，沙箱 Chromium 启动会崩溃。
- 提交在 `/tmp/aliaschat-rename` 可写临时克隆创建；bundle 保存为 `/tmp/aliaschat-rename.bundle`。push 因沙箱代理不可达失败，GitHub MCP 对 blob 写入返回“requires approval, but approval policy is never”。

## H1 邮箱正则性能修复（2026-10-05）

- `core/pii.js` 的 EMAIL 起始负向后顾覆盖完整 local-part 字符集，包含 `-` 和 `_`，避免长 token 反复从中间开始匹配。检测到邮箱后使用 sticky 匹配继续检查相邻邮箱，保留 `-`/`_` 分隔的既有行为。
- 域名模式的标签以点分隔，没有歧义拆分；新增 `@` 后长连字符、local-part 后长连字符及多段连字符域名性能回归，无需修改域名正则。
- `test-security.js` 增加 4 万字符连字符、下划线、base64url 混合输入，各次 mask 限制 200ms；补充正常邮箱、前导 `-`/`_` 及逗号/分号相邻邮箱检测。
- 验证：`node test.js`、`node test-security.js`、`npm test` 通过（ok / office ok / security ok），无 Swift 编译超时。单独测量：连字符 6.33ms、下划线 0.93ms、base64url 1.79ms；三种长连字符域名输入 0.86–3.34ms。未提交。

## H2 请求路径与字段覆盖修复（2026-10-05）

- `extension/rewrite.js` 匹配 completion/conversation/chat_conversations 完整路径段及任意子路径，覆盖 retry_completion、title 与 UUID；查询字符串和 fragment 不参与路径匹配，近似名称保持排除。
- rewrite 与 bridge 两份 TEXT_KEYS 同步新增 message_content、file_name；walk 仅对 attachments 数组元素的直接 name 字段调用遮蔽，其他 name 字段保持原样。
- `test.js` 新增路径、JSON/表单字段、附件结构与保留字段回归；`test-security.js` 在扩展 VM 中验证三类 URL 的请求改写及表单字段遮蔽。历史 completion_history 排除断言改为任意子路径覆盖断言。
- 验证：`node test.js`、`node test-security.js`、`npm test` 通过（ok / office ok / security ok），无 60 秒超时；`git diff --check` 通过。未提交。

## H3 文件上传遮蔽修复（2026-10-05）

- 未支持的文件类型默认以 `unknown-blocked` 拦截；`allowUnknownUploads`（默认 false）允许上传，并显示未检查警告。PDF/图片继续使用原有独立开关；策略集中在 files.maskFile，bridge 转发错误码和警告。
- 文件名在原始扩展名分类后遮蔽，FormData 使用返回的遮蔽名称；文件名中的下划线/连字符全名添加 NAME 检测上下文，保留扩展名。
- ChatGPT `/backend-api/files` 元数据请求加入独立匹配，覆盖 fetch、Request 和异步 XHR，bridge 对 `file_name` 使用同一文件名遮蔽逻辑。存储域名的原始字节 PUT 不进入 JSON 改写。
- Office 新增 docProps/core.xml 和 app.xml 文本遮蔽，creator/lastModifiedBy 添加姓名上下文；标签和属性保留。
- 文本文件使用 fatal 解码；保留 UTF-8 BOM，UTF-16LE/BE BOM 文件按原编码遮蔽并写回。解码失败或含 NUL 的文本保留原始字节并警告；文件名仍遮蔽。
- 回归覆盖 .eml/.zip 默认拦截及开关、PDF FormData 文件名、元数据三种传输、存储 PUT 字节、docx 属性、UTF-16 双端序、UTF-8 BOM、GBK 字节及无 BOM/截断 UTF-16 回退。
- 验证：`node test-security.js`、`node test.js`、`npm test` 通过（ok / office ok / security ok）；node test.js 使用 60 秒超时保护且未超时；`git diff --check` 通过。未提交，保留既有 H1/H2 改动；manifest/package 保持 0.7.0。

## H4 CLI hook fail-closed 与密钥原子写入（2026-10-05）

- `hooks/mask.js` 的 main 增加 try/catch：UserPromptSubmit 出错输出 block + suppressOriginalPrompt；stdin JSON 无法解析时同样拦截。SessionStart/PostToolUse 输出错误 systemMessage，PreToolUse/MessageDisplay/SessionEnd 出错不输出且不抛出。
- 新密钥写入同目录随机 0600 临时文件，再 rename 发布；保留旧 privyAI 密钥复制、0700 目录处理与残留 tmp 清理。独占 `placeholder-key.lock` 目录避免并发覆盖密钥或删除正在写入的 tmp；竞争时 fail closed 后重试。硬杀进程可能留下锁目录，需确认无 hook 正在初始化后删除该残留目录再重发。
- VM 回归覆盖密钥读取失败、损坏 stdin、各事件错误输出、rename 发布、并发初始化、写入中断及恢复；既有权限、残留 tmp 和旧密钥兼容测试继续通过。
- 验证：`node test.js`（60 秒 timeout，未超时）、`node test-security.js`、`npm test` 全部通过（ok / office ok / security ok）；`git diff --check` 通过。未提交，保留既有 H1/H2/H3 改动。

## M2 占位符映射并发与容量修复（2026-10-05）

- background 将 map get/set 串行执行；set 读取当前 aliasMap 后合并，传入值优先，避免过期快照或并发读写丢映射。get 的旧 privyMap 迁移合并逻辑保持原样。
- MAX_MAP_ENTRIES 为 20000；合并后超限返回包含条目数及重启清理说明的错误，不写入、不丢弃已有映射。容量满时仍可更新已有条目。
- bridge 的 setMap 检查错误响应并抛错，run 等待写入成功才返回遮蔽结果；错误经 mask-result 传给 content，阻止发送并显示明确容量提示。
- extension VM 回归覆盖两标签页过期快照、同时 set、冲突值覆盖、容量边界、不写入保护、bridge 拒绝发送及用户提示。
- 验证：`node test-security.js`、`node test.js`（60 秒 timeout，未超时）、`npm test` 通过（ok / office ok / security ok）；`git diff --check` 通过。未提交，保留既有改动；manifest/package 保持 0.7.0。

## M4 页面遮蔽通道限流（2026-10-05）

- bridge 在入队前使用容量 10、每秒补充 1 个额度的令牌桶；超限返回指定错误，不执行遮蔽或调用 worker，content 按既有错误路径阻止发送。
- content/bridge 的 postMessage 目标统一为 location.origin。TECHNICAL 明确同源脚本仍能观察 token、完整明文请求体和文件字节并伪造请求；限流降低批量 oracle 猜测的可行性，无法消除风险，也可能被耗尽额度阻断正常发送。
- extension VM 增加可推进时钟及目标 origin 捕获；覆盖 15 请求突发的 10 成功/5 拒绝、无 worker 调用、真实发送被拦、逐步补充及 10 秒后恢复容量。异步轮询改为 5 秒截止时间，避免批量 crypto 工作触发迭代次数限制。
- 验证：`node test-security.js`、`node test.js`（60 秒 timeout，未超时）、`npm test`（60 秒 timeout，未超时）通过（ok / office ok / security ok）；`git diff --check` 通过。未提交，保留既有改动；manifest/package 保持 0.7.0。

## M6 与公开文档校准（2026-10-05）

- PRODUCT 与 TECHNICAL 明确 Firefox 支持尚未实现，需先添加 `background.scripts` 和 `browser_specific_settings.gecko.id`。
- 商店数据披露改为扩展标签页共享的浏览器 session storage；隐私政策补充网页脚本可读取还原后的 DOM 真值。
- 清理交接文件中的内部业务细节，保留品牌、架构、技术修复与验证历史。
- 验证：`node test.js`（60 秒 timeout，未超时）、`node test-security.js`、`npm test` 通过（ok / office ok / security ok）。仅修改文档，未提交。

## Privacy note

此仓库公开，交接文件不得记录内部业务细节（收入目标、定价、本地绝对路径、工具额度）；条目应仅记录技术进展、架构决策与验证结果。

## Batch 2 — M3 DOM restoration (2026-10-05)

- Throttled text nodes are queued and retried after the remaining one-second window. Unknown placeholder lookups expire after 30 seconds, allowing later mutations to restore newly stored mappings.
- Extension VM regressions cover the timer boundary and lookup expiry. `timeout 60 node test.js`, `node test-security.js`, and `npm test` passed without a Swift timeout; `git diff --check` passed. Versions remain 0.7.0.

## Batch 2 — M1 secret detection (2026-10-05)

- Added SECRET detection for GitHub tokens, OpenAI keys (including project keys), and three-segment JWTs with strict character sets, boundaries, and minimum lengths.
- Regressions cover every supported prefix, full-value restoration, minimum-length failures, incomplete JWTs, and ordinary words. `timeout 60 node test.js` passed (ok / office ok); `node test-security.js` passed (security ok), with no timeout.
- Final `npm test` passed (ok / office ok / security ok).

## Batch 2 — M7 detection false positives (2026-10-05)

- SSN detection validates area, group, and serial components and excludes the example 123-45-6789. The positive fixture uses area 219; the existing 111-11-1111 document regression remains passing. PHONE rejects SSN-shaped candidates so invalid area-000 values are not masked through the international phone pattern.
- PHONE_CN excludes immediately plus-prefixed digits, allowing PHONE to mask the complete +14155552671 value. Plain 13800138000 remains PHONE_CN; regressions verify classifications, stored values, and restoration.
- `timeout 60 node test.js`, `node test-security.js`, and final `npm test` passed (ok / office ok / security ok), with no timeout. Neither item was skipped; versions remain 0.7.0. No git commands were run.

## N1/N5/N6/PHONE_CN regressions (2026-10-05)

- N1: Text uploads with invalid or unsupported encodings fail closed with `encoding-blocked`, forwarded through bridge with a dedicated user message. `allowUnknownUploads` permits the unchanged bytes with an uninspected warning. Regressions include GBK CSV bytes containing 张三 and 13800138000, NUL-containing text and truncated UTF-16.
- N5: Content interceptions carry `via: 'content-script'` and use an independent 50-token bucket refilling at 10/second; unmarked requests retain 10 tokens and 1/second. Regressions cover 20 simultaneous masked file uploads, strict enumeration, bucket independence and both refill boundaries. The marker is forgeable by page scripts; TECHNICAL documents this limitation.
- N6: Unknown placeholder records retain affected text nodes. A 30-second expiry timer requeues eligible connected nodes and retries restoration without a new DOM mutation. Regression verifies the expiry boundary and restoration of two nodes after the mapping arrives.
- PHONE_CN: Single-space 3/4/4 grouped Chinese mobile numbers are masked in full. Regressions preserve plain Chinese mobile classification, full plus-prefixed international phones and the standalone 138 value.
- Each item was reproduced by a failing regression before its fix; relevant tests used `timeout 60`. Final `timeout 60 npm test` passed (ok / office ok / security ok). No items skipped and no git commands run; manifest/package remain 0.7.0.

## CLI key lock recovery and PostToolUse failure intervention (2026-10-05)

- Existing placeholder keys bypass locking and temporary-file cleanup. First creation polls every 100ms for up to five seconds, writes a 0600 owner.json with timestamp and PID in the lock directory, and recovers locks older than 60 seconds or owned by a nonexistent PID. Locks without valid metadata use directory mtime for expiry; active temporary keys remain protected during initialization.
- Reviewed repository hook documentation and the Claude Code official hooks reference: https://code.claude.com/docs/en/hooks#posttooluse-decision-control . PostToolUse cannot undo a tool's effects; decision:block alone adds feedback. Errors now return continue:false, stopReason, a prominent systemMessage and additionalContext, and updatedToolOutput with strings emptied while preserving structure. Claude Code validates built-in output schemas and can reject replacements, so stopping processing is also required; behavior was verified through hook JSON, not a live Claude Code host.
- Swift compilation uses a 120000ms timeout. The timeout option and compiler-timeout fallback were checked with a simulated darwin process and mocked compiler; no actual macOS Swift compilation was run.
- Added test-hook-lock.js to npm test. Direct Node subprocess checks cover overlapping first initialization with delayed publication, matching HMAC tokens from the same complete key, existing-key lock bypass, old timestamp recovery, dead PID recovery, live-lock five-second timeout, and PostToolUse error intervention for Bash and MCP-named tools. Updated existing VM checks for owner metadata and initialization-only cleanup.
- Verification: timeout 60 node test-hook-lock.js and final timeout 60 npm test passed (ok / office ok / security ok plus hook checks). Modified code has no trailing whitespace; manifest/package remain 0.7.0. No items skipped and no git commands run.

## N3 Office numeric cells and documentation cleanup (2026-10-05)

- Worksheet sheet*.xml numeric values matching existing PII detection are masked and converted to inline string cells; nonmatching numeric cells and shared-string indexes remain unchanged. XML text scanning now includes w:delText and w:instrText.
- Regressions cover numeric Chinese phones and IDs, card numbers, ordinary years and amounts, shared strings, deleted text and field instructions.
- TECHNICAL records unsupported Office parts and long-tail detection patterns. Marketplace ownership and README repository commands now point to yhdhappy/AliasChat; the plugin and marketplace IDs remain privy-ai. PRODUCT removes Gumroad payment and launch entries.
- Verification: timeout 60 node test.js, timeout 60 node test-security.js and timeout 60 npm test passed. Modified files have no trailing whitespace; manifest/package remain 0.7.0. No items skipped and no git commands run.

## Batch 4 — final audit round (2026-10-05)

- H1: XML_CELL no longer matches self-closing `<c .../>` tags; formula cells (`<f>` children) are left byte-identical. Regressions cover styled empty cells, formula cells and numeric phone cells with XML balance checks.
- H2: vision() failures in redirectPdf/redirectImage now block the Read with a reason instead of silently passing the original file; visionBinary() null also blocks. Swift compile failures are cached via a 24h marker file to avoid recompiling on every hook call. main() catch for PreToolUse now outputs a block decision.
- H3: pastedImages marks files seen only after successful processing, so OCR failures and resends reprocess the image. The reads-dir check uses path.resolve + path.relative containment instead of string prefix, closing the `../../` traversal.
- M1: content-script to bridge masking now travels over a MessageChannel port (first-port-wins); window.postMessage mask-requests always use the strict bucket and the forgeable `via` field is gone. Test harness uses a fake in-memory channel (real worker_threads ports kept the test process alive).
- M2: maskFileName only rewrites filenames on explicit PII patterns (email/phone/ID/card); NAME-only detections are rolled back. Generic names in filenames are intentionally not masked; documented in TECHNICAL.
- M5: unknown-placeholder records cap at 10 attempts, release node references on give-up, and the timer stops when nothing is pending.
- Misc: PRODUCT roadmap no longer says PrivyAI; TECHNICAL documents spaced Chinese mobile format; legacy placeholder.key copy is atomic via temp file + rename; bridge-timeout toast tells the user to refresh the page after extension update; README Limits notes the hook unmask-before-network-tools prompt-injection risk. No Firefox support claims anywhere (docs say planned only).
- Not changed: plugin id privy-ai (deliberate compat), no CI, N4/M3-remainder/M6-long-tail remain documented limitations.
- Verification: `npm test` passed (ok / office ok / security ok + hook checks) in ~10s; `git diff --check` clean; manifest/package remain 0.7.0.
