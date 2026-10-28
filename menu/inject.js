/**
 * inject.js —— 游戏挂载与注入器
 *
 * 【为什么不用 window.location.href 跳转】
 * 实测（NW.js）整页跳转到游戏后：Node 上下文里的 global 数据还在，但页面的事件循环
 * 会被重置——菜单页注册的定时器、nw.Window 事件回调全部失效。也就是说「跳到游戏页
 * 之后，启动器的代码已经死了」，任何作弊/注入逻辑都无法再运行。
 *
 * 【方案】把游戏 HTML 以 iframe 形式加载进菜单页，菜单页永不导航：
 *   - 宿主页（菜单）的定时器与注入器一直存活；
 *   - 游戏跑在 iframe 里，仍是一个真实的 DOM 窗口，$gameParty / $gameMap 正常存在；
 *   - 由宿主页向 iframe 注入 cheat.js，注入时机与重试都由我们控制。
 *
 * nodeFs / nodePath 由 index.html 的内联脚本提供，这里不要重复声明。
 */

// 应用根目录：要在 process.chdir / execPath 被改写之前先取好
const APP_ROOT = (function () {
    try {
        return nodePath.dirname(process.execPath);
    } catch (e) {
        return process.cwd();
    }
})();

const CHEAT_SCRIPT_URL = 'file:///' + nodePath.join(APP_ROOT, 'menu', 'cheat.js').replace(/\\/g, '/');

const INJECT_INTERVAL = 200;   // 看护间隔
const INJECT_RETRY_GAP = 1500; // 注入失败后的重试间隔

let gameFrame = null;
let frameWatchTimer = null;
let injectedDoc = null;
let injectedAt = 0;
let retryCount = 0;

/**
 * 阉割 process.exit：游戏检测到"异常"时无法自我了断（Node 级，长期有效）
 */
function patchProcessExit(win) {
    try {
        if (win && win.process && typeof win.process.exit === 'function') {
            win.process.exit = function () { };
        }
    } catch (e) {
        console.error('[注入器] 拦截 process.exit 失败:', e);
    }
}

/**
 * 把 cheat.js 作为 <script> 塞进目标文档（在目标页面的执行环境里运行）
 */
function injectCheatScript(doc) {
    doc.querySelectorAll('script[data-rpg-cheat]').forEach(n => n.remove());

    const script = doc.createElement('script');
    script.setAttribute('data-rpg-cheat', '1');
    script.src = CHEAT_SCRIPT_URL;
    (doc.head || doc.documentElement).appendChild(script);
}

/**
 * 看护 iframe：文档换了就注入，注入没生效就重试
 */
function watchGameFrame(frame) {
    if (frameWatchTimer) clearInterval(frameWatchTimer);
    injectedDoc = null;
    retryCount = 0;

    frameWatchTimer = setInterval(function () {
        if (!frame.isConnected) {
            clearInterval(frameWatchTimer);
            frameWatchTimer = null;
            return;
        }

        let doc, win;
        try {
            doc = frame.contentDocument;
            win = frame.contentWindow;
        } catch (e) {
            return;
        }
        if (!doc || !doc.head || !win) return;

        if (win.__CHEAT_READY) {
            injectedDoc = doc;
            return;
        }

        if (doc === injectedDoc) {
            // 注入过但没生效，限次重试
            if (Date.now() - injectedAt > INJECT_RETRY_GAP && retryCount < 5) {
                retryCount++;
                injectedAt = Date.now();
                injectCheatScript(doc);
            }
            return;
        }

        injectedDoc = doc;
        injectedAt = Date.now();
        retryCount = 0;
        injectCheatScript(doc);
        console.log('[注入器] 已向游戏页面注入修改器: ' + doc.URL);
    }, INJECT_INTERVAL);
}

/**
 * 等比布局：window 可以随意缩放，但游戏区域始终保持自身宽高比（不足处留黑边）
 */
const DEFAULT_RATIO = 816 / 624; // RPG Maker MV/MZ 默认分辨率
let frameRatio = DEFAULT_RATIO;
let layoutBound = false;
let gameBackdrop = null;

// ---- 窗口比例锁 ----
const nwWindow = (typeof nw !== 'undefined' && nw.Window) ? nw.Window.get() : null;
let ratioLocked = false;
let winMaximized = false;
let ratioTimer = null;
let suppressUntil = 0;

/**
 * 开启窗口比例锁（进入游戏后调用）。
 * 只在「调整结束」后校正，避免拖动过程中窗口自己 resize 造成频闪。
 */
function enableRatioLock() {
    if (ratioLocked || !nwWindow) return;
    ratioLocked = true;
    try {
        nwWindow.on('maximize', function () { winMaximized = true; });
        nwWindow.on('unmaximize', function () { winMaximized = false; });
        nwWindow.on('restore', function () { winMaximized = false; });
    } catch (e) { }
}

/**
 * 拖动/缩放结束后再校正（防抖），拖动过程中完全不动窗口
 */
function scheduleRatioCorrect() {
    if (!ratioLocked || !nwWindow || winMaximized) return;
    if (Date.now() < suppressUntil) return;   // 自己触发的 resize，忽略

    if (ratioTimer) clearTimeout(ratioTimer);
    ratioTimer = setTimeout(function () {
        ratioTimer = null;
        correctWindowRatio();
    }, 200);
}

/**
 * 校正窗口比例：
 *   - 只「压缩」超出比例的那一侧（太高压高度、太宽压宽度），绝不放大窗口；
 *   - 压缩时保持窗口中心点不动。
 */
function correctWindowRatio() {
    if (!ratioLocked || !nwWindow || winMaximized) return;

    let w, h, x, y;
    try {
        w = nwWindow.width;
        h = nwWindow.height;
        x = nwWindow.x;
        y = nwWindow.y;
    } catch (e) {
        return;
    }
    if (!w || !h) return;

    const ratio = frameRatio || DEFAULT_RATIO;
    const targetH = Math.round(w / ratio);   // 按当前宽度应有的高度
    const targetW = Math.round(h * ratio);   // 按当前高度应有的宽度

    let nextW = w;
    let nextH = h;

    if (h > targetH + 1) {
        nextH = targetH;          // 太高了 → 压高度
    } else if (w > targetW + 1) {
        nextW = targetW;          // 太宽了 → 压宽度
    }
    // 两侧都不超出（比例已正确或更瘦）时不动窗口，剩余空间由黑边兜住

    if (nextW === w && nextH === h) return;

    nextW = Math.max(320, nextW);
    nextH = Math.max(240, nextH);

    // 中心点保持不变
    const cx = x + w / 2;
    const cy = y + h / 2;
    const nx = Math.round(cx - nextW / 2);
    const ny = Math.round(cy - nextH / 2);

    suppressUntil = Date.now() + 400;
    try {
        nwWindow.resizeTo(nextW, nextH);
        nwWindow.moveTo(nx, ny);
    } catch (e) { }
}

/** 从游戏页读取真实分辨率比例（Graphics.boxWidth / boxHeight） */
function readFrameRatio(frame) {
    try {
        const win = frame.contentWindow;
        const g = win && win.Graphics;
        if (!g) return null;
        const w = g.boxWidth || g.width;
        const h = g.boxHeight || g.height;
        if (w > 0 && h > 0) return w / h;
    } catch (e) { }
    return null;
}

/**
 * 按比例把游戏 iframe 居中铺进窗口，多余空间留黑边
 */
function layoutGameFrame(frame) {
    if (!frame || !frame.isConnected) return;

    const ratio = readFrameRatio(frame);
    if (ratio) frameRatio = ratio;

    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let w = vw;
    let h = Math.round(vw / frameRatio);
    if (h > vh) {
        h = vh;
        w = Math.round(vh * frameRatio);
    }

    frame.style.width = w + 'px';
    frame.style.height = h + 'px';
    frame.style.left = Math.round((vw - w) / 2) + 'px';
    frame.style.top = Math.round((vh - h) / 2) + 'px';
}

/** 游戏区背后的纯黑底，避免等比留白处露出菜单界面 */
function ensureBackdrop() {
    if (gameBackdrop && gameBackdrop.isConnected) return gameBackdrop;
    const div = document.createElement('div');
    div.id = 'game-backdrop';
    div.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;background:#000;z-index:99998;';
    document.body.appendChild(div);
    gameBackdrop = div;
    return div;
}

/**
 * 在菜单页内挂载游戏（等比缩放，随窗口同步调整）
 * @param {string} gamePath 游戏目录绝对路径
 */
function mountGameFrame(gamePath) {
    if (gameFrame && gameFrame.isConnected) {
        gameFrame.remove();
    }

    const indexHtmlPath = 'file:///' + nodePath.resolve(gamePath, 'index.html').replace(/\\/g, '/');
    console.log('[启动器] 正在加载游戏: ' + indexHtmlPath);

    ensureBackdrop();

    const frame = document.createElement('iframe');
    frame.id = 'game-frame';
    frame.src = indexHtmlPath;
    // 宽高由 layoutGameFrame 按比例计算，这里只固定定位与层级
    frame.style.cssText = 'position:fixed;left:0;top:0;border:0;z-index:99999;background:#000;';

    frame.addEventListener('load', function () {
        // 游戏加载完成后才知道真实分辨率，重新算一次比例
        layoutGameFrame(frame);
        try { frame.contentWindow.focus(); } catch (e) { }
    });

    document.body.appendChild(frame);
    gameFrame = frame;

    // 先按默认比例铺一次，避免加载瞬间闪烁
    layoutGameFrame(frame);

    if (!layoutBound) {
        window.addEventListener('resize', function () {
            if (gameFrame && gameFrame.isConnected) layoutGameFrame(gameFrame);
            scheduleRatioCorrect();
        });
        layoutBound = true;
    }

    // 进入游戏后锁定窗口宽高比
    enableRatioLock();

    watchGameFrame(frame);
    return frame;
}
