# AliasChat 技术文档

> 面向：写代码的 Agent。读完这份应该能直接上手改代码。基准：serkankorkut/mask2ai v0.6.0（MIT），AliasChat 是其英文市场 fork。

## 技术栈

- Chrome Manifest V3 扩展，纯原生 JS，无构建步骤，无第三方依赖。
- Firefox MV3 需要 `background.scripts` 和 `browser_specific_settings.gecko.id`；当前清单仅配置 `background.service_worker`，尚未实现 Firefox 支持。
- 另含一个 Claude Code CLI 插件（hooks/mask.js），与浏览器扩展共用 `core/pii.js`。
- 权限：只申请 `storage`（存用户配置），对商店审核友好。

## 架构总览

扩展跑在两个"世界"里（Chrome 的安全隔离机制）：

| | MAIN world (`extension/content.js`) | 隔离世界 (`extension/bridge.js`) |
|---|---|---|
| 能干什么 | 能碰网页的网络请求（必须在这里才能拦截），但能被网页脚本看到 | 网页脚本看不到，能调 `chrome.storage` |
| 职责 | 包裹 `fetch` / `XMLHttpRequest`，把要发的数据递给隔离世界 | 真正执行遮蔽/还原，保管"占位符↔真值"对照表 |

两个世界之间用 `postMessage` 传话，目标限定为 `location.origin`，token 每次页面加载随机生成。同源网页脚本仍能观察消息，包括 token、待遮蔽的完整明文请求体和文件字节，也能伪造 `mask-request`，用返回的占位符猜测低熵真值；限定 origin 不能认证发送者。bridge 每页使用容量 10、每 10 秒补充 10 个额度的令牌桶，超限返回错误并阻止发送，使批量 oracle 暴力猜测难以实际开展，但并非不可能；脚本也可耗尽额度阻断正常发送。

## 核心流程

**发出去（遮蔽）：**
1. `content.js` 包裹了 `window.fetch` 和 `XMLHttpRequest`。
2. 识别发往 chatgpt.com / claude.ai 的聊天请求（URL 含 `completion` / `conversation` / `chat_conversations`）。
3. 把请求体（JSON / 表单 / 字节流，支持 gzip）递给 `bridge.js`。
4. `bridge.js` 调 `core/pii.js` 的 `mask()`：按类型（EMAIL、PHONE、CARD…）用正则找敏感信息，换成占位符如 `__PII_EMAIL_a1b2c3d4e5f6__`，真值记在对照表里。
5. 改写后的请求发出去。发之前右下角弹 toast："AliasChat: 遮蔽了 N 处"。

**收回来（还原）：**
1. `MutationObserver` 盯着页面文本节点。
2. 看到占位符就找隔离世界要真值换回来。用户屏幕上看到的是原文。

## 占位符设计

- 格式：`__PII_<类型>_<12位十六进制>__`，例如 `__PII_EMAIL_a1b2c3d4e5f6__`。
- 12 位哈希 + 每会话随机盐：同一邮箱每次打开页面生成的占位符不一样，碰撞概率可忽略。
- 同一会话内同一值 → 同一占位符（保证 AI 回复里能对上）。

## 检测能力（`core/pii.js`）

| 类型 | 方式 |
|---|---|
| 邮箱、IBAN、IP | 正则 |
| 银行卡、银联卡 | 正则 + Luhn 校验 |
| 中国身份证 | 正则 + 校验位 |
| 中国手机号 | `1[3-9]\d{9}` |
| SSN、电话、地址、生日、证件号 | 正则（含 US/UK 格式） |
| 姓名 | 提示词/称谓/标签后的姓名 + 文中重复出现二次扫描；邮箱推导出的姓名 |

**不做的：** 无提示词的裸姓名（要上 NLP 模型，Phase 2 再议）；中文姓名/地址（同上）。

**已删除（英文市场不需要）：** 土耳其 TCKN、土耳其车牌、土耳其地址/生日/证件/姓名模式、土耳其手机号格式。

## 安全设计（Phase 1b 加固后）

1. **出错拦下不放行**：遮蔽任何一步出错 → 请求不发 + toast 报错。隐私工具默认不能"悄悄放行"。
2. **对照表不出隔离世界**：真值保存在 `chrome.storage.session`，由 service worker 管理；网页脚本读不到。
3. **页面通道限流**：配置由扩展存储读取；MAIN world 接受首个有效 token，但 token 不认证网页消息。`mask-request` 在进入处理队列前限流，超限不执行遮蔽。
4. **自定义正则防卡死**：用户在设置页加的正则，保存时做语法校验 + 2000 字符压力测试，超 100ms 拒绝保存。
5. **拦截面**：`fetch` + `XMLHttpRequest` 都包了。WebSocket / sendBeacon 聊天场景不用，暂不处理。

## 配置

- 设置页 `extension/options.html` → 存 `chrome.storage.sync`：开关各类检测、白名单、自定义规则。
- CLI 插件读 `MASK2AI_CONFIG` 环境变量 → 当前目录 `.mask2ai.json` → `~/.mask2ai/config.json`（内部标识名保留，保证兼容）。
- 新 CLI 会话数据写入 `~/.claude/aliaschat/`；旧 `~/.claude/privyAI/` 中的映射和占位符密钥继续可读。浏览器旧 `privyMap` key 会在仍存在时迁移到 `aliasMap`；Chrome 更新或重载扩展时会清空 `storage.session`。

## 测试

- `npm test`：`test.js` 跑核心遮蔽/还原 round-trip + 类型覆盖；另有 office/zip 测试。必须全过才能提交。
- `node demo/prove.js`：端到端"防泄漏"验证（拿 demo 数据走一遍，检查线上没出现真值）。改检测规则后必须同步更新 demo 数据，否则它会红。
- `test-security.js`（1b 新增）：安全专项测试。

## 代码规矩（原作者定的，继续遵守）

- 无注释（除非万不得已）、无行尾空格、文件末尾无空行。
- 提交信息格式：`Feat: Capitalised summary`，不加署名行。
- `manifest.json` / `package.json` / `.claude-plugin/plugin.json` 版本号保持一致。
- LICENSE 原样保留（Copyright 2026 Serkan Korkut），不许动。

## 已知短板（= Pro 卖点）

- ChatGPT 文件上传两步流程（元数据 POST + blob PUT）未完整处理。
- 站点一改 API 路径/格式就可能失效，要跟修。
- 流式回复中占位符被切断时可能短暂显示残缺（极低频）。
