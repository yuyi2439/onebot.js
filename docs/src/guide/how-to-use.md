# 如何使用

onebot.js 使用 `正向连接` 来连接到 `NapcatQQ`

## 1.初始化SDK

`connect` 建立正向连接：**连接成功后才返回 `OneBotClient` 对象**；按
`reconnection` 的预算自动重试，全部失败会直接抛出异常，由调用者处理

我们支持两种连接方式, 根据自己的喜好选择

如果开启了 `DEBUG` 模式，那么会输出收到的所有数据

### 详细配置

```typescript
import { connect } from 'onebot.js'

const napcat = await connect(
  {
    protocol: 'wss',
    host: 'napcat.example',
    port: 443,
    accessToken: 'your token',
    // ↓ 自动重连(可选)
    reconnection: {
      enable: true,
      attempts: 10,
      delay: 5000,
    },
    // ↓ 是否开启 DEBUG 模式
  },
  false,
)
```

### 快速配置

```typescript
import { connect } from 'onebot.js'

const napcat = await connect(
  {
    baseUrl: 'ws://napcat.example',
    accessToken: 'your token',
    // ↓ 自动重连(可选)
    reconnection: {
      enable: true,
      attempts: 10,
      delay: 5000,
    },
    // ↓ 是否开启 DEBUG 模式
  },
  false,
)
```

## 2.绑定事件

请查看 [绑定事件](./bind-event.md)

## 3.连接管理

连接已由 `connect` 完成；对象上仍有手动管理方法：

```typescript
// 断开连接
napcat.disconnect()

// 重新连接
// 类似 connect 方法一样可以用 await
napcat.reconnect()
```
