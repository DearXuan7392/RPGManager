// menu.js
const nwGui = require('nw.gui');
const { exec } = require('child_process');
const { superDecryptImage } = require('./imageDecoder.js');

let rightClickedGamePath = null;
let rightClickedGameName = null;

// 【核心状态锁】：标识当前是否正有解密任务在运行
let isDecrypting = false; 

// ==========================================
// 功能一：仅解密图片资产到原游戏目录下的 decrypt_img 文件夹
// ==========================================
function startImageDecryption(gamePath) {
    if (isDecrypting) return;

    const imgDir = nodePath.join(gamePath, 'img');
    const systemJsonPath = nodePath.join(gamePath, 'data', 'System.json');
    const decryptOutputDir = nodePath.join(gamePath, 'decrypt_img');

    if (!nodeFs.existsSync(imgDir)) {
        alert("未找到该游戏的 img 资源文件夹！");
        return;
    }

    let encryptionKey = null;
    if (nodeFs.existsSync(systemJsonPath)) {
        try {
            const systemData = JSON.parse(nodeFs.readFileSync(systemJsonPath, 'utf8'));
            if (systemData.hasEncryptedImages || systemData.encryptionKey) {
                encryptionKey = systemData.encryptionKey;
            }
        } catch (e) { console.error(e); }
    }

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

    const encryptedExts = ['.rpgmvp', '.rmmzmvp', '.png__', '.png_'];
    const hasEncryptedFiles = allFilesList.some(f => 
        encryptedExts.includes(nodePath.extname(f).toLowerCase())
    );

    if (!hasEncryptedFiles) {
        const cmd = process.platform === 'win32' ? 'explorer' : 'open';
        exec(`${cmd} "${imgDir}"`);
        return;
    }

    isDecrypting = true;

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

    function processNextFile() {
        if (currentIndex >= allFilesList.length) {
            setTimeout(() => {
                document.body.removeChild(overlay);
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
        if (encryptedExts.includes(ext)) {
            destFullPath = destFullPath.slice(0, -ext.length) + '.png';
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

        currentIndex++;
        const percent = Math.floor((currentIndex / allFilesList.length) * 100);
        barFill.style.width = `${percent}%`;
        barText.innerText = `当前进度：${percent}% (${currentIndex}/${allFilesList.length})`;

        setTimeout(processNextFile, 0);
    }
    processNextFile();
}

// ==========================================
// 功能二：解密完整游戏到新文件夹 (包含全部代码与资产，无缝游玩)
// ==========================================
function startFullGameDecryption(gamePath, gameName) {
    if (isDecrypting) return;

    // 定义全新的解密输出根目录 (原名加 -解密)
    const suffix = "-解密";
    const decryptGameOutputDir = gamePath.endsWith(nodePath.sep) 
        ? gamePath.slice(0, -1) + suffix 
        : gamePath + suffix;

    // 1. 获取解密密钥 (如果有的话)
    const systemJsonPath = nodePath.join(gamePath, 'data', 'System.json');
    let encryptionKey = null;
    let systemData = null;
    if (nodeFs.existsSync(systemJsonPath)) {
        try {
            systemData = JSON.parse(nodeFs.readFileSync(systemJsonPath, 'utf8'));
            if (systemData.encryptionKey) {
                encryptionKey = systemData.encryptionKey;
            }
        } catch (e) { console.error(e); }
    }

    // 2. ✨ 全盘深度扫描：获取原游戏文件夹下的“所有”文件（包括html, js, json等）
    const allFilesList = [];
    function scanAllFilesRecursively(dir) {
        if (!nodeFs.existsSync(dir)) return;
        const files = nodeFs.readdirSync(dir);
        files.forEach(file => {
            const fullPath = nodePath.join(dir, file);
            if (nodeFs.statSync(fullPath).isDirectory()) {
                scanAllFilesRecursively(fullPath);
            } else {
                allFilesList.push(fullPath);
            }
        });
    }
    scanAllFilesRecursively(gamePath);

    if (allFilesList.length === 0) {
        alert("未在游戏内检测到任何文件！");
        return;
    }

    isDecrypting = true;

    const overlay = document.createElement('div');
    overlay.className = 'decrypt-progress-overlay';
    overlay.innerHTML = `
        <div class="decrypt-progress-box">
            <div class="decrypt-progress-title">正在解密并克隆完整可玩游戏副本...</div>
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

    const encryptedExts = ['.rpgmvp', '.rmmzmvp', '.png__', '.png_', '.rpgmvo', '.rpgmvm'];

    function processNextFile() {
        if (currentIndex >= allFilesList.length) {
            // 所有文件克隆与解密映射结束，更新新文件夹内的 System.json 标记
            setTimeout(() => {
                const targetSystemJsonPath = nodePath.join(decryptGameOutputDir, 'data', 'System.json');
                modifySystemJsonFlag(targetSystemJsonPath, systemData);
                
                document.body.removeChild(overlay);
                isDecrypting = false; 

                // ✨ 依据要求：不弹出文件夹，直接执行 window.loadGameList() 刷新列表
                if (typeof window.loadGameList === 'function') {
                    window.loadGameList();
                }

                alert(`完整游戏解密完成！已作为独立解密版游戏克隆至同级目录。\n列表已自动更新。`);
            }, 500);
            return;
        }

        const srcFullPath = allFilesList[currentIndex];
        const relativePath = nodePath.relative(gamePath, srcFullPath);
        let destFullPath = nodePath.join(decryptGameOutputDir, relativePath);
        
        const ext = nodePath.extname(srcFullPath).toLowerCase();
        let isAudio = false;
        let shouldDecrypt = encryptedExts.includes(ext);

        if (shouldDecrypt) {
            if (['.rpgmvp', '.rmmzmvp', '.png__', '.png_'].includes(ext)) {
                destFullPath = destFullPath.slice(0, -ext.length) + '.png';
            } else if (ext === '.rpgmvo') {
                destFullPath = destFullPath.slice(0, -ext.length) + '.ogg';
                isAudio = true;
            } else if (ext === '.rpgmvm') {
                destFullPath = destFullPath.slice(0, -ext.length) + '.m4a';
                isAudio = true;
            }
        }

        const destDir = nodePath.dirname(destFullPath);
        if (!nodeFs.existsSync(destDir)) {
            nodeFs.mkdirSync(destDir, { recursive: true });
        }

        try {
            if (shouldDecrypt) {
                const fileBuffer = nodeFs.readFileSync(srcFullPath);
                let decryptedBuffer = superDecryptImage(fileBuffer, encryptionKey);

                // 音频纯净化：剪掉前 16 字节的加密外壳头，解决电脑端报错
                if (isAudio && decryptedBuffer.length > 16 && decryptedBuffer[0] === 0x52 && decryptedBuffer[1] === 0x50) {
                    decryptedBuffer = decryptedBuffer.slice(16);
                }

                nodeFs.writeFileSync(destFullPath, decryptedBuffer);
            } else {
                // html, js, json, css, 各种大图及基础文件直接无损克隆复制过去
                nodeFs.copyFileSync(srcFullPath, destFullPath);
            }
        } catch (err) {
            console.error(`克隆或转换文件失败: ${srcFullPath}`, err);
        }

        currentIndex++;
        const percent = Math.floor((currentIndex / allFilesList.length) * 100);
        barFill.style.width = `${percent}%`;
        barText.innerText = `当前进度：${percent}% (${currentIndex}/${allFilesList.length})`;

        setTimeout(processNextFile, 0);
    }

    processNextFile();
}

// 辅助函数：修改目标文件夹里的 System.json 彻底关掉加密配置
function modifySystemJsonFlag(systemJsonPath, currentData) {
    if (!nodeFs.existsSync(systemJsonPath)) return;
    try {
        const data = currentData || JSON.parse(nodeFs.readFileSync(systemJsonPath, 'utf8'));
        // 标记为未加密
        data.hasEncryptedImages = false;
        data.hasEncryptedAudio = false;
        nodeFs.writeFileSync(systemJsonPath, JSON.stringify(data, null, 4), 'utf8');
    } catch (e) {
        console.error("更新目标 System.json 失败:", e);
    }
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

// 实例化菜单项一：仅解密图片
const decryptImgItem = new nwGui.MenuItem({
    label: '解密全部图片资产',
    click: () => {
        if (!rightClickedGamePath) return;
        startImageDecryption(rightClickedGamePath);
    }
});
nativeMenu.append(decryptImgItem);

// 实例化菜单项二：解密独立完整游戏并刷新列表
const decryptFullGameItem = new nwGui.MenuItem({
    label: '解密完整游戏 (还原原始资产)',
    click: () => {
        if (!rightClickedGamePath) return;
        startFullGameDecryption(rightClickedGamePath, rightClickedGameName);
    }
});
nativeMenu.append(decryptFullGameItem);

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

    if (isDecrypting) {
        decryptImgItem.enabled = false;
        decryptFullGameItem.enabled = false;
        decryptFullGameItem.label = '游戏解密中 (请稍候...)';
    } else {
        decryptImgItem.enabled = true;
        decryptFullGameItem.enabled = true;
        decryptFullGameItem.label = '解密完整游戏 (还原原始资产)';
    }

    nativeMenu.popup(e.clientX, e.clientY);
}, false);