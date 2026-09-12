# 天下纵横：世界地理数据

本目录提供离线全球沙盘数据。`world-map.js` 使用经典脚本声明
`globalThis.WORLD_MAP`，并附带 `module.exports`，浏览器直接加载或 Node
`require` 都可读取；`assets/maps/world.json` 是同一对象的 JSON 镜像。

## 重新生成

在一个复制出来的应用目录中运行以下命令。生成器只读取应用内已落盘的
Natural Earth 压缩包、中国几何副本和 relief 图片；没有网络请求。

```sh
cd /path/to/outputs/jiangshan
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python source-tools/build_world_map.py
.venv/bin/python source-tools/validate_world_map.py
```

验证证据写入仓库内的 `work/world-map/validation.json`，该工作目录不会提交到 Git。
生成器使用临时目录 `work/world-map/build-cache/run-*` 解压源数据，并以临时文件
替换方式写入 `world-map.js` 与 `assets/maps/world.json`，静态页面不会读到半个对象。

## 坐标与覆盖

世界使用等经纬度投影，`width=1800`、`height=900`、`bounds=[-180,-90,180,90]`。
`backgroundBounds={x:-140,y:-131,width:2080,height:1162}` 是给平移和不同视口留下的
连续海纸边缘；`backgroundImageBounds` 对应完整的 1800×900 `world-relief.jpg`。
`backgroundPath` 是 Natural Earth 物理陆地的完整背景，包含南极和各大洲；
`playablePath`/`landPath` 是 93 个可玩地块的 union，`contextPath` 是其余真实陆地
背景。未配置城市锚点的南极、北极岛屿和远方小陆块只作为背景，不会被误当成可攻占
地块。`regions` 的地块是锚点驱动的虚构分区，不是现代省界，也不宣称历史疆域。

主线聚焦中国时可选用随应用维护的 `assets/maps/world-china-relief.jpg`：它由同一
Gray Earth 源按 `lon=65..145, lat=0..60` 裁出 2700×2025 的高分辨率局部地形，
只用于显示细节，不改变世界几何、邻接或中国 mask。

每个地块含连续整数 `id`、城市 `name`、经纬 `center`、SVG `path`、
`neighbors`、`terrain`、`fertility`、`group`、`ownerSlot`；`borders` 对每个陆地
邻接对保存实际共享线。`neighbors` 和 `borders` 不含只有点接触的地块，也不把海岛
跨海相连。跨海行动单独记录在 `seaLinks`，其 `distance` 是引擎使用的 1–12 个月
行程值。`expeditionSites` 是不改变主地图归属的四个远征副本目标，使用同样的
1–12 月、1–100 难度和奖励字段。

## 中国几何与定位附图

中国可玩区使用随包的 `assets/maps/world-china.geojson`：DataV `100000_full.json`
的 34 个命名省级几何 union 成为中国陆地 mask；文件中的第 35 个
`100000_JD` 展示要素单独保留为 `chinaJDPath`，不参与陆地、邻接或地盘面积。
该 mask 包含台湾省、海南省、香港特别行政区、澳门特别行政区和随源数据提供的
相关岛屿几何。`chinaBoundaryPath` 是该实际 union 的投影路径，`chinaInset` 提供
台湾岛、钓鱼岛、赤尾屿、香港、澳门、海南岛及东沙/西沙/中沙/南沙等定位标签；
重要岛屿没有被自动分给日本或伪造陆地邻边。

DataV 几何是公开数据补充来源，官方标准地图规范和自然资源部标准地图服务只作
公开参考。本地游戏图未声明通过审图，也不把自制地块解释为现代法律疆界；地图中
中国 52 个主线城市继续沿用中原沙盘锚点，并补充乌鲁木齐、喀什、拉萨、日喀则、
呼和浩特、沈阳、哈尔滨、台北、海口、南宁和昆明。

## 海外副本与固定角色

海外城市先按 Natural Earth Admin-0 国家几何组成文化区域 mask，再在 mask 内做
Voronoi 式虚构分区。这样德里和孟买只能落在南亚陆地，东京与朝鲜半岛分开，
俄罗斯/蒙古锚点位于欧亚草原，基希讷乌位于东欧，廷巴克图位于西非，檀香山位于
夏威夷；没有用全球 Voronoi 让某个头像吞掉另一块大陆。海外初始控制区是游戏
设定，不能当作这些人物真实历史疆域。

12 个 `requiredFactionIds` 都有至少一个 `ownerSlot` 和初始地块：

`gwanggaeto`（首尔）、`ieyasu`（东京）、`ashoka`（德里/孟买）、
`saladin`（伊斯坦布尔/开罗）、`richard`（伦敦/巴黎/罗马）、
`genghiskhan`（莫斯科/乌兰巴托）、`stefan`（基希讷乌）、
`jayavarman7`（河内/吴哥/雅加达/马尼拉）、`mansamusa`（廷巴克图/内罗毕/开普敦）、
`moctezuma2`（纽约/洛杉矶/墨西哥城）、`pachacuti`（利马/库斯科/南美诸城）、
`kamehameha`（檀香山/悉尼/奥克兰）。中国 `ownerSlot` 保留为可选主线势力，
不占用这些固定海外角色。

## 来源与许可

- Natural Earth 10m Physical Land：<https://naciscdn.org/naturalearth/10m/physical/ne_10m_land.zip>
- Natural Earth 10m Admin-0 Countries：<https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_0_countries.zip>
- Natural Earth Gray Earth relief：<https://naciscdn.org/naturalearth/10m/raster/GRAY_LR_SR.zip>
- Natural Earth 许可说明：<https://github.com/nvkelso/natural-earth-vector/blob/master/LICENSE.md>
- DataV 中国省级公开几何：<https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json>
- DataV 数据仓库参考：<https://github.com/wangyang0210/chinaMap/blob/main/100000_full.json>
- 2023 年版标准地图规范（公开参考）：<https://www.fmprc.gov.cn/web/wjb_673085/zzjg_673183/bjhysws_674671/bhflfg/dtdmxgfl/202303/P020230313585504979937.pdf>
- 自然资源部标准地图服务（公开参考）：<https://bzdt.tianditu.gov.cn/>

Natural Earth 数据按其公开许可作为公有领域数据使用。中国几何保留在应用内供
离线重建和审计；DataV 数据未声明为 MIT 或公有领域，权利边界见 [第三方素材说明](THIRD_PARTY_NOTICES.md)。来源、用途和“未声明审图”的口径同时写入 `WORLD_MAP.sources`
与 `WORLD_MAP.description`。

## 当前验证结果

最后一次本地构建得到 93 个地块、191 条真实陆地邻接/边线、17 条海路和 4 个远征
目标；合并邻接图（陆地边 + 海路）连通，所有 12 个固定海外角色均有初始地块。
验证器对 region id、中心点、几何有效性、陆地 coverage、邻接 reciprocity、
边线引用、中国 35 要素离线源、台湾/海南标签、海路距离和 CommonJS 读取均通过。
coverage ratio 为 `0.9999997654`（SVG 解析误差；生成时 `playablePath` 直接由全部
region geometry union 得到）。对应证据在 `work/world-map/validation.json`。

共享边界由统一的陆地 mask 裁切后生成，并沿同一条曲线同步更新两侧地块，避免各自简化导致裂缝或漏掉邻接。验收遍历全部地块对，检查未列入邻接的长接壤边；拉萨与日喀则的邻接及自然曲线另有回归检查，均已通过。
