# VeilAI — 项目状态（HANDOFF）

> 每次让 Codex / pi 干活前先读此文件，干完更新。额度中断后从这里接着来，不许偏离。

## 项目一句话
VeilAI = mask2ai（MIT）的二次开发 fork：Chrome 浏览器插件，在用户消息发往 ChatGPT / Claude 网页版之前，把个人敏感信息替换成占位符，AI 只看到占位符，回答回来后在屏幕上还原真值。目标：免费+付费高级版，卖到国外，达叔的副业目标 $10/天。

## 关键决策（已定，不许擅改）
- 品牌名：VeilAI（2026-10-04 达叔亲定）
- Logo：第 1 个方案（盾牌+气泡+面纱），达叔待发原图
- 基准项目：serkankorkut/mask2ai v0.6.0，MIT（Copyright 2026 Serkan Korkut，LICENSE 必须原样保留）
- 仓库：github.com/yhdhappy/veilAI（public），47 个提交历史已推送（已滤掉 .github/workflows，因 token 无 workflow 权限）
- 变现：免费核心 + Pro（团队策略包、审计日志、更多站点、文件脱敏），Gumroad 起手 $5 一次性
- 节奏：边做边接单（达叔每天分 2-3 小时 Fiverr 保底）
- 英文：产品文案/客服邮件由 Muse 写，达叔读写可以、口语不行

## 当前进度
- [x] Phase 0 验货：仓库真实、MIT 确认、npm test 通过、机制读懂
- [x] 仓库建立 + 代码推送（2026-10-04 凌晨）
- [x] Logo：第 1 方案（盾牌+气泡+面纱），已切 16/32/48/128 换进 extension/icons/，原图存 brand/veilAI-logo-original.png（2026-10-04 早）
- [x] Phase 1：品牌重命名 mask2ai→VeilAI + 去 Turkish（2026-10-04 上午，Codex gpt-6-luna 执行，pi deepseek-v4.1-flash 审查 FAIL→修完 7 项→PASS）
  - 改名：manifest/README/store listing/options.html/content.js toast/hooks/plugin.json/marketplace.json/demo 脚本；插件统一 kebab-case 身份 `veil-ai`；LICENSE 未动
  - 去 Turkish：删 TCKN 校验+模式、PLATE、土耳其地址/DOB/证件/姓名线索、FOLD 字符映射、土耳其手机号格式；保留 `\b0\d{4} ?\d{6}\b`（实为英国手机号，测试要求）
  - 刻意保留的内部标识（兼容性）：MASK2AI_CONFIG、`~/.mask2ai/config.json`、`.mask2ai.json`、`data-mask2ai`、`mask2ai-config` postMessage、`~/.claude/veilAI`（已改名）、JS 命名空间
  - `npm test` 通过（ok / office ok）
- [x] Phase 1b：安全修复（2026-10-04 上午，Codex gpt-6.1-sol 执行，pi deepseek-v4.1-flash 审查 PASS，3 处小问题已修）
  - 修了 8 项：同名二次遮蔽、中国手机号/身份证/银联卡识别、postMessage token 加固、出错拦下不放行、占位符 12 位+每会话盐、对照表搬进插件隔离区、自定义正则安检、XHR 拦截
  - pi 揪出：同步 XHR 非聊天上传被误拦（已修）、身份证校验缺长度保护（已修）、商店文案过时（已修）
  - `npm test` 通过（ok / office ok / security ok）
  - 架构变化：content.js 只跑 MAIN world 做拦截，遮蔽/还原逻辑搬到 bridge.js（隔离世界），对照表不再经页面
- [ ] Phase 2：物料（截图、商店描述）
- [ ] Phase 3：Gumroad 上架 + license 验证接入
- [ ] Phase 4：Chrome 商店上架（$5 达叔付）+ Edge（注意：store/listing.md 的 privacy policy URL 目前是 GitHub 仓库地址，上架前需换成真实隐私政策页）
- [ ] Phase 5：Product Hunt / Reddit 获客

## 技术要点（给 Codex 的）
- Manifest V3，vanilla JS，无构建步骤，`npm test` 必须通过
- 拦截机制：content script 跑在 MAIN world，包裹 window.fetch，URL 匹配 `/completion|conversation|chat_conversations`，改写请求体；MutationObserver 扫文本节点还原占位符（不依赖对方 DOM 结构）
- 脆弱点：OpenAI/Anthropic 改 API 路径或请求格式 → 跟修。只做 chatgpt.com + claude.ai 两站
- 已知短板（Pro 卖点）：ChatGPT 文件上传两步流程未处理；浏览器内 PDF/图片不检查；纯模式匹配
- 商店状态：原作者从未提交 Chrome 商店，我们有机会第一个上架

## 额度/上下文管理
- Codex Plus 和 OpenCode Go 均有 5 小时额度限制
- 任务切小块，每块独立可验证；额度用完立刻停，把进度写进此文件再下班
- 达叔说"额度到了"我就记一笔

## 销售渠道清单（达叔要求记好，工具做好后逐步指导上架）
- 分发：Chrome 商店（$5）、Edge（免费）、Firefox（免费）
- 收款：Gumroad → Lemon Squeezy → Paddle
- 获客：Product Hunt、Hacker News Show HN、Reddit
- 后期：AppSumo

## 待办修改清单（2026-10-04 记，等 Claude Chat 审核完统一改）
> 达叔指示：先记下来，等 Claude 审核完毕后，与审核发现的问题一起统一修改。

### 代码层面（Muse/Codex 执行）
1. **首次运行同意弹窗（高优先级，Chrome 8月新规强制）**
   - 背景：2026年7月1日宣布、8月1日执行的 Chrome 商店新规要求：所有数据处理必须在产品界面内显著公示并拿到明确同意，隐私政策/商店描述不算数。
   - 要做：插件首次安装时弹一个同意界面，说明"只在本地遮蔽、不上传、占位符对照表存内存、关标签页即销毁"，用户点"我同意"后才开始工作。
   - 注意：咱们的 `storage` 权限只存用户自己的可选配置，也要在弹窗里说清楚。

2. **仓库 docs/PRODUCT.md 状态校准**
   - 现状：写着 Phase 1b"进行中"，实际已完成。
   - 要做：改成"已完成"，与 Mac 本地副本一致。

3. **store/listing.md 按 8 月新规复查**
   - 对照 extensionbooster 的合规指南，检查 single purpose 描述、数据披露、权限说明是否符合新措辞。

### 达叔动手（Muse 只给步骤）
4. **Mac 上多余的 veilAI 文件夹**
   - 路径：`/Users/yhd/Documents/AI_Workspace/veilAI`（误 clone 的）
   - 要做：确认删除（之前移废纸篓审批超时，未确认）。

5. **GitHub Pages 开通**
   - 仓库 Settings → Pages，选 main 分支的 docs 文件夹。
   - 目的：让 `https://yhdhappy.github.io/veilAI/privacy.html` 生效（商店隐私政策 URL 用）。

### 战略备忘（2026-10-04 达叔定）
6. **目标市场 = 海外英文用户，不指望国内**
   - 依据：达叔判断"中国人对隐私没那么在意，欧美更注重"；开源在海外是信任硬通货。
   - 落点：所有文案、推广按英文母语用户写；中文脱敏（身份证/手机号/银联卡）从主卖点降为加分项（海外华人/对华业务场景）。
   - 竞品：AgentCloak（9月18日免费发布，闭源、无中文）是直接竞品但暂时碰不到中文用户；咱们打"开源+可查代码"差异化。

7. **Pro 版长期考虑（不急）**
   - AgentCloak 用"数字孪生"（真名换假名如 Julio Schmidt）而非占位符，AI 推理效果更好；可作为 Pro 版升级点调研。
   - KnowBe4（9月23日发布浏览器插件做企业影子AI管控）验证了企业方向；咱们 Pro 的团队策略/审计日志路线不变。

## Claude 审核 A 级修复（2026-10-04 完成）
> 审核报告：`/Users/yhd/Documents/AI_Workspace/project_0011_veilAI/docs/VeilAI 审查报告.md`（达叔 Mac 本地）

- [x] **A1 无限循环（CRITICAL）**：`extension/content.js` 的 MutationObserver 在 unmask 找不到映射时写回原文触发死循环。修复：只在 `after !== before` 时写回；用 `unknownPlaceholders` Set 跳过已知无映射的占位符；每秒最多 10 次 unmask 请求限流。
- [x] **A2 刷新丢映射（CRITICAL UX）**：`extension/bridge.js` 的 `Map` 改存 `chrome.storage.session`（刷新保留、关浏览器清除、网页不可读）。新增 `extension/background.js` service worker（manifest.json 注册），`scripts/pack-extension.sh` 打包时包含它。
- [x] **A3 双重遮蔽**：`core/pii.js` 的 `addressLike` 拒绝含 `__PII_` 的值；`unmask` 改循环直到稳定（最多 10 轮）。
- [x] **A4 过度遮蔽**：`core/pii.js` 的 `repeatedNames` 只对 2+ 词全名做大小写变体；单字名只精确匹配；新增常见词 stoplist（will/may/mark/grace/bill 等）。
- [x] **A5.1 还原逻辑进隔离世界**：MutationObserver 从 `content.js`（MAIN）搬到 `bridge.js`（isolated），直接读 map 无需 RPC；彻底删除 `unmask-request` postMessage 接口（`content.js` 和 `bridge.js` 双向）；`content.js` 的 XHR 响应还原逻辑删除（页面 JS 只见占位符，DOM 显示由 observer 还原，更安全）。
- [x] **A5.2 PDF/图片默认拦截**：`core/pii.js` 新增 `allowOpaqueUploads` 配置（默认 false）；`extension/bridge.js` 默认抛错拦截，`options.html` 说明该选项。
- [x] **A5.3 文档去过度承诺**：`store/listing.md` 和 `docs/privacy.html` 的 "The model only ever sees placeholders" 改为 "replaces the personal data it detects"；新增 Limitations 章节；存储描述更新为 session storage。
- [x] **A7 清理旧作者文件**：`AGENTS.md` 重写为 VeilAI 专用；删除仓库根 `HANDOFF.md`（只留 `docs/HANDOFF.md`）。
- [x] **C2 署名修正**：`LICENSE` 加 `Copyright (c) 2026 yhdhappy`（保留原作者）；`package.json`、`​.claude-plugin/plugin.json` 作者改为 yhdhappy；`README.md` 加 "Based on mask2ai (MIT) by Serkan Korkut"。
- [ ] **待做（Chrome 8月新规）**：首次运行同意弹窗（见上方待办第 1 项）。
- [ ] **待做**：`docs/PRODUCT.md` 状态校准为"已完成"（见上方待办第 2 项）。
