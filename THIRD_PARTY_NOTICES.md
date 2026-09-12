# 第三方素材与来源

本文件只说明各素材的来源和许可，不将所有素材统一改授为项目源码许可证。运行时全部从本地加载。

## 字体与图标

- **Noto Serif SC**：SIL Open Font License 1.1。字体为子集版本，保留 [OFL 原文](assets/fonts/OFL.txt)；来源为 [Google Fonts](https://github.com/google/fonts/tree/main/ofl/notoserifsc)。
- **Tabler Icons**：MIT；保留 [原许可证](assets/icons/LICENSE.txt)，来源为 [Tabler Icons](https://github.com/tabler/tabler-icons)。

## 世界人物头像

以下图像均经过头肩或局部裁切、缩放及 WebP 格式转换。标注 CC BY-SA 4.0 的三个改编文件仍按该许可提供，应保留署名、来源、修改说明及相同方式共享条款；该条款针对这些图像，不据此改变整个程序的许可。

| 仓库文件 | 原作者 / 来源记录 | 许可 | 来源 |
| --- | --- | --- | --- |
| `assets/portraits/world-gwanggaeto.webp` | Nakjibibimbap | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | [原始页面](https://commons.wikimedia.org/wiki/File:20250524_Nakjibibimbap_Gwanggaeto_the_great_statue.jpg) |
| `assets/portraits/world-ieyasu.webp` | 传统归于狩野探幽；馆藏说明为德川家康神像画像 | [Public domain](https://creativecommons.org/publicdomain/mark/1.0/) | [原始页面](https://commons.wikimedia.org/wiki/File:Tokugawa_Ieyasu.jpg) |
| `assets/portraits/world-ashoka.webp` | Yann | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | [原始页面](https://commons.wikimedia.org/wiki/File:Lion_Capital_of_Ashoka.jpg) |
| `assets/portraits/world-jayavarman7.webp` | Marcin Konsek | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | [原始页面](https://commons.wikimedia.org/wiki/File:2016_Phnom_Penh,_Pa%C5%82ac_Kr%C3%B3lewski,_Pos%C4%85g_D%C5%BCajawarmana_VII_(01).jpg) |
| `assets/portraits/world-stefan.webp` | Ninhursag3（壁画摄影）；壁画作者未署名 | [CC0](https://creativecommons.org/publicdomain/zero/1.0/) | [原始页面](https://commons.wikimedia.org/wiki/File:Stephen_the_Great,_1488,_Vorone%C5%A3_Monastery,_portrait_size.jpg) |
| `assets/portraits/world-mansamusa.webp` | 归于 Abraham Cresques | [Public domain](https://creativecommons.org/publicdomain/mark/1.0/) | [原始页面](https://commons.wikimedia.org/wiki/File:Catalan_Atlas_BNF_Sheet_6_Mansa_Musa_(cropped).jpg) |
| `assets/portraits/world-moctezuma2.webp` | Juan de Tovar（约1546–约1626） | [Public domain](https://creativecommons.org/publicdomain/mark/1.0/) | [原始页面](https://commons.wikimedia.org/wiki/File:Moctezuma_II,_the_Last_Aztec_King_(Reigned_1502%E2%80%9320)_WDL6724.png) |
| `assets/portraits/world-pachacuti.webp` | 馆藏来源未署名；Brooklyn Museum 1995.29.10 | [Public domain](https://creativecommons.org/publicdomain/mark/1.0/) | [原始页面](https://commons.wikimedia.org/wiki/File:Brooklyn_Museum_-_Pachacuti,_Tenth_Inca,_1_of_14_Portraits_of_Inca_Kings.jpg) |
| `assets/portraits/world-kamehameha.webp` | Louis Choris | [Public domain](https://creativecommons.org/publicdomain/mark/1.0/) | [原始页面](https://commons.wikimedia.org/wiki/File:%27King_Kamehameha_I%27,_watercolor_by_Louis_Choris,_1817,_Bernice_P._Bishop_Museum.jpg) |

机器可读的文件校验与来源表见 [WORLD-PORTRAIT-SOURCES.json](docs/WORLD-PORTRAIT-SOURCES.json)。历史图像和后世纪念雕像不代表可靠的真实容貌复原。

## 其他人物图像与生成画面

既有历史人物图像的逐张 Commons 来源见 [ASSETS.md](ASSETS.md)，作者、当前文件哈希与复核状态见 [历史头像来源表](docs/LEGACY-PORTRAIT-SOURCES.json)。公版与忠实复制图像的法律认定可能因地区而异，应保留来源页的使用说明。十张初始头像、纸张、印章与装饰纹理使用 AI 辅助生成，属于艺术演绎；本项目不将其描述为存世史料或保证可独占的艺术作品。

## 地理数据

- **Natural Earth**：陆地、行政背景、河流与 Gray Earth relief 使用公开领域数据；源包、裁切与派生图均保留来源。详见 [Natural Earth 使用条款](https://www.naturalearthdata.com/about/terms-of-use/) 与 [地理说明](GEOGRAPHY.md)。
- **中国区域几何**：来源为 DataV 的公开省级数据，原始来源和标准地图参考见 [世界地图说明](WORLD-GEOGRAPHY.md)。阿里云的[使用文档](https://help.aliyun.com/zh/datav/datav-6-0/user-guide/regional-thermal-layer)说明了提取、修改与自行托管 GeoJSON 的用法。本次未检索到该数据独立、明确的开源再分发许可证，因此保留原来源与权利，不宣称其为 MIT、公有领域或已获得商业再授权。
- 生成的领地分区是游戏机制数据，不能作为真实行政界线；本项目游戏地图尚未办理地图审核。
