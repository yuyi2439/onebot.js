# 调用接口

我们连接好了 `NapcatQQ` 是时候该 ~~调教~~ 一下她了

大部分接口都可以直接在 `实例化对象` 上直接调用, 比如 发送信息 `send_msg`

此处的 `Structs` 在 [下一篇-结构体构造器](./struct-maker.md) 中有介绍

```typescript
import { Structs } from 'onebot.js'

await napcat.send_msg({
  user_id: 10001,
  message: [Structs.text('你好呀~')],
})
```

## 收藏表情（NapCat 扩展）

```typescript
// 获取收藏表情 URL 或完整详情；count 可省略，使用实现端默认值。
const urls = await napcat.fetch_custom_face({ count: 10 })
const faces = await napcat.fetch_custom_face_detail({ count: 10 })

await napcat.add_custom_face({ file: '/path/on/napcat/face.png', is_origin: true })

const face = faces[0]
if (face) {
  await napcat.set_custom_face_desc({
    emoji_id: face.emoId,
    res_id: face.resId,
    md5: face.md5,
    desc: '新的描述',
  })
  await napcat.delete_custom_face({ res_id: face.resId })
}
```

`add_custom_face.file` 是 **NapCat 所在机器**的本地文件路径，不接受 URL 或 base64。
SDK 只传递路径，不上传文件。添加时还可提供 `emoji_id`、`package_id`、`file_name`、
`file_size`、`md5`、`is_mark_face`，省略时由实现端补全。

删除支持 `res_id`、`id` 的单个字符串或数组，以及 `ids` 数组；这些值是详情中的 `resId`。
仅提供 `md5` 无法删除。添加、删除和修改描述的返回值保留为 `unknown`，原样返回实现端数据。
管理接口需要支持它们的 NapCat 版本，依据 [NapCat CustomFace 实现](https://github.com/NapNeko/NapCatQQ/blob/main/packages/napcat-onebot/action/extends/CustomFace.ts)。

## 接口大全

::: tip 注意
如有缺少或类型错误请提交 [pr](https://github.com/yuyi2439/onebot.js/compare)
:::

以 [NapCatQQ 文档](https://napneko.github.io/develop/api) 为准
