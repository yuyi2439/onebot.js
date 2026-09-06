# onebot.js

OneBot 11 正向 WebSocket 客户端 SDK（TypeScript、仅 ESM）。

以 OneBot 11 标准协议为主，同时附带 NapCat 扩展 API（与标准协议不冲突，故直接收录）。注意：扩展 API 仅在 NapCat 上保证可用，其他实现调用时可能报错，兼容边界后续会改进。

> 本项目 fork 自 [node-napcat-ts](https://github.com/HkTeamX/node-napcat-ts)（MIT），
> 感谢原作者 [@huankong233](https://github.com/huankong233) 及各位贡献者。

## 安装

```sh
pnpm add onebot.js
```

要求 Node.js >= 22。本包仅支持 ESM（`import`）；CJS 环境请使用 `await import('onebot.js')`。

## 快速开始

`connect()` 建立正向连接：**连接成功后才返回 `OneBotClient` 对象**；
按 `reconnection` 的预算自动重试，全部失败会直接抛出异常，由调用者处理。

```ts
import { connect, Structs } from 'onebot.js'

const bot = await connect({
  baseUrl: 'ws://127.0.0.1:3001',
  accessToken: 'your token', // 以 query 参数追加（OneBot 11 正向 WS 约定），可选
  // reconnection: { enable: true, attempts: 10, delay: 5000 }, // 自动重连，可选
})

// 收消息（事件名支持 message / notice / request / meta_event 及分层子事件）
bot.on('message', (context) => {
  console.log(context.sender.nickname, context.raw_message)
})

// 发消息
bot.on('message', async (context) => {
  if (context.raw_message === 'echo') {
    await bot.send_msg({ ...context, message: [Structs.text('pong')] })
  }
})
```

也可以不经过 `connect()`，直接实例化并自行管理生命周期：

```ts
import { OneBotClient } from 'onebot.js'

const bot = new OneBotClient({ baseUrl: 'ws://127.0.0.1:3001' })
await bot.connect()   // 等待连接建立
await bot.disconnect() // 主动断开
```

更多用法见 [docs](./docs/src/guide/what-is-onebot-js.md)：[如何使用](./docs/src/guide/how-to-use.md) · [绑定事件](./docs/src/guide/bind-event.md) · [调用接口](./docs/src/guide/call-api.md) · [结构体构造器](./docs/src/guide/struct-maker.md)。

## 文档

- [NapCatQQ 文档](https://napneko.github.io/) — 实现端行为参考
- [go-cqhttp 文档](https://docs.go-cqhttp.org/)
- [OneBot 11 文档](https://github.com/botuniverse/onebot-11/)

## License

[MIT](./LICENSE)
