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
let sortModalCategory = null;
let sortModalSnapshot = null;
let categorySortSnapshot = null;

const LS_KEYS = {
    repo: 'bookmarkAdmin.repo',
    token: 'bookmarkAdmin.token',
    jsonPath: 'bookmarkAdmin.jsonPath',
    email: 'bookmarkAdmin.email'
};

// 登录配置：优先 EdgeOne Pages 环境变量（经 /api/runtime-config 注入），
// 其次 window.__ENV__（本地 env.js）、再 meta[name="env:KEY"]。
// LOGIN_URL 必填；请求体字段名未配置时默认 email / password。
const DEFAULT_LOGIN_EMAIL_FIELD = 'email';
const DEFAULT_LOGIN_PASSWORD_FIELD = 'password';
let runtimeEnvLoaded = false;

function getEnv(name, fallback) {
    const env = (typeof window !== 'undefined' && window.__ENV__) ? window.__ENV__ : {};
    if (env[name] != null && String(env[name]).trim() !== '') {
        return String(env[name]).trim();
    }
    const meta = typeof document !== 'undefined'
        ? document.querySelector(`meta[name="env:${name}"]`)
        : null;
    if (meta) {
        const content = (meta.getAttribute('content') || '').trim();
        if (content) return content;
    }
    if (arguments.length >= 2) return fallback;
    return undefined;
}

/**
 * 从 EdgeOne Edge Function 拉取平台环境变量（LOGIN_URL 等）。
 * 纯静态本地若接口不存在则静默跳过，继续用 env.js。
 */
async function loadRuntimeEnv() {
    if (runtimeEnvLoaded) return;
    try {
        const res = await fetch('/api/runtime-config', { cache: 'no-store' });
        if (res.ok) {
            const data = await res.json();
            if (data && typeof data === 'object') {
                window.__ENV__ = Object.assign({}, window.__ENV__ || {}, data);
            }
        }
    } catch (_) {
        // 无 Edge Function / 离线：依赖 env.js 或 meta
    } finally {
        runtimeEnvLoaded = true;
    }
}

function getLoginUrl() {
    const url = getEnv('LOGIN_URL');
    if (!url) {
        throw new Error(
            '未配置环境变量 LOGIN_URL。EdgeOne：控制台或 edgeone makers env set LOGIN_URL "https://..."；本地可写 env.js'
        );
    }
    return url;
}

function getLoginBodyFields(email, password) {
    const emailField = getEnv('LOGIN_EMAIL_FIELD', DEFAULT_LOGIN_EMAIL_FIELD) || DEFAULT_LOGIN_EMAIL_FIELD;
    const passwordField = getEnv('LOGIN_PASSWORD_FIELD', DEFAULT_LOGIN_PASSWORD_FIELD) || DEFAULT_LOGIN_PASSWORD_FIELD;
    return {
        [emailField]: email,
        [passwordField]: password
    };
}

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
            const actions = document.createElement('div');
            actions.className = 'category-header-actions';

            const sortBtn = document.createElement('button');
            sortBtn.type = 'button';
            sortBtn.className = 'sort-category';
            sortBtn.textContent = '排序';
            sortBtn.addEventListener('click', () => openSortModal(category));
            actions.appendChild(sortBtn);

            const addBtn = document.createElement('button');
            addBtn.type = 'button';
            addBtn.className = 'add-in-category';
            addBtn.textContent = '+ 添加';
            addBtn.addEventListener('click', () => openBookmarkModal({ category }));
            actions.appendChild(addBtn);

            header.appendChild(actions);
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
    });
}

function createBookmarkCard(bookmark, category) {
    const card = document.createElement('div');
    card.classList.add('bookmark-card');
    card.dataset.id = bookmark.id;
    card.dataset.category = category;

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

// ---------- 分类内排序弹窗（拖动标题） ----------

function openSortModal(category) {
    if (!isAdmin || !bookmarksData[category] || bookmarksData[category].length === 0) {
        alert('该分类暂无书签可排序');
        return;
    }

    sortModalCategory = category;
    sortModalSnapshot = deepClone(bookmarksData[category]);

    document.getElementById('sort-modal-title').textContent = `排序 · ${category}`;
    renderSortList(bookmarksData[category]);
    document.getElementById('sort-modal').classList.add('visible');
}

function renderSortList(items) {
    const list = document.getElementById('sort-list');
    list.innerHTML = '';

    items.forEach((bookmark, index) => {
        const li = document.createElement('li');
        li.className = 'sort-list-item';
        li.draggable = true;
        li.dataset.id = bookmark.id;

        const grip = document.createElement('span');
        grip.className = 'sort-grip';
        grip.innerHTML = '<i class="fas fa-grip-vertical"></i>';

        const title = document.createElement('span');
        title.className = 'sort-title';
        title.textContent = bookmark.title || '(无标题)';

        const idx = document.createElement('input');
        idx.type = 'number';
        idx.className = 'sort-index';
        idx.min = '1';
        idx.step = '1';
        idx.value = String(index + 1);
        idx.title = '输入目标序号，与该位置交换';
        idx.addEventListener('mousedown', (e) => e.stopPropagation());
        idx.addEventListener('click', (e) => e.stopPropagation());
        idx.addEventListener('dragstart', (e) => e.preventDefault());
        idx.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                applyIndexSwap(li, idx);
                idx.blur();
            }
        });
        idx.addEventListener('change', () => applyIndexSwap(li, idx));
        idx.addEventListener('blur', () => {
            // 非法输入时恢复显示当前真实序号
            renumberSortList(list);
        });

        li.appendChild(grip);
        li.appendChild(title);
        li.appendChild(idx);
        list.appendChild(li);
    });

    setupSortListDrag(list);
}

/**
 * 把当前行序号改成目标编号：与目标位置的那一项交换位置
 * 例：第 1 项改成 5 → 与第 5 项对调
 */
function applyIndexSwap(li, inputEl) {
    const list = document.getElementById('sort-list');
    if (!list || !li) return;

    const items = Array.from(list.querySelectorAll('.sort-list-item'));
    const fromIndex = items.indexOf(li);
    if (fromIndex < 0) return;

    const raw = String(inputEl.value).trim();
    const target = parseInt(raw, 10);
    const max = items.length;

    if (!Number.isFinite(target) || target < 1 || target > max) {
        inputEl.value = String(fromIndex + 1);
        return;
    }

    const toIndex = target - 1;
    if (toIndex === fromIndex) {
        inputEl.value = String(fromIndex + 1);
        return;
    }

    // 数组交换后按新顺序重新挂到列表
    const tmp = items[fromIndex];
    items[fromIndex] = items[toIndex];
    items[toIndex] = tmp;
    items.forEach(el => list.appendChild(el));

    renumberSortList(list);
    applySortListOrder(list);
}

function setupSortListDrag(list) {
    let dragged = null;

    list.querySelectorAll('.sort-list-item').forEach(item => {
        item.addEventListener('dragstart', (e) => {
            dragged = item;
            item.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', item.dataset.id);
        });

        item.addEventListener('dragend', () => {
            item.classList.remove('dragging');
            dragged = null;
            renumberSortList(list);
            applySortListOrder(list);
        });

        item.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (!dragged || dragged === item) return;

            const rect = item.getBoundingClientRect();
            const midY = rect.top + rect.height / 2;
            if (e.clientY < midY) {
                list.insertBefore(dragged, item);
            } else {
                list.insertBefore(dragged, item.nextSibling);
            }
        });
    });

    list.addEventListener('dragover', (e) => e.preventDefault());
    list.addEventListener('drop', (e) => e.preventDefault());
}

function renumberSortList(list) {
    list.querySelectorAll('.sort-list-item').forEach((item, index) => {
        const idx = item.querySelector('.sort-index');
        if (idx) idx.value = String(index + 1);
    });
}

function applySortListOrder(list) {
    if (!sortModalCategory || !bookmarksData[sortModalCategory]) return;

    const ids = Array.from(list.querySelectorAll('.sort-list-item')).map(el => el.dataset.id);
    const map = new Map(bookmarksData[sortModalCategory].map(b => [b.id, b]));
    const reordered = ids.map(id => map.get(id)).filter(Boolean);

    const prev = JSON.stringify(bookmarksData[sortModalCategory].map(b => b.id));
    const next = JSON.stringify(reordered.map(b => b.id));
    if (prev !== next) {
        bookmarksData[sortModalCategory] = reordered;
        markDirty();
    }
}

function syncDirtyWithServer() {
    if (serverSnapshot && JSON.stringify(bookmarksData) === JSON.stringify(serverSnapshot)) {
        clearDirty();
    } else {
        dirty = true;
        updateDirtyUI();
    }
}

function closeSortModal(revert) {
    if (revert && sortModalCategory && sortModalSnapshot) {
        bookmarksData[sortModalCategory] = deepClone(sortModalSnapshot);
        syncDirtyWithServer();
    }

    document.getElementById('sort-modal').classList.remove('visible');
    sortModalCategory = null;
    sortModalSnapshot = null;

    if (!searchActive) {
        renderBookmarks();
    } else {
        searchBookmarks(document.getElementById('search-input').value);
    }
    renderCategoryNav();
}

function finishSortModal() {
    const list = document.getElementById('sort-list');
    applySortListOrder(list);
    closeSortModal(false);
}

function cancelSortModal() {
    closeSortModal(true);
}

// ---------- 分类排序弹窗（调整分类 key 顺序） ----------

function getNonEmptyCategoryNames(data = bookmarksData) {
    return Object.keys(data).filter(k => data[k] && data[k].length > 0);
}

function reorderCategories(orderedNames) {
    const next = {};
    for (const name of orderedNames) {
        if (Object.prototype.hasOwnProperty.call(bookmarksData, name)) {
            next[name] = bookmarksData[name];
        }
    }
    for (const name of Object.keys(bookmarksData)) {
        if (!Object.prototype.hasOwnProperty.call(next, name)) {
            next[name] = bookmarksData[name];
        }
    }
    const prevKeys = JSON.stringify(Object.keys(bookmarksData));
    const nextKeys = JSON.stringify(Object.keys(next));
    if (prevKeys !== nextKeys) {
        bookmarksData = next;
        markDirty();
    }
}

function openCategorySortModal() {
    if (!isAdmin) return;
    const names = getNonEmptyCategoryNames();
    if (names.length === 0) {
        alert('暂无分类可排序');
        return;
    }
    categorySortSnapshot = deepClone(bookmarksData);
    renderCategorySortList(names);
    document.getElementById('category-sort-modal').classList.add('visible');
}

function renderCategorySortList(names) {
    const list = document.getElementById('category-sort-list');
    list.innerHTML = '';

    names.forEach((name, index) => {
        const li = document.createElement('li');
        li.className = 'sort-list-item';
        li.draggable = true;
        li.dataset.category = name;

        const grip = document.createElement('span');
        grip.className = 'sort-grip';
        grip.innerHTML = '<i class="fas fa-grip-vertical"></i>';

        const title = document.createElement('span');
        title.className = 'sort-title';
        title.textContent = name;

        const idx = document.createElement('input');
        idx.type = 'number';
        idx.className = 'sort-index';
        idx.min = '1';
        idx.step = '1';
        idx.value = String(index + 1);
        idx.title = '输入目标序号，与该位置交换';
        idx.addEventListener('mousedown', (e) => e.stopPropagation());
        idx.addEventListener('click', (e) => e.stopPropagation());
        idx.addEventListener('dragstart', (e) => e.preventDefault());
        idx.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                applyCategoryIndexSwap(li, idx);
                idx.blur();
            }
        });
        idx.addEventListener('change', () => applyCategoryIndexSwap(li, idx));
        idx.addEventListener('blur', () => renumberSortList(list));

        li.appendChild(grip);
        li.appendChild(title);
        li.appendChild(idx);
        list.appendChild(li);
    });

    setupCategorySortListDrag(list);
}

function applyCategorySortListOrder(list) {
    if (!list) return;
    const names = Array.from(list.querySelectorAll('.sort-list-item'))
        .map(el => el.dataset.category)
        .filter(Boolean);
    reorderCategories(names);
}

function applyCategoryIndexSwap(li, inputEl) {
    const list = document.getElementById('category-sort-list');
    if (!list || !li) return;

    const items = Array.from(list.querySelectorAll('.sort-list-item'));
    const fromIndex = items.indexOf(li);
    if (fromIndex < 0) return;

    const target = parseInt(String(inputEl.value).trim(), 10);
    const max = items.length;

    if (!Number.isFinite(target) || target < 1 || target > max) {
        inputEl.value = String(fromIndex + 1);
        return;
    }

    const toIndex = target - 1;
    if (toIndex === fromIndex) {
        inputEl.value = String(fromIndex + 1);
        return;
    }

    const tmp = items[fromIndex];
    items[fromIndex] = items[toIndex];
    items[toIndex] = tmp;
    items.forEach(el => list.appendChild(el));

    renumberSortList(list);
    applyCategorySortListOrder(list);
}

function setupCategorySortListDrag(list) {
    let dragged = null;

    list.querySelectorAll('.sort-list-item').forEach(item => {
        item.addEventListener('dragstart', (e) => {
            dragged = item;
            item.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', item.dataset.category || '');
        });

        item.addEventListener('dragend', () => {
            item.classList.remove('dragging');
            dragged = null;
            renumberSortList(list);
            applyCategorySortListOrder(list);
        });

        item.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (!dragged || dragged === item) return;

            const rect = item.getBoundingClientRect();
            const midY = rect.top + rect.height / 2;
            if (e.clientY < midY) {
                list.insertBefore(dragged, item);
            } else {
                list.insertBefore(dragged, item.nextSibling);
            }
        });
    });

    list.addEventListener('dragover', (e) => e.preventDefault());
    list.addEventListener('drop', (e) => e.preventDefault());
}

function forceCloseCategorySortModal() {
    const modal = document.getElementById('category-sort-modal');
    if (modal) modal.classList.remove('visible');
    categorySortSnapshot = null;
}

function closeCategorySortModal(revert) {
    if (revert && categorySortSnapshot) {
        bookmarksData = deepClone(categorySortSnapshot);
        syncDirtyWithServer();
    }

    document.getElementById('category-sort-modal').classList.remove('visible');
    categorySortSnapshot = null;

    if (!searchActive) {
        renderBookmarks();
    } else {
        searchBookmarks(document.getElementById('search-input').value);
    }
    renderCategoryNav();
}

function finishCategorySortModal() {
    const list = document.getElementById('category-sort-list');
    applyCategorySortListOrder(list);
    closeCategorySortModal(false);
}

function cancelCategorySortModal() {
    closeCategorySortModal(true);
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
    forceCloseCategorySortModal();
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

    await loadRuntimeEnv();

    let loginUrl;
    try {
        loginUrl = getLoginUrl();
    } catch (err) {
        setModalStatus('login-step1-status', 'error', err.message || '未配置 LOGIN_URL');
        return;
    }

    setModalStatus('login-step1-status', 'loading', '正在登录...');
    const btn = document.getElementById('login-step1-btn');
    btn.disabled = true;

    try {
        const response = await fetch(loginUrl, {
            method: 'POST',
            headers: {
                'Accept': '*/*',
                'Content-Type': 'text/plain;charset=UTF-8'
            },
            body: JSON.stringify(getLoginBodyFields(email, password)),
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

function fillCategorySelect(selectedCategory = '') {
    const select = document.getElementById('bm-category');
    const newInput = document.getElementById('bm-category-new');

    select.innerHTML = '';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '请选择已有分类';
    select.appendChild(placeholder);

    const names = Object.keys(bookmarksData);
    names.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = cat;
        select.appendChild(opt);
    });

    // 每次打开都保留完整列表，不因已选值过滤
    const exists = selectedCategory && names.includes(selectedCategory);
    if (exists) {
        select.value = selectedCategory;
        newInput.value = '';
    } else if (selectedCategory) {
        select.value = '';
        newInput.value = selectedCategory;
    } else {
        select.value = '';
        newInput.value = '';
    }
}

function onCategorySelectChange() {
    const select = document.getElementById('bm-category');
    const newInput = document.getElementById('bm-category-new');
    // 选了已有分类时，清空新建框，避免保存时误走新建
    if (select.value) {
        newInput.value = '';
    }
}

function onCategoryNewInput() {
    const select = document.getElementById('bm-category');
    const newInput = document.getElementById('bm-category-new');
    // 开始输入新分类时，下拉回到占位，列表选项始终还在
    if (newInput.value.trim()) {
        select.value = '';
    }
}

function getCategoryFromModal() {
    const newName = document.getElementById('bm-category-new').value.trim();
    if (newName) return newName;
    return (document.getElementById('bm-category').value || '').trim();
}

function openBookmarkModal(pref = {}) {
    if (!isAdmin) return;

    document.getElementById('bookmark-modal-title').textContent =
        pref.id ? '编辑书签' : '添加书签';
    document.getElementById('bm-id').value = pref.id || '';
    document.getElementById('bm-original-category').value = pref.category || '';
    document.getElementById('bm-title').value = pref.title || '';
    document.getElementById('bm-url').value = pref.url || '';
    document.getElementById('bm-description').value = pref.description || '';

    fillCategorySelect(pref.category || '');

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
    const category = getCategoryFromModal();

    if (!title) {
        setModalStatus('bm-status', 'error', '请输入标题');
        return;
    }
    if (!url) {
        setModalStatus('bm-status', 'error', '请输入 URL');
        return;
    }
    if (!category) {
        setModalStatus('bm-status', 'error', '请选择已有分类，或输入新分类名称');
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
    forceCloseCategorySortModal();
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
    document.getElementById('sort-modal').addEventListener('click', (e) => {
        if (e.target.id === 'sort-modal') cancelSortModal();
    });
    document.getElementById('category-sort-modal').addEventListener('click', (e) => {
        if (e.target.id === 'category-sort-modal') cancelCategorySortModal();
    });

    document.getElementById('fab-add').addEventListener('click', () => openBookmarkModal({}));
    document.getElementById('bm-save-btn').addEventListener('click', saveBookmarkFromModal);
    document.getElementById('bm-category').addEventListener('change', onCategorySelectChange);
    document.getElementById('bm-category-new').addEventListener('input', onCategoryNewInput);
    document.getElementById('bm-category-new').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            saveBookmarkFromModal();
        }
    });
    document.getElementById('sort-done-btn').addEventListener('click', finishSortModal);
    document.getElementById('sort-cancel-btn').addEventListener('click', cancelSortModal);
    document.getElementById('category-sort-btn').addEventListener('click', openCategorySortModal);
    document.getElementById('category-sort-done-btn').addEventListener('click', finishCategorySortModal);
    document.getElementById('category-sort-cancel-btn').addEventListener('click', cancelCategorySortModal);

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
    loadRuntimeEnv();
    loadBookmarks();
});
