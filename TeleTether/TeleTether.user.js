// ==UserScript==
// @name         TeleTether
// @namespace    https://github.com/Mr-holysheep/storage
// @version      0.1.1
// @description  Telegram Web K 聊天清單排序凍結與更新路徑診斷
// @match        https://web.telegram.org/k/*
// @run-at       document-idle
// @grant        unsafeWindow
// @grant        GM_registerMenuCommand
// @downloadURL  https://raw.githubusercontent.com/Mr-holysheep/storage/main/TeleTether/TeleTether.user.js
// @updateURL    https://raw.githubusercontent.com/Mr-holysheep/storage/main/TeleTether/TeleTether.user.js
// ==/UserScript==

(function() {
  'use strict';

  let VERSION = '0.1.1';
  let page = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  let freezeEnabled = false;
  let diagnosticsEnabled = false;
  let appManager = null;
  let suppressedSortUpdates = 0;
  let patchedListCount = 0;
  let patchedVirtualListCount = 0;
  let patches = [];
  let diagnosticEvents = [];
  let diagnosticCounts = Object.create(null);
  let patchedManagers = new WeakSet();
  let listStates = new WeakMap();

  function summarizeItems(items) {
    if (!Array.isArray(items)) {
      return String(items);
    }

    let result = items.slice(0, 12).map(function(item) {
      if (!item || typeof item !== 'object') {
        return String(item);
      }
      let id = item.id !== undefined ? String(item.id) : '?';
      let index = item.index !== undefined ? '@' + item.index : '';
      return id + index;
    });

    if (items.length > 12) {
      result.push('... +' + (items.length - 12));
    }
    return result.join(', ');
  }

  function recordMutation(operation, detail) {
    if (!diagnosticsEnabled || !freezeEnabled) {
      return;
    }

    let stack = new Error().stack || '';
    let event = {
      number: diagnosticEvents.length + 1,
      time: new Date().toLocaleTimeString(),
      operation: operation,
      detail: detail,
      stack: stack.split('\n').slice(2, 12).join('\n')
    };

    diagnosticEvents.push(event);
    if (diagnosticEvents.length > 150) {
      diagnosticEvents.shift();
    }

    diagnosticCounts[operation] = (diagnosticCounts[operation] || 0) + 1;
  }

  function observeVirtualMethod(virtualList, key, operation, describe) {
    let original = virtualList[key];
    if (typeof original !== 'function' || original.__teleTetherObserved) {
      return;
    }

    let wrapped = function() {
      if (diagnosticsEnabled && freezeEnabled) {
        recordMutation(operation, describe(arguments));
      }
      return original.apply(this, arguments);
    };

    wrapped.__teleTetherObserved = true;
    virtualList[key] = wrapped;
    patches.push({target: virtualList, key: key, original: original, wrapped: wrapped});
  }

  function patchVirtualList(xd) {
    let virtualList = xd.sortedList.virtualList;
    if (!virtualList || typeof virtualList.updateItem !== 'function') {
      return false;
    }

    observeVirtualMethod(virtualList, 'updateItem', 'virtualList.updateItem', function(args) {
      return String(args[0]) + ' -> index ' + String(args[1]);
    });
    observeVirtualMethod(virtualList, 'addItems', 'virtualList.addItems', function(args) {
      return summarizeItems(args[0]);
    });
    observeVirtualMethod(virtualList, 'addPinnedItems', 'virtualList.addPinnedItems', function(args) {
      return summarizeItems(args[0]);
    });
    observeVirtualMethod(virtualList, 'ensurePinnedItems', 'virtualList.ensurePinnedItems', function(args) {
      return summarizeItems(args[0]);
    });
    observeVirtualMethod(virtualList, 'removeItem', 'virtualList.removeItem', function(args) {
      return String(args[0]);
    });
    observeVirtualMethod(virtualList, 'removePinnedItem', 'virtualList.removePinnedItem', function(args) {
      return String(args[0]);
    });
    observeVirtualMethod(virtualList, 'clear', 'virtualList.clear', function() {
      return 'clear all items';
    });

    patchedVirtualListCount++;
    return true;
  }

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
    patchVirtualList(xd);
    listStates.set(xd, state);

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

  function startDiagnostics() {
    diagnosticEvents = [];
    diagnosticCounts = Object.create(null);
    diagnosticsEnabled = true;
    console.info('[TeleTether] 診斷收集已開始。請在凍結狀態下重現清單移動。');
    return getStatus();
  }

  function stopDiagnostics() {
    diagnosticsEnabled = false;
    return reportDiagnostics();
  }

  function reportDiagnostics() {
    let summary = Object.keys(diagnosticCounts).map(function(operation) {
      return {operation: operation, count: diagnosticCounts[operation]};
    });

    console.group('[TeleTether] 清單更新診斷報告');
    console.table(summary);
    console.table(diagnosticEvents.map(function(event) {
      return {
        number: event.number,
        time: event.time,
        operation: event.operation,
        detail: event.detail
      };
    }));
    diagnosticEvents.forEach(function(event) {
      console.log('#' + event.number + ' ' + event.operation + ' ' + event.detail + '\n' + event.stack);
    });
    console.groupEnd();

    return {
      counts: summary,
      events: diagnosticEvents.slice()
    };
  }

  function clearDiagnostics() {
    diagnosticEvents = [];
    diagnosticCounts = Object.create(null);
    console.info('[TeleTether] 診斷資料已清空。');
    return getStatus();
  }

  function getStatus() {
    return {
      version: VERSION,
      connected: !!appManager,
      freezeEnabled: freezeEnabled,
      diagnosticsEnabled: diagnosticsEnabled,
      patchedLists: patchedListCount,
      patchedVirtualLists: patchedVirtualListCount,
      suppressedSortUpdates: suppressedSortUpdates,
      diagnosticEvents: diagnosticEvents.length
    };
  }

  function restore() {
    setFrozen(false);
    diagnosticsEnabled = false;
    for (let i = patches.length - 1; i >= 0; i--) {
      let patch = patches[i];
      if (patch.target[patch.key] === patch.wrapped) {
        patch.target[patch.key] = patch.original;
      }
    }
    patches.length = 0;
    console.info('[TeleTether] 已撤銷本次注入的攔截與診斷；重新載入頁面可重新啟用。');
    return getStatus();
  }

  page.TeleTether = {
    version: VERSION,
    freeze: function() { return setFrozen(true); },
    unfreeze: function() { return setFrozen(false); },
    toggle: toggleFreeze,
    status: getStatus,
    diagnostics: function(enabled) {
      return enabled ? startDiagnostics() : stopDiagnostics();
    },
    report: reportDiagnostics,
    clearDiagnostics: clearDiagnostics,
    restore: restore
  };

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('TeleTether：切換排序凍結', toggleFreeze);
    GM_registerMenuCommand('TeleTether：查看狀態', function() {
      console.table(getStatus());
    });
    GM_registerMenuCommand('TeleTether：開始更新路徑診斷', startDiagnostics);
    GM_registerMenuCommand('TeleTether：輸出診斷報告', stopDiagnostics);
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
