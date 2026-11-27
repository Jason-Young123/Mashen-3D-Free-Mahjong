# 麻神 · 3D Free Mahjong

**一个面向四位玩家的共享式 3D 自由麻将桌。**  
**A shared 3D free-form mahjong table for four players.**

---

### 项目简介

**麻神 · 3D Free Mahjong** 是一个四人在线共享的 3D 麻将桌项目。项目的设计灵感来自原始项目 **queju_mahjong**：

- 原始项目：<https://github.com/Aixineiar/queju_mahjong>

本项目在自由操作麻将牌的方向上进行了重构：玩家可以在同一张 3D 桌面上自由拾取、移动、旋转、翻面、排列和叠放麻将牌。项目不实现传统麻将的轮流出牌状态机、自动发牌流程、吃碰杠胡规则判定或番数计算；服务器主要负责玩家、牌对象、持有权、空间变换、手牌排列和分数等共享状态。

### 重构与新增功能

- **四人共享 3D 桌面**：四个方位玩家连接同一服务器，实时同步麻将牌和桌面状态。
- **自由麻将牌操作**：支持拾取、拖动、旋转、翻面、复位、手牌吸附和多层叠放。
- **独立玩家视角**：每个玩家拥有自己的摄像机视角、方位标识和本地视觉风格设置。
- **可调桌面风格**：支持背景明暗、牌桌颜色与明暗、牌背颜色和牌面明暗调整；这些视觉设置仅影响当前玩家视角。
- **玩家与计分板**：支持头像选择及占用校验、本局分数和累计总分、增量修改和直接设定，以及分数变化提示。
- **对局管理**：支持四人确认后开始下一局、对局数显示、历史流水和累计分数。
- **桌面交互**：支持中央骰子槽同步投骰、庄家方位标、吃/碰/杠/胡动作提示、离线通知和危险操作确认。
- **轻量运行**：基于 Node.js、WebSocket 和 Three.js，无需数据库即可进行四人本机或局域网测试。

### 运行方式

**本地运行**

环境要求：Node.js 22 或更高版本、npm，以及支持 WebGL 的桌面浏览器。

```bash
npm install
npm start
```

浏览器访问：

```text
http://localhost:8080
```

四人测试时，使用四个独立浏览器窗口访问同一地址，并分别选择东、南、西、北座位。服务器默认监听 `0.0.0.0:8080`；如需更换端口，可设置 `PORT` 环境变量，例如 `PORT=8081 npm start`。

**公网服务器运行**

<http://43.143.108.152:8080>

四位玩家可以通过该公网地址从不同地点访问同一张麻将桌，无需在各自电脑上安装或运行服务器。

### 操作说明

**键盘快捷键**

| 按键 | 功能 |
|---|---|
| `A` / `D` | 旋转当前手持麻将牌 |
| `W` | 翻转当前手持麻将牌 |
| `S` | 将当前手持麻将牌复位为正对自己的状态（无旋转、无翻面），不会将牌放回原位 |

**鼠标操作**

| 操作 | 功能 |
|---|---|
| 鼠标左键单击 | 拾取 / 放下麻将牌 |
| 鼠标右键单击 | 撤销当前拾取操作 |
| 按住鼠标左键并拖动 | 旋转摄像机视角 |
| 鼠标滚轮 | 缩放摄像机视角 |

### 项目结构

```text
Mashen-3D-Free-Mahjong/
├── server.js
├── package.json
├── LICENSE
├── README.md
├── design.prompt
└── public/
    ├── index.html
    ├── game.html
    ├── assets/
    │   └── tiles-atlas.png
    └── src/
        ├── lobby.js
        ├── free-main.js
        └── tile-factory.js
```

### 致谢、版权与开发说明

- 本项目的设计灵感来自 [queju_mahjong](https://github.com/Aixineiar/queju_mahjong)。原项目版权信息：Copyright (c) 2024-2026 Aixineiar and queju-mahjong contributors。
- 本项目保留并使用了来源项目中的麻将牌面图集资源；原项目 MIT License 文本保留在 [`LICENSE`](./LICENSE) 中。
- 运行时依赖包括 [Three.js](https://threejs.org/)（MIT）和 [ws](https://github.com/websockets/ws)（MIT）。
- 本项目主要由 AI 辅助进行设计、编码和迭代。项目设计提示词保存在 [`./design.prompt`](./design.prompt) 中。

---

### Overview

**Mashen · 3D Free Mahjong** is a shared 3D mahjong table for four players. Its design is inspired by the original **queju_mahjong** project:

- Original project: <https://github.com/Aixineiar/queju_mahjong>

This project was refactored around free-form interaction with mahjong tiles. Players share one 3D table and can pick up, move, rotate, flip, arrange, and stack tiles. It intentionally does not implement a traditional turn-based mahjong state machine, automatic dealing, chi/peng/gang/hu rule validation, or fan calculation. The server primarily manages shared player state, tile objects, ownership, transforms, hand arrangement, and scores.

### Refactoring Highlights and Features

- **Four-player shared table** with real-time synchronization through a Node.js WebSocket server.
- **Free-form tile manipulation**, including grabbing, dragging, rotation, flipping, reset, hand-zone snapping, and multi-level stacking.
- **Independent player viewpoints**, including seat-relative cameras, seat markers, and local visual preferences.
- **Adjustable table appearance**: background brightness, table color and brightness, tile-back color, and tile-face brightness. Visual preferences are local to each player's view.
- **Player profiles and scoreboards**: selectable avatars with occupancy checks, round scores, cumulative scores, score increments or direct value setting, and score-change feedback.
- **Round management**: unanimous confirmation for the next round, round counter, round history, and cumulative totals.
- **Table interactions**: synchronized dice rolling, dealer marker, chi/peng/gang/hu action notifications, offline notices, and confirmation dialogs for risky actions.
- **Lightweight setup** for local or LAN play without a database.

### Getting Started

**To Run Locally**

Requirements: Node.js 22 or later, npm, and a desktop browser with WebGL support.

```bash
npm install
npm start
```

Open <http://localhost:8080> in your browser. For a four-player local test, use four separate browser windows and select East, South, West, and North respectively. The server listens on `0.0.0.0:8080` by default. Set the `PORT` environment variable to use another port, for example `PORT=8081 npm start`.

**To Run on Public Server**

<http://43.143.108.152:8080>

All four players can access the same public URL from different locations and join the same shared mahjong table. Players do not need to install or run the server locally.

### Controls

**Keyboard Shortcuts**

| Key | Action |
|---|---|
| `A` / `D` | Rotate the currently held mahjong tile |
| `W` | Flip the currently held mahjong tile |
| `S` | Reset the held tile to face the current player, with no rotation or flipped face. This does not return the tile to its original position. |

**Mouse Controls**

| Action | Function |
|---|---|
| Left-click | Pick up / place down a mahjong tile |
| Right-click | Undo the current pickup operation |
| Hold and drag the left mouse button | Rotate the camera view |
| Mouse wheel | Zoom the camera view |

### Project Structure

```text
Mashen-3D-Free-Mahjong/
├── server.js
├── package.json
├── LICENSE
├── README.md
├── design.prompt
└── public/
    ├── index.html
    ├── game.html
    ├── assets/
    │   └── tiles-atlas.png
    └── src/
        ├── lobby.js
        ├── free-main.js
        └── tile-factory.js
```

### Credits, License, and Development

- The project is inspired by [queju_mahjong](https://github.com/Aixineiar/queju_mahjong). Original project copyright: Copyright (c) 2024-2026 Aixineiar and queju-mahjong contributors.
- The original project's mahjong tile atlas artwork is retained in this project. The original MIT License text is preserved in [`LICENSE`](./LICENSE).
- Runtime dependencies: [Three.js](https://threejs.org/) (MIT) and [ws](https://github.com/websockets/ws) (MIT).
- This project was developed primarily with AI assistance for design, implementation, and iteration. The design prompt is available at [`./design.prompt`](./design.prompt).