// menu.js
const nwGui = require('nw.gui');
const { exec } = require('child_process');
const { superDecryptImage } = require('./imageDecoder.js');

let rightClickedGamePath = null;
let rightClickedGameName = null;

// 【核心状态锁】：标识当前是否正有解密任务在运行
let isDecrypting = false; 

// ==========================================
// 核心逻辑：带状态锁与图形进度条的解密引擎
// ==========================================
function startImageDecryption(gamePath) {
    // 防御性拦截：如果已经在解密中，直接拒绝
    if (isDecrypting) return;

    const imgDir = nodePath.join(gamePath, 'img');
    const systemJsonPath = nodePath.join(gamePath, 'data', 'System.json');
    const decryptOutputDir = nodePath.join(gamePath, 'img_decrypt');

    if (!nodeFs.existsSync(imgDir)) {
        alert("未找到该游戏的 img 资源文件夹！");
        return;
    }

    // 1. 获取解密密钥 (如果有的话)
    let encryptionKey = null;
    if (nodeFs.existsSync(systemJsonPath)) {
        try {
            const systemData = JSON.parse(nodeFs.readFileSync(systemJsonPath, 'utf8'));
            if (systemData.hasEncryptedImages || systemData.encryptionKey) {
                encryptionKey = systemData.encryptionKey;
            }
        } catch (e) { console.error(e); }
    }

    // 2. 深度优先搜索：获取所有文件的路径列表
    const allFilesList = [];
    function getAllFiles(dir) {
        const files = nodeFs.readdirSync(dir);
        files.forEach(file => {
            const fullPath = nodePath.join(dir, file);
            if (nodeFs.statSync(fullPath).isDirectory()) {
                getAllFiles(fullPath);
            } else {
                allFilesList.push(fullPath);
            }
        });
    }
    getAllFiles(imgDir);

    // 3. 判断是否整包都是健康未加密文件
    const encryptedExts = ['.rpgmvp', '.rmmzmvp', '.png__', '.png_'];
    const hasEncryptedFiles = allFilesList.some(f => 
        encryptedExts.includes(nodePath.extname(f).toLowerCase())
    );

    // 4. 如果本身没加密，直接打开原 img 文件夹
    if (!hasEncryptedFiles) {
        const cmd = process.platform === 'win32' ? 'explorer' : 'open';
        exec(`${cmd} "${imgDir}"`);
        return;
    }

    // 设置状态锁：进入解密状态
    isDecrypting = true;

    // 5. 创建动态图形进度条 UI 容器
    const overlay = document.createElement('div');
    overlay.className = 'decrypt-progress-overlay';
    overlay.innerHTML = `
        <div class="decrypt-progress-box">
            <div class="decrypt-progress-title">正在解密游戏图像资产...</div>
            <div class="decrypt-progress-bar-bg">
                <div id="decrypt-bar-fill" class="decrypt-progress-bar-fill"></div>
            </div>
            <div id="decrypt-bar-text" class="decrypt-progress-text">正在初始化列表... (0/${allFilesList.length})</div>
        </div>
    `;
    document.body.appendChild(overlay);

    const barFill = document.getElementById('decrypt-bar-fill');
    const barText = document.getElementById('decrypt-bar-text');

    let currentIndex = 0;

    // 6. 异步分批迭代处理（防止卡死渲染进程）
    function processNextFile() {
        if (currentIndex >= allFilesList.length) {
            // 解密任务彻底完成
            setTimeout(() => {
                document.body.removeChild(overlay);
                
                // 解锁状态：允许接收下一个任务
                isDecrypting = false; 

                const cmd = process.platform === 'win32' ? 'explorer' : 'open';
                exec(`${cmd} "${decryptOutputDir}"`);
            }, 500);
            return;
        }

        const srcFullPath = allFilesList[currentIndex];
        const relativePath = nodePath.relative(imgDir, srcFullPath);
        let destFullPath = nodePath.join(decryptOutputDir, relativePath);
        
        const ext = nodePath.extname(srcFullPath).toLowerCase();
        if (ext === '.rpgmvp' || ext === '.png__' || ext === '.png_') {
            destFullPath = destFullPath.slice(0, -ext.length) + '.png';
        } else if (ext === '.rpgmvo') {
            destFullPath = destFullPath.slice(0, -ext.length) + '.ogg';
        }

        const destDir = nodePath.dirname(destFullPath);
        if (!nodeFs.existsSync(destDir)) {
            nodeFs.mkdirSync(destDir, { recursive: true });
        }

        try {
            const fileBuffer = nodeFs.readFileSync(srcFullPath);
            if (encryptedExts.includes(ext) || fileBuffer[0] !== 0x89) {
                const decryptedBuffer = superDecryptImage(fileBuffer, encryptionKey);
                nodeFs.writeFileSync(destFullPath, decryptedBuffer);
            } else {
                nodeFs.copyFileSync(srcFullPath, destFullPath);
            }
        } catch (err) {
            console.error(`解密单张失败: ${srcFullPath}`, err);
        }

        // 步进并动态更新渲染图形进度条
        currentIndex++;
        const percent = Math.floor((currentIndex / allFilesList.length) * 100);
        barFill.style.width = `${percent}%`;
        barText.innerText = `当前进度：${percent}% (${currentIndex}/${allFilesList.length})`;

        // 交还主线程，下一帧继续
        setTimeout(processNextFile, 0);
    }

    // 开始迭代
    processNextFile();
}

// 存档自动备份辅助函数
function backupSaveFiles(gamePath) {
    const savePath = nodePath.join(gamePath, 'save');
    if (!nodeFs.existsSync(savePath)) {
        nodeFs.mkdirSync(savePath);
        return;
    }
    try {
        const files = nodeFs.readdirSync(savePath);
        const targetFiles = files.filter(f => f.toLowerCase().endsWith('.rpgsave') && !f.includes('.backup_'));
        if (targetFiles.length === 0) return;

        const now = new Date();
        const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
        
        targetFiles.forEach(file => {
            nodeFs.copyFileSync(nodePath.join(savePath, file), nodePath.join(savePath, `${file}.backup_${timestamp}`));
        });
    } catch (e) { console.error("备份失败:", e); }
}

// ==========================================
// NW.js 原生上下文菜单配置
// ==========================================
const nativeMenu = new nwGui.Menu();

nativeMenu.append(new nwGui.MenuItem({
    label: '打开文件夹',
    click: () => {
        if (!rightClickedGamePath) return;
        const cmd = process.platform === 'win32' ? 'explorer' : 'open';
        exec(`${cmd} "${rightClickedGamePath}"`);
    }
}));

nativeMenu.append(new nwGui.MenuItem({
    label: '打开存档',
    click: () => {
        if (!rightClickedGamePath) return;
        const savePath = nodePath.join(rightClickedGamePath, 'save');
        if (!nodeFs.existsSync(savePath)) nodeFs.mkdirSync(savePath);
        const cmd = process.platform === 'win32' ? 'explorer' : 'open';
        exec(`${cmd} "${savePath}"`);
    }
}));

nativeMenu.append(new nwGui.MenuItem({ type: 'separator' }));

// 实例化菜单时先声明一个引用，方便后续动态修改它的可用状态
const decryptMenuItem = new nwGui.MenuItem({
    label: '解密全部图片资产',
    click: () => {
        if (!rightClickedGamePath) return;
        startImageDecryption(rightClickedGamePath);
    }
});
nativeMenu.append(decryptMenuItem);

nativeMenu.append(new nwGui.MenuItem({
    label: '编辑存档 (在线)',
    click: () => {
        if (!rightClickedGamePath) return;
        backupSaveFiles(rightClickedGamePath);
        const savePath = nodePath.join(rightClickedGamePath, 'save');
        const folderCmd = process.platform === 'win32' ? 'explorer' : 'open';
        exec(`${folderCmd} "${savePath}"`);
        nwGui.Shell.openExternal('https://saveeditor.online/');
    }
}));

// 右键事件监听
document.getElementById('game-list').addEventListener('contextmenu', (e) => {
    const card = e.target.closest('.game-card');
    if (!card) return;
    e.preventDefault();

    rightClickedGamePath = card.dataset.gamePath;
    rightClickedGameName = card.dataset.gameName;

    // 【核心动态菜单拦截】：
    // 如果当前有任务正在解密，将右键菜单中的“解密”按钮置灰（Disabled）
    // 防止用户右键其他卡片或重复点击启动新任务
    if (isDecrypting) {
        decryptMenuItem.enabled = false;
        decryptMenuItem.label = '解密资产中 (请稍候...)';
    } else {
        decryptMenuItem.enabled = true;
        decryptMenuItem.label = '解密全部图片资产';
    }

    nativeMenu.popup(e.clientX, e.clientY);
}, false);