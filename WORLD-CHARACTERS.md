# 世界人物与区域代表

`world-characters.js` 为世界地图补充 9 个新人物，并以元数据列出 12 个
区域代表槽位。既有 22 人仍保留；`saladin`、`richard`、`genghiskhan`
直接复用 `character-data.js` 中的对象和七维数值，不在本文件重复覆盖。

世界人物是跨时代取材的玩法阵营。地图区域是现代产品中的地理抽象，不能
理解为人物同时代共存、古代政权等同现代国家，或数值代表史学排名。

## 集成契约

- 新增 ID：`gwanggaeto`、`ieyasu`、`ashoka`、`jayavarman7`、`stefan`、
  `mansamusa`、`moctezuma2`、`pachacuti`、`kamehameha`。
- 复用 ID：`saladin`、`richard`、`genghiskhan`。
- `characterIds` 是 12 个世界代表的稳定顺序；`georegions` 将
  `cultureKey` 映射到中文地理标签和代表 ID，供地图和图鉴按区域筛选。
- 每个新增 faction 都有 `id/name/era/style/role/description/color/portrait`
  和固定七维 `stats`，另有 `region`、`cultureKey`、`eraNote`、
  `portraitNote`、`relationshipNote`。头像全部是本地路径。
- `relationships` 只新增一条 `richard` ↔ `saladin` 的 `rivalry`，不把
  跨时代人物虚构为同盟或旧主。

## 12 个代表槽位

| 区域 | 代表 | ID | 取材时代 | 头像说明 |
| --- | --- | --- | --- | --- |
| 朝鲜半岛 | 广开土王 | `gwanggaeto` | 高句丽 391–413 | 当代纪念像，非存世肖像 |
| 日本 | 德川家康 | `ieyasu` | 安土桃山至江户初 | 江户时期画像 |
| 印度 | 阿育王 | `ashoka` | 孔雀帝国约前268–前232 | 阿育王狮柱时代徽记 |
| 西亚北非 | 萨拉丁 | `saladin` | 阿尤布王朝 | 复用既有头像 |
| 欧洲 | 理查一世 | `richard` | 金雀花王朝 | 复用既有头像 |
| 东欧／内亚 | 成吉思汗 | `genghiskhan` | 蒙古帝国早期 | 复用既有头像 |
| 东欧 | 斯特凡大公 | `stefan` | 摩尔达维亚 1457–1504 | 1488 年壁画图像 |
| 东南亚 | 阇耶跋摩七世 | `jayavarman7` | 高棉帝国约1181–1215 | 后世纪念雕像 |
| 非洲 | 曼萨·穆萨 | `mansamusa` | 马里帝国约1280–1337 | 1375 年地图集图像 |
| 美洲 | 蒙特祖玛二世 | `moctezuma2` | 墨西加／阿兹特克 1502–1520 | 16 世纪手稿图像 |
| 美洲安第斯 | 帕查库蒂 | `pachacuti` | 印加帝国 15 世纪中叶 | 后世印加王像 |
| 大洋洲 | 卡美哈梅哈一世 | `kamehameha` | 夏威夷群岛约1758–1819 | 1817 年早期水彩像 |

朝鲜半岛采用广开土王，是因为本轮的筛选尺度偏向高句丽的军事扩张与
边疆整合；世宗代表文化制度全盛，是另一种合理选择，但不在本槽位中。
日本采用德川家康，是因为关原与大阪战后能同时呈现政权统一和长期稳定；
织田信长、丰臣秀吉更偏战国统一过程。两处的“代表”都只是明确的游戏
尺度，不是“最强盛”的客观定论。

斯特凡大公补足东欧当地的中世纪守边与要塞传统，成吉思汗仍保留为东欧／
内亚的跨区域扩张代表。美洲同时放入墨西加湖区与安第斯山地两个代表，
避免用一个人物覆盖完全不同的历史环境。

## 固定属性

新数值为 1–100 的娱乐评分，重开、换种子、战斗和归顺都不改变。它们不
是史学测量，也不能用来比较真实人物的能力。

| 人物 | 武力 | 智力 | 谋略 | 魅力 | 统帅 | 政务 | 守御 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 广开土王 | 91 | 80 | 93 | 84 | 96 | 76 | 86 |
| 德川家康 | 82 | 91 | 94 | 88 | 91 | 94 | 93 |
| 阿育王 | 76 | 90 | 87 | 91 | 84 | 97 | 82 |
| 阇耶跋摩七世 | 78 | 88 | 84 | 90 | 83 | 96 | 82 |
| 斯特凡大公 | 86 | 80 | 88 | 82 | 90 | 75 | 92 |
| 曼萨·穆萨 | 64 | 88 | 80 | 94 | 72 | 98 | 70 |
| 蒙特祖玛二世 | 68 | 84 | 78 | 86 | 74 | 88 | 72 |
| 帕查库蒂 | 80 | 86 | 92 | 88 | 90 | 94 | 86 |
| 卡美哈梅哈一世 | 88 | 82 | 89 | 91 | 94 | 79 | 83 |

## 来源与图像边界

历史选择依据链接列于本文末尾；图像来源、作者、许可、修改方式与本地文件校验见
[世界头像来源表](docs/WORLD-PORTRAIT-SOURCES.json) 和
[第三方素材说明](THIRD_PARTY_NOTICES.md)。
素材来自 Wikimedia Commons 的公共领域、CC0 或署名共享文件；运行时不访问远程源。

阿育王使用狮柱而非伪造人物肖像。广开土王、阇耶跋摩七世使用纪念性雕像；
曼萨·穆萨、蒙特祖玛二世、帕查库蒂的图像来自后世地图或手稿传统。每条
faction 的 `portraitNote` 都标出这一限制。新头像为 384×384 WebP，文件名
格式为 `assets/portraits/world-<id>.webp`。

## 关系

`richard-saladin-rivalry-world` 仅表示两人在第三次十字军东征中的交战
对手背景；实际行动和战果仍由游戏状态决定。九名新增人物都明确没有本局
与其他在册人物的既定历史关系。没有加入“南蛮、北狄、西戎、东夷”等古代
地域泛称势力，避免把历史术语误当现代民族标签，也保持当前 12 槽位足以
覆盖目标区域。

相关权威入口：

- [韩国史门户：广开土王](https://contents.history.go.kr/mobile/kc/view.do?code=kc_age_10&levelId=kc_n100500)
- [日本国立国会图书馆：德川家康与江户](https://dl.ndl.go.jp/view/prepareDownload?itemId=info%3Andljp%2Fpid%2F14579796)
- [UNESCO：桑奇佛教遗址](https://whc.unesco.org/en/list/524)
- [UNESCO：吴哥](https://whc.unesco.org/en/list/668)
- [摩尔多瓦文化部：Stephen the Great](https://mc.gov.md/sites/default/files/file-cloud/brosura_stephan_en.pdf)
- [大都会艺术博物馆：Visualizing a Sahelian Past](https://www.metmuseum.org/es/perspectives/visualizing-a-sahelian-past)
- [大都会艺术博物馆：Gold of the Indies](https://www.metmuseum.org/fr/essays/gold-of-the-indies)
- [大英博物馆：Pachacuti Inca Yupanqui](https://www.britishmuseum.org/collection/term/BIOG184445)
- [美国国会图书馆：Kamehameha I](https://www.loc.gov/item/today-in-history/november-07/?loclr=fbloc)
