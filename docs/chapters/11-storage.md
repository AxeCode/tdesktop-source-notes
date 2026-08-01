# 第 11 章：本地存储与密钥层次 —— tdata 不只是一个缓存目录

<div class="chapter-meta"><span>M11</span><span>难度：进阶</span><span>建议 45 分钟</span><span>关键词：tdata / localKey / passcode</span></div>

> Telegram Desktop 要在启动时恢复账号、授权、设置、草稿和缓存，同时支持本地 passcode。理解它最关键的概念是密钥包裹：passcode 派生 key 保护随机 localKey，localKey 再保护账号数据。

## 1. 两级存储 owner

### Storage::Domain

与 `Main::Domain` 一一对应，负责：

- 全局 info 与账号列表；
- localKey；
- passcode salt / passcodeKey；
- active account index；
- 新增账号和旧格式迁移。

### Storage::Account

与 `Main::Account` 一一对应，负责：

- map file 与各类 file key；
- MTP authorization/config；
- per-account settings；
- drafts、stickers、gifs、locations、export settings 等；
- Storage facade/cache database 的密钥衔接。

全局和分账号分开，允许一个 tdata 中多个账号共享 passcode/local key 根，同时各自维护文件映射。

## 2. 密钥包裹模型

<div class="flow">user local passcode + random salt
              │ KDF / CreateLocalKey
              ▼
        passcodeKey
              │ decrypt encrypted localKey
              ▼
        random localKey
        ├── encrypt Domain info / account table
        ├── encrypt Account map
        ├── encrypt MTP auth/config
        ├── encrypt settings/drafts/etc.
        └── derive storage/cache encryption key</div>

设置或修改本地 passcode 时，主要重新加密 localKey 的包裹，而不必逐个重加密所有数据文件。这是 envelope encryption 的典型工程优势。

## 3. 首次启动如何创建密钥

`Storage::Domain::startFromScratch()` 生成随机 pass material 与 salt，创建 localKey，然后用空 passcode 生成 passcodeKey 并加密 localKey。

“没有本地密码”不等于明文存储：仍然有 localKey 加密数据，只是保护 localKey 的 passcode 为空，不能抵御能读取同一用户文件的本地攻击者。

## 4. 有 passcode 时的启动

[`Storage::Domain::startModern`](https://github.com/telegramdesktop/tdesktop/blob/v7.0.6/Telegram/SourceFiles/storage/storage_domain.cpp) 大体：

1. 读取 salt 与 encrypted localKey；
2. 从输入 passcode + salt 派生 passcodeKey；
3. 尝试解密 localKey，失败即返回 passcode 错；
4. 用 localKey 解密 Domain info；
5. 恢复 AccountWithIndex、active index 等；
6. 为每个 Account 准备 config/auth 并启动。

解密失败不能留下半恢复的 account graph，这与第 3 章的启动不变量一致。

## 5. Map file 是文件键目录

Storage::Account 的 map 记录多类逻辑数据对应的 file key，而不是把所有内容塞进一个数据库：

- user settings；
- locations；
- drafts；
- stickers/recent gifs/hashtags；
- export/search/trusted peers 等。

写某类数据时先通过 map 找到或分配 key，再使用 FileWrite 写 encrypted payload。这样逻辑类别可以独立更新和清理。

## 6. 为什么文件名不像业务名

文件 key 经过转换形成不透明路径，减少直接暴露数据类别，也支持安全替换/备份策略。但这不是访问控制：真正的机密性来自 localKey 加密和 OS 用户权限。

调试 tdata 时不要仅按文件名猜内容，应从 map key type 和读写函数反查。

## 7. MTP authorization 的持久化

Account 把 auth keys、main DC、config 等序列化后由 localKey 加密写盘。启动时读回交给 `Main::Account::prepareToStart/startMtp`。

这正是 Telegram Desktop 无需每次输入验证码的原因，也是 tdata 具有高敏感性的原因：拿到可解密的本地授权材料可能等价于拿到会话。文档和调试日志不应复制真实 tdata 或 key 内容。

## 8. 本地 passcode 不等于云端 2FA

| 本地 passcode | Telegram 2FA/cloud password |
|---|---|
| 保护本机应用解锁和 localKey | 参与账号登录/敏感操作 |
| 由 Storage::Domain 验证 | 通过 Telegram API 与服务端状态验证 |
| 可离线检查 | 需要协议/API 流程 |
| 忘记可能导致本地数据重置 | 忘记进入账号恢复流程 |

UI 可以都叫“密码”，但安全边界完全不同。

## 9. 加密文件的完整性检查

Storage encryption 不只是 AES 变换。加密描述符带有长度/hash 等结构，解密后验证格式与摘要，避免错误 key 或损坏数据被当作有效 QDataStream 继续解析。

读盘常见结果要区分：

- 文件不存在：第一次运行或该类别未写；
- 解密失败：passcode/key 错或损坏；
- schema/stream version 不兼容；
- 字段缺失：旧版本数据，使用默认值；
- 未知 key type：版本前向兼容策略。

## 10. 顺序序列化的兼容纪律

部分设置使用 QDataStream 顺序写字段。新增字段必须追加在末尾；读取时用 `!stream.atEnd()` 守护并给默认值。若插入中间，旧文件的后续字节会被错读成新字段，造成静默错位。

更适合简单开关/值的场景可以用带类型 key 的 preferences facility，避免全局顺序耦合。

## 11. 写入的原子性与延迟

频繁状态（草稿、窗口设置、recent items）不能每次键盘事件都同步刷盘。代码通常：

- 内存先更新；
- timer/debounce 合并写请求；
- 使用安全写/临时文件替换；
- 退出前 flush 必要数据；
- 大数据类别独立文件，减少写放大。

调试“重启后丢设置”时，要检查 timer 是否执行、退出是否 flush、写入是否失败，而不是只看 setter。

## 12. 缓存与权威数据的边界

媒体 cache、shared media index、search data 可被重建；MTP auth、账号表、用户设置、草稿不应被当作普通 cache 清理。

设置页的“清理缓存”因此通过 Storage facade/Cache API 定向删除，不会递归清空 tdata。实现维护工具时必须按数据类别调用公开清理方法，不能凭路径批量删。

## 13. 安全调试规则

- 不打印 auth key、localKey、passcode 派生结果或完整 encrypted blob；
- 不把真实 tdata 提交到 issue/仓库；
- 复制测试数据前确认账号与 portable 目录；
- 做损坏恢复实验时使用副本；
- 区分“加密失败”“序列化失败”“文件 I/O 失败”；
- 清理操作只对明确 cache key/path，不碰整个工作目录。

## 14. 调试入口

| 现象 | 第一入口 | 关键状态 |
|---|---|---|
| passcode 永远错误 | `Storage::Domain::startModern/checkPasscode` | salt、派生 key 比较、decrypt result |
| 账号不恢复 | Domain info read | AccountWithIndex、active index、localKey |
| 授权丢失 | `Storage::Account::readMtpData` | file key、decrypt、serialized auth |
| 草稿不落盘 | draft write/read | map key、delayed timer、topic key |
| 缓存清不掉 | Storage::Cache/Facade | tag、database path、active tasks |
| 升级后设置错位 | settings deserialize | stream version、field append、atEnd guards |

## 15. 小结

tdata 是以 Domain/Account 为边界的加密本地状态系统。passcodeKey 包裹 localKey，localKey 保护账号表、授权和分类型文件；map 管理逻辑数据到 file key 的映射；延迟写和兼容读取保证长期演进。

下一章转向实时性最高的子系统：一次语音/视频通话怎样把 MTProto 信令、状态机、WebRTC/tgcalls 和 UI 控制连接起来。

