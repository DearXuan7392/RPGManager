const nodeFs = require('fs');
const nodePath = require('path');

// 标准 PNG 的前 16 字节固定文件头 (十六进制形式)
const PNG_STANDARD_HEADER = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52]);
// 官方 RPG Maker MV 加密的固定头部签名: "RPGMV\0\0\0"
const RPGMV_SIGNATURE = "5250474d56000000"; 

/**
 * RPG Maker 强力解密核心 (集成密钥解密与无密钥还原)
 * @param {Buffer} encryptedBuffer 原始文件流
 * @param {string} keyHex 32位十六进制密钥
 * @returns {Buffer} 修复/解密后的图片流
 */
function superDecryptImage(encryptedBuffer, keyHex) {
    const headerSize = 16;
    if (encryptedBuffer.length <= headerSize) return encryptedBuffer;

    // 提取文件前 16 字节的头部签名
    const fileHeaderHex = encryptedBuffer.slice(0, headerSize).toString('hex');
    const isStandardRpgmv = fileHeaderHex.startsWith(RPGMV_SIGNATURE);

    // ==========================================
    // 方案 A：有密钥，且文件符合官方加密签名，走标准异或解密
    // ==========================================
    if (keyHex && keyHex.length === 32 && isStandardRpgmv) {
        const keyArray = [];
        for (let i = 0; i < 16; i++) {
            keyArray.push(parseInt(keyHex.slice(i * 2, i * 2 + 2), 16));
        }

        const bodySize = encryptedBuffer.length - headerSize;
        const decryptedBuffer = Buffer.alloc(bodySize);

        // 仅对第17~32字节（即数据体前16字节）进行异或运算
        for (let i = 0; i < 16; i++) {
            decryptedBuffer[i] = encryptedBuffer[headerSize + i] ^ keyArray[i];
        }
        // 剩余数据直接复制
        encryptedBuffer.copy(decryptedBuffer, 16, headerSize + 16);
        return decryptedBuffer;
    }

    // ==========================================
    // 方案 B：无密钥、密钥失效，或属于魔改 `.png__`
    // 采用黑客恢复法：直接剥离前32字节，强行缝合标准PNG健康头
    // ==========================================
    if (isStandardRpgmv || encryptedBuffer[0] !== 0x89) {
        // 如果有官方头混淆，跳过混淆区
        const stripLen = isStandardRpgmv ? 32 : 16; 
        if (encryptedBuffer.length > stripLen) {
            const dataBody = encryptedBuffer.slice(stripLen);
            return Buffer.concat([PNG_STANDARD_HEADER, dataBody]);
        }
    }

    // 降级：如果本身就是健康的图片，原样返回
    return encryptedBuffer;
}

/**
 * 假装加载游戏主界面真正调用的背景图
 * @param {string} gamePath 
 */
function getTrueGameBackgroundImage(gamePath) {
    const systemJsonPath = nodePath.join(gamePath, 'data', 'System.json');
    const titlesDir = nodePath.join(gamePath, 'img', 'titles1');

    if (!nodeFs.existsSync(titlesDir)) return null;

    let title1Name = null;
    let encryptionKey = null;

    if (nodeFs.existsSync(systemJsonPath)) {
        try {
            const systemData = JSON.parse(nodeFs.readFileSync(systemJsonPath, 'utf8'));
            title1Name = systemData.title1Name;
            if (systemData.hasEncryptedImages || systemData.encryptionKey) {
                encryptionKey = systemData.encryptionKey;
            }
        } catch (e) {
            console.error("[解密器] 读取System.json异常:", e);
        }
    }

    const exts = ['.rpgmvp', '.rmmzmvp', '.png__', '.png_', '.png', '.jpg'];
    let finalFilePath = null;

    if (title1Name) {
        for (let ext of exts) {
            const testPath = nodePath.join(titlesDir, title1Name + ext);
            if (nodeFs.existsSync(testPath)) {
                finalFilePath = testPath;
                break;
            }
        }
    }

    // 盲搜降级
    if (!finalFilePath) {
        try {
            const files = nodeFs.readdirSync(titlesDir);
            const targetFile = files.find(f => exts.some(ext => f.toLowerCase().endsWith(ext)));
            if (targetFile) finalFilePath = nodePath.join(titlesDir, targetFile);
        } catch (e) { return null; }
    }

    if (!finalFilePath) return null;
    const extName = nodePath.extname(finalFilePath).toLowerCase();

    try {
        // 只要不是纯净的正常图片，一律推入超强内存解密器中清洗
        if (extName !== '.png' && extName !== '.jpg') {
            const encryptedBuffer = nodeFs.readFileSync(finalFilePath);
            const rawBuffer = superDecryptImage(encryptedBuffer, encryptionKey);
            return `data:image/png;base64,${rawBuffer.toString('base64')}`;
        }
        // 正常图片走本地原生路径加载
        return 'file:///' + finalFilePath.replace(/\\/g, '/');
    } catch (err) {
        console.error(`[解密器] 核心清洗发生致命错误:`, err);
        return null;
    }
}

module.exports = { getTrueGameBackgroundImage, superDecryptImage };