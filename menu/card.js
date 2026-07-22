const { getTrueGameBackgroundImage } = require('./imageDecoder.js');

// 获取双图层 DOM 节点
const bgLayers = [
    document.getElementById('global-bg-1'),
    document.getElementById('global-bg-2')
];

// 双层动画独立状态控制
let activeLayerIndex = 0; // 当前展示中（或正在淡入）的图层索引 (0 或 1)
let layerStates = [
    { animId: null, opacity: 0, src: null }, // 图层 0 的状态
    { animId: null, opacity: 0, src: null }  // 图层 1 的状态
];

let currentHoveredCard = null;

/**
 * 针对单个图层的独立全功能动画渲染器
 * @param {number} index - 图层索引 (0 或 1)
 * @param {number} toOpacity - 目标透明度
 * @param {number} duration - 动画时长 (ms)
 * @param {string|null} changeSrc - 是否需要在此图层载入新图 (不换图传 null)
 */
function animateLayerOpacity(index, toOpacity, duration, changeSrc) {
    const layer = bgLayers[index];
    const state = layerStates[index];

    if (state.animId) {
        cancelAnimationFrame(state.animId);
        state.animId = null;
    }

    if (changeSrc) {
        state.src = changeSrc;
        layer.style.backgroundImage = `url("${changeSrc}")`;
    }

    const fromOpacity = state.opacity;
    const startTime = performance.now();

    if (duration <= 0) {
        state.opacity = toOpacity;
        layer.style.opacity = toOpacity.toString();
        return;
    }

    function tick() {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        // 使用 cubic ease-out 曲线让淡入淡出更平滑
        const eased = 1 - Math.pow(1 - progress, 3);
        state.opacity = fromOpacity + (toOpacity - fromOpacity) * eased;
        layer.style.opacity = state.opacity.toString();

        if (progress < 1) {
            state.animId = requestAnimationFrame(tick);
        } else {
            state.opacity = toOpacity;
            layer.style.opacity = toOpacity.toString();
            state.animId = null;
        }
    }

    state.animId = requestAnimationFrame(tick);
}

// 2. 生成并渲染游戏卡片
function createGameCard(gameFolderName, gamePath) {
    const card = document.createElement('div');
    card.className = 'game-card';
    card.dataset.gamePath = gamePath;
    card.dataset.gameName = gameFolderName;
    card.title = gameFolderName;

    // 调用解密器模块获取精准的背景图
    const bgSrc = getTrueGameBackgroundImage(gamePath);

    if (bgSrc) {
        card.onmouseenter = () => {
            currentHoveredCard = card;

            const currentActiveState = layerStates[activeLayerIndex];
            
            // 如果指回了已经在显示/淡入的同一张图，直接确保它完全淡入即可
            if (currentActiveState.src === bgSrc) {
                animateLayerOpacity(activeLayerIndex, 1, (1 - currentActiveState.opacity) * 1000, null);
                return;
            }

            // 【核心交叉淡入淡出逻辑】：
            // 1. 让现有的活跃图层以其“当前透明度 * 1000ms”的对等速度淡出到 0
            const oldLayerIndex = activeLayerIndex;
            const oldState = layerStates[oldLayerIndex];
            const fadeOutDuration = oldState.opacity * 1000; 
            animateLayerOpacity(oldLayerIndex, 0, fadeOutDuration, null);

            // 2. 切换当前活跃图层指针到另一个空闲图层
            activeLayerIndex = activeLayerIndex === 0 ? 1 : 0;

            // 3. 让新图层立刻载入新图，并在 1 秒内独立淡入到 1，不需要等待老图消失
            animateLayerOpacity(activeLayerIndex, 1, 1000, bgSrc);
        };

        card.onmouseleave = () => {
            if (currentHoveredCard === card) currentHoveredCard = null;

            setTimeout(() => {
                // 如果鼠标彻底离开了所有卡片，让所有图层全部平滑淡出到 0
                if (!currentHoveredCard) {
                    layerStates.forEach((state, idx) => {
                        if (state.opacity > 0) {
                            animateLayerOpacity(idx, 0, state.opacity * 1000, null);
                        }
                    });
                }
            }, 0);
        };
    }

    // 2.3 生成游戏图标
    const iconEl = document.createElement('img');
    iconEl.className = 'game-icon';
    const expectedIconPath = nodePath.join(gamePath, 'icon', 'icon.png');
    
    if (nodeFs.existsSync(expectedIconPath)) {
        iconEl.src = 'file:///' + expectedIconPath.replace(/\\/g, '/');
    } else {
        iconEl.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="%234fc3f7" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect><line x1="7" y1="2" x2="7" y2="22"></line><line x1="17" y1="2" x2="17" y2="22"></line><line x1="2" y1="12" x2="22" y2="12"></line><line x1="2" y1="7" x2="7" y2="7"></line><line x1="2" y1="17" x2="7" y2="17"></line><line x1="17" y1="17" x2="22" y2="17"></line><line x1="17" y1="7" x2="22" y2="7"></line></svg>';
    }
    
    const nameEl = document.createElement('div');
    nameEl.className = 'game-name';
    nameEl.innerText = gameFolderName;

    card.appendChild(iconEl);
    card.appendChild(nameEl);
    card.onclick = () => launchGame(gamePath);

    gameListContainer.appendChild(card);
}