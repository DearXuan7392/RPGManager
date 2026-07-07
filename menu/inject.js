function log(...args) {
    console.log(...args);
}

/**
 * 核心注入函数：拦截 fs 模块、屏蔽 F12 闪退检测、拦截退出事件
 * @param {Window} win 当前窗口的 window 对象
 * @param {string} saveDirPath 该游戏的绝对存档路径
 */
function injectFsInterceptor(win, saveDirPath) {
    if (!win || !win.require) return;
    log(`注入拦截器`);

    // 禁用退出函数
    if (win.process && win.process.exit) {
        win.process.exit = function (code) { };
    }

    // 禁用 devtools 监听
    const originalOn = win.on;
    win.on = function (event, listener) {
        if (event === 'devtools-opened' || event === 'devtools-closed') {
            return win; // 直接返回窗口对象，不注册后面的 () => process.exit()
        }
        return originalOn.apply(this, arguments);
    };

    // 拦截 F12 闪退检测
    win.addEventListener('keydown', function (e) {
        if (targetKeys.includes(e.keyCode)) {
            e.stopImmediatePropagation();
        }
    }, true);
};