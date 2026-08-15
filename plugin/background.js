// 右键菜单 + 自动保存
// 保存流程：先从 GitHub 拉取最新 bookmarks.json，追加书签后带最新 sha 提交，
// 避免用过期的本地缓存上传导致 409 冲突，或覆盖其他端的新书签。

// 创建右键菜单
chrome.runtime.onInstalled.addListener(() => {
    updateContextMenuCategories();
});

// 处理右键菜单点击事件
chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "addToBookmarks" || info.menuItemId === "createNewCategory") {
        // 打开插件弹窗
        chrome.action.openPopup();
    } else if (info.menuItemId.startsWith("category_")) {
        // 获取分类名称
        const category = info.menuItemId.replace("category_", "");

        // 使用该分类保存书签
        saveBookmarkWithCategory(tab, category, info.linkUrl);
    }
});

// 更新右键菜单中的分类
function updateContextMenuCategories() {
    // 清除所有现有子菜单
    chrome.contextMenus.removeAll(() => {
        // 重新创建父菜单
        chrome.contextMenus.create({
            id: "addToBookmarks",
            title: "添加到书签管理器",
            contexts: ["page", "link"]
        });

        // 从存储中获取书签数据
        chrome.storage.local.get('bookmarksData', (data) => {
            if (data.bookmarksData) {
                // 为每个分类创建子菜单
                Object.keys(data.bookmarksData).forEach(category => {
                    chrome.contextMenus.create({
                        id: "category_" + category,
                        parentId: "addToBookmarks",
                        title: category,
                        contexts: ["page", "link"]
                    });
                });

                // 添加"创建新分类"菜单项
                chrome.contextMenus.create({
                    id: "createNewCategory",
                    parentId: "addToBookmarks",
                    title: "创建新分类...",
                    contexts: ["page", "link"]
                });
            }
        });
    });
}

// 当书签数据更新时，刷新右键菜单
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.bookmarksData) {
        updateContextMenuCategories();
    }
});

// 使用指定分类保存书签：先拉取远端最新数据，追加并上传
function saveBookmarkWithCategory(tab, category, linkUrl = null) {
    // 获取要保存的URL和标题
    const url = linkUrl || tab.url;
    const title = tab.title;

    // 直接用拉取返回的数据（保持文件中的分类顺序），
    // 不再经 storage 读回，避免 chrome.storage 重排对象键顺序
    fetchLatestFromGitHub()
        .then(({ bookmarksData: latest, fileSha }) => {
            const bookmarksData = latest;

            // 确保分类存在
            if (!bookmarksData[category]) {
                bookmarksData[category] = [];
            }

            // 创建新书签对象
            const newBookmark = {
                id: Date.now().toString(36) + Math.random().toString(36).substr(2),
                title: title,
                url: url,
                description: "",
                addedAt: new Date().toISOString()
            };

            // 添加到相应分类
            bookmarksData[category].push(newBookmark);

            // 同步到本地缓存后上传
            return new Promise(resolve => {
                chrome.storage.local.set({ bookmarksData: bookmarksData }, () => {
                    resolve({ bookmarksData, fileSha });
                });
            });
        })
        .then(({ bookmarksData, fileSha }) =>
            uploadToGitHub(bookmarksData, fileSha, { category, title }))
        .catch(error => {
            console.error('保存书签失败:', error);
            notifyResult(false, error.message);
        });
}

// 从 GitHub 拉取最新书签数据，刷新本地缓存与 sha，并把最新数据返回给调用方。
// 渲染与上传必须用返回值：chrome.storage 存取会重排对象键顺序。
// 文件不存在(404)时回退本地缓存数据。
function fetchLatestFromGitHub() {
    return new Promise((resolve, reject) => {
        chrome.storage.sync.get(['githubRepo', 'githubToken', 'jsonPath'], (settings) => {
            if (!settings.githubRepo || !settings.githubToken || !settings.jsonPath) {
                reject(new Error('请先在插件弹窗的“设置”页配置 GitHub 信息'));
                return;
            }

            const [owner, repo] = settings.githubRepo.split('/');

            fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${settings.jsonPath}`, {
                headers: {
                    'Authorization': `token ${settings.githubToken}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            })
                .then(response => {
                    if (response.status === 200) return response.json();
                    if (response.status === 404) return null;
                    return response.json().then(d => {
                        throw new Error(d.message || `GitHub API返回错误: ${response.status}`);
                    });
                })
                .then(fileData => {
                    if (!fileData) {
                        // 文件不存在：回退本地缓存
                        chrome.storage.local.get(['bookmarksData', 'fileSha'], (local) => {
                            resolve({
                                bookmarksData: local.bookmarksData || {},
                                fileSha: local.fileSha
                            });
                        });
                        return;
                    }
                    try {
                        const bookmarksData = JSON.parse(
                            b64_to_utf8(fileData.content.replace(/\n/g, '')));
                        // 缓存仅供兜底，渲染与上传一律用返回值
                        chrome.storage.local.set({
                            bookmarksData: bookmarksData,
                            fileSha: fileData.sha
                        }, () => resolve({ bookmarksData, fileSha: fileData.sha }));
                    } catch (e) {
                        reject(new Error('解析远端书签数据失败'));
                    }
                })
                .catch(reject);
        });
    });
}

// 上传到 GitHub，成功/失败都通过系统通知明确告知
function uploadToGitHub(bookmarksData, fileSha, meta = {}) {
    return new Promise((resolve, reject) => {
        chrome.storage.sync.get(['githubRepo', 'githubToken', 'jsonPath'], (settings) => {
            if (!settings.githubRepo || !settings.githubToken || !settings.jsonPath) {
                reject(new Error('请先在插件弹窗的“设置”页配置 GitHub 信息'));
                return;
            }

            const [owner, repo] = settings.githubRepo.split('/');
            const content = utf8_to_b64(JSON.stringify(bookmarksData, null, 2)); // Base64编码

            const requestBody = {
                message: '添加新书签',
                content: content
            };

            // 如果有SHA，添加到请求中
            if (fileSha) {
                requestBody.sha = fileSha;
            }

            fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${settings.jsonPath}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `token ${settings.githubToken}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            })
                .then(response => response.json().then(data => ({ status: response.status, data })))
                .then(({ status, data }) => {
                    if (data.content) {
                        // 更新本地保存的SHA
                        chrome.storage.local.set({ fileSha: data.content.sha });
                        resolve();
                        notifyResult(true, `已将“${meta.title || ''}”添加到“${meta.category || ''}”分类`);
                    } else if (status === 409 || (data.message && /sha/i.test(data.message))) {
                        reject(new Error('远端文件已更新，请再次点击菜单重试'));
                    } else if (status === 401 || status === 403) {
                        reject(new Error('Token 无效或权限不足'));
                    } else {
                        reject(new Error(data.message || `上传失败: ${status}`));
                    }
                })
                .catch(reject);
        });
    });
}

// 保存结果通知：失败时同样弹出，避免误以为已保存
function notifyResult(success, message) {
    chrome.notifications.create({
        type: 'basic',
        iconUrl: 'images/icon128.png',
        title: success ? '书签已保存' : '书签保存失败',
        message: message
    });
}

function utf8_to_b64(str) {
    return btoa(unescape(encodeURIComponent(str)));
}

function b64_to_utf8(str) {
    return decodeURIComponent(escape(atob(str)));
}
