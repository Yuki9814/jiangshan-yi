# 视觉资产与来源

界面采用「军议山河」纸墨风格，地图旗标以人物头像呈现。

- 十个人物头像分别调用内置 Image Gen 生成，统一为古典历史策略游戏手绘风格。属于艺术演绎，不是有依据的历史容貌复原。
- 山地纹理使用真实地理底图为参考生成。它提供水墨纸感，山峰细节为装饰；可争夺地盘、海岸和河流的实数据见 GEOGRAPHY.md。
- 宣纸材质与朱红“弈”印章由内置 Image Gen 生成。
- 所有游戏图像、字体、图标随本地文件打包；正常游玩不依赖外网请求。

## 开放字体与图标

- Noto Serif SC，SIL Open Font License。来自 [Google Fonts](https://github.com/google/fonts/tree/main/ofl/notoserifsc)，许可证随包保存在 assets/fonts/OFL.txt。以覆盖本应用文字的子集加载，缺字回退本机宋体；动态种子仍为可编辑文本。
- Tabler Icons outline，MIT License。来自 [Tabler 官方仓库](https://github.com/tabler/tabler-icons)，许可证随包保存在 assets/icons/LICENSE.txt。

头像在名册、地图和选中将领条中使用同一个文件。圆形裁切为界面遮罩，外圈颜色代表势力。

## 本轮新增人物头像（2026-09-12）

新增十二张头像采用 Wikimedia Commons 的历史绘画、版画或雕像图像，在本地裁成 384×384 WebP；既有来源记录均标注为公版（Public domain）；逐张作者、来源、当前文件哈希和本次核对状态见 [历史头像来源表](docs/LEGACY-PORTRAIT-SOURCES.json)。它们是历史图像的视觉引用，不是人物真实容貌复原。最终文件都使用 `assets/portraits/<id>.webp`，界面仍由 CSS 的方形/圆形遮罩裁切。

| 人物 | 打包文件 | Commons 来源 | 本地处理 |
| --- | --- | --- | --- |
| 刘备 | `assets/portraits/liubei.webp` | [Portraits of Famous Men – Liu Bei](https://commons.wikimedia.org/wiki/File:Portraits_of_Famous_Men_-_Liu_Bei.jpg) | 从单人像取头部与肩胸，去除上方大面积空白。 |
| 张飞 | `assets/portraits/zhangfei.webp` | [明人画张飞像轴](https://commons.wikimedia.org/wiki/File:%E6%98%8E%E4%BA%BA%E7%94%BB%E5%BC%A0%E9%A3%9E%E5%83%8F%E8%BD%B4.png) | 从单人明代画像取头肩构图，保留面部与衣领。 |
| 赵云 | `assets/portraits/zhaoyun.webp` | [ZhaoYun.jpg](https://commons.wikimedia.org/wiki/File:ZhaoYun.jpg) | 取原图人物上半身，避免远景和大面积背景。 |
| 周瑜 | `assets/portraits/zhouyu.webp` | [周輿画像](https://commons.wikimedia.org/wiki/File:%E5%91%A8%E8%BC%BF.jpg) | 从单人画像取头肩，减少全身衣袍在头像中的比例。 |
| 司马懿 | `assets/portraits/simayi.webp` | [魏·太傅 司馬懿](https://commons.wikimedia.org/wiki/File:%E9%AD%8F%C2%B7%E5%A4%AA%E5%82%85_%E5%8F%B8%E9%A6%AC%E6%87%BF.jpg) | 保留原人物线描的面部、冠帽与肩部。 |
| 孙权 | `assets/portraits/sunquan.webp` | [Portraits of Famous Men – Sun Quan](https://commons.wikimedia.org/wiki/File:Portraits_of_Famous_Men_-_Sun_Quan.jpg) | 改用单人像并取头肩，避免与刘备混用群像身份。 |
| 岳飞 | `assets/portraits/yuefei.webp` | [Portrait of Yue Fei, LACMA M.80.215](https://commons.wikimedia.org/wiki/File:Portrait_of_Yue_Fei_LACMA_M.80.215.jpg) | 上移并收紧人物头肩，去除原图下方空白。 |
| 戚继光 | `assets/portraits/qijiguang.webp` | [Qi_jiguang.JPG](https://commons.wikimedia.org/wiki/File:Qi_jiguang.JPG) | 采用含头部的雕像近景，保留头盔、面部和肩甲。 |
| 项羽 | `assets/portraits/xiangyu.webp` | [Portraits of Famous Men – Xiang Wang](https://commons.wikimedia.org/wiki/File:Portraits_of_Famous_Men_-_Xiang_Wang.jpg) | 改用单人画像取头肩，替换原全身线描构图。 |
| 成吉思汗 | `assets/portraits/genghiskhan.webp` | [Yuan Emperor Album: Genghis portrait](https://commons.wikimedia.org/wiki/File:YuanEmperorAlbumGenghisPortrait.jpg) | 保留原画像头肩和浅色背景。 |
| 萨拉丁 | `assets/portraits/saladin.webp` | [Cristofano dell'Altissimo, Saladin](https://commons.wikimedia.org/wiki/File:Cristofano_dell%27altissimo,_saladino,_ante_1568_-_Serie_Gioviana.jpg) | 保留单人历史肖像的头肩与头巾。 |
| 理查一世 | `assets/portraits/richard.webp` | [British – Richard I – Google Art Project](https://commons.wikimedia.org/wiki/File:British_-_Richard_I_-_Google_Art_Project.jpg) | 取单人画像的头肩并保留王冠、盔甲和剑。 |

以上图像均经过裁切与 WebP 转换；运行时直接读取仓库内的最终头像文件。作者和许可补充见 [第三方素材说明](THIRD_PARTY_NOTICES.md)。

交付前已逐张检查文件 magic、可解码性和尺寸：十二张新增文件均为有效 VP8 WebP、384×384 像素，且每张均为单一头像画面。
