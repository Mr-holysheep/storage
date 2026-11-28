// ==UserScript==
// @name         TeleTether
// @namespace    https://github.com/Mr-holysheep/storage
// @version      0.1.0
// @description  Telegram Web K 聊天清單排序凍結原型
// @match        https://web.telegram.org/k/*
// @run-at       document-idle
// @grant        unsafeWindow
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function() {
  'use strict';

  let VERSION = '0.1.0';
  let page = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  let freezeEnabled = false;
  let appManager = null;
  let suppressedSortUpdates = 0;
  let patchedListCount = 0;
  let patches = [];
  let patchedManagers = new WeakSet();
  let listStates = new WeakMap();

  function patchList(xd) {
    if (!xd || typeof xd.updateDialog !== 'function' || !xd.sortedList || typeof xd.sortedList.update !== 'function') {
      return false;
    }

    let existingState = listStates.get(xd);
    if (existingState) {
      return true;
    }

    let sortedList = xd.sortedList;
    let state = {insideUpdateDialog: 0};
    let originalUpdateDialog = xd.updateDialog;
    let originalSortedUpdate = sortedList.update;

    let wrappedUpdateDialog = function() {
      state.insideUpdateDialog++;
      try {
        return originalUpdateDialog.apply(this, arguments);
      } finally {
        state.insideUpdateDialog--;
      }
    };

    let wrappedSortedUpdate = function() {
      if (freezeEnabled && state.insideUpdateDialog > 0) {
        suppressedSortUpdates++;
        return Promise.resolve();
      }
      return originalSortedUpdate.apply(this, arguments);
    };

    xd.updateDialog = wrappedUpdateDialog;
    sortedList.update = wrappedSortedUpdate;
    listStates.set(xd, {sortedList: sortedList});

    patches.push({target: xd, key: 'updateDialog', original: originalUpdateDialog, wrapped: wrappedUpdateDialog});
    patches.push({target: sortedList, key: 'update', original: originalSortedUpdate, wrapped: wrappedSortedUpdate});
    patchedListCount++;
    return true;
  }

  function patchManager(manager) {
    if (!manager || patchedManagers.has(manager)) {
      return false;
    }

    if (typeof manager.l === 'function') {
      let originalFactory = manager.l;
      let wrappedFactory = function() {
        let result = originalFactory.apply(this, arguments);
        if (result && result.xd) {
          patchList(result.xd);
        }
        return result;
      };

      manager.l = wrappedFactory;
      patches.push({target: manager, key: 'l', original: originalFactory, wrapped: wrappedFactory});
    }

    if (manager.xds) {
      for (let key in manager.xds) {
        patchList(manager.xds[key]);
      }
    }
    patchList(manager.xd);

    patchedManagers.add(manager);
    appManager = manager;
    return true;
  }

  function findManager() {
    let manager = page.appDialogsManager;
    if (!manager || typeof manager.l !== 'function' || !manager.xds) {
      return false;
    }
    return patchManager(manager);
  }

  function setFrozen(enabled) {
    freezeEnabled = Boolean(enabled);
    let message = freezeEnabled ? '已啟用：聊天項目排序凍結' : '已停用：恢復 Telegram 原生排序';
    console.info('[TeleTether]', message);
    return getStatus();
  }

  function toggleFreeze() {
    return setFrozen(!freezeEnabled);
  }

  function getStatus() {
    return {
      version: VERSION,
      connected: !!appManager,
      freezeEnabled: freezeEnabled,
      patchedLists: patchedListCount,
      suppressedSortUpdates: suppressedSortUpdates
    };
  }

  function restore() {
    setFrozen(false);
    for (let i = patches.length - 1; i >= 0; i--) {
      let patch = patches[i];
      if (patch.target[patch.key] === patch.wrapped) {
        patch.target[patch.key] = patch.original;
      }
    }
    patches.length = 0;
    console.info('[TeleTether] 已撤銷本次注入的攔截；重新載入頁面可重新啟用。');
    return getStatus();
  }

  page.TeleTether = {
    version: VERSION,
    freeze: function() { return setFrozen(true); },
    unfreeze: function() { return setFrozen(false); },
    toggle: toggleFreeze,
    status: getStatus,
    restore: restore
  };

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('TeleTether：切換排序凍結', toggleFreeze);
    GM_registerMenuCommand('TeleTether：查看狀態', function() {
      console.table(getStatus());
    });
    GM_registerMenuCommand('TeleTether：撤銷攔截', restore);
  }

  if (!findManager()) {
    let observer = new MutationObserver(function() {
      if (findManager()) {
        observer.disconnect();
        console.info('[TeleTether] 已連接 Telegram Web K。', getStatus());
      }
    });
    observer.observe(document.documentElement, {childList: true, subtree: true});
  } else {
    console.info('[TeleTether] 已連接 Telegram Web K。', getStatus());
  }
})();
