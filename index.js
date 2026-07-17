// 书签数据（访客从本地 json 加载；管理员从 GitHub 加载）
let bookmarksData = {};

// 管理员会话状态
let isAdmin = false;
let passwordOk = false;
let dirty = false;
let fileSha = null;
let serverSnapshot = null;
let adminConfig = {
    repo: '',
    token: '',
    jsonPath: 'bookmarks.json'
};
let searchActive = false;
let dragState = { category: null, id: null };

const LS_KEYS = {
    repo: 'bookmarkAdmin.repo',
    token: 'bookmarkAdmin.token',
    jsonPath: 'bookmarkAdmin.jsonPath',
    email: 'bookmarkAdmin.email'
};

const LOGIN_URL = 'https://ssl.xiaoying.org.cn/login';

// ---------- 工具 ----------

function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function utf8_to_b64(str) {
    return btoa(unescape(encodeURIComponent(str)));
}

function b64_to_utf8(str) {
    return decodeURIComponent(escape(atob(str)));
}

function parseRepo(repo) {
    const parts = (repo || '').trim().split('/').filter(Boolean);
    if (parts.length !== 2) return null;
    return { owner: parts[0], name: parts[1] };
}

// ---------- 加载与渲染 ----------

async function loadBookmarks() {
    try {
        const response = await fetch('bookmarks.json');
        bookmarksData = await response.json();
        renderBookmarks();
        renderCategoryNav();
    } catch (error) {
        console.error('加载书签失败:', error);
    }
}

function renderBookmarks(data = bookmarksData) {
    const container = document.getElementById('bookmarks-container');
    container.innerHTML = '';

    const keys = Object.keys(data).filter(k => data[k] && data[k].length > 0);

    if (keys.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i>📚</i>
                <h2>没有找到书签</h2>
                <p>${isAdmin ? '点击右下角「+」添加书签' : '暂无书签'}</p>
            </div>
        `;
        return;
    }

    keys.forEach(category => {
        const bookmarks = data[category];
        const section = document.createElement('section');
        section.classList.add('category-section');
        section.id = `category-${category}`;

        const header = document.createElement('div');
        header.className = 'category-header';
        header.innerHTML = `
            <h2>${escapeHtml(category)}</h2>
            <span class="count">${bookmarks.length}</span>
        `;
        if (isAdmin) {
            const addBtn = document.createElement('button');
            addBtn.type = 'button';
            addBtn.className = 'add-in-category';
            addBtn.textContent = '+ 添加';
            addBtn.addEventListener('click', () => openBookmarkModal({ category }));
            header.appendChild(addBtn);
        }
        section.appendChild(header);

        const grid = document.createElement('div');
        grid.className = 'bookmarks-grid';
        grid.dataset.category = category;
        grid.id = `grid-${category}`;

        bookmarks.forEach(bookmark => {
            grid.appendChild(createBookmarkCard(bookmark, category));
        });

        section.appendChild(grid);
        container.appendChild(section);

        if (isAdmin && !searchActive) {
            setupGridDrag(grid, category);
        }
    });
}

function createBookmarkCard(bookmark, category) {
    const card = document.createElement('div');
    card.classList.add('bookmark-card');
    card.dataset.id = bookmark.id;
    card.dataset.category = category;

    const handle = document.createElement('span');
    handle.className = 'drag-handle';
    handle.title = '拖动排序';
    handle.innerHTML = '<i class="fas fa-grip-vertical"></i>';
    card.appendChild(handle);

    const title = document.createElement('h3');
    title.textContent = bookmark.title || '';
    card.appendChild(title);

    const desc = document.createElement('p');
    desc.textContent = bookmark.description || '没有描述';
    card.appendChild(desc);

    const link = document.createElement('a');
    link.href = bookmark.url || '#';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = '访问';
    card.appendChild(link);

    const actions = document.createElement('div');
    actions.className = 'card-actions';
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.textContent = '编辑';
    editBtn.addEventListener('click', (e) => {
        e.preventDefault();
        openBookmarkModal({
            id: bookmark.id,
            title: bookmark.title,
            url: bookmark.url,
            description: bookmark.description || '',
            category
        });
    });
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'delete';
    delBtn.textContent = '删除';
    delBtn.addEventListener('click', (e) => {
        e.preventDefault();
        deleteBookmark(bookmark.id, category);
    });
    actions.appendChild(editBtn);
    actions.appendChild(delBtn);
    card.appendChild(actions);

    return card;
}

function renderCategoryNav() {
    const nav = document.getElementById('category-nav');
    nav.innerHTML = '';

    Object.keys(bookmarksData).forEach(category => {
        if (!bookmarksData[category] || bookmarksData[category].length === 0) return;

        const button = document.createElement('button');
        button.textContent = category;
        button.addEventListener('click', () => {
            scrollToCategory(category);
            document.querySelectorAll('.category-nav button').forEach(btn => {
                btn.classList.remove('active');
            });
            button.classList.add('active');
        });
        nav.appendChild(button);
    });
}

function scrollToCategory(category) {
    const element = document.getElementById(`category-${category}`);
    if (element) {
        window.scrollTo({
            top: element.offsetTop - (isAdmin ? 70 : 20),
            behavior: 'smooth'
        });
    }
}

function searchBookmarks(query) {
    query = (query || '').toLowerCase().trim();
    searchActive = !!query;
    document.body.classList.toggle('searching', searchActive);

    if (!query) {
        renderBookmarks();
        return;
    }

    const results = {};

    Object.keys(bookmarksData).forEach(category => {
        if (category.toLowerCase().includes(query)) {
            results[category] = bookmarksData[category];
            return;
        }

        const matchedBookmarks = bookmarksData[category].filter(bookmark =>
            (bookmark.title && bookmark.title.toLowerCase().includes(query)) ||
            (bookmark.description && bookmark.description.toLowerCase().includes(query)) ||
            (bookmark.url && bookmark.url.toLowerCase().includes(query))
        );

        if (matchedBookmarks.length > 0) {
            results[category] = matchedBookmarks;
        }
    });

    renderBookmarks(results);
}

// ---------- 拖拽排序（同分类） ----------

function setupGridDrag(grid, category) {
    let dragged = null;

    grid.querySelectorAll('.bookmark-card').forEach(card => {
        card.draggable = true;

        card.addEventListener('dragstart', (e) => {
            if (searchActive || !isAdmin) {
                e.preventDefault();
                return;
            }
            dragged = card;
            dragState = { category, id: card.dataset.id };
            card.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', card.dataset.id);
        });

        card.addEventListener('dragend', () => {
            card.classList.remove('dragging');
            dragged = null;
            applyOrderFromDom(category);
        });

        card.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (!dragged || dragged === card) return;
            if (card.dataset.category !== category) return;

            const rect = card.getBoundingClientRect();
            const midY = rect.top + rect.height / 2;
            if (e.clientY < midY) {
                grid.insertBefore(dragged, card);
            } else {
                grid.insertBefore(dragged, card.nextSibling);
            }
        });
    });

    grid.addEventListener('dragover', (e) => e.preventDefault());
    grid.addEventListener('drop', (e) => e.preventDefault());
}

function applyOrderFromDom(category) {
    const grid = document.getElementById(`grid-${category}`);
    if (!grid || !bookmarksData[category]) return;

    const ids = Array.from(grid.querySelectorAll('.bookmark-card')).map(c => c.dataset.id);
    const map = new Map(bookmarksData[category].map(b => [b.id, b]));
    const reordered = ids.map(id => map.get(id)).filter(Boolean);

    // 保留 DOM 中未出现的（理论上没有）
    if (reordered.length !== bookmarksData[category].length) {
        bookmarksData[category].forEach(b => {
            if (!ids.includes(b.id)) reordered.push(b);
        });
    }

    const prev = JSON.stringify(bookmarksData[category].map(b => b.id));
    const next = JSON.stringify(reordered.map(b => b.id));
    if (prev !== next) {
        bookmarksData[category] = reordered;
        markDirty();
    }
}

// ---------- Dirty / 编辑模式 UI ----------

function markDirty() {
    dirty = true;
    updateDirtyUI();
}

function clearDirty() {
    dirty = false;
    updateDirtyUI();
}

function updateDirtyUI() {
    const badge = document.getElementById('dirty-badge');
    if (badge) badge.classList.toggle('show', dirty);
    const commitBtn = document.getElementById('commit-btn');
    if (commitBtn) commitBtn.disabled = !dirty;
}

function enterAdminMode() {
    isAdmin = true;
    document.body.classList.add('admin-mode');
    document.getElementById('admin-bar').classList.add('visible');
    document.getElementById('admin-btn').style.display = 'none';
    // 清除搜索，避免在过滤视图上排序
    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.value = '';
    searchActive = false;
    document.body.classList.remove('searching');
    renderBookmarks();
    renderCategoryNav();
    updateDirtyUI();
}

function exitAdminMode() {
    isAdmin = false;
    passwordOk = false;
    document.body.classList.remove('admin-mode');
    document.getElementById('admin-bar').classList.remove('visible');
    document.getElementById('admin-btn').style.display = '';
    clearDirty();
    fileSha = null;
    serverSnapshot = null;
    loadBookmarks();
}

// ---------- 登录 ----------

function openLoginModal() {
    passwordOk = false;
    showLoginStep(1);
    setModalStatus('login-step1-status', '', '');
    setModalStatus('login-step2-status', '', '');
    document.getElementById('login-password').value = '';

    const email = localStorage.getItem(LS_KEYS.email) || '';
    document.getElementById('login-email').value = email;

    document.getElementById('github-repo').value =
        localStorage.getItem(LS_KEYS.repo) || 'liyao52033/bookmark';
    document.getElementById('github-token').value =
        localStorage.getItem(LS_KEYS.token) || '';
    document.getElementById('json-path').value =
        localStorage.getItem(LS_KEYS.jsonPath) || 'bookmarks.json';

    document.getElementById('login-modal').classList.add('visible');
}

function closeLoginModal() {
    document.getElementById('login-modal').classList.remove('visible');
    passwordOk = false;
    document.getElementById('login-password').value = '';
}

function showLoginStep(step) {
    document.getElementById('login-step-1').classList.toggle('active', step === 1);
    document.getElementById('login-step-2').classList.toggle('active', step === 2);
}

function setModalStatus(id, type, message) {
    const el = document.getElementById(id);
    if (!el) return;
    el.className = 'modal-status' + (type ? ' ' + type : '');
    el.textContent = message || '';
}

async function handleRemoteLogin() {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    if (!email || !password) {
        setModalStatus('login-step1-status', 'error', '请输入邮箱和密码');
        return;
    }

    setModalStatus('login-step1-status', 'loading', '正在登录...');
    const btn = document.getElementById('login-step1-btn');
    btn.disabled = true;

    try {
        const response = await fetch(LOGIN_URL, {
            method: 'POST',
            headers: {
                'Accept': '*/*',
                'Content-Type': 'text/plain;charset=UTF-8'
            },
            body: JSON.stringify({ email, password }),
            mode: 'cors',
            credentials: 'include'
        });

        let data = null;
        try {
            data = await response.json();
        } catch (_) {
            data = null;
        }

        if (!response.ok) {
            const msg = (data && data.error) ? data.error : `登录失败 (${response.status})`;
            setModalStatus('login-step1-status', 'error', msg);
            return;
        }

        if (!data || (!data.user && !data.session)) {
            setModalStatus('login-step1-status', 'error', '登录响应异常');
            return;
        }

        passwordOk = true;
        try {
            localStorage.setItem(LS_KEYS.email, email);
        } catch (_) { /* ignore */ }

        document.getElementById('login-password').value = '';
        setModalStatus('login-step1-status', 'success', '登录成功');
        showLoginStep(2);
        setModalStatus('login-step2-status', '', '');
    } catch (err) {
        console.error(err);
        setModalStatus('login-step1-status', 'error', `网络错误: ${err.message}`);
    } finally {
        btn.disabled = false;
    }
}

async function handleGitHubLogin() {
    if (!passwordOk) {
        setModalStatus('login-step2-status', 'error', '请先完成账号登录');
        showLoginStep(1);
        return;
    }

    const repo = document.getElementById('github-repo').value.trim();
    const token = document.getElementById('github-token').value.trim();
    const jsonPath = (document.getElementById('json-path').value.trim() || 'bookmarks.json');

    if (!repo || !token) {
        setModalStatus('login-step2-status', 'error', '请填写仓库和 Token');
        return;
    }

    const parsed = parseRepo(repo);
    if (!parsed) {
        setModalStatus('login-step2-status', 'error', '仓库格式应为 owner/repo');
        return;
    }

    setModalStatus('login-step2-status', 'loading', '正在连接 GitHub...');
    const btn = document.getElementById('login-step2-btn');
    btn.disabled = true;

    try {
        const url = `https://api.github.com/repos/${parsed.owner}/${parsed.name}/contents/${jsonPath}`;
        const response = await fetch(url, {
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });

        if (!response.ok) {
            let msg = `GitHub 错误: ${response.status}`;
            try {
                const errBody = await response.json();
                if (errBody.message) msg = errBody.message;
            } catch (_) { /* ignore */ }
            setModalStatus('login-step2-status', 'error', msg);
            return;
        }

        const fileData = await response.json();
        const content = b64_to_utf8(fileData.content.replace(/\n/g, ''));
        const parsedJson = JSON.parse(content);

        bookmarksData = parsedJson;
        fileSha = fileData.sha;
        serverSnapshot = deepClone(parsedJson);
        adminConfig = { repo, token, jsonPath };
        clearDirty();

        try {
            localStorage.setItem(LS_KEYS.repo, repo);
            localStorage.setItem(LS_KEYS.token, token);
            localStorage.setItem(LS_KEYS.jsonPath, jsonPath);
        } catch (_) { /* ignore */ }

        closeLoginModal();
        enterAdminMode();
    } catch (err) {
        console.error(err);
        setModalStatus('login-step2-status', 'error', `连接失败: ${err.message}`);
    } finally {
        btn.disabled = false;
    }
}

// ---------- 书签 CRUD（仅内存） ----------

function openBookmarkModal(pref = {}) {
    if (!isAdmin) return;

    document.getElementById('bookmark-modal-title').textContent =
        pref.id ? '编辑书签' : '添加书签';
    document.getElementById('bm-id').value = pref.id || '';
    document.getElementById('bm-original-category').value = pref.category || '';
    document.getElementById('bm-title').value = pref.title || '';
    document.getElementById('bm-url').value = pref.url || '';
    document.getElementById('bm-description').value = pref.description || '';
    document.getElementById('bm-category').value = pref.category || '';

    const list = document.getElementById('category-list');
    list.innerHTML = '';
    Object.keys(bookmarksData).forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat;
        list.appendChild(opt);
    });

    setModalStatus('bm-status', '', '');
    document.getElementById('bookmark-modal').classList.add('visible');
}

function closeBookmarkModal() {
    document.getElementById('bookmark-modal').classList.remove('visible');
}

function saveBookmarkFromModal() {
    const id = document.getElementById('bm-id').value;
    const originalCategory = document.getElementById('bm-original-category').value;
    const title = document.getElementById('bm-title').value.trim();
    const url = document.getElementById('bm-url').value.trim();
    const description = document.getElementById('bm-description').value.trim();
    const category = document.getElementById('bm-category').value.trim();

    if (!title) {
        setModalStatus('bm-status', 'error', '请输入标题');
        return;
    }
    if (!url) {
        setModalStatus('bm-status', 'error', '请输入 URL');
        return;
    }
    if (!category) {
        setModalStatus('bm-status', 'error', '请输入分类');
        return;
    }

    if (!bookmarksData[category]) {
        bookmarksData[category] = [];
    }

    if (id) {
        // 编辑：同分类原地更新；换分类则移除再追加
        let found = null;
        let fromCat = originalCategory;
        let fromIdx = -1;

        if (fromCat && bookmarksData[fromCat]) {
            fromIdx = bookmarksData[fromCat].findIndex(b => b.id === id);
            if (fromIdx !== -1) found = bookmarksData[fromCat][fromIdx];
        }

        if (!found) {
            for (const cat of Object.keys(bookmarksData)) {
                const idx = bookmarksData[cat].findIndex(b => b.id === id);
                if (idx !== -1) {
                    found = bookmarksData[cat][idx];
                    fromCat = cat;
                    fromIdx = idx;
                    break;
                }
            }
        }

        const updated = {
            ...(found || {}),
            id,
            title,
            url,
            description,
            addedAt: (found && found.addedAt) || new Date().toISOString()
        };

        if (fromCat === category && fromIdx !== -1 && bookmarksData[category]) {
            bookmarksData[category][fromIdx] = updated;
        } else {
            if (fromCat && fromIdx !== -1 && bookmarksData[fromCat]) {
                bookmarksData[fromCat].splice(fromIdx, 1);
                if (bookmarksData[fromCat].length === 0) delete bookmarksData[fromCat];
            }
            if (!bookmarksData[category]) bookmarksData[category] = [];
            bookmarksData[category].push(updated);
        }
    } else {
        bookmarksData[category].push({
            id: generateId(),
            title,
            url,
            description,
            addedAt: new Date().toISOString()
        });
    }

    markDirty();
    closeBookmarkModal();
    searchActive = false;
    document.body.classList.remove('searching');
    document.getElementById('search-input').value = '';
    renderBookmarks();
    renderCategoryNav();
}

function deleteBookmark(id, category) {
    if (!isAdmin) return;
    if (!confirm('确定删除该书签？删除后需点「提交到 GitHub」才会写入仓库。')) return;

    if (!bookmarksData[category]) return;
    const idx = bookmarksData[category].findIndex(b => b.id === id);
    if (idx === -1) return;

    bookmarksData[category].splice(idx, 1);
    if (bookmarksData[category].length === 0) {
        delete bookmarksData[category];
    }

    markDirty();
    renderBookmarks(searchActive ? getSearchResults() : bookmarksData);
    renderCategoryNav();
}

function getSearchResults() {
    const query = document.getElementById('search-input').value;
    // 复用 search 逻辑但不改 searchActive
    const q = (query || '').toLowerCase().trim();
    if (!q) return bookmarksData;
    const results = {};
    Object.keys(bookmarksData).forEach(category => {
        if (category.toLowerCase().includes(q)) {
            results[category] = bookmarksData[category];
            return;
        }
        const matched = bookmarksData[category].filter(b =>
            (b.title && b.title.toLowerCase().includes(q)) ||
            (b.description && b.description.toLowerCase().includes(q)) ||
            (b.url && b.url.toLowerCase().includes(q))
        );
        if (matched.length) results[category] = matched;
    });
    return results;
}

function discardChanges() {
    if (!serverSnapshot) return;
    if (dirty && !confirm('确定丢弃所有未提交的更改？')) return;
    bookmarksData = deepClone(serverSnapshot);
    clearDirty();
    searchActive = false;
    document.body.classList.remove('searching');
    document.getElementById('search-input').value = '';
    renderBookmarks();
    renderCategoryNav();
}

function handleExitAdmin() {
    if (dirty) {
        if (!confirm('有未提交的更改，退出将丢失这些修改。确定退出？')) return;
    }
    exitAdminMode();
}

// ---------- 提交 GitHub（唯一写操作） ----------

async function commitToGitHub() {
    if (!isAdmin) return;
    if (!dirty) {
        alert('没有需要提交的更改');
        return;
    }

    const parsed = parseRepo(adminConfig.repo);
    if (!parsed || !adminConfig.token || !adminConfig.jsonPath) {
        alert('GitHub 配置不完整，请重新登录');
        return;
    }

    const btn = document.getElementById('commit-btn');
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = '提交中...';

    try {
        const baseUrl = `https://api.github.com/repos/${parsed.owner}/${parsed.name}/contents/${adminConfig.jsonPath}`;
        const headers = {
            'Authorization': `token ${adminConfig.token}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json'
        };

        // 先取最新 sha，降低冲突
        const getRes = await fetch(baseUrl, { headers: {
            'Authorization': headers.Authorization,
            'Accept': headers.Accept
        }});

        if (!getRes.ok) {
            throw new Error(`获取远程文件失败: ${getRes.status}`);
        }

        const remote = await getRes.json();
        const sha = remote.sha;

        const content = utf8_to_b64(JSON.stringify(bookmarksData, null, 2));
        const putRes = await fetch(baseUrl, {
            method: 'PUT',
            headers,
            body: JSON.stringify({
                message: 'sync: 更新书签',
                content,
                sha
            })
        });

        const putData = await putRes.json();

        if (!putRes.ok) {
            if (putRes.status === 409 || (putData.message && /sha/i.test(putData.message))) {
                throw new Error('远程文件已变更，请退出后重新登录再试');
            }
            if (putRes.status === 401 || putRes.status === 403) {
                throw new Error('Token 无效或权限不足');
            }
            throw new Error(putData.message || `提交失败: ${putRes.status}`);
        }

        if (putData.content && putData.content.sha) {
            fileSha = putData.content.sha;
        }
        serverSnapshot = deepClone(bookmarksData);
        clearDirty();
        alert('已提交到 GitHub');
    } catch (err) {
        console.error(err);
        alert(`提交失败: ${err.message}`);
        updateDirtyUI();
    } finally {
        btn.textContent = originalText;
        updateDirtyUI();
    }
}

// ---------- 事件 ----------

function setupEventListeners() {
    const searchInput = document.getElementById('search-input');
    const searchButton = document.getElementById('search-button');

    searchButton.addEventListener('click', () => {
        searchBookmarks(searchInput.value);
    });

    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            searchBookmarks(searchInput.value);
        }
    });

    document.getElementById('admin-btn').addEventListener('click', openLoginModal);
    document.getElementById('login-step1-btn').addEventListener('click', handleRemoteLogin);
    document.getElementById('login-step2-btn').addEventListener('click', handleGitHubLogin);
    document.getElementById('login-back-btn').addEventListener('click', () => {
        showLoginStep(1);
    });

    document.getElementById('login-password').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleRemoteLogin();
    });

    document.querySelectorAll('[data-close-modal]').forEach(el => {
        el.addEventListener('click', () => {
            const id = el.getAttribute('data-close-modal');
            if (id === 'login-modal') closeLoginModal();
            if (id === 'bookmark-modal') closeBookmarkModal();
        });
    });

    document.getElementById('login-modal').addEventListener('click', (e) => {
        if (e.target.id === 'login-modal') closeLoginModal();
    });
    document.getElementById('bookmark-modal').addEventListener('click', (e) => {
        if (e.target.id === 'bookmark-modal') closeBookmarkModal();
    });

    document.getElementById('fab-add').addEventListener('click', () => openBookmarkModal({}));
    document.getElementById('bm-save-btn').addEventListener('click', saveBookmarkFromModal);

    document.getElementById('commit-btn').addEventListener('click', commitToGitHub);
    document.getElementById('discard-btn').addEventListener('click', discardChanges);
    document.getElementById('exit-admin-btn').addEventListener('click', handleExitAdmin);

    window.addEventListener('beforeunload', (e) => {
        if (dirty) {
            e.preventDefault();
            e.returnValue = '';
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    loadBookmarks();
});
