# 开发与检查

## 启动

在仓库根目录运行 `python3 launcher.py`。服务只监听 `127.0.0.1`，默认选择空闲端口；`--no-open --port 8766` 可指定端口并跳过自动打开浏览器。页面没有打包步骤。

## JavaScript

使用 Node.js 22 或更新版本，无需 `npm install`。

```sh
node engine.test.cjs
node character-mechanics.test.cjs
node campaign-mechanics.test.cjs
node world-mechanics.test.cjs
node world-completion.test.cjs
node viewport.test.cjs
```

分别覆盖引擎与资源约束、人物固定能力和关系、联盟与远征、世界篇章和海路、不同视口的缩放和平移边界。测试中的合成小地图用于隔离规则；完整自然推演与浏览器验收另见 [验收记录](VALIDATION.md)。

## Python 地图几何

只游玩不需要安装这些依赖。修改或复核地图时，在仓库根目录运行：

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python source-tools/validate_world_map.py --evidence work/world-map-validation.json
```

Windows 将 `.venv/bin/python` 替换为 `.venv\Scripts\python.exe`。图像尺寸的辅助读取目前使用 macOS 的 `sips`；Linux 上该信息可为空，几何检查仍运行。

完整世界地图可使用 `source-tools/build_world_map.py` 重建，输入为随仓库保存的地理源文件及已有 relief 图。区域地图生成若需要原始 Gray Earth 栅格，请按 [地理说明](../GEOGRAPHY.md) 取得源包并放到 `assets/maps/GRAY_LR_SR.zip`；该较大的原始栅格包不在运行时依赖中。

生成器的缓存和验证记录写入仓库内已被 Git 忽略的 `work/`，不依赖作者本机目录。重建地图后，请在提交前核对生成文件差异。

## PR 自动检查

GitHub Actions 在推送、PR 和手动触发时运行 JavaScript 语法、六套机制/视口测试及世界几何检查。工作流只申请读取仓库内容的权限。第三方 Fork 的首次工作流可能需要维护者按 GitHub 默认规则批准运行。
