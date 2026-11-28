// ==UserScript==
// @name         TeleTether
// @namespace    https://github.com/Mr-holysheep/storage
// @version      0.1.2
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

  let VERSION = '0.1.2';
  let page = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  let freezeEnabled = false;
  let diagnosticsEnabled = false;
  let appManager = null;
  let suppressedSortUpdates = 0;
  let patchedListCount = 0;
  let patchedVirtualListCount = 0;
  let nextListId = 1;
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

  function recordMutation(operation, detail, state, stackOffset) {
    if (!diagnosticsEnabled || !freezeEnabled) {
      return;
    }

    let stack = new Error().stack || '';
    let event = {
      number: diagnosticEvents.length + 1,
      time: new Date().toLocaleTimeString(),
      listId: state ? state.listId : null,
      filterId: state ? state.filterId : null,
      operation: operation,
      detail: detail,
      stack: stack.split('\n').slice(stackOffset || 2, (stackOffset || 2) + 12).join('\n')
    };

    diagnosticEvents.push(event);
    if (diagnosticEvents.length > 200) {
      diagnosticEvents.shift();
    }

    diagnosticCounts[operation] = (diagnosticCounts[operation] || 0) + 1;
  }

  function addPatch(target, key, original, wrapped) {
    target[key] = wrapped;
    patches.push({target: target, key: key, original: original, wrapped: wrapped});
  }

  function observeVirtualMethod(virtualList, key, operation, describe, state) {
    let original = virtualList[key];
    if (typeof original !== 'function' || original.__teleTetherObserved) {
      return;
    }

    let wrapped = function() {
      if (diagnosticsEnabled && freezeEnabled) {
        recordMutation(operation, describe(arguments), state, 3);
      }
      return original.apply(this, arguments);
    };

    wrapped.__teleTetherObserved = true;
    addPatch(virtualList, key, original, wrapped);
  }

  function getDialogSnapshot(dialog, xd, state) {
    if (!dialog || typeof dialog !== 'object') {
      return String(dialog);
    }

    let sortedItems = xd.sortedList.getSortedItems();
    let last = sortedItems[sortedItems.length - 1];
    let indexKey = xd.indexKey;
    return {
      peerId: dialog.peerId,
      indexKey: indexKey,
      dialogIndex: indexKey ? dialog[indexKey] : undefined,
      bottomIndex: last ? last.index : undefined,
      loadedItemCount: sortedItems.length,
      hasReachedTheEnd: xd.hasReachedTheEnd,
      filterId: state.filterId,
      listId: state.listId
    };
  }

  function patchDialogListMethods(xd, state) {
    let methods = [
      {
        key: 'updateDialog',
        operation: 'list.updateDialog',
        before: function(args) { return getDialogSnapshot(args[0], xd, state); }
      },
      {
        key: 'addOrDeleteDialogIfNeeded',
        operation: 'list.addOrDeleteDialogIfNeeded',
        before: function(args) { return getDialogSnapshot(args[0], xd, state); }
      },
      {
        key: 'canUpdateDialog',
        operation: 'list.canUpdateDialog',
        before: function(args) { return getDialogSnapshot(args[0], xd, state); }
      }
    ];

    for (let i = 0; i < methods.length; i++) {
      let item = methods[i];
      let original = xd[item.key];
      if (typeof original !== 'function' || original.__teleTetherObserved) {
        continue;
      }

      let wrapped = function() {
        let detail = diagnosticsEnabled && freezeEnabled ? item.before(arguments) : null;
        let result = original.apply(this, arguments);
        if (diagnosticsEnabled && freezeEnabled) {
          if (item.key === 'canUpdateDialog') {
            detail.result = result;
          } else if (item.key === 'addOrDeleteDialogIfNeeded') {
            detail.result = result;
          }
          recordMutation(item.operation, detail, state, 3);
        }
        return result;
      };

      wrapped.__teleTetherObserved = true;
      addPatch(xd, item.key, original, wrapped);
    }
  }

  function patchSortedListMethods(sortedList, state) {
    let methods = ['add', 'delete'];
    for (let i = 0; i < methods.length; i++) {
      let key = methods[i];
      let original = sortedList[key];
      if (typeof original !== 'function' || original.__teleTetherObserved) {
        continue;
      }

      let wrapped = function() {
        if (diagnosticsEnabled && freezeEnabled) {
          recordMutation('sortedList.' + key, summarizeItems([{id: arguments[0]}]), state, 3);
        }
        return original.apply(this, arguments);
      };

      wrapped.__teleTetherObserved = true;
      addPatch(sortedList, key, original, wrapped);
    }

    let originalGetIndex = sortedList.getIndexForKey;
    if (typeof originalGetIndex === 'function' && !originalGetIndex.__teleTetherObserved) {
      let wrappedGetIndex = function() {
        let key = arguments[0];
        let result = originalGetIndex.apply(this, arguments);
        if (diagnosticsEnabled && freezeEnabled) {
          if (result && typeof result.then === 'function') {
            return result.then(function(index) {
              recordMutation('sortedList.getIndexForKey:resolved', String(key) + ' -> ' + String(index), state, 3);
              return index;
            });
          }
          recordMutation('sortedList.getIndexForKey', String(key) + ' -> ' + String(result), state, 3);
        }
        return result;
      };

      wrappedGetIndex.__teleTetherObserved = true;
      addPatch(sortedList, 'getIndexForKey', originalGetIndex, wrappedGetIndex);
    }
  }

  function patchVirtualList(xd, state) {
    let virtualList = xd.sortedList.virtualList;
    if (!virtualList || typeof virtualList.updateItem !== 'function') {
      return false;
    }

    observeVirtualMethod(virtualList, 'updateItem', 'virtualList.updateItem', function(args) {
      return String(args[0]) + ' -> index ' + String(args[1]);
    }, state);
    observeVirtualMethod(virtualList, 'addItems', 'virtualList.addItems', function(args) {
      return summarizeItems(args[0]);
    }, state);
    observeVirtualMethod(virtualList, 'addPinnedItems', 'virtualList.addPinnedItems', function(args) {
      return summarizeItems(args[0]);
    }, state);
    observeVirtualMethod(virtualList, 'ensurePinnedItems', 'virtualList.ensurePinnedItems', function(args) {
      return summarizeItems(args[0]);
    }, state);
    observeVirtualMethod(virtualList, 'removeItem', 'virtualList.removeItem', function(args) {
      return String(args[0]);
    }, state);
    observeVirtualMethod(virtualList, 'removePinnedItem', 'virtualList.removePinnedItem', function(args) {
      return String(args[0]);
    }, state);
    observeVirtualMethod(virtualList, 'clear', 'virtualList.clear', function() {
      return 'clear all items';
    }, state);

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
    let state = {
      listId: nextListId++,
      filterId: xd.filterId === undefined ? null : xd.filterId,
      insideUpdateDialog: 0
    };

    patchDialogListMethods(xd, state);
    patchSortedListMethods(sortedList, state);
    patchVirtualList(xd, state);

    let originalSortedUpdate = sortedList.update;
    let wrappedSortedUpdate = function() {
      if (freezeEnabled && state.insideUpdateDialog > 0) {
        suppressedSortUpdates++;
        recordMutation('sortedList.update:suppressed', String(arguments[0]), state, 3);
        return Promise.resolve();
      }
      if (diagnosticsEnabled && freezeEnabled) {
        recordMutation('sortedList.update:allowed', String(arguments[0]), state, 3);
      }
      return originalSortedUpdate.apply(this, arguments);
    };

    addPatch(sortedList, 'update', originalSortedUpdate, wrappedSortedUpdate);

    let originalUpdateDialog = xd.updateDialog;
    let wrappedUpdateDialog = function() {
      state.insideUpdateDialog++;
      try {
        return originalUpdateDialog.apply(this, arguments);
      } finally {
        state.insideUpdateDialog--;
      }
    };

    addPatch(xd, 'updateDialog', originalUpdateDialog, wrappedUpdateDialog);
    listStates.set(xd, state);
    patchedListCount++;
    console.info('[TeleTether] 已接管清單', {listId: state.listId, filterId: state.filterId});
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

      addPatch(manager, 'l', originalFactory, wrappedFactory);
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
    console.info('[TeleTether]', freezeEnabled ? '已啟用：聊天項目排序凍結' : '已停用：恢復 Telegram 原生排序');
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

  function reportDiagnostics() {
    diagnosticsEnabled = false;
    let summary = Object.keys(diagnosticCounts).map(function(operation) {
      return {operation: operation, count: diagnosticCounts[operation]};
    });

    console.group('[TeleTether] 清單更新診斷報告');
    console.table(summary);
    console.table(diagnosticEvents.map(function(event) {
      return {
        number: event.number,
        time: event.time,
        listId: event.listId,
        filterId: event.filterId,
        operation: event.operation,
        detail: typeof event.detail === 'object' ? JSON.stringify(event.detail) : event.detail
      };
    }));
    diagnosticEvents.forEach(function(event) {
      console.log('#' + event.number + ' [' + event.listId + '/' + event.filterId + '] ' + event.operation + ' ' + JSON.stringify(event.detail) + '\n' + event.stack);
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
      return enabled ? startDiagnostics() : reportDiagnostics();
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
    GM_registerMenuCommand('TeleTether：輸出診斷報告', reportDiagnostics);
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
