# 江山弈地理数据

本目录中的 [map-data.js](./map-data.js) 是可直接双击打开网页使用的静态地图数据，不会在运行时请求网络。它采用 `globalThis.MAP_DATA = {...}` 经典脚本格式，并在 Node 环境中附带 `module.exports` 兼容导出。`borders` 字段按 `{a,b,path}` 保存每一对相邻区域的实际 SVG 共同边，供动态战线绘制。

## 范围与表达

- 主图地理范围：`105–122°E, 28–40°N`，包含关中、中原、河北、山东、江淮、荆襄及长江中下游东岸。
- 主图尺寸：`1000 × 780`，`bounds` 保留上述经纬度范围；坐标使用紧凑区域适用的等距经纬投影。
- 大陆海岸线和岛屿来自 Natural Earth 10m physical land；河流来自 Natural Earth 10m rivers and lake centerlines。
- `inset` 使用 Natural Earth 10m Admin-0 countries 中 `ADM0_A3=CHN` 的中国定位轮廓，作为范围定位小图，不参与分区裁切。
- 52 个分区由城市经纬度种子生成初始分区，与主图陆地裁切后，再把内部共边统一重建为自然曲折轮廓；这些分区是游戏用的虚构地盘，名称借用古今通行地名以便阅读，不对应任何历史或现行行政区。
- `landPath` 是 52 个可参与区域的完整 playable union；`contextPath` 保留真实底图中未参与本局的陆地（当前主要是东北边缘和烟台外海片），供 UI 先以低对比度背景绘制，不能把它当作海水。
- 对 Voronoi 与陆地求交后出现的离散碎片，逐片寻找与保留区域的真实共边，并归给共享边最长的相邻区域；没有任何保留区域共边的碎片才进入 `contextPath`。当前审计记录为天津→沧州、南通→上海、上海→南通三片归属，烟台一片保留为背景。

## 自然边界更新（2026-09-12）

- 内陆边界使用不规则长弯、细小起伏和柔化的三岔交汇，替代原始直边分区。曲折是游戏地图的美术处理，不是现代省市的实际边界。
- 相邻地盘复用同一条边，填色边界、选中轮廓和动态战线保持重合；海岸线和地图裁切范围不变。
- 最终52个区域无自交、无重叠、无未覆盖地面；132条战线与实际共边完全一致，陆地和背景轮廓与旧版完全一致。再生成两次的地图文件字节一致。
- `boundaryStyle` 记录生成方法及拓扑检查结果。人物头像位置由浏览器根据当前势力的完整领土另行计算，不再使用城市标注作为固定位置。

## 生成流程

交付源码位于 `source-tools/`，依赖版本记录在 [requirements.txt](./requirements.txt)。生成脚本以 `source-tools/..` 为应用根，从应用内 `assets/` 的三个 ZIP 解压到本次运行专属的 `work-geography/run-*` 中，不依赖应用外的 `work/geography_source`，也不覆盖源压缩包。Voronoi 单元使用逐个垂直平分半平面裁切生成；每个单元再与真实陆地求交。GEOS 结果写出前统一到 `1e-5°` 精度网格，保证相邻单元的共同边在输出 SVG 中使用相同端点；随后由 `natural_boundaries.py` 在投影坐标中为每条内部共边生成一次带多尺度起伏的曲线，并柔化内陆三岔交汇的方向；将这些共享线与固定海岸轮廓一起多边形化，重建52个地盘。重建后核对原132条邻接、连通性、有效几何与陆地总轮廓，失败时降低扰动幅度重试；最终由相邻单元边界交集生成 `borders`。浏览器端只读取已经写入 `map-data.js` 的 SVG path 与 JSON。

从应用目录重新生成并验证：

```sh
cd outputs/jiangshan
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python source-tools/build_geography.py
.venv/bin/python source-tools/validate_geography.py
```

这会只写应用根的 `map-data.js`，中间解压文件留在该应用的 `work-geography/run-*` 中；交付包本身不需要携带该运行目录。

## 离线源数据

源压缩包已随交付落盘，位于 `assets/`，可复核生成过程：

- [geography-ne_10m_land.zip](./assets/geography-ne_10m_land.zip) — SHA-256 `e547d749445eaa0964aba76738090ec88f5e63c4585122170f98c67a7ea922dc`
- [geography-ne_10m_rivers_lake_centerlines.zip](./assets/geography-ne_10m_rivers_lake_centerlines.zip) — SHA-256 `ded71b01870855ccfe19b51f2ec14c9bb48fae23c0e9f3c11974d426433b5c38`
- [geography-ne_10m_admin_0_countries.zip](./assets/geography-ne_10m_admin_0_countries.zip) — SHA-256 `ce1ac7036499a0edd641fbc093cd209a98f96a49d2eca8480aaacad35138a7f6`

对应官方来源：

- Natural Earth 10m physical land：<https://naciscdn.org/naturalearth/10m/physical/ne_10m_land.zip>
- Natural Earth 10m rivers and lake centerlines：<https://naciscdn.org/naturalearth/10m/physical/ne_10m_rivers_lake_centerlines.zip>
- Natural Earth 10m Admin-0 countries：<https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_0_countries.zip>
- Natural Earth Vector 官方仓库：<https://github.com/nvkelso/natural-earth-vector>

Natural Earth 数据为 Public Domain；Admin-0 定位轮廓沿用 Natural Earth 的 de facto country layer 口径。该口径只用于小图定位，沙盘分区本身不表达政治或行政主张。

## 原版验证记录（2026-09-11）

- `regions.length === 52`，ID 严格连续为 `0..51`；原版 `map-data.js` SHA-256 为 `f22ccd73fc94cbd63baf8332f95b1295c8654623d1b8e75530dc1afff076aeb4`。
- 所有区域的 `x/y` 都落在自身分区内部；每个区域都有非空陆地几何。
- 邻接表对称，共 `132` 条无向共享边；以 SVG path 复算后最短共同边约 `0.424 px`，没有仅顶点相碰的邻接项；52 个区域从任一点均可遍历到，图连通。
- `borders.length === 132`；每条边的 `a/b` 都引用有效区域，路径非空且与对应区域的 `neighbors` 双向一致。
- `neighbors`、`terrain`、`fertility`、`landPath`、`contextPath`、`fragmentAudit`、`rivers`、`mountains`、`inset`、`sources` 等约定字段均存在；`terrain` 仅取 `plain`、`mountain`、`river`，`fertility` 全部落在 `0.8–1.3`。
- `landPath` 与 52 个区域 union 的 SVG 几何一致；`contextPath` 与 playable union 仅有小于 20 px² 的投影精度误差，保留约 `2045.574 px²` 的真实背景陆地。`fragmentAudit` 共记录 4 片碎片，所有超过显著面积且有真实共边的碎片均有归属。
- 独立几何检查脚本 `work/scripts/validate_geography.py` 复算静态 SVG path，验证所有共同边、连通图和锚点内含；输出 `min_shared_edge_px: 0.424264`。
- `node -e "const d=require('./outputs/jiangshan/map-data.js'); ..."` 读取通过；静态页面无需网络请求地图源。
- 将整个应用复制到 `work/portable-geography-test`，在复制应用内新建 venv、按 `requirements.txt` 安装并运行两个 `source-tools` 脚本后，生成的 `map-data.js` 与本交付文件字节一致；复制应用的独立几何验证同样通过。

## 跨战场目录与连续背景（2026-09-12）

[map-catalog.js](./map-catalog.js) 是四张离线战场的 classic JavaScript 目录，加载后提供 `globalThis.MAP_CATALOG`，Node 也可直接 `require`。`central` 沿用中原52区；其余三张是独立生成的虚构地盘：

| id | 名称 | 地理焦点 | 地盘 | 邻接边 |
| --- | --- | --- | ---: | ---: |
| `central` | 中原逐鹿 | 关中、河洛、江淮 | 52 | 132 |
| `north` | 朔北风云 | 河套、燕云、辽东 | 35 | 79 |
| `south` | 岭南潮起 | 巴蜀、岭表、中南半岛 | 38 | 84 |
| `mediterranean` | 海隅十字潮 | 亚得里亚海至两河 | 37 | 70 |

三张新增战场的锚点使用西宁、北京、成都、曼谷、罗马、安条克、巴格达等真实地名与近似坐标，仅用于形成可读的城市中心；地盘是跨时代娱乐沙盘的虚构分区，不是历史行政区，也不把现代省界伪称为真实边界。每图的 `neighbors` 与 `borders` 都由实际几何共边重算，邻接图连通；远征点在 `expeditionSites` 中独立描述，不加入主地盘邻接。

新增地图的外圈由全部城市锚点的凸包缓冲与 Natural Earth land 求交形成，外边缘因此跟随真实海岸或圆缓冲曲线，不再把名义范围四边直接涂成可玩地盘。`playablePath`/`landPath` 是本局地盘 union，`backgroundPath` 是更大的完整真实陆地背景，`contextPath` 是背景中未参加本局的陆地。每图的 `backgroundBounds` 与 `backgroundImageBounds` 都是 `3200 × 2496` 的连续背景帧（主图 `1000 × 780` 的约3.2倍），用于最小缩放和拖拽边界；[map-view.js](./map-view.js) 对有该字段的目录图按 SVG `xMinYMin meet` 的实际可见宽高限制视野，缩放与窗口比例变化后也保持在背景帧内，并在切换地图时通过 `setMap(map)` 重建底图和标记层。地形层使用 `terrainRelief` 的宽缓山系带、真实河流和 `waterLines`，不使用重复三角山图标，也不复用旧中原 `assets/terrain.webp`。

四张战场均有独立的连续 Gray Earth relief 裁切：`assets/maps/central-relief.jpg`、`north-relief.jpg`、`south-relief.jpg`、`mediterranean-relief.jpg`，尺寸均为 `1000 × 780`。原始 `GRAY_LR_SR.zip`（SHA-256 `ff67db37ccdfb615ace76fc906704df39efc02584e90f3a5d361e7df0dee50ea`）保存在共享工作缓存 `work/campaign-geography/GRAY_LR_SR.zip`，运行包只携带上述小幅裁切图；Natural Earth land/river ZIP 仍随应用 `assets/` 落盘。来源是 [Natural Earth 10m Gray Earth](https://naciscdn.org/naturalearth/10m/raster/GRAY_LR_SR.zip)，Public Domain。构建临时解压目录位于 `work/campaign-geography/build-cache/run-*`，成功运行后当前 run 会删除；`last-build.json` 与既有审计缓存可保留用于复核。

重新生成并验证跨战场目录（需要本机 Python 环境中的 `Shapely==2.0.7` 与 `pyshp==3.1.6`，不向全局安装依赖）：

```sh
cd /path/to/cross-era-generals-map-sandbox
.venv/bin/python source-tools/build_campaign_maps.py
.venv/bin/python source-tools/validate_campaign_maps.py
```

`build_campaign_maps.py` 从 `assets/` 读取三份 Natural Earth 矢量 ZIP，从 `work/campaign-geography/` 读取 Gray Earth 源包；生成的 JSON 镜像、catalog 和构建记录均先写临时文件再原子替换，避免静态页面在重建中读到半份脚本。验证证据写入 `work/campaign-map/validation.json`，应报告四图 `status: PASS`、连续 region ID、连通邻接、逐边非空 borders、地盘覆盖与背景帧检查。
