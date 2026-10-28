/**
 * cheat.js —— RPG Maker MV/MZ 运行时修改器【页面载荷】
 *
 * 由 inject.js 以 <script> 的形式注入到「游戏页面」内部执行，
 * 所以这里的 window 就是游戏窗口，$gameParty / $gameMap 可直接访问。
 *
 * 【界面】注入成功后会在游戏画面右上角出现一个可拖拽的圆形悬浮球
 * （每次启动都回右上角，拖动只在本次会话内有效），
 * 点击展开作弊面板：数值修改 / 一键拉满 / 事件雷达 / 立即胜利 / 立即战败。
 *
 * 【控制台 API】也可在 F12 控制台直接调用：
 *   cheatSetHp(9999) / cheatSetMp(9999) / cheatSetAtk(9999) / cheatSetGold(999999)
 *   cheatHightlightEventPos()  开启地图事件雷达
 *   cheatStopRadar()           关闭雷达
 *   cheatBattleVictory()       战斗中立即胜利
 *   cheatBattleDefeat()        战斗中立即战败
 *   cheatInBattle()            当前是否在战斗中
 *   cheatHelp()                打印可用指令
 */
(function () {
    'use strict';

    var VERSION = 5;

    // 已安装且版本一致则跳过（防止重复注入产生多个雷达循环 / 多个悬浮球）
    if (window.__CHEAT_READY === VERSION) return;

    // =====================================================================
    // 一、反检测补丁（必须跑在游戏页面里才有效，放菜单页会随导航失效）
    // =====================================================================

    // 1. 阉割 process.exit，游戏检测到“异常”时无法自杀
    try {
        if (window.process && typeof window.process.exit === 'function') {
            window.process.exit = function () { };
        }
    } catch (e) { }

    // 2. 丢弃 devtools-opened / devtools-closed 监听（这类监听通常直接绑定退出）
    try {
        if (window.nw && window.nw.Window && typeof window.nw.Window.get === 'function') {
            var nwWin = window.nw.Window.get();
            var originalOn = nwWin.on;
            if (originalOn && !nwWin.__cheatOnPatched) {
                nwWin.on = function (event) {
                    if (event === 'devtools-opened' || event === 'devtools-closed') {
                        return nwWin;
                    }
                    return originalOn.apply(this, arguments);
                };
                nwWin.__cheatOnPatched = true;
            }
        }
    } catch (e) { }

    // 3. 阻断页面层对 F12 的按键监听（devtools 本身仍由浏览器打开）
    try {
        window.addEventListener('keydown', function (e) {
            if (e.keyCode === 123) { // F12
                e.stopImmediatePropagation();
            }
        }, true);
    } catch (e) { }

    // 4. 隐藏游戏页面的滚动条（只改外观，不影响滚动能力）
    try {
        var scrollStyle = document.createElement('style');
        scrollStyle.setAttribute('data-rpg-cheat-style', '1');
        scrollStyle.textContent =
            '::-webkit-scrollbar{width:0 !important;height:0 !important;display:none !important;}' +
            'html,body{scrollbar-width:none !important;-ms-overflow-style:none !important;}';
        (document.head || document.documentElement).appendChild(scrollStyle);
    } catch (e) { }

    // 5. 屏蔽游戏页面的右键菜单（避免误触系统菜单打断游戏）
    try {
        document.addEventListener('contextmenu', function (e) {
            e.preventDefault();
            e.stopPropagation();
        }, true);
    } catch (e) { }

    // =====================================================================
    // 二、数值修改核心
    // =====================================================================

    function getParty() {
        return window.$gameParty || null;
    }

    function toNumber(value) {
        var num = Number(value);
        return isNaN(num) ? null : num;
    }

    function report(msg) {
        console.log('%c[Cheat] ' + msg, 'color:#4fc3f7;font-weight:bold');
    }

    /**
     * 设置全员某项基础能力值（清零该项加成，保证结果等于目标值）
     * @param {number} paramId 0=HP 1=MP 2=ATK
     * @param {*} value
     * @param {string} label 用于提示
     * @returns {{ok:boolean, msg:string}}
     */
    function setParamAll(paramId, value, label) {
        var party = getParty();
        if (!party) return { ok: false, msg: '还没进入游戏，请先加载存档并进入地图' };

        var num = toNumber(value);
        if (num === null) return { ok: false, msg: '请输入有效数字' };

        party.members().forEach(function (actor) {
            if (actor._paramPlus) actor._paramPlus[paramId] = 0;
            if (typeof actor.addParam === 'function') actor.addParam(paramId, num);
            if (paramId === 0 && typeof actor.setHp === 'function') actor.setHp(num);
            if (paramId === 1 && typeof actor.setMp === 'function') actor.setMp(num);
        });

        report(label + ' = ' + num);
        return { ok: true, msg: '已设置' + label + ' = ' + num + '（' + party.members().length + ' 名角色）' };
    }

    function setGold(value) {
        var party = getParty();
        if (!party) return { ok: false, msg: '还没进入游戏，请先加载存档并进入地图' };

        var num = toNumber(value);
        if (num === null) return { ok: false, msg: '请输入有效数字' };

        party.gainGold(num - party.gold()); // 差额补足，避免正负号判断差异
        report('金币 = ' + party.gold());
        return { ok: true, msg: '已设置金币 = ' + party.gold() };
    }

    /**
     * 回满：把当前值补到角色上限；本来就超过上限的，直接压回正常上限
     * @param {number} paramId 0=HP 1=MP
     * @param {string} label
     * @returns {{ok:boolean, msg:string}}
     */
    function fillToMax(paramId, label) {
        var party = getParty();
        if (!party) return { ok: false, msg: '还没进入游戏，请先加载存档并进入地图' };

        var maxFn = paramId === 0 ? 'mhp' : 'mmp';
        var curFn = paramId === 0 ? 'hp' : 'mp';
        var setFn = paramId === 0 ? 'setHp' : 'setMp';

        var applied = 0;
        var capped = 0;
        var firstMax = null;

        party.members().forEach(function (actor) {
            if (!actor) return;

            var max = (typeof actor[maxFn] === 'function') ? Number(actor[maxFn]()) : NaN;
            if (!isFinite(max) || max <= 0) {
                max = (typeof actor.param === 'function') ? Number(actor.param(paramId)) : NaN;
            }
            if (!isFinite(max) || max <= 0) return;
            if (firstMax === null) firstMax = max;

            // 当前值已经超过上限的，记一笔，下面统一压回上限
            var cur = (typeof actor[curFn] === 'function') ? Number(actor[curFn]()) : 0;
            if (cur > max) capped++;

            if (typeof actor[setFn] === 'function') actor[setFn](max);
            applied++;
        });

        if (!applied) return { ok: false, msg: '未取到' + label + '上限，无法回满' };

        report(label + ' 回满至上限 ' + firstMax + (capped ? '（' + capped + ' 名角色超过上限已重置）' : ''));
        return {
            ok: true,
            msg: '已回满' + label + '（上限 ' + firstMax + '）' +
                (capped ? '，' + capped + ' 名角色超过上限已重置' : '')
        };
    }

    // 控制台 API
    window.cheatSetHp = function (v) { return setParamAll(0, v, '全员生命').msg; };
    window.cheatSetMp = function (v) { return setParamAll(1, v, '全员魔法').msg; };
    window.cheatSetAtk = function (v) { return setParamAll(2, v, '全员攻击力').msg; };
    window.cheatSetGold = function (v) { return setGold(v).msg; };
    window.cheatFillHp = function () { return fillToMax(0, '全员生命').msg; };
    window.cheatFillMp = function () { return fillToMax(1, '全员魔法').msg; };

    // =====================================================================
    // 三、地图事件雷达
    // =====================================================================

    var radar = { overlay: null, rafId: null, lastMapId: null, running: false };
    var TRIGGER_NAMES = ['调查', '触碰', '事件触碰', '自动', '并行'];

    function stopRadar() {
        radar.running = false;
        if (radar.rafId !== null) {
            cancelAnimationFrame(radar.rafId);
            radar.rafId = null;
        }
        if (radar.overlay && radar.overlay.parentNode) {
            radar.overlay.parentNode.removeChild(radar.overlay);
        }
        radar.overlay = null;
        radar.lastMapId = null;
    }

    function ensureOverlay() {
        if (radar.overlay && radar.overlay.parentNode === document.body) return radar.overlay;
        var old = document.getElementById('rpg-dynamic-overlay');
        if (old) old.remove();

        var overlay = document.createElement('div');
        overlay.id = 'rpg-dynamic-overlay';
        overlay.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;' +
            'z-index:99999;pointer-events:none;overflow:hidden;';
        document.body.appendChild(overlay);
        radar.overlay = overlay;
        return overlay;
    }

    function drawRadarFrame() {
        if (!radar.running) return;

        var overlay = radar.overlay;
        if (!overlay || !overlay.parentNode) {
            radar.running = false;
            return;
        }
        overlay.innerHTML = '';

        try {
            var gmap = window.$gameMap;
            var canvas = document.getElementById('gameCanvas') || document.querySelector('canvas');
            if (!gmap || !canvas || typeof gmap.data !== 'function' || !gmap.data()) {
                radar.rafId = requestAnimationFrame(drawRadarFrame);
                return;
            }

            var mapId = gmap.mapId();
            var displayX = gmap.displayX();
            var displayY = gmap.displayY();
            if (radar.lastMapId !== mapId) {
                radar.lastMapId = mapId;
                console.log('%c[雷达] 已同步地图 ID: ' + mapId, 'color:#00ffff');
            }

            var tw = gmap.tileWidth ? gmap.tileWidth() : 48;
            var th = gmap.tileHeight ? gmap.tileHeight() : 48;
            var boxW = (window.Graphics && (Graphics.boxWidth || Graphics.width)) || 816;
            var boxH = (window.Graphics && (Graphics.boxHeight || Graphics.height)) || 624;

            var rect = canvas.getBoundingClientRect();
            var scaleX = rect.width / boxW;
            var scaleY = rect.height / boxH;

            var events = typeof gmap.events === 'function' ? gmap.events() : (gmap._events || []);
            var maxX = canvas.width / tw + 1;
            var maxY = canvas.height / th + 1;

            events.forEach(function (ev) {
                if (!ev) return;

                var raw = typeof ev.event === 'function' ? ev.event() : ev;
                if (!raw || !raw.pages || raw.pages.length === 0) return;

                var page = (ev._pageIndex !== undefined && ev._pageIndex >= 0)
                    ? raw.pages[ev._pageIndex]
                    : raw.pages[0];

                if (page && page.list && page.list.length <= 1 && !page.characterName && !page.tileId) return;

                var screenX = ev.x - displayX;
                var screenY = ev.y - displayY;
                if (screenX < -1 || screenX > maxX || screenY < -1 || screenY > maxY) return;

                var box = document.createElement('div');
                box.style.cssText = 'position:absolute;box-sizing:border-box;' +
                    'left:' + (rect.left + screenX * tw * scaleX) + 'px;' +
                    'top:' + (rect.top + screenY * th * scaleY) + 'px;' +
                    'width:' + (tw * scaleX) + 'px;' +
                    'height:' + (th * scaleY) + 'px;' +
                    'border:2px solid #00ffff;' +
                    'box-shadow:0 0 8px #00ffff, inset 0 0 6px rgba(0,255,255,0.3);' +
                    'background:rgba(0,255,255,0.1);';

                var label = document.createElement('div');
                label.innerText = (raw.name || ('EV' + raw.id)) + '\n[' + ev.x + ',' + ev.y + '] (' +
                    (TRIGGER_NAMES[page ? page.trigger : 0] || '未知') + ')';
                label.style.cssText = 'position:absolute;top:-' + (th * scaleY * 0.8) + 'px;left:50%;' +
                    'transform:translateX(-50%);background:rgba(0,0,0,0.8);color:#fff;' +
                    'font:10px/1.3 monospace;padding:1px 4px;border-radius:3px;' +
                    'border:1px solid #00ffff;white-space:pre;text-align:center;';

                box.appendChild(label);
                overlay.appendChild(box);
            });
        } catch (e) {
            // 地图重载瞬间的偶发 null，忽略并继续
        }

        radar.rafId = requestAnimationFrame(drawRadarFrame);
    }

    function startRadar() {
        stopRadar();
        ensureOverlay();
        radar.running = true;
        radar.rafId = requestAnimationFrame(drawRadarFrame);
    }

    window.cheatHightlightEventPos = function () {
        startRadar();
        report('地图事件雷达已开启（再次调用会重置）');
        return '雷达已开启';
    };
    window.cheatStopRadar = function () {
        stopRadar();
        return '雷达已关闭';
    };
    window.cheatIsRadarOn = function () { return radar.running; };

    // =====================================================================
    // 四、战斗控制（仅在战斗进行中可用）
    // =====================================================================

    /**
     * 当前是否正处于战斗中
     * 判据：当前场景是 Scene_Battle，且战斗尚未结束
     */
    function inBattle() {
        try {
            var sm = window.SceneManager;
            var scene = sm && sm._scene;
            if (!scene) return false;

            var name = scene.constructor && scene.constructor.name;
            if (name !== 'Scene_Battle') return false;

            var bm = window.BattleManager;
            if (bm && typeof bm.isBattleEnd === 'function' && bm.isBattleEnd()) return false;

            return true;
        } catch (e) {
            return false;
        }
    }

    /** 让敌方全体倒下（统一处理 die / setHp 两种实现） */
    function killTroop() {
        var troop = window.$gameTroop;
        if (!troop || typeof troop.members !== 'function') return false;
        var killed = 0;
        troop.members().forEach(function (enemy) {
            if (!enemy) return;
            try {
                if (typeof enemy.isDead === 'function' && enemy.isDead()) return;
                if (typeof enemy.die === 'function') enemy.die();
                else if (typeof enemy.setHp === 'function') enemy.setHp(0);
                killed++;
            } catch (e) { }
        });
        return killed > 0;
    }

    /** 让队伍全员倒下 */
    function killParty() {
        var party = getParty();
        if (!party) return false;
        var killed = 0;
        party.members().forEach(function (actor) {
            if (!actor) return;
            try {
                if (typeof actor.isDead === 'function' && actor.isDead()) return;
                if (typeof actor.setHp === 'function') { actor.setHp(0); killed++; }
            } catch (e) { }
        });
        return killed > 0;
    }

    function forceVictory() {
        if (!inBattle()) return { ok: false, msg: '当前不在战斗中，无法使用' };

        var bm = window.BattleManager;

        // 先让敌方全灭：部分插件/魔改版在结算时会检查 $gameTroop.isAllDead()
        killTroop();

        try {
            if (bm && typeof bm.processVictory === 'function') {
                bm.processVictory();
                report('战斗：立即胜利');
                return { ok: true, msg: '已立即胜利' };
            }
        } catch (e) {
            console.warn('[Cheat] processVictory 调用失败，改用结算判定:', e);
        }

        try {
            if (bm && typeof bm.checkBattleEnd === 'function') {
                bm.checkBattleEnd();
                return { ok: true, msg: '已击倒全部敌人' };
            }
        } catch (e) { }

        return { ok: false, msg: '该游戏不支持一键胜利' };
    }

    function forceDefeat() {
        if (!inBattle()) return { ok: false, msg: '当前不在战斗中，无法使用' };

        var bm = window.BattleManager;

        // 1) 先把队伍生命清零（MV/MZ 判定战败的依据就是 $gameParty.isAllDead()）
        killParty();

        // 2) 强制触发战败事件（官方战败流程：战败消息 + 战败 ME + endBattle(2)）
        try {
            if (bm && typeof bm.processDefeat === 'function') {
                bm.processDefeat();
                report('战斗：立即战败（全员倒下）');
                return { ok: true, msg: '已立即战败（全员倒下）' };
            }
            if (bm && typeof bm.checkBattleEnd === 'function') {
                bm.checkBattleEnd();
                return { ok: true, msg: '已清空队伍血量并触发战败结算' };
            }
        } catch (e) {
            console.warn('[Cheat] 触发战败失败:', e);
        }

        return { ok: false, msg: '该游戏不支持一键战败' };
    }

    window.cheatBattleVictory = function () { return forceVictory().msg; };
    window.cheatBattleDefeat = function () { return forceDefeat().msg; };
    window.cheatInBattle = inBattle;

    // =====================================================================
    // 五、悬浮球 + 作弊面板
    // =====================================================================

    var UI_ID = 'rpg-cheat-host';
    var BALL_SIZE = 56;
    var PANEL_WIDTH = 252;

    var ui = {
        host: null, btn: null, panel: null, tip: null, radarBtn: null,
        winBtn: null, loseBtn: null, open: false, battleTimer: null
    };

    function clamp(v, min, max) {
        return Math.min(Math.max(v, min), max);
    }

    function placeBall(left, top) {
        var maxLeft = window.innerWidth - BALL_SIZE - 4;
        var maxTop = window.innerHeight - BALL_SIZE - 4;
        left = clamp(left, 4, Math.max(4, maxLeft));
        top = clamp(top, 4, Math.max(4, maxTop));
        ui.host.style.left = left + 'px';
        ui.host.style.top = top + 'px';
    }

    function placePanel() {
        if (!ui.open) return;
        var r = ui.host.getBoundingClientRect();
        var ph = ui.panel.offsetHeight || 300;

        var left = r.left - PANEL_WIDTH - 12;          // 默认放左侧
        if (left < 8) left = r.right + 12;             // 左边放不下就放右侧
        left = clamp(left, 8, Math.max(8, window.innerWidth - PANEL_WIDTH - 8));

        var top = clamp(r.top, 8, Math.max(8, window.innerHeight - ph - 8));

        ui.panel.style.left = left + 'px';
        ui.panel.style.top = top + 'px';
    }

    function setTip(msg, isError) {
        if (!ui.tip) return;
        ui.tip.innerText = msg;
        ui.tip.style.color = isError ? '#ff8a80' : '#8ce99a';
    }

    function refreshBattleButtons() {
        if (!ui.winBtn || !ui.loseBtn) return;
        var on = inBattle();
        ui.winBtn.disabled = !on;
        ui.loseBtn.disabled = !on;
    }

    function togglePanel(force) {
        ui.open = (typeof force === 'boolean') ? force : !ui.open;
        ui.panel.style.display = ui.open ? 'block' : 'none';
        ui.btn.classList.toggle('active', ui.open);

        if (ui.open) {
            placePanel();
            if (window.cheatIsRadarOn()) ui.radarBtn.innerText = '事件雷达：开';
            refreshBattleButtons();
            // 战斗状态会变（遇敌 / 结束），面板开着时持续刷新按钮可用性
            if (!ui.battleTimer) {
                ui.battleTimer = setInterval(refreshBattleButtons, 500);
            }
        } else if (ui.battleTimer) {
            clearInterval(ui.battleTimer);
            ui.battleTimer = null;
        }
    }

    function applyParam(paramId, inputEl, label) {
        var res = setParamAll(paramId, inputEl.value, label);
        setTip(res.msg, !res.ok);
    }

    function buildUI() {
        if (document.getElementById(UI_ID)) return;

        var host = document.createElement('div');
        host.id = UI_ID;
        host.style.cssText = 'position:fixed;width:' + BALL_SIZE + 'px;height:' + BALL_SIZE + 'px;' +
            'z-index:2147483000;left:0;top:0;';

        // 用 Shadow DOM 隔离，避免与游戏自身 CSS 打架
        var root = host.attachShadow({ mode: 'open' });
        root.innerHTML = [
            '<style>',
            ':host{all:initial;}',
            '.ball{width:56px;height:56px;border-radius:50%;box-sizing:border-box;',
            'background:radial-gradient(circle at 32% 28%,#7fdcff,#0f7fbf 72%);',
            'box-shadow:0 8px 22px rgba(0,0,0,.45),inset 0 0 0 1px rgba(255,255,255,.4);',
            'display:flex;align-items:center;justify-content:center;color:#fff;',
            'font:700 14px/1 "Microsoft YaHei",sans-serif;letter-spacing:1px;',
            'cursor:grab;user-select:none;touch-action:none;transition:transform .15s,box-shadow .15s;}',
            '.ball:hover{transform:scale(1.06);box-shadow:0 10px 26px rgba(0,0,0,.55),inset 0 0 0 1px rgba(255,255,255,.6);}',
            '.ball.dragging{cursor:grabbing;transform:scale(1.08);}',
            '.ball.active{background:radial-gradient(circle at 32% 28%,#8ef0b8,#0f9f63 72%);}',
            '.panel{position:fixed;display:none;width:252px;box-sizing:border-box;',
            'background:rgba(24,24,31,.96);border:1px solid #4fc3f7;border-radius:12px;',
            'padding:12px;color:#e9e9f2;font:13px/1.5 "Microsoft YaHei",sans-serif;',
            'box-shadow:0 16px 36px rgba(0,0,0,.6);}',
            '.head{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;}',
            '.title{color:#4fc3f7;font-weight:700;letter-spacing:.5px;}',
            '.close{cursor:pointer;color:#9aa0ad;font-size:18px;line-height:1;padding:0 4px;}',
            '.close:hover{color:#fff;}',
            '.row{display:grid;grid-template-columns:38px minmax(0,1fr) 46px 46px;',
            'align-items:center;gap:6px;margin-bottom:8px;}',
            '.row label{color:#b8becc;}',
            '.row button{width:100%;padding:5px 0;}',
            'input{width:100%;box-sizing:border-box;min-width:0;background:#0f0f14;border:1px solid #3a3a48;',
            'color:#fff;border-radius:6px;padding:5px 8px;font:13px "Microsoft YaHei",sans-serif;outline:none;}',
            'input:focus{border-color:#4fc3f7;}',
            'input[type=number]::-webkit-inner-spin-button,',
            'input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0;}',
            'input[type=number]{-moz-appearance:textfield;appearance:textfield;}',
            'button.fill{padding:5px 7px;color:#9fe6b8;border-color:#2f7d4f;}',
            'button.fill:hover{background:#1f5c3a;border-color:#4cd98a;}',
            'button{cursor:pointer;border:1px solid #3a3a48;background:#2a2a36;color:#e9e9f2;',
            'border-radius:6px;padding:5px 10px;font:13px "Microsoft YaHei",sans-serif;transition:background .15s;}',
            'button:hover{background:#37415a;border-color:#4fc3f7;}',
            'button.primary{background:#4fc3f7;border-color:#4fc3f7;color:#10131a;font-weight:700;}',
            'button.primary:hover{background:#7ad4ff;}',
            '.grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:10px 0 8px;}',
            'button:disabled{opacity:.4;cursor:not-allowed;background:#22222b;border-color:#33333f;color:#8b93a1;}',
            'button:disabled:hover{background:#22222b;border-color:#33333f;}',
            'button.win{border-color:#2f7d4f;}',
            'button.win:not(:disabled):hover{background:#1f5c3a;border-color:#4cd98a;}',
            'button.lose{border-color:#7d2f2f;}',
            'button.lose:not(:disabled):hover{background:#5c1f1f;border-color:#e06a6a;}',
            '.sep{height:1px;background:#33333f;margin:10px 0;}',
            '.tip{font-size:11px;color:#8ce99a;min-height:16px;line-height:1.4;word-break:break-all;}',
            '.hint{font-size:11px;color:#7c8391;margin-top:6px;}',
            '</style>',
            '<div class="ball" id="ball">作弊</div>',
            '<div class="panel" id="panel">',
            '  <div class="head"><span class="title">作弊面板</span><span class="close" id="close">×</span></div>',
            '  <div class="row"><label>生命</label><input id="hp" type="number" placeholder="9999"><button data-act="hp">应用</button><button data-act="hpfill" class="fill">回满</button></div>',
            '  <div class="row"><label>魔法</label><input id="mp" type="number" placeholder="9999"><button data-act="mp">应用</button><button data-act="mpfill" class="fill">回满</button></div>',
            '  <div class="row"><label>攻击</label><input id="atk" type="number" placeholder="999"><button data-act="atk">应用</button><span class="ph"></span></div>',
            '  <div class="row"><label>金币</label><input id="gold" type="number" placeholder="999999"><button data-act="gold">应用</button><span class="ph"></span></div>',
            '  <div class="grid">',
            '    <button id="max" class="primary">一键拉满</button>',
            '    <button id="radar">事件雷达：关</button>',
            '  </div>',
            '  <div class="sep"></div>',
            '  <div class="grid">',
            '    <button id="win" class="win" disabled>立即胜利</button>',
            '    <button id="lose" class="lose" disabled>立即战败</button>',
            '  </div>',
            '  <div class="tip" id="tip">拖动圆球可移动位置</div>',
            '</div>'
        ].join('');

        document.body.appendChild(host);

        ui.host = host;
        ui.btn = root.getElementById('ball');
        ui.panel = root.getElementById('panel');
        ui.tip = root.getElementById('tip');
        ui.radarBtn = root.getElementById('radar');
        ui.winBtn = root.getElementById('win');
        ui.loseBtn = root.getElementById('lose');

        // ---- 位置初始化：每次启动都回到右上角（本次会话内可拖动） ----
        placeBall(window.innerWidth - BALL_SIZE - 18, 88);

        // ---- 拖拽 / 点击 ----
        var drag = { active: false, moved: false, sx: 0, sy: 0, left: 0, top: 0 };

        function onPointerDown(e) {
            if (e.button !== 0 && e.pointerType === 'mouse') return;
            e.preventDefault();
            e.stopPropagation();

            var r = host.getBoundingClientRect();
            drag.active = true;
            drag.moved = false;
            drag.sx = e.clientX;
            drag.sy = e.clientY;
            drag.left = r.left;
            drag.top = r.top;
            ui.btn.classList.add('dragging');
            try { ui.btn.setPointerCapture(e.pointerId); } catch (err) { }

            window.addEventListener('pointermove', onPointerMove, true);
            window.addEventListener('pointerup', onPointerUp, true);
            window.addEventListener('pointercancel', onPointerUp, true);
        }

        function onPointerMove(e) {
            if (!drag.active) return;
            e.preventDefault();
            e.stopPropagation();

            var dx = e.clientX - drag.sx;
            var dy = e.clientY - drag.sy;
            if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 5) {
                drag.moved = true;
                togglePanel(false); // 开始拖动就收起面板
            }
            if (drag.moved) placeBall(drag.left + dx, drag.top + dy);
        }

        function onPointerUp(e) {
            if (!drag.active) return;
            drag.active = false;
            ui.btn.classList.remove('dragging');

            window.removeEventListener('pointermove', onPointerMove, true);
            window.removeEventListener('pointerup', onPointerUp, true);
            window.removeEventListener('pointercancel', onPointerUp, true);

            if (drag.moved) {
                // 位置仅本次会话有效，下次启动仍回到右上角
            } else {
                togglePanel(); // 没移动 → 视作点击
            }
        }

        ui.btn.addEventListener('pointerdown', onPointerDown);

        // ---- 面板交互 ----
        // 阻止事件冒泡到游戏（否则点击/按键会被游戏 UI 或按键系统吃掉）。
        // 注意：必须挂在「球 / 面板」自身上用冒泡阶段拦截；
        // 若在 host 上用捕获阶段 stopPropagation，会把内部按钮的事件也一起掐掉。
        var BLOCKED_EVENTS = ['pointerdown', 'pointerup', 'pointermove', 'click', 'dblclick',
            'mousedown', 'mouseup', 'keydown', 'keyup', 'wheel', 'contextmenu'];
        [ui.btn, ui.panel].forEach(function (el) {
            BLOCKED_EVENTS.forEach(function (evt) {
                el.addEventListener(evt, function (e) { e.stopPropagation(); }, false);
            });
        });

        root.getElementById('close').addEventListener('click', function () { togglePanel(false); });

        var inputs = {
            hp: root.getElementById('hp'),
            mp: root.getElementById('mp'),
            atk: root.getElementById('atk'),
            gold: root.getElementById('gold')
        };

        root.querySelectorAll('button[data-act]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var act = btn.getAttribute('data-act');
                if (act === 'hp') applyParam(0, inputs.hp, '全员生命');
                if (act === 'mp') applyParam(1, inputs.mp, '全员魔法');
                if (act === 'atk') applyParam(2, inputs.atk, '全员攻击力');
                if (act === 'gold') {
                    var res = setGold(inputs.gold.value);
                    setTip(res.msg, !res.ok);
                }
                if (act === 'hpfill') {
                    var rHp = fillToMax(0, '全员生命');
                    setTip(rHp.msg, !rHp.ok);
                }
                if (act === 'mpfill') {
                    var rMp = fillToMax(1, '全员魔法');
                    setTip(rMp.msg, !rMp.ok);
                }
            });
        });

        root.getElementById('max').addEventListener('click', function () {
            var r1 = setParamAll(0, 9999, '全员生命');
            var r2 = setParamAll(1, 9999, '全员魔法');
            var r3 = setParamAll(2, 999, '全员攻击力');
            var r4 = setGold(9999999);
            var ok = r1.ok && r2.ok && r3.ok && r4.ok;
            setTip(ok ? '已一键拉满：HP/MP 9999、攻击 999、金币 9999999' : (r1.msg || r2.msg || r3.msg || r4.msg), !ok);
            inputs.hp.value = 9999;
            inputs.mp.value = 9999;
            inputs.atk.value = 999;
            inputs.gold.value = 9999999;
        });

        ui.radarBtn.addEventListener('click', function () {
            if (window.cheatIsRadarOn()) {
                stopRadar();
                ui.radarBtn.innerText = '事件雷达：关';
                setTip('事件雷达已关闭', false);
            } else {
                startRadar();
                ui.radarBtn.innerText = '事件雷达：开';
                setTip('事件雷达已开启（青色框为地图事件）', false);
            }
        });

        ui.winBtn.addEventListener('click', function () {
            var res = forceVictory();
            setTip(res.msg, !res.ok);
        });

        ui.loseBtn.addEventListener('click', function () {
            var res = forceDefeat();
            setTip(res.msg, !res.ok);
        });

        // 点击画面其它位置关闭面板
        document.addEventListener('pointerdown', function (e) {
            if (!ui.open) return;
            if (e.target === host || host.contains(e.target)) return;
            togglePanel(false);
        }, true);

        // 窗口尺寸变化时把球拉回可视区
        window.addEventListener('resize', function () {
            var r = host.getBoundingClientRect();
            placeBall(r.left, r.top);
            placePanel();
        });
    }

    // =====================================================================
    // 五、帮助与初始化
    // =====================================================================

    window.cheatHelp = function () {
        console.log('%c[RPG 修改器] 右上角圆球点开即用；也可在控制台调用：\n' +
            '  cheatSetHp(9999)            全员生命\n' +
            '  cheatSetMp(9999)            全员魔法\n' +
            '  cheatSetAtk(9999)           全员攻击力\n' +
            '  cheatSetGold(999999)        金币\n' +
            '  cheatFillHp() / cheatFillMp()  回满生命 / 魔法\n' +
            '  cheatHightlightEventPos()   开启地图事件雷达\n' +
            '  cheatStopRadar()            关闭雷达\n' +
            '  cheatBattleVictory()        战斗中立即胜利\n' +
            '  cheatBattleDefeat()         战斗中立即战败',
            'color:#4fc3f7');
    };

    window.__CHEAT_READY = VERSION;

    function mountWhenBodyReady() {
        if (document.body) {
            buildUI();
        } else {
            document.addEventListener('DOMContentLoaded', buildUI, { once: true });
        }
    }

    mountWhenBodyReady();

    console.log('%c[RPG 修改器] 已注入 ' + location.href + '，右上角圆球可打开作弊面板',
        'color:#4fc3f7;font-weight:bold');
})();
