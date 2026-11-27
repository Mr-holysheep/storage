// ==UserScript==
// @name         Element Collapse
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Collapse specified elements on mouse click and provide a toggle to expand/collapse
// @author       You
// @match        http*://*/*
// @grant        GM_registerMenuCommand
// @run-at       document-body
// @noframes
// ==/UserScript==

(function() {

	//---------------------設定項目---------------------

    let EC_HOTKEY = {
        ctrl: true,
        shift: false,
        alt: false,
        key: 'q'
    };

    let EC_APPLY_INTERVAL = 500;

    let excludedTagsRegex = /^(P|BR|PRE|SPAN|STRONG|CODE|A|EM|Q|H\d|UL|OL|LI|DL|DT|DD|TD|TR|BUTTON|SVG|IMG)$/i;

    let attr_for_selector = false;

    let bar_style = `
            :host {
                box-sizing: border-box;
                width: auto;
                max-height: 1500px;
                overflow: hidden;
                transition: max-height 0.3s ease-in-out;
                z-index: 2147483647;
                position: relative;
            }

            :host(.ec-collapsed) {
                display: inline-flex;
                align-items: center;
                box-sizing: border-box;
                width: fit-content;
                max-width: 100%;
                max-height: 25px;
                padding: 1px 3px;
                background: #252525;
                border: 1px solid #444;
                border-radius: 5px;
                box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
            }

            :host(.ec-collapsed) ::slotted(*) {
                display: none !important;
            }

            .ec-control {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                box-sizing: border-box;
                height: 21px;
                margin-right: 1px;
                padding: 3px 5px;
                color: #ddd;
                border-radius: 3px;
                font: 13px/15px system-ui, sans-serif;
                cursor: pointer;
                user-select: none;
            }

            .ec-control:hover {
                background: rgba(255, 255, 255, 0.12);
            }

            .ec-save.ec-saved {
                background: rgba(255, 255, 255, 0.08);
            }

            .ec-save.ec-flash {
                animation: ecBrightnessFlash 0.5s alternate-reverse 2;
            }

            @keyframes ecBrightnessFlash {
                from {
                    filter: brightness(1);
                }
                to {
                    filter: brightness(2);
                }
            }

            .ec-title {
                margin-left: 1px;
            }
        `;

    let global_bar_style = `
            :host {
                position: fixed;
                top: 5px;
                left: 5px;
                z-index: 2147483647 !important;

                display: none;

                box-sizing: border-box;
                padding: 5px;

                background: #222;
                border-radius: 5px;

                color: #ddd;

                font: 15px/15px system-ui, sans-serif;

                user-select: none;
            }

            :host(.ec-visible) {
                display: block;
            }

            .ec-global-button {
                display: inline-block;

                box-sizing: border-box;

                margin-right: 4px;
                padding: 2px 4px;

                color: inherit;

                vertical-align: middle;

                font: inherit;
                cursor: pointer;

                white-space: nowrap;
            }

            .ec-global-button:last-child {
                margin-right: 0;
            }

            .ec-global-button:hover {
                filter: brightness(1.35);
            }

            .ec-global-label {
                padding-right: 7px;
            }
        `;

    //---------------------設定項目---------------------

    let EC_STORAGE_KEY = 'ec-dom_path';

    let collapseMap = new WeakMap();
    let collapseId = 0;
    let EC_AUTO_APPLY_DELAY_KEY = 'ec-auto-apply-delay';
    let EC_AUTO_APPLY_DELAY = 0;

    //---------------------delay+GM MENU---------------------

    function getAutoApplyDelay() {
        let data = localStorage.getItem(EC_AUTO_APPLY_DELAY_KEY);

        if (data === null) {
            return 0;
        }

        let delay = Number(data);

        if (!Number.isFinite(delay) || delay < 0) {
            return 0;
        }

        return delay;
    }

    function saveAutoApplyDelay(delay) {
        localStorage.setItem(
            EC_AUTO_APPLY_DELAY_KEY,
            String(delay)
        );
    }

    function registerAutoApplyDelayMenu() {
        GM_registerMenuCommand(
            '設定自動收合延遲',
            () => {
                let currentDelay = getAutoApplyDelay();

                let input = prompt(
                    '輸入自動收合延遲時間（毫秒）\n輸入 0 = 關閉延遲',
                    String(currentDelay)
                );

                if (input === null) {
                    return;
                }

                input = input.trim();

                let delay = Number(input);

                if (!Number.isFinite(delay) || delay < 0) {
                    alert('請輸入大於或等於 0 的數字');
                    return;
                }

                delay = Math.floor(delay);

                saveAutoApplyDelay(delay);

                EC_AUTO_APPLY_DELAY = delay;
            }
        );
    }

    //---------------------Storage---------------------

    function getSavedPaths() {

        let data = localStorage.getItem(EC_STORAGE_KEY);

        if (!data) {
            return [];
        }

        return data
            .split(',')
            .map(path => path.trim())
            .filter(Boolean);
    }


    function savePaths(paths) {

        if (!paths.length) {
            localStorage.removeItem(EC_STORAGE_KEY);
            return;
        }

        localStorage.setItem(
            EC_STORAGE_KEY,
            paths.join(',')
        );
    }


    function saveCollapsePath(path) {

        if (!path) {
            return;
        }

        let paths = getSavedPaths();

        if (!paths.includes(path)) {
            paths.push(path);
            savePaths(paths);
        }
    }


    function removeCollapsePath(path) {

        if (!path) {
            return;
        }

        let paths = getSavedPaths();

        let newPaths =
            paths.filter(item => item !== path);

        savePaths(newPaths);
    }

    function isPathSaved(path) {

        if (!path) {
            return false;
        }

        return getSavedPaths().includes(path);
    }

    // ---------- State ----------

    function createCollapseState(element, path = null) {
        if (!path) {
            path = getPath(element);
        }

        let state = {
            id: ++collapseId,
            element,
            path,
            bar: null,
            saveButton: null,
            collapsed: true,
            saved: isPathSaved(path)
        };

        collapseMap.set(element, state);

        return state;
    }

    function updateSaveButton(state) {

        let button = state?.saveButton;

        if (!button) {
            return;
        }


        if (state.saved) {
            button.classList.add('ec-saved');

            button.title =
                'DOM Path Saved';

        } else {
            button.classList.remove('ec-saved');

            button.title =
                'Save DOM Path';
        }
    }

    // ---------- Bar ----------

    function createCollapseBar(state) {

        let host = document.createElement('div');

        host.dataset.ecUi = 'collapse';
        host.dataset.ecId = String(state.id);
        host.classList.add('ec-collapsed');


        let shadow = host.attachShadow({
            mode: 'closed'
        });


        let style = document.createElement('style');

        style.textContent = bar_style;


        // ---------- Save ----------

        let saveButton =
            document.createElement('span');

        saveButton.className =
            'ec-control ec-save';

        saveButton.textContent = '💾';

        saveButton.title =
            'Save DOM Path';

        state.saveButton = saveButton;


        // ---------- Close ----------

        let closeButton =
            document.createElement('span');

        closeButton.className =
            'ec-control ec-close';

        closeButton.textContent = '×';

        closeButton.title =
            'Restore + Remove Saved Path';


        // ---------- Title ----------

        let title =
            document.createElement('span');

        title.className =
            'ec-control ec-title';

        title.textContent =
            '點擊這裡收合/展開';


        // ---------- Content Slot ----------

        let slot =
            document.createElement('slot');


        // ---------- Events ----------

        title.addEventListener(
            'click',
            event => {

                event.preventDefault();
                event.stopPropagation();

                toggleCollapse(state);

            }
        );


        saveButton.addEventListener(
            'click',
            event => {

                event.preventDefault();
                event.stopPropagation();

                saveCollapseState(state);

            }
        );


        closeButton.addEventListener(
            'click',
            event => {

                event.preventDefault();
                event.stopPropagation();

                restoreCollapse(
                    state,
                    true
                );

            }
        );


        shadow.append(
            style,
            saveButton,
            closeButton,
            title,
            slot
        );

        state.bar = host;

        updateSaveButton(state);

        return host;
    }


    // ---------- Collapse ----------

    function collapseElement(element, path = null) {
        if (!(element instanceof Element)) {
            return null;
        }

        let state = collapseMap.get(element);

        if (state) {
            if (!state.collapsed) {
                setCollapsed(state);
            }

            return state;
        }

        state = createCollapseState(element, path);

        if (!state.path) {
            collapseMap.delete(element);
            return null;
        }

        let bar = createCollapseBar(state);

        element.replaceWith(bar);
        bar.appendChild(element);

        return state;
    }


    // ---------- Set Collapsed ----------

    function setCollapsed(state) {

        if (!state || state.collapsed) {
            return;
        }


        let bar = state.bar;

        if (!bar) {
            return;
        }


        bar.classList.add('ec-collapsed');

        state.collapsed = true;
    }


    // ---------- Set Expanded ----------

    function setExpanded(state) {

        if (!state || !state.collapsed) {
            return;
        }


        let bar = state.bar;

        if (!bar) {
            return;
        }


        bar.classList.remove('ec-collapsed');

        state.collapsed = false;
    }


    // ---------- Toggle ----------

    function toggleCollapse(state) {

        if (!state) {
            return;
        }


        if (state.collapsed) {
            setExpanded(state);
        } else {
            setCollapsed(state);
        }
    }


    // ---------- Save ----------

    function saveCollapseState(state) {

        if (!state || !state.path) {
            return;
        }


        saveCollapsePath(state.path);

        state.saved = true;

        updateSaveButton(state);


        let button = state.saveButton;

        if (!button) {
            return;
        }


        button.classList.remove('ec-flash');

        /*
         * 強制重新觸發 animation。
         */
        void button.offsetWidth;

        button.classList.add('ec-flash');


        setTimeout(() => {

            button.classList.remove('ec-flash');

        }, 1100);

    }


    // ---------- Restore ----------

    function restoreCollapse(state, removeSavedPath = false) {

        if (!state) {
            return;
        }

        let element = state.element;
        let bar = state.bar;

        if (!element || !bar) {
            return;
        }

        if (bar.isConnected) {
            bar.replaceWith(element);
        }

        state.collapsed = false;

        if (removeSavedPath) {
            removeCollapsePath(state.path);
        }

        collapseMap.delete(element);
    }

    // =====================================
    // Global Bar + Selection
    // =====================================

    let ecPicking = false;
    let ecHoverTarget = null;

    let ecPressedKeys = new Set();

    // ---------- Style ----------

    let ecSelectionStyle = document.createElement('style');

    ecSelectionStyle.textContent = `
    .ec-selection-highlight {
        outline: 2px solid #ff4040 !important;
        outline-offset: -2px !important;
        cursor: crosshair !important;
    }
    `;

    document.head.appendChild(ecSelectionStyle);


    // ---------- Global Bar ----------

    function createGlobalBar() {
        let host = document.createElement('div');

        host.dataset.ecUi = 'global';

        let shadow = host.attachShadow({
            mode: 'closed'
        });

        let style = document.createElement('style');

        style.textContent = global_bar_style;

        // ---------- Manual Preview ----------
        let previewButton =
            document.createElement('span');

        previewButton.className =
            'ec-global-button';

        previewButton.textContent = '👁️';

        previewButton.title =
            'Preview a Manual DOM Path';

        // ---------- Delete All ----------
        let deleteButton =
            document.createElement('span');

        deleteButton.className =
            'ec-global-button';

        deleteButton.textContent = '×';

        deleteButton.title =
            'Delete all saved DOM Paths';

        // ---------- Event ----------
        previewButton.addEventListener(
            'click',
            event => {

                event.preventDefault();
                event.stopPropagation();

                manualPreview();

            }
        );

        deleteButton.addEventListener(
            'click',
            event => {

                event.preventDefault();
                event.stopPropagation();

                deleteAllSavedPaths();

            }
        );

        shadow.append(
            style,
            previewButton,
            deleteButton
        );

        document.body.appendChild(host);

        return host;
    }

    let ecGlobalBar = createGlobalBar();

    function ensureGlobalBar() {
        if (!ecGlobalBar || !ecGlobalBar.isConnected) {
            ecGlobalBar = createGlobalBar();
        }
    }

    function showGlobalBar() {

        ecGlobalBar.classList.add(
            'ec-visible'
        );

    }

    function hideGlobalBar() {

        ecGlobalBar.classList.remove(
            'ec-visible'
        );

    }

    // ---------- UI 判斷 ----------

    function isEcUiElement(element) {

        if (!(element instanceof Element)) {
            return false;
        }

        return Boolean(
            element.closest(
                '[data-ec-ui]'
            )
        );
    }


    // ---------- Hover ----------

    function updateSelectionTarget(element) {

        if (!ecPicking) {
            return;
        }

        if (!(element instanceof Element)) {
            return;
        }

        if (isEcUiElement(element)) {
            clearSelectionTarget();
            return;
        }


        let target = stob(element);

        if (!(target instanceof Element)) {
            clearSelectionTarget();
            return;
        }


        if (ecHoverTarget === target) {
            return;
        }


        clearSelectionTarget();

        ecHoverTarget = target;
        ecHoverTarget.classList.add(
            'ec-selection-highlight'
        );
    }


    function clearSelectionTarget() {

        if (!ecHoverTarget) {
            return;
        }

        ecHoverTarget.classList.remove(
            'ec-selection-highlight'
        );

        ecHoverTarget = null;
    }


    // ---------- 啟用 ----------

    function enableEcPicker() {

        if (ecPicking) {
            return;
        }

        ecPicking = true;

        document.addEventListener(
            'mouseover',
            handleEcMouseOver,
            true
        );

        document.addEventListener(
            'click',
            handleEcClick,
            true
        );

        showGlobalBar();
    }


    // ---------- 停用 ----------

    function disableEcPicker() {

        if (!ecPicking) {
            return;
        }

        ecPicking = false;

        document.removeEventListener(
            'mouseover',
            handleEcMouseOver,
            true
        );

        document.removeEventListener(
            'click',
            handleEcClick,
            true
        );

        clearSelectionTarget();
        hideGlobalBar();
    }


    // ---------- Mouse Over ----------

    function handleEcMouseOver(event) {

        if (!ecPicking) {
            return;
        }

        updateSelectionTarget(event.target);
    }


    // ---------- Click ----------

    function handleEcClick(event) {

        if (!ecPicking) {
            return;
        }

        if (isEcUiElement(event.target)) {
            return;
        }


        let target = stob(event.target);

        if (!(target instanceof Element)) {
            return;
        }


        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();


        clearSelectionTarget();

        collapseElement(target);
    }


     // =====================================
     // Manual Path
     // =====================================

    function getManualTarget(path) {

        if (!path) {
            return null;
        }


        let matches;

        try {

            matches = document.querySelectorAll(path);

        } catch (error) {

            alert(
                'Element Collapse : Invalid DOM Path\n\n' +
                error.message
            );

            return null;
        }


        if (!matches.length) {

            alert(
                'Element Collapse : Can\'t find The Target'
            );

            return null;
        }


        if (matches.length > 1) {

            alert(
                'Element Collapse : is Not a Only Element'
            );

            return null;
        }


        return matches[0];
    }

    // ---------- Manual Preview ----------
    function manualPreview() {
        let inputPath = prompt(
            'Enter a DOM Path'
        );

        if (!inputPath) {
            return;
        }

        inputPath = inputPath.trim();

        let target = getManualTarget(inputPath);

        if (!target) {
            return;
        }

        if (isEcUiElement(target)) {
            alert(
                'Element Collapse : Target is Element Collapse UI'
            );
            return;
        }

        collapseElement(target, inputPath);
    }

    // ---------- Delete All ----------

    function deleteAllSavedPaths() {

        let paths = getSavedPaths();

        if (!paths.length) {
            return;
        }


        if (
            !confirm(
                'Delete all Element Collapse Data?'
            )
        ) {
            return;
        }


        localStorage.removeItem(
            EC_STORAGE_KEY
        );


        /*
         * 這裡只刪 persistent data。
         * 現有 Collapse 不主動還原。
         */
    }


    // =====================================
    // Hotkey
    // =====================================

    function isHotkeyActive() {

        let key = EC_HOTKEY.key.toLowerCase();

        let ctrl =
            !EC_HOTKEY.ctrl ||
            ecPressedKeys.has('control');

        let shift =
            !EC_HOTKEY.shift ||
            ecPressedKeys.has('shift');

        let alt =
            !EC_HOTKEY.alt ||
            ecPressedKeys.has('alt');

        let mainKey =
            ecPressedKeys.has(key);


        return ctrl && shift && alt && mainKey;
    }


    function updateHotkeyState() {

        let active = isHotkeyActive();

        if (active) {
            enableEcPicker();
        } else {
            disableEcPicker();
        }
    }


    // ---------- Key Down ----------

    document.addEventListener(
        'keydown',
        event => {

            if (event.key) {
                ecPressedKeys.add(
                    event.key.toLowerCase()
                );
            }


            updateHotkeyState();

        },
        true
    );


    // ---------- Key Up ----------

    document.addEventListener(
        'keyup',
        event => {

            if (event.key) {
                ecPressedKeys.delete(
                    event.key.toLowerCase()
                );
            }


            updateHotkeyState();

        },
        true
    );


    // ---------- Window Blur ----------

    window.addEventListener(
        'blur',
        () => {

            ecPressedKeys.clear();

            disableEcPicker();

        },
        true
    );

    // =====================================
    // Saved Collapse
    // =====================================

    let ecApplyTimer = null;
    let ecLastApplyTime = 0;
    let ecApplying = false;

    let ecInvalidPathSet = new Set();


    // ---------- Path 解析 ----------

    function resolveCollapsePath(path) {

        if (!path) {
            return null;
        }

        try {

            let nodes = document.querySelectorAll(path);

            if (nodes.length !== 1) {
                return null;
            }

            return nodes[0];

        } catch (error) {

            if (!ecInvalidPathSet.has(path)) {

                ecInvalidPathSet.add(path);

                console.warn(
                    'Element Collapse: 無效 selector:',
                    path,
                    error
                );
            }

            return null;
        }
    }


    // ---------- 套用 ----------

    function applySavedCollapses() {

        if (ecApplying) {
            return;
        }

        let paths = getSavedPaths();

        if (!paths.length) {
            return;
        }

        ecApplying = true;

        try {

            // 先一次解析所有目前存在的 target
            let targets = [];

            for (let path of paths) {

                let element = resolveCollapsePath(path);

                if (!element) {
                    continue;
                }

                let state = collapseMap.get(element);

                if (state) {
                    continue;
                }

                targets.push(element);
            }


            // 有 ancestor target 時，只保留最上層 ancestor
            let collapseTargets = [];

            for (let element of targets) {

                let hasAncestor = false;

                for (let other of targets) {

                    if (
                        other !== element &&
                        other.contains(element)
                    ) {
                        hasAncestor = true;
                        break;
                    }

                }

                // 自己是某個 target 的子孫 → 跳過
                if (hasAncestor) {
                    continue;
                }

                collapseTargets.push(element);
            }


            // 現在才真正修改 DOM
            for (let element of collapseTargets) {
                collapseElement(element);
            }

        } finally {
            ecApplying = false;
        }
    }


    // ---------- 排程 ----------

    function queueApplySavedCollapses() {

        if (ecApplying) {
            return;
        }

        let now = performance.now();
        let elapsed = now - ecLastApplyTime;

        if (ecLastApplyTime === 0 || elapsed >= EC_APPLY_INTERVAL) {

            ecLastApplyTime = now;

            if (!getSavedPaths().length) {
                return;
            }

            applySavedCollapses();
            return;
        }

        if (ecApplyTimer !== null) {
            return;
        }

        ecApplyTimer = setTimeout(() => {

            ecApplyTimer = null;

            if (ecApplying) {
                return;
            }

            ecLastApplyTime = performance.now();
            applySavedCollapses();

        }, EC_APPLY_INTERVAL - elapsed);
    }


    // ---------- Observer ----------

    let ecObserver = new MutationObserver(() => {

        ensureGlobalBar();

        if (ecApplying) {
            return;
        }

        queueApplySavedCollapses();

    });


    function startCollapseObserver() {

        if (!document.body) {
            return;
        }

        ecObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
    }


    // ---------- 初始化 ----------

    function initSavedCollapses() {
        if (EC_AUTO_APPLY_DELAY === 0) {
            applySavedCollapses();
            startCollapseObserver();
            return;
        }

        setTimeout(() => {
            applySavedCollapses();
            startCollapseObserver();
        }, EC_AUTO_APPLY_DELAY);
    }

    EC_AUTO_APPLY_DELAY = getAutoApplyDelay();
    registerAutoApplyDelayMenu();

    if(document.readyState !== "loading"){
        initSavedCollapses();
    }else{
        document.addEventListener(
            'DOMContentLoaded',
            initSavedCollapses
        );
    }

    // ======================================== STOB ========================================

	function stob(elm){ // small to big功能,可能要多做個開關變數給他

        function isExcluded(element) {
            return excludedTagsRegex.test(element.tagName);

        };

        function hasSameTagChildren(element) {
            let children = element.children;
            let tagCounts = {};

            for (let i = 0; i < children.length; i++) {
                if (!isExcluded(children[i])) {
                    let tagName = children[i].tagName;
                    if (tagCounts[tagName]) {
                        tagCounts[tagName]++;
                        if (tagCounts[tagName] >= 2) {
                            return true;
                        }
                    } else {
                        tagCounts[tagName] = 1;
                    }
                }
            }
            return false;
        };

        function getrec(elm){ return elm ? elm.getBoundingClientRect() : false };

        function stob_main(elm) {
            let target = elm;
            let target_confirmed = false;

            while (target instanceof Element && target !== document.body) {
                if (!target_confirmed) {
                    if (target.childElementCount == 1 && !isExcluded(target) && !isExcluded(target.firstElementChild)) { // 第1階段:如果只有1個子元素,並且自己與子元素都不在排除名單
                        //console.log(target);
                        console.log(1);
                        target_confirmed = target;
                        continue
                    } else if ( target.childElementCount > 1 && hasSameTagChildren(target) ) { // 第2階段:如果有多個子元素,且擁有2個以上"同標籤名"的非排除名單的子元素
                        //console.log(target);
                        console.log(2);
                        target_confirmed = target;
                        continue
                    }else if(
                        target.parentNode &&
                        !isExcluded(target.parentNode) &&
                        target.parentNode.childElementCount > 1 &&
                        getrec(elm).width * getrec(elm).height / (getrec(target.parentNode).width * getrec(target.parentNode).height) < 0.5
                    ){ // 第3階段:如果目標的父元素不在排除名單,且有多個子元素,且比"最初"目標在視覺比例上大超過50%
                        console.log(3);
                        target_confirmed = target.parentNode;
                        target = target.parentNode;
                        continue
                    }
                } else if (target_confirmed && target.parentNode.childElementCount > 1 && !isExcluded(target)) { // confirmed 之後，如果目前 target 的父層是一個多子元素容器，就把目前 target 當成 shell 回傳。
                    // console.log(target);
                    return target
                }
                target = target.parentNode;
            }
            return target_confirmed
        };

        return stob_main(elm);
    }

    // ======================================== Path生成器 ========================================

    function getPath(el) {
        if (!(el instanceof Element)) return;

        let path = [];

        function name_renew(str) {
            return String(str || '')
                .trim()
                .split(/\s+/) // 以空白切開多個 class
                .filter(Boolean) // 過濾掉空字串
                .map(s => CSS.escape(s)) // 每個 class 都用 CSS.escape() 做合法轉義
                .join('.'); // 再用 . 串起來 → .foo.bar.baz
        }

        function tryAttributes(element) {
            let attrs = Array.from(element.attributes);
            for (let attr of attrs) {
                let {
                    name,
                    value
                } = attr;
                if (!value) continue;
                // 過濾掉不適合的屬性
                if (name === 'id' || name === 'class' || name === 'style') continue;
                if (name.startsWith('aria-')) continue;

                let safeValue = CSS.escape(value);
                let testSel = `${element.nodeName.toLowerCase()}[${name}="${safeValue}"]`;
                try {
                    let matches = document.querySelectorAll(testSel);
                    if (matches.length === 1) {
                        return testSel;
                    }
                } catch (_) {}
            }
            return null;
        }

        function processDefault(selector, element) {
            // 先嘗試屬性
            let attrSel = attr_for_selector && tryAttributes(element);
            if (attrSel) return attrSel;

            let parent = element.parentElement;
            if (!parent) return selector;

            let siblings = Array.from(parent.children)
                .filter(n => n.nodeName.toLowerCase() === element.nodeName.toLowerCase());
            let index = siblings.indexOf(element);

            // === 先檢查 first-child / last-child ===
            if (element === parent.firstElementChild) {
                selector += ":first-child";
                return selector;
            }
            if (element === parent.lastElementChild) {
                selector += ":last-child";
                return selector;
            }

            // === 再檢查 first-of-type / last-of-type ===
            if (index === 0) {
                selector += ":first-of-type";
            } else if (index === siblings.length - 1) {
                selector += ":last-of-type";
            } else if (siblings.length > 1) {
                selector += `:nth-of-type(${index + 1})`;
            }

            return selector;
        }


        while (el && el.nodeType === Node.ELEMENT_NODE) {
            let selector = el.nodeName.toLowerCase();
            let safeId = CSS.escape(el.id);
            let class_name = (el.getAttribute('class') || '').replace(/\bThePathPicker-[^\s]+/g, '').trim();

            if (el.id && document.querySelectorAll('#' + safeId).length === 1) {
                selector += '#' + name_renew(el.id);
                path.unshift(selector);
                break; // id 已經足夠唯一，直接停止
            } else if (class_name) {
                // console.log(el.className);
                let new_class = name_renew(class_name);
                if (new_class) {
                    // 嘗試用 className
                    try {
                        let testSel = '.' + new_class;
                        let matches = document.querySelectorAll(testSel);
                        if (matches.length === 1) {
                            selector += '.' + new_class;
                        } else {
                            // 不唯一 → fallback
                            selector = processDefault(selector, el);
                        }
                    } catch (e) {
                        // className 無效 → fallback
                        selector = processDefault(selector, el);
                    }
                } else {
                    selector = processDefault(selector, el);
                }
            } else {
                selector = processDefault(selector, el);
            }

            path.unshift(selector);
            el = el.parentNode;
        }

        return path.join(" > ");
    }


})();
