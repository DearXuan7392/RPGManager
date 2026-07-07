const GAMES_DIR = nodePath.join(process.cwd(), 'games');
const gameListContainer = document.getElementById('game-list');

function launchGame(gamePath) {
    const saveDirPath = nodePath.resolve(gamePath, 'save');
    if (!nodeFs.existsSync(saveDirPath)) {
        nodeFs.mkdirSync(saveDirPath);
    }
    process.chdir(gamePath);
    process.mainModule.filename = nodePath.resolve(gamePath, 'index.html');
    process.execPath = nodePath.resolve(gamePath, 'nw.exe');
    injectFsInterceptor(window, saveDirPath);

    const indexHtmlPath = 'file:///' + nodePath.resolve(gamePath, 'index.html').replace(/\\/g, '/');
    console.log("[启动器] 正在当前窗口直接加载游戏: " + indexHtmlPath);
    window.location.href = indexHtmlPath;
}

function scanGames() {
    if (!nodeFs.existsSync(GAMES_DIR)) {
        nodeFs.mkdirSync(GAMES_DIR);
    }

    const files = nodeFs.readdirSync(GAMES_DIR);
    let hasGame = false;
    gameListContainer.innerHTML = '';

    files.forEach(file => {
        const gamePath = nodePath.join(GAMES_DIR, file);
        const isDir = nodeFs.statSync(gamePath).isDirectory();

        if (isDir && nodeFs.existsSync(nodePath.join(gamePath, 'index.html'))) {
            hasGame = true;
            createGameCard(file, gamePath);
        }
    });

    if (!hasGame) {
        gameListContainer.innerHTML = '<p id="no-games">未在 games 文件夹下找到有效的 RPG Maker 游戏 (目录需包含 index.html)</p>';
    }
}

scanGames();