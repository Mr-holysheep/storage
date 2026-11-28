# TeleTether

Telegram Web K 左側聊天清單優化原型。

## 目前版本：0.1.2

0.1.1 診斷顯示：清單移動時，Telegram 會經由 `AutonomousDialogListBase.updateDialog()` → `addOrDeleteDialogIfNeeded()` → `deleteDialog()` 移除聊天項目，之後又經由 `SortedDialogList.add()` 重新加入。每次刪除的 `removePinnedItem()` 與 `removeItem()` 是 `SortedDialogList.delete()` 同時檢查置頂／一般集合的正常行為。

0.1.2 增加針對這條流程的診斷，記錄：

- 每個清單的 `listId` 與 `filterId`。
- `updateDialog()`、`addOrDeleteDialogIfNeeded())、`canUpdateDialog()) 的呼叫。
- `canUpdateDialog()` 判斷時的 dialogIndex、目前已載入清單的 bottomIndex、loadedItemCount、hasReachedTheEnd 及判斷結果。
- `SortedDialogList.add()` / `delete()` 的呼叫端堆疊。
- `getIndexForKey()` 最終取得的排序索引。

本版本不增加新的攔截範圍，診斷紀錄也不會阻止新增／刪除操作。

## 安裝／更新

使用 Tampermonkey 或 Violentmonkey，開啟 [TeleTether.user.js](https://raw.githubusercontent.com/Mr-holysheep/storage/main/TeleTether/TeleTether.user.js) 安裝或更新，然後重新載入 Telegram Web K。

## 操作

使用者腳本管理器選單提供：

- **切換排序凍結**：開啟／關閉原型功能。
- **查看狀態**：顯示連線、接管清單數及攔截次數。
- **開始更新路徑診斷**：開始記錄凍結期間的內部清單操作。
- **輸出診斷報告**：停止收集並在主控台輸出方法、清單識別、索引判斷值與呼叫堆疊。
- **撤銷攔截**：還原本次注入的函式包裝。

也可以在 Telegram 頁面的開發者主控台使用：

```js
TeleTether.freeze();
TeleTether.unfreeze();
TeleTether.status();
TeleTether.diagnostics(true);
TeleTether.diagnostics(false);
TeleTether.report();
TeleTether.restore();
```

## 測試方式

1. 更新腳本並重新載入 Telegram Web K。
2. 啟用「排序凍結」。
3. 在主控台執行 `TeleTether.diagnostics(true)`。
4. 讓原本會造成聊天項目移動的情況再發生。
5. 執行 `TeleTether.diagnostics(false)`，查看報告。

優先觀察：

- 同一個 `peerId` 是否在同一個 `listId/filterId` 被移除後重新加入。
- `canUpdateDialog` 的 `dialogIndex) 是否小於 `bottomIndex)，以及當時的 `hasReachedTheEnd)。
- `SortedDialogList.add()` 的呼叫端堆疊，確認重新加入來自哪個更新事件。
- 同一個 ID 的重複加入是否其實發生於不同資料夾清單。

目前尚未在使用者的 Telegram 帳號上實測 0.1.2。診斷資料最多保留 200 筆，且只在排序凍結與診斷同時啟用時收集。

## Telegram Web K 原始碼參考

- [AutonomousDialogListBase](https://github.com/morethanwords/tweb/blob/master/src/components/autonomousDialogList/base.ts)
- [AutonomousDialogList](https://github.com/morethanwords/tweb/blob/master/src/components/autonomousDialogList/dialogs.ts)
- [SortedDialogList](https://github.com/morethanwords/tweb/blob/master/src/components/sortedDialogList.ts)
- [DeferredSortedVirtualList](https://github.com/morethanwords/tweb/blob/master/src/components/deferredSortedVirtualList.tsx)
- [AppDialogsManager](https://github.com/morethanwords/tweb/blob/master/src/lib/appDialogsManager.ts)
